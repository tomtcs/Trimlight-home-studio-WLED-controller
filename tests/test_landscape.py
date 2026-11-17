import copy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server
from test_scheduler import Request, Wled


def settings_for(host, counts):
    return {
        **server.DEFAULT_SETTINGS,
        "mode": "wled",
        "host": host,
        "channelCount": 4,
        "outputs": [{"leds": count} for count in counts],
    }


def landscape_line(output=4, first=2, last=5):
    return {
        "id": "path", "kind": "landscape", "name": "Walkway",
        "output": output, "first": first, "last": last,
        "points": [[10, 80], [80, 90]], "wireSegments": [],
    }


class ControllerTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.multiple(server, DB_PATH=str(Path(directory) / "studio.sqlite"), SCHEDULERS={}))
        with server.database() as conn:
            server.write_state(conn, "settings", settings_for("10.1.50.250", (200, 300, 224, 16)))
        status, result = Request("/api/controllers", {"name": "Far-side landscape"}).post()
        self.assertEqual(status, 201)
        self.controller = result["id"]
        self.suffix = f"?controller={self.controller}"

    def post(self, path, value, *, primary=False):
        return Request(path + ("" if primary else self.suffix), value).post()

    def test_profiles_isolate_settings_app_writes_and_scheduler_pause(self):
        settings = settings_for("10.1.50.251", (42,))
        settings["houseViews"] = {"front": {"lines": [landscape_line(output=1)]}}
        self.assertEqual(self.post("/api/settings", settings)[0], 200)
        self.assertEqual(self.post("/api/app", {"userLooks": [{"name": "Far-side warm white"}]})[0], 200)
        self.assertEqual(self.post("/api/scheduler/status", {"enabled": False})[1]["state"], "paused")
        with server.database() as conn:
            self.assertEqual(server.read_state(conn, "settings")["host"], "10.1.50.250")
            self.assertEqual(server.read_state(conn, server.controller_key(self.controller, "settings")), settings)
            self.assertIsNone(server.read_state(conn, "app"))
            self.assertTrue(server.scheduler_enabled(conn))
            self.assertFalse(server.scheduler_enabled(conn, self.controller))
        self.assertEqual(Request("/api/app?controller=missing", {}).post()[0], 404)

    def test_same_address_cannot_be_saved_under_two_profiles(self):
        status, result = self.post("/api/settings", settings_for("10.1.50.250", (16,)))
        self.assertEqual(status, 400)
        self.assertIn("already assigned", result["error"])

    def test_each_calendar_writes_to_its_own_controller(self):
        self.assertEqual(self.post("/api/settings", settings_for("10.1.50.251", (24,)))[0], 200)
        devices = {f"http://10.1.50.{n}": Wled() for n in (250, 251)}
        for primary, count in ((True, 740), (False, 24)):
            body = {"on": True, "bri": 120, "seg": [{"id": 0, "start": 0, "stop": count, "fx": 0}]}
            schedule = {"onMode": "sunset", "eveLook": "warm", "default": {"look": "warm", "body": body}}
            self.assertEqual(self.post("/api/app", {"schedule": schedule}, primary=primary)[0], 200)
        with patch.object(server, "wled_json", side_effect=lambda base, *args: devices[base](base, *args)):
            server.scheduler_tick()
            server.scheduler_tick(self.controller)
        for base, count in (("http://10.1.50.250", 740), ("http://10.1.50.251", 24)):
            self.assertEqual(devices[base].presets["240"]["seg"][0]["stop"], count)

    def test_channel_four_maps_relative_bulbs_to_physical_bounds(self):
        settings = settings_for("10.1.50.250", (200, 300, 224, 16))
        settings["houseViews"] = {"front": {"lines": [landscape_line()]}}
        self.assertEqual(self.post("/api/settings", settings, primary=True)[0], 200)
        roof = {"id": 0, "start": 0, "stop": 724, "fx": 8, "on": True}
        current = {"on": True, "bri": 150, "pl": -1, "seg": [roof]}
        config = {"hw": {"led": {"ins": [
            {"start": start, "len": count} for start, count in ((0, 200), (200, 300), (500, 224), (724, 16))
        ]}}}
        updates = []

        def device(base, path, body=None):
            self.assertEqual(base, "http://10.1.50.250")
            if path == "/json/info":
                return {"leds": {"maxseg": 32}}
            if path == "/json/cfg":
                return config
            if body is not None:
                updates.append(body)
                current["seg"].extend(copy.deepcopy(body["seg"]))
                return {"success": True}
            return copy.deepcopy(current)

        with patch.object(server, "wled_json", side_effect=device):
            code, _ = self.post("/api/controller/landscape", {
                "side": "front", "line": "path", "color": "#ff8000", "brightness": 64,
            }, primary=True)
        self.assertEqual(code, 200)
        self.assertEqual(current["seg"][0], roof)
        segment = updates[0]["seg"][0]
        self.assertEqual((segment["start"], segment["stop"], segment["bri"]), (725, 729, 64))
        self.assertEqual(segment["col"][0], [255, 128, 0])
        self.assertNotIn("bri", updates[0])

    def test_landscape_ranges_must_be_valid_and_disjoint_across_views(self):
        settings = settings_for("10.1.50.250", (200, 300, 224, 16))
        settings["houseViews"] = {
            "front": {"lines": [landscape_line()]},
            "rear": {"lines": [landscape_line(first=5, last=7)]},
        }
        with self.assertRaisesRegex(ValueError, "must not overlap"):
            server.validate_settings(settings)
        settings["houseViews"]["rear"]["lines"][0]["last"] = 17
        with self.assertRaisesRegex(ValueError, "within a configured output"):
            server.validate_settings(settings)

    def test_zone_control_splits_solid_but_does_not_split_animation(self):
        original = {"id": 0, "start": 0, "stop": 120, "fx": 0, "bri": 80, "on": True, "col": [[44, 55, 66]]}
        state = {"on": True, "pl": -1, "seg": [original]}
        left, right, zone = server.landscape_command(state, 30, 50, "#ff8000", 0, 3)
        self.assertEqual(left, {**original, "stop": 30})
        self.assertEqual(right, {**original, "start": 50, "id": 1})
        self.assertEqual(zone, {"id": 2, "start": 30, "stop": 50, "on": False})
        original["fx"] = 8
        with self.assertRaisesRegex(ValueError, "crosses active effects"):
            server.landscape_command(state, 30, 50, "#ff8000", 50, 3)
