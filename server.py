#!/usr/bin/env python3
"""Small same-origin API and SQLite persistence for Trimlight Home Studio."""
import json
import ipaddress
import math
import os
import re
import sqlite3
import socket
import threading
import time
from contextlib import contextmanager, nullcontext
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DB_PATH = os.environ.get("STUDIO_DB", "/data/studio.sqlite3")
MAX_BODY = 8 * 1024 * 1024
DEFAULT_HOUSE_SIDES = [{"id": "front", "label": "Front"}, {"id": "right", "label": "Right side"}, {"id": "rear", "label": "Rear"}, {"id": "left", "label": "Left side"}, {"id": "shed", "label": "Shed"}]
DEFAULT_SETTINGS = {"mode": "demo", "host": "", "channelCount": 4, "outputs": [], "photo": "", "photoSize": [2000, 1500], "houseViews": {}, "houseSides": DEFAULT_HOUSE_SIDES, "timezone": "UTC"}
SCHEDULE_STATUS = {"enabled": False, "state": "disabled", "message": "", "updated": None, "program": None, "date": None}
SCHEDULE_STATUS_LOCK = threading.Lock()
SCHEDULE_WRITE_LOCK = threading.Lock()
SCHEDULE_LAST_KEY = None
SCHEDULE_RETRY_AT = 0
SCHEDULE_RETRY_DELAY = 30
SCHEDULE_RETRY_KEY = None
SCHEDULE_AUXILIARY_KEY = None


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


WLED_HTTP = build_opener(ProxyHandler({}), NoRedirect())


def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")
    conn.execute("CREATE TABLE IF NOT EXISTS studio_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
    return conn


@contextmanager
def database():
    conn = connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def read_state(conn, key):
    row = conn.execute("SELECT value FROM studio_state WHERE key = ?", (key,)).fetchone()
    return json.loads(row[0]) if row else None


def write_state(conn, key, value):
    conn.execute(
        "INSERT INTO studio_state(key, value, updated_at) VALUES(?, ?, CURRENT_TIMESTAMP) "
        "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=CURRENT_TIMESTAMP",
        (key, json.dumps(value, ensure_ascii=False, separators=(",", ":"))),
    )


def scheduler_status(**updates):
    with SCHEDULE_STATUS_LOCK:
        SCHEDULE_STATUS.update(updates)
        return dict(SCHEDULE_STATUS)


def wled_base(host):
    """Resolve only local controller addresses; this service must not become an SSRF proxy."""
    host = str(host or "").strip().strip("[]")
    if not host or len(host) > 255 or any(c in host for c in "/?#@\\"):
        raise ValueError("Set a valid local WLED controller address in Wiring & setup.")
    try:
        literal = ipaddress.ip_address(host.split("%", 1)[0])
        addresses = [literal]
    except ValueError:
        try:
            results = socket.getaddrinfo(host, 80, type=socket.SOCK_STREAM)
        except OSError as exc:
            raise ValueError("The API container cannot resolve the WLED address: " + str(exc)) from exc
        addresses = []
        for result in results:
            try:
                addresses.append(ipaddress.ip_address(result[4][0].split("%", 1)[0]))
            except ValueError:
                continue
    if not addresses or any(not address.is_private or address.is_loopback or address.is_link_local or address.is_multicast or address.is_unspecified for address in addresses):
        raise ValueError("The scheduler only connects to WLED controllers on a private local network.")
    # Connect to the validated address without resolving the hostname again.
    address = next((address for address in addresses if address.version == 4), addresses[0])
    return f"http://[{address}]" if address.version == 6 else f"http://{address}"


def wled_json(base, path, body=None):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = Request(base + path, data=data, headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with WLED_HTTP.open(request, timeout=4) as response:
            payload = response.read(1_000_000)
            if response.status < 200 or response.status >= 300:
                raise ValueError("WLED returned HTTP " + str(response.status))
            result = json.loads(payload.decode("utf-8")) if payload else {}
            if body is not None and (not isinstance(result, dict) or result.get("success") is not True):
                error = result.get("error") if isinstance(result, dict) else None
                raise ValueError("WLED did not acknowledge the preset update" + (" (error " + str(error) + ")." if error else "."))
            return result
    except HTTPError as exc:
        raise ValueError("WLED returned HTTP " + str(exc.code)) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ValueError("Could not reach WLED from the API container: " + str(exc)) from exc


def scheduled_selection(app, now, timezone_fallback="UTC"):
    schedule = app.get("schedule") or {}
    zone_name = schedule.get("timezone") or timezone_fallback or "UTC"
    try:
        local_now = now.astimezone(ZoneInfo(zone_name))
    except (ZoneInfoNotFoundError, ValueError):
        zone_name = "UTC"
        local_now = now.astimezone(ZoneInfo("UTC"))
    day = local_now.weekday()
    # Python Monday=0, browser Sunday=0.
    dow = (day + 1) % 7
    date_key = local_now.date().isoformat()
    programs = schedule.get("programs") if isinstance(schedule.get("programs"), list) else []
    matches = [p for p in programs if isinstance(p, dict) and p.get("on") is not False and isinstance(p.get("start"), str) and isinstance(p.get("end"), str) and p["start"] <= date_key <= p["end"] and isinstance(p.get("body"), dict)]
    program = max(matches, key=lambda p: p.get("start", ""), default=None)
    weekly = schedule.get("weeklyLooks") if isinstance(schedule.get("weeklyLooks"), dict) else {}
    weekly_bodies = schedule.get("weeklyBodies") if isinstance(schedule.get("weeklyBodies"), dict) else {}
    weekly_id = weekly.get(str(dow))
    base_entry = weekly_bodies.get(str(dow)) if weekly_id else None
    has_weekly = isinstance(base_entry, dict) and base_entry.get("look") == weekly_id and isinstance(base_entry.get("body"), dict)
    if has_weekly:
        base_body = base_entry["body"]
        base_name = base_entry.get("name") or "Weekday look"
    else:
        default = schedule.get("default") if isinstance(schedule.get("default"), dict) else {}
        base_body = default.get("body") if default.get("look") == schedule.get("eveLook", "current") and isinstance(default.get("body"), dict) else None
        base_name = default.get("name") or "Usual look"
    selection = program if program else (base_entry if has_weekly else None)
    body = selection.get("body") if selection else base_body
    name = (program.get("name") if program else None) or (selection.get("name") if selection else None) or base_name
    slot = 244 + dow if has_weekly else 240
    return {"date": date_key, "dow": dow, "slot": slot, "body": body, "name": name, "program": program.get("name") if program else None, "timezone": zone_name}


PRESET_FIELDS = {"on", "bri", "transition", "tt", "mainseg", "seg", "playlist", "lor", "pl", "ifon", "n"}
SEGMENT_FIELDS = {"id", "start", "stop", "grp", "spc", "of", "on", "frz", "bri", "cct", "set", "sel",
                  "rev", "mi", "fx", "sx", "ix", "pal", "c1", "c2", "c3", "o1", "o2", "o3",
                  "si", "m12", "bm", "tlsbm", "fe", "tlc", "mod", "slow", "col", "n"}
PLAYLIST_FIELDS = {"ps", "dur", "transition", "repeat", "end", "r"}


def preset_command(body, name):
    if not isinstance(body, dict):
        raise ValueError("Missing WLED preset command.")
    command = {key: value for key, value in body.items() if key in PRESET_FIELDS}
    if "seg" in command:
        segments = command["seg"]
        if not isinstance(segments, list) or len(segments) > 64 or not all(isinstance(seg, dict) for seg in segments):
            raise ValueError("Invalid WLED preset segments.")
        command["seg"] = [{key: value for key, value in seg.items() if key in SEGMENT_FIELDS} for seg in segments]
    if "playlist" in command:
        playlist = command["playlist"]
        if not isinstance(playlist, dict) or not isinstance(playlist.get("ps"), list) or not playlist["ps"]:
            raise ValueError("Invalid WLED playlist.")
        command["playlist"] = {key: value for key, value in playlist.items() if key in PLAYLIST_FIELDS}
    command["n"] = str(name).encode("utf-8")[:32].decode("utf-8", errors="ignore")
    return command


def preset_matches(stored, expected, *, legacy=False):
    if not isinstance(stored, dict):
        return False
    for key, value in expected.items():
        if legacy and "playlist" in expected and key == "bri":
            # Stock WLED serializes the playlist and power, without master brightness.
            continue
        if legacy and key == "playlist":
            playlist = stored.get(key)
            if not isinstance(playlist, dict):
                return False
            wanted = dict(value)
            actual = {field: playlist.get(field) for field in value}
            if wanted.get("r"):
                # WLED can shuffle before its asynchronous save. Match complete steps.
                fields = ("ps", "dur", "transition")
                steps = [actual.get(field) for field in fields]
                if any(not isinstance(step, list) or len(step) != len(wanted["ps"]) for step in steps):
                    return False
                if sorted(zip(*steps)) != sorted(zip(*(wanted[field] for field in fields))):
                    return False
                for field in fields:
                    del wanted[field], actual[field]
            if actual != wanted:
                return False
            continue
        if key != "seg":
            if stored.get(key) != value:
                return False
            continue
        actual = stored.get("seg")
        if not isinstance(actual, list) or len(actual) != len(value):
            return False
        for index, (got, want) in enumerate(zip(actual, value)):
            if not isinstance(got, dict):
                return False
            for field, item in want.items():
                other = got.get(field, index if field == "id" else None)
                if field == "slow" and item == 1 and other is None:
                    continue
                if field == "col" and isinstance(other, list) and isinstance(item, list):
                    rgbw = lambda colors: [color + [0] * (4 - len(color)) if isinstance(color, list) else color for color in colors]
                    if rgbw(other) == rgbw(item):
                        continue
                if other != item:
                    return False
    return True


def make_schedule_fingerprint(host, selection):
    body = selection["body"]
    command = preset_command(body, "Studio · " + selection["name"]) if body is not None else None
    return json.dumps([host, selection["slot"], command], sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def stored_preset(base, slot):
    presets = wled_json(base, "/presets.json")
    if not isinstance(presets, dict):
        raise ValueError("WLED returned an invalid preset file.")
    return presets.get(str(slot))


def restore_wled_state(base, previous):
    current = wled_json(base, "/json/state")
    segments = previous.get("seg", [])
    ids = {seg["id"] for seg in segments}
    added = [{"id": seg["id"], "stop": 0} for seg in current.get("seg", []) if seg["id"] not in ids]
    restore = {key: previous[key] for key in ("on", "bri", "transition", "mainseg", "lor") if key in previous}
    restore.update({"tt": 0, "seg": segments + added})
    if previous.get("ps", -1) > 0:
        restore["pd"] = previous["ps"]
    wled_json(base, "/json/state", restore)
    if previous.get("pl", -1) > 0:
        wled_json(base, "/json/state", {"ps": previous["pl"]})


def store_wled_preset(base, slot, command, non_applying, *, existing=None):
    before = stored_preset(base, slot) if existing is None else existing.get(str(slot))
    if preset_matches(before, command, legacy=not non_applying):
        return False
    if non_applying:
        try:
            wled_json(base, "/json/state", {"psstore": slot, "preset": command})
        except ValueError:
            # A timed-out response can mean the write completed. Check before retrying.
            if not preset_matches(stored_preset(base, slot), command):
                raise
            return True
    else:
        # Stock WLED and older Studio firmware apply the command while storing it.
        previous = wled_json(base, "/json/state")
        try:
            wled_json(base, "/json/state", {**command, "psave": slot, "ib": True, "sb": True, "o": True})
            if "playlist" in command:
                # Older WLED saves playlists asynchronously.
                time.sleep(0.4)
        finally:
            restore_wled_state(base, previous)
    if not preset_matches(stored_preset(base, slot), command, legacy=not non_applying):
        raise ValueError(f"WLED did not verify preset {slot}.")
    return True


def scheduler_enabled(conn):
    return read_state(conn, "scheduler_enabled") is not False


def scheduler_status_for(settings, enabled):
    configured = settings.get("mode") == "wled" and bool(settings.get("host"))
    fields = {"enabled": enabled, "settingsMode": settings.get("mode", "demo"), "controllerConfigured": configured}
    if not enabled:
        return scheduler_status(**fields, state="paused", message="Calendar writes are paused. WLED keeps its existing timers.", program=None, date=None)
    if not configured:
        return scheduler_status(**fields, state="disabled", message="Save a WLED controller address in Wiring & setup.", program=None, date=None)
    if SCHEDULE_STATUS["state"] in {"paused", "disabled"}:
        return scheduler_status(**fields, state="starting", message="Waiting for the scheduler to check the saved WLED controller.")
    return scheduler_status(**fields)


def apply_scheduled_preset(host, selection):
    base = wled_base(host)
    info = wled_json(base, "/json/info")
    command = preset_command(selection["body"], "Studio · " + selection["name"])
    return store_wled_preset(base, selection["slot"], command, info.get("studioPresetStore") is True)


def auxiliary_presets(schedule):
    entries = schedule.get("auxiliaryPresets", [])
    if not isinstance(entries, list) or len(entries) > 41:
        raise ValueError("Invalid calendar preset list.")
    commands = {}
    for entry in entries:
        if not isinstance(entry, dict) or type(entry.get("slot")) is not int or entry["slot"] not in {*range(200, 240), 241}:
            raise ValueError("Invalid calendar preset slot.")
        commands[entry["slot"]] = preset_command(entry.get("body"), entry.get("name", "Studio look"))
    return commands


def store_preset_batch(base, commands, non_applying):
    if not commands:
        return 0
    existing = wled_json(base, "/presets.json")
    if not isinstance(existing, dict):
        raise ValueError("WLED returned an invalid preset file.")
    return sum(store_wled_preset(base, slot, command, non_applying, existing=existing) for slot, command in commands.items())


def configure_timers(base, timers, location):
    config = wled_json(base, "/json/cfg")
    ntp = config.setdefault("if", {}).setdefault("ntp", {})
    wanted_ntp = {"en": True}
    if isinstance(location, dict) and all(type(location.get(key)) in (int, float) and abs(location[key]) <= limit for key, limit in (("lt", 90), ("ln", 180))):
        wanted_ntp.update(lt=location["lt"], ln=location["ln"])
    def timer_keys(entries):
        keys = []
        for timer in entries:
            if timer.get("en") and timer.get("macro"):
                start = timer.get("start") or {}
                end = timer.get("end") or {}
                keys.append((timer["hour"], timer["min"], timer["macro"], timer["dow"],
                             start.get("mon", 1), start.get("day", 1), end.get("mon", 12), end.get("day", 31)))
        return sorted(keys)
    current = config.setdefault("timers", {}).get("ins", [])
    if timer_keys(current) != timer_keys(timers) or any(ntp.get(key) != value for key, value in wanted_ntp.items()):
        ntp.update(wanted_ntp)
        config["timers"]["ins"] = timers
        config.get("hw", {}).get("led", {}).pop("ins", None)
        wled_json(base, "/json/cfg", config)
        current = wled_json(base, "/json/cfg").get("timers", {}).get("ins", [])
        if timer_keys(current) != timer_keys(timers):
            raise ValueError("WLED did not retain the requested timers.")
    return len(timer_keys(current))


def validate_timers(timers):
    bounds = {"en": (0, 1), "hour": (0, 255), "min": (-59, 59), "macro": (0, 250), "dow": (0, 127)}
    if not isinstance(timers, list) or len(timers) > 64 or any(
        not isinstance(timer, dict) or timer.keys() != bounds.keys()
        or any(type(timer[key]) is not int or not low <= timer[key] <= high for key, (low, high) in bounds.items())
        for timer in timers
    ):
        raise ValueError("Invalid WLED timers.")


def scheduler_tick():
    global SCHEDULE_LAST_KEY, SCHEDULE_RETRY_AT, SCHEDULE_RETRY_DELAY, SCHEDULE_RETRY_KEY, SCHEDULE_AUXILIARY_KEY
    with SCHEDULE_WRITE_LOCK:
        with database() as conn:
            settings = read_state(conn, "settings") or DEFAULT_SETTINGS
            app = read_state(conn, "app") or {}
            enabled = scheduler_enabled(conn)
        status = scheduler_status_for(settings, enabled)
        if not enabled or not status["controllerConfigured"]:
            SCHEDULE_LAST_KEY = None
            SCHEDULE_AUXILIARY_KEY = None
            return
        fingerprint = None
        try:
            schedule = app.get("schedule") or {}
            selection = scheduled_selection(app, datetime.now().astimezone(), settings.get("timezone", "UTC"))
            if schedule.get("onMode") == "none" or selection["body"] is None:
                SCHEDULE_LAST_KEY = None
                scheduler_status(state="ready", message="No automatic evening preset is scheduled.", program=None, date=selection["date"])
                return
            host = settings["host"]
            auxiliary = auxiliary_presets(schedule)
            auxiliary_key = json.dumps([host, auxiliary], sort_keys=True, ensure_ascii=False)
            evening_key = make_schedule_fingerprint(host, selection)
            fingerprint = (evening_key, auxiliary_key)
            if fingerprint == SCHEDULE_RETRY_KEY and time.monotonic() < SCHEDULE_RETRY_AT:
                return
            if fingerprint != SCHEDULE_RETRY_KEY:
                SCHEDULE_RETRY_DELAY = 30
            if evening_key == SCHEDULE_LAST_KEY and auxiliary_key == SCHEDULE_AUXILIARY_KEY:
                scheduler_status(date=selection["date"], program=selection["program"])
                return
            if auxiliary_key != SCHEDULE_AUXILIARY_KEY and auxiliary:
                base = wled_base(host)
                info = wled_json(base, "/json/info")
                store_preset_batch(base, auxiliary, info.get("studioPresetStore") is True)
            SCHEDULE_AUXILIARY_KEY = auxiliary_key
            changed = evening_key != SCHEDULE_LAST_KEY and apply_scheduled_preset(host, selection)
            SCHEDULE_LAST_KEY = evening_key
            SCHEDULE_RETRY_AT = 0
            SCHEDULE_RETRY_DELAY = 30
            SCHEDULE_RETRY_KEY = None
            action = "Updated" if changed else "Verified"
            scheduler_status(state="active" if selection["program"] else "ready",
                             message=f'{action} {selection["name"]} in WLED preset {selection["slot"]}.',
                             updated=datetime.now().astimezone().isoformat(timespec="seconds"),
                             program=selection["program"], date=selection["date"])
        except (ValueError, TypeError, KeyError, AttributeError) as exc:
            SCHEDULE_RETRY_KEY = fingerprint
            SCHEDULE_RETRY_AT = time.monotonic() + SCHEDULE_RETRY_DELAY
            scheduler_status(state="error", message=f"{str(exc)[:250]} Retrying in {SCHEDULE_RETRY_DELAY} seconds.")
            SCHEDULE_RETRY_DELAY = min(SCHEDULE_RETRY_DELAY * 2, 900)


def scheduler_loop():
    while True:
        try:
            scheduler_tick()
        except sqlite3.Error as exc:
            scheduler_status(state="error", message=str(exc)[:300])
        time.sleep(5)


def validate_settings(settings):
    if not isinstance(settings, dict):
        raise ValueError("Settings must be a JSON object.")
    mode = settings.get("mode", "demo")
    if mode not in ("demo", "wled"):
        raise ValueError("Mode must be demo or wled.")
    host = str(settings.get("host", ""))
    if len(host) > 255 or any(ch in host for ch in "/?#@\\") or host.lower().startswith(("http:", "https:")):
        raise ValueError("Controller address must be a hostname or IP only.")
    timezone = settings.get("timezone", "UTC")
    if not isinstance(timezone, str) or len(timezone) > 100:
        raise ValueError("Time zone must be a valid IANA time-zone name.")
    try:
        ZoneInfo(timezone)
    except (ZoneInfoNotFoundError, ValueError) as exc:
        raise ValueError("Time zone must be a valid IANA time-zone name.") from exc
    outputs = settings.get("outputs", [])
    channel_count = settings.get("channelCount", len(outputs) if isinstance(outputs, list) else 4)
    if channel_count not in (2, 4, 6):
        raise ValueError("Controller channel count must be 2, 4, or 6.")
    if not isinstance(outputs, list) or len(outputs) > 6:
        raise ValueError("WLED settings support up to six output channels.")
    if len(outputs) > channel_count:
        raise ValueError("Configured outputs cannot exceed the selected controller channel capacity.")
    total = 0
    for output in outputs:
        if not isinstance(output, dict):
            raise ValueError("Each output must be an object.")
        leds = output.get("leds")
        if not isinstance(leds, int) or isinstance(leds, bool) or not 1 <= leds <= 10000:
            raise ValueError("Each output must have between 1 and 10,000 LEDs.")
        total += leds
        if total > 10000:
            raise ValueError("The combined layout cannot exceed 10,000 LEDs.")
        points = output.get("points", [])
        if not isinstance(points, list) or len(points) > 500:
            raise ValueError("An output path must contain at most 500 points.")
        for point in points:
            if not isinstance(point, list) or len(point) != 2 or any(not isinstance(v, (int, float)) or isinstance(v, bool) or not 0 <= v <= 1 for v in point):
                raise ValueError("Roofline points must be normalized coordinates between 0 and 1.")
    photo = settings.get("photo", "")
    if photo:
        if not isinstance(photo, str) or len(photo) > 2_300_000 or not re.match(r"^data:image/(jpeg|png|webp);base64,", photo):
            raise ValueError("The home photo must be a resized JPEG, PNG, or WebP image under the storage limit.")
    house_sides = settings.get("houseSides", DEFAULT_HOUSE_SIDES)
    if not isinstance(house_sides, list) or not 1 <= len(house_sides) <= 12:
        raise ValueError("Configure between 1 and 12 house elevations.")
    side_ids = set()
    for side in house_sides:
        if not isinstance(side, dict) or not isinstance(side.get("id"), str) or not re.fullmatch(r"[a-z][a-z0-9-]{0,31}", side["id"]) or side["id"] in side_ids or not isinstance(side.get("label"), str) or not 1 <= len(side["label"].strip()) <= 32:
            raise ValueError("Each house elevation needs a unique identifier and a name from 1 to 32 characters.")
        side_ids.add(side["id"])
    preview_side = settings.get("previewSide")
    if preview_side is not None and preview_side not in side_ids:
        raise ValueError("The preview elevation must match one of the configured house sides.")
    house_views = settings.get("houseViews", {})
    if not isinstance(house_views, dict) or set(house_views) - side_ids:
        raise ValueError("House views must match the configured elevations.")
    photo_total = 0
    for side, view in house_views.items():
        if not isinstance(view, dict):
            raise ValueError("Each house view must be an object.")
        image = view.get("photo", "")
        if image and (not isinstance(image, str) or len(image) > 180_000 or not re.match(r"^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$", image)):
            raise ValueError("Each elevation photo must be a resized JPG, PNG, or WebP image under 180 KB.")
        photo_total += len(image or "")
        if photo_total > 1_000_000:
            raise ValueError("The combined house photos exceed the persistent storage limit.")
        dimensions = view.get("photoSize", [4, 3])
        if not isinstance(dimensions, list) or len(dimensions) != 2 or any(not isinstance(n, int) or isinstance(n, bool) or not 1 <= n <= 10000 for n in dimensions):
            raise ValueError("Elevation photo dimensions are invalid.")
        lines = view.get("lines", [])
        if not isinstance(lines, list) or len(lines) > 40:
            raise ValueError("Each elevation can contain at most 40 traced sections.")
        ids = set()
        for line in lines:
            if not isinstance(line, dict) or not isinstance(line.get("id"), str) or not 1 <= len(line["id"]) <= 128 or line["id"] in ids:
                raise ValueError("Each traced section must have a unique identifier.")
            ids.add(line["id"])
            if line.get("kind") not in ("edge", "ridge") or not isinstance(line.get("name", ""), str) or len(line.get("name", "")) > 48:
                raise ValueError("Traced sections need a name and a valid roof edge or ridge type.")
            points = line.get("points")
            if not isinstance(points, list) or not 2 <= len(points) <= 100:
                raise ValueError("Each traced section must contain 2 to 100 points.")
            for point in points:
                if not isinstance(point, list) or len(point) != 2 or any(not isinstance(n, (int, float)) or isinstance(n, bool) or not math.isfinite(n) or not 0 <= n <= 100 for n in point):
                    raise ValueError("Traced roofline points must be within the elevation photo.")
            wires = line.get("wireSegments", [])
            if not isinstance(wires, list) or len(wires) > len(points) - 1 or any(not isinstance(n, int) or isinstance(n, bool) or not 0 <= n < len(points) - 1 for n in wires) or len(set(wires)) != len(wires):
                raise ValueError("Wire-only links must refer to unique segments in the traced roofline.")
    return settings


class Handler(BaseHTTPRequestHandler):
    server_version = "TrimlightStudioAPI/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, value, status=200):
        raw = json.dumps(value, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def send_bootstrap(self):
        with database() as conn:
            app = read_state(conn, "app")
            settings = read_state(conn, "settings")
        state = {"app": app, "settings": settings, "has_app": app is not None, "has_settings": settings is not None}
        payload = json.dumps(state, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        raw = ("window.TL_SERVER_STATE=" + payload + ";\n").encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        size = int(self.headers.get("Content-Length", "0"))
        if size < 0 or size > MAX_BODY:
            raise ValueError("Request body exceeds the 8 MB limit.")
        data = self.rfile.read(size)
        return json.loads(data.decode("utf-8")) if data else {}

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == "/healthz":
            self.send_json({"ok": True})
            return
        if path == "/api/bootstrap.js":
            self.send_bootstrap()
            return
        if path == "/api/scheduler/status":
            with database() as conn:
                settings = read_state(conn, "settings") or DEFAULT_SETTINGS
                enabled = scheduler_enabled(conn)
            self.send_json(scheduler_status_for(settings, enabled))
            return
        if path in ("/api/app", "/api/settings"):
            key = "app" if path == "/api/app" else "settings"
            with database() as conn:
                value = read_state(conn, key)
            self.send_json(value if value is not None else ({} if key == "app" else DEFAULT_SETTINGS))
            return
        self.send_json({"ok": False, "error": "Not found"}, 404)

    def do_POST(self):
        path = urlsplit(self.path).path
        if path not in ("/api/app", "/api/settings", "/api/restore", "/api/schedule/apply", "/api/schedule/save", "/api/scheduler/status", "/api/controller/presets", "/api/controller/push"):
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return
        try:
            incoming = self.body()
            if path == "/api/scheduler/status":
                global SCHEDULE_LAST_KEY, SCHEDULE_RETRY_AT, SCHEDULE_RETRY_DELAY, SCHEDULE_RETRY_KEY, SCHEDULE_AUXILIARY_KEY
                if not isinstance(incoming, dict) or type(incoming.get("enabled")) is not bool:
                    raise ValueError("Choose whether the calendar scheduler is enabled.")
                with SCHEDULE_WRITE_LOCK, database() as conn:
                    write_state(conn, "scheduler_enabled", incoming["enabled"])
                    settings = read_state(conn, "settings") or DEFAULT_SETTINGS
                    SCHEDULE_LAST_KEY = None
                    SCHEDULE_AUXILIARY_KEY = None
                    if incoming["enabled"]:
                        scheduler_status(state="starting", message="Waiting for the scheduler to check the saved WLED controller.")
                    SCHEDULE_RETRY_AT = 0
                    SCHEDULE_RETRY_DELAY = 30
                    SCHEDULE_RETRY_KEY = None
                    status = scheduler_status_for(settings, incoming["enabled"])
                self.send_json(status)
                return
            if path in ("/api/schedule/apply", "/api/schedule/save", "/api/controller/presets", "/api/controller/push"):
                if not isinstance(incoming, dict):
                    raise ValueError("Preset request must be a JSON object.")
                with SCHEDULE_WRITE_LOCK:
                    with database() as conn:
                        settings = read_state(conn, "settings") or DEFAULT_SETTINGS
                        app = read_state(conn, "app") or {}
                        enabled = scheduler_enabled(conn)
                    if path == "/api/schedule/save" and app.get("schedule") != incoming.get("expectedSchedule"):
                        self.send_json({"ok": False, "error": "Another browser changed the schedule. Reload before saving again."}, 409)
                        return
                    if settings.get("mode") != "wled" or not settings.get("host"):
                        raise ValueError("Save a WLED controller address in Wiring & setup first.")
                    host = settings["host"]
                    if path == "/api/controller/push":
                        command = preset_command(incoming, "")
                        command.pop("n")
                        if not command.get("seg"):
                            raise ValueError("Missing WLED look segments.")
                        base = wled_base(host)
                        current = wled_json(base, "/json/state")
                        ids = {segment.get("id") for segment in command["seg"]}
                        command["seg"].extend({"id": segment["id"], "stop": 0} for segment in current.get("seg", []) if segment["id"] not in ids)
                        wled_json(base, "/json/state", {**command, "live": False})
                        result = {"ok": True, "state": wled_json(base, "/json/state")}
                        active = [segment for segment in result["state"].get("seg", []) if segment.get("stop", 0) > segment.get("start", 0)]
                        expected = [segment for segment in command["seg"] if segment.get("stop", 0) > segment.get("start", 0)]
                        if result["state"].get("on") == command.get("on") and result["state"].get("bri") == command.get("bri") and preset_matches(
                            {"seg": active}, {"seg": [{key: value for key, value in segment.items() if key != "n"} for segment in expected]},
                        ):
                            try:
                                boot = preset_command(incoming, incoming.get("name", "Studio look"))
                                info = wled_json(base, "/json/info")
                                max_segments = min(64, info.get("leds", {}).get("maxseg", 32))
                                boot["seg"] = expected + [{"id": index, "stop": 0} for index in range(len(expected), max_segments)]
                                if info.get("studioPresetStore") is True:
                                    store_wled_preset(base, 3, boot, True)
                                    if info.get("leds", {}).get("bootps") != 3:
                                        config = wled_json(base, "/json/cfg")
                                        config.setdefault("def", {})["ps"] = 3
                                        config.get("hw", {}).get("led", {}).pop("ins", None)
                                        wled_json(base, "/json/cfg", config)
                                else:
                                    wled_json(base, "/json/state", {"psave": 3, "n": boot["n"], "ib": True, "sb": True, "bootps": 3})
                            except (TypeError, ValueError) as exc:
                                result["bootWarning"] = str(exc)
                    elif path == "/api/schedule/apply":
                        selection = scheduled_selection(app, datetime.now().astimezone(), settings.get("timezone", "UTC"))
                        if not enabled:
                            result = {"ok": True, "changed": False, "tonight": "Calendar scheduler paused"}
                        elif (app.get("schedule") or {}).get("onMode") == "none":
                            result = {"ok": True, "changed": False, "tonight": "Automatic evening start disabled"}
                        else:
                            if selection["body"] is None and incoming.get("slot") == selection["slot"]:
                                selection["body"] = incoming.get("body")
                            if selection["body"] is None:
                                # Preserve the controller's current/default preset when no look has been pushed.
                                result = {"ok": True, "changed": False, "tonight": "No saved evening look"}
                            else:
                                base = wled_base(host)
                                info = wled_json(base, "/json/info")
                                command = preset_command(selection["body"], "Studio · " + selection["name"])
                                changed = store_wled_preset(base, selection["slot"], command, info.get("studioPresetStore") is True)
                                SCHEDULE_LAST_KEY = make_schedule_fingerprint(host, selection)
                                result = {"ok": True, "changed": changed, "tonight": f'Preset {selection["slot"]} verified'}
                    else:
                        batch = incoming.get("presets")
                        if not isinstance(batch, list) or len(batch) > 50 or (not batch and path != "/api/schedule/save"):
                            raise ValueError("Invalid Studio preset batch.")
                        commands = []
                        for entry in batch:
                            if not isinstance(entry, dict) or type(entry.get("slot")) is not int or entry["slot"] not in {3, *range(200, 251)}:
                                raise ValueError("Invalid Studio preset slot.")
                            commands.append((entry["slot"], preset_command(entry.get("body"), entry.get("name", "Studio look"))))
                        commands = dict(commands)
                        if path == "/api/schedule/save":
                            schedule = incoming.get("schedule")
                            if not isinstance(schedule, dict):
                                raise ValueError("Missing Studio schedule.")
                            validate_timers(incoming.get("timers"))
                            selection = scheduled_selection({"schedule": schedule}, datetime.now().astimezone(), settings.get("timezone", "UTC"))
                            if enabled and schedule.get("onMode") != "none" and selection["body"] is not None:
                                commands[selection["slot"]] = preset_command(selection["body"], "Studio · " + selection["name"])
                        base = wled_base(host)
                        non_applying = wled_json(base, "/json/info").get("studioPresetStore") is True
                        changes = store_preset_batch(base, commands, non_applying)
                        if path == "/api/schedule/save":
                            count = configure_timers(base, incoming.get("timers"), incoming.get("location"))
                            with database() as conn:
                                conn.execute("BEGIN IMMEDIATE")
                                latest = read_state(conn, "app") or {}
                                latest["schedule"] = schedule
                                write_state(conn, "app", latest)
                        SCHEDULE_LAST_KEY = None
                        SCHEDULE_AUXILIARY_KEY = None
                        result = {"ok": True, "changed": changes}
                        if path == "/api/schedule/save":
                            result["timers"] = count
                            result["tonight"] = "Calendar scheduler paused" if not enabled else (selection["name"] if schedule.get("onMode") != "none" and selection["body"] else "No automatic evening preset")
                self.send_json(result)
                return
            if path == "/api/restore":
                if not isinstance(incoming, dict) or incoming.get("format") != "trimlight-home-studio-wled-backup" or incoming.get("version") != 1:
                    raise ValueError("This is not a supported Trimlight Home Studio WLED backup.")
                app = incoming.get("application")
                if not isinstance(app, dict):
                    raise ValueError("Backup application data must be a JSON object.")
                for key, expected in (("userLooks", list), ("roofSections", list), ("playlists", list), ("schedule", dict), ("edits", dict), ("starred", dict)):
                    if key in app and not isinstance(app[key], expected):
                        raise ValueError("Backup application data has an invalid " + key + " value.")
                settings = validate_settings(incoming.get("controller"))
                # Validate serializability and reject NaN/Infinity before any database writes.
                serialized_app = json.dumps(app, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                serialized_settings = json.dumps(settings, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
                if len(serialized_app.encode("utf-8")) + len(serialized_settings.encode("utf-8")) > MAX_BODY:
                    raise ValueError("Backup data exceeds the 8 MB storage limit.")
                with SCHEDULE_WRITE_LOCK, database() as conn:
                    write_state(conn, "app", app)
                    write_state(conn, "settings", settings)
                self.send_json({"ok": True})
                return
            lock = SCHEDULE_WRITE_LOCK if isinstance(incoming, dict) and (path == "/api/settings" or "schedule" in incoming) else nullcontext()
            with lock, database() as conn:
                if path == "/api/app":
                    if not isinstance(incoming, dict):
                        raise ValueError("App state must be a JSON object.")
                    conn.execute("BEGIN IMMEDIATE")
                    current = read_state(conn, "app") or {}
                    if "expectedSchedule" in incoming and current.get("schedule") != incoming.pop("expectedSchedule"):
                        self.send_json({"ok": False, "error": "The schedule was updated in another browser."}, 409)
                        return
                    current.update(incoming)
                    value = current
                    key = "app"
                else:
                    value = validate_settings(incoming)
                    key = "settings"
                write_state(conn, key, value)
            self.send_json({"ok": True})
        except (ValueError, TypeError, json.JSONDecodeError, UnicodeDecodeError) as exc:
            self.send_json({"ok": False, "error": str(exc)}, 400)
        except sqlite3.Error:
            self.send_json({"ok": False, "error": "Could not save persistent application data."}, 500)

    def do_DELETE(self):
        if urlsplit(self.path).path != "/api/settings":
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return
        with database() as conn:
            conn.execute("DELETE FROM studio_state WHERE key = 'settings'")
        self.send_json({"ok": True})


if __name__ == "__main__":
    with database() as db:
        initial_settings = read_state(db, "settings") or DEFAULT_SETTINGS
    if initial_settings.get("mode") == "wled" and initial_settings.get("host"):
        scheduler_status(enabled=True, state="starting", message="Waiting for the first WLED schedule check.")
    threading.Thread(target=scheduler_loop, name="wled-calendar-scheduler", daemon=True).start()
    ThreadingHTTPServer(("0.0.0.0", int(os.environ.get("PORT", "8000"))), Handler).serve_forever()
