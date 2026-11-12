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
from contextlib import contextmanager
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
SCHEDULE_LAST_KEY = None


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
    # Preserve the configured hostname for HTTP Host headers and mDNS-capable container hosts.
    return "http://[" + host + "]" if ":" in host else "http://" + host


def wled_json(base, path, body=None):
    data = None if body is None else json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = Request(base + path, data=data, headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    try:
        with WLED_HTTP.open(request, timeout=4) as response:
            payload = response.read(1_000_000)
            if response.status < 200 or response.status >= 300:
                raise ValueError("WLED returned HTTP " + str(response.status))
            return json.loads(payload.decode("utf-8")) if payload else {}
    except HTTPError as exc:
        raise ValueError("WLED returned HTTP " + str(exc.code)) from exc
    except (URLError, TimeoutError, OSError, json.JSONDecodeError) as exc:
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
    has_weekly = isinstance(base_entry, dict) and isinstance(base_entry.get("body"), dict)
    if has_weekly:
        base_body = base_entry["body"]
        base_name = base_entry.get("name") or "Weekday look"
    else:
        default = schedule.get("default") if isinstance(schedule.get("default"), dict) else {}
        base_body = default.get("body") if isinstance(default.get("body"), dict) else None
        base_name = default.get("name") or "Usual look"
    selection = program if program else (base_entry if has_weekly else None)
    body = selection.get("body") if selection else base_body
    name = (program.get("name") if program else None) or (selection.get("name") if selection else None) or base_name
    slot = 244 + dow if has_weekly else 240
    return {"date": date_key, "dow": dow, "slot": slot, "body": body, "name": name, "program": program.get("name") if program else None, "timezone": zone_name}


def apply_scheduled_preset(host, selection):
    body = selection.get("body")
    if not isinstance(body, dict):
        # A "current look" schedule has no serialized base body; keep the controller's stored preset.
        return False
    base = wled_base(host)
    current = wled_json(base, "/json/state")
    preset = dict(body)
    preset.pop("_palKey", None)
    preset.update({"psave": selection["slot"], "n": "Studio · " + str(selection["name"])[:48], "ib": True, "sb": True, "o": True})
    try:
        wled_json(base, "/json/state", preset)
    finally:
        restore = {"on": current.get("on", False), "bri": current.get("bri", 0), "transition": 0, "seg": current.get("seg", [])}
        wled_json(base, "/json/state", restore)
    return True


def scheduler_loop():
    global SCHEDULE_LAST_KEY
    while True:
        try:
            with database() as conn:
                settings = read_state(conn, "settings") or DEFAULT_SETTINGS
                app = read_state(conn, "app") or {}
            if settings.get("mode") != "wled" or not settings.get("host"):
                SCHEDULE_LAST_KEY = None
                scheduler_status(enabled=False, state="disabled", message="Enable a WLED controller to run calendar programs.", program=None, date=None)
            else:
                selection = scheduled_selection(app, datetime.now().astimezone(), settings.get("timezone", "UTC"))
                schedule_fingerprint = json.dumps([settings.get("host"), selection, app.get("schedule", {}).get("programs", [])], sort_keys=True, separators=(",", ":"), ensure_ascii=False)
                scheduler_status(enabled=True)
                if schedule_fingerprint != SCHEDULE_LAST_KEY:
                    if apply_scheduled_preset(settings["host"], selection):
                        SCHEDULE_LAST_KEY = schedule_fingerprint
                        scheduler_status(state="active" if selection.get("program") else "ready", message="Applied " + str(selection["name"]) + " to WLED preset " + str(selection["slot"]) + ".", updated=datetime.now().astimezone().isoformat(timespec="seconds"), program=selection.get("program"), date=selection["date"])
                    else:
                        SCHEDULE_LAST_KEY = schedule_fingerprint
                        scheduler_status(state="ready", message="No saved base look is available for this date; the existing WLED preset was left in place.", updated=datetime.now().astimezone().isoformat(timespec="seconds"), program=selection.get("program"), date=selection["date"])
        except Exception as exc:
            scheduler_status(enabled=True, state="error", message=str(exc)[:300])
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
            if settings.get("mode") != "wled" or not settings.get("host"):
                status = scheduler_status(enabled=False, state="disabled", settingsMode=settings.get("mode", "demo"), controllerConfigured=bool(settings.get("host")), message="Save a WLED controller address in Wiring & setup.")
            else:
                status = scheduler_status(enabled=True, settingsMode="wled", controllerConfigured=True)
                if status.get("state") == "disabled":
                    status = scheduler_status(state="starting", message="Waiting for the scheduler to check the saved WLED controller.")
            self.send_json(status)
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
        if path not in ("/api/app", "/api/settings", "/api/restore"):
            self.send_json({"ok": False, "error": "Not found"}, 404)
            return
        try:
            incoming = self.body()
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
                with database() as conn:
                    write_state(conn, "app", app)
                    write_state(conn, "settings", settings)
                self.send_json({"ok": True})
                return
            with database() as conn:
                if path == "/api/app":
                    if not isinstance(incoming, dict):
                        raise ValueError("App state must be a JSON object.")
                    current = read_state(conn, "app") or {}
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
