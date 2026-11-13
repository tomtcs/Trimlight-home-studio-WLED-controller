import copy
import tempfile
import threading
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import server


class Request:
    def __init__(self, path, body):
        self.path = path
        self.incoming = copy.deepcopy(body)
        self.response = None

    def body(self):
        return self.incoming

    def send_json(self, value, status=200):
        self.response = (status, value)

    def post(self):
        server.Handler.do_POST(self)
        return self.response


class Wled:
    def __init__(self):
        self.presets = {}
        self.config = {
            "hw": {"led": {"ins": [{"pin": [2]}], "fps": 80}},
            "light": {"gc": {"bri": False, "val": 2.8}},
            "if": {"ntp": {"en": False, "tz": 5}},
            "timers": {"ins": []},
        }
        self.calls = []
        self.drop_after_write = False
        self.ignore_write = False

    def __call__(self, base, path, body=None):
        self.calls.append((path, copy.deepcopy(body)))
        if path == "/json/info":
            return {"studioPresetStore": True}
        if path == "/presets.json":
            return copy.deepcopy(self.presets)
        if path == "/json/cfg":
            if body is None:
                return copy.deepcopy(self.config)
            body = copy.deepcopy(body)
            body["hw"]["led"]["ins"] = self.config["hw"]["led"]["ins"]
            self.config = body
            return {"success": True}
        if path == "/json/state" and body and "psstore" in body:
            if not self.ignore_write:
                self.presets[str(body["psstore"])] = copy.deepcopy(body["preset"])
            if self.drop_after_write:
                raise ValueError("Timed out")
            return {"success": True}
        raise AssertionError((path, body))

    @property
    def writes(self):
        return [(path, body) for path, body in self.calls if body is not None]


class SchedulerTests(unittest.TestCase):
    def setUp(self):
        directory = self.enterContext(tempfile.TemporaryDirectory())
        self.enterContext(patch.multiple(
            server,
            DB_PATH=str(Path(directory) / "studio.sqlite"),
            SCHEDULE_LAST_KEY=None,
            SCHEDULE_AUXILIARY_KEY=None,
            SCHEDULE_RETRY_KEY=None,
            SCHEDULE_RETRY_AT=0,
            SCHEDULE_RETRY_DELAY=30,
            SCHEDULE_STATUS={"enabled": True, "state": "starting"},
        ))
        self.controller = Wled()
        self.enterContext(patch.object(server, "wled_json", self.controller))
        self.body = {"on": True, "bri": 182, "seg": [
            {"id": 0, "start": 0, "stop": 724, "fx": 216, "sx": 33, "col": [[255, 0, 0]], "tlsbm": 1},
            {"id": 1, "stop": 0},
        ]}
        self.schedule = {
            "timezone": "America/New_York",
            "onMode": "sunset",
            "eveLook": "flag",
            "default": {"look": "flag", "name": "American Flag", "body": self.body},
        }
        with server.database() as conn:
            server.write_state(conn, "settings", {"host": "10.1.50.250", "mode": "wled"})
            server.write_state(conn, "app", {"schedule": self.schedule})

    def post(self, path, data):
        return Request(path, data).post()

    def test_pause_persists_and_prevents_background_traffic(self):
        self.assertEqual(self.post("/api/scheduler/status", {"enabled": False})[1]["state"], "paused")
        with server.database() as conn:
            self.assertFalse(server.scheduler_enabled(conn))
        server.scheduler_tick()
        self.assertEqual(self.controller.calls, [])
        self.assertEqual(self.post("/api/schedule/apply", {})[1]["tonight"], "Calendar scheduler paused")
        self.assertEqual(self.controller.calls, [])
        self.assertEqual(self.post("/api/scheduler/status", {"enabled": True})[1]["state"], "starting")
        server.scheduler_tick()
        self.assertEqual(len(self.controller.writes), 1)

    def test_pause_acknowledges_after_in_flight_store(self):
        started = threading.Event()
        finish = threading.Event()
        pause_started = threading.Event()
        result = []

        def slow_store(*args):
            started.set()
            if not finish.wait(3):
                raise AssertionError("Test did not release the write")
            return True

        def pause():
            pause_started.set()
            result.append(self.post("/api/scheduler/status", {"enabled": False}))

        with patch.object(server, "apply_scheduled_preset", slow_store):
            writer = threading.Thread(target=server.scheduler_tick)
            pauser = threading.Thread(target=pause)
            writer.start()
            self.assertTrue(started.wait(3))
            pauser.start()
            try:
                self.assertTrue(pause_started.wait(3))
                pauser.join(0.05)
                self.assertTrue(pauser.is_alive())
            finally:
                finish.set()
                writer.join(3)
                pauser.join(3)
        self.assertEqual(result[0][1]["state"], "paused")
        server.scheduler_tick()
        self.assertEqual(self.controller.calls, [])

    def test_no_automatic_start_has_no_traffic(self):
        self.schedule["onMode"] = "none"
        self.post("/api/app", {"schedule": self.schedule})
        server.scheduler_tick()
        self.assertEqual(self.controller.calls, [])

    def test_uncertain_write_is_verified_without_resending(self):
        self.controller.drop_after_write = True
        server.scheduler_tick()
        self.assertEqual(server.SCHEDULE_STATUS["state"], "ready")
        server.SCHEDULE_LAST_KEY = None
        server.scheduler_tick()
        self.assertEqual(len(self.controller.writes), 1)
        self.assertEqual(self.controller.presets["240"]["seg"][0]["col"], [[255, 0, 0]])

    def test_unverified_write_backs_off_then_checks_before_writing(self):
        self.controller.ignore_write = True
        with patch.object(server.time, "monotonic", return_value=100) as monotonic:
            server.scheduler_tick()
            self.assertEqual(server.SCHEDULE_STATUS["state"], "error")
            monotonic.return_value = 105
            server.scheduler_tick()
            self.assertEqual(len(self.controller.writes), 1)
            self.controller.presets["240"] = server.preset_command(self.body, "Studio · American Flag")
            monotonic.return_value = 130
            server.scheduler_tick()
        self.assertEqual(len(self.controller.writes), 1)
        self.assertEqual(server.SCHEDULE_STATUS["state"], "ready")

    def test_preset_comparison_checks_every_requested_field(self):
        command = server.preset_command(self.body, "Flag")
        stale = copy.deepcopy(command)
        stale["seg"][0]["sx"] = 40
        self.assertFalse(server.preset_matches(stale, command))
        stale["seg"][0]["sx"] = 33
        stale["seg"][0]["col"][0].append(0)
        self.assertTrue(server.preset_matches(stale, command))
        stale["seg"][0]["col"][0][0] = 0
        self.assertFalse(server.preset_matches(stale, command))

    def test_playlist_verification_preserves_step_duration_and_transition(self):
        wanted = {"on": True, "bri": 90, "playlist": {
            "ps": [200, 201], "dur": [600, 900], "transition": [20, 30], "repeat": 0, "end": 0, "r": True,
        }}
        saved = {"on": True, "playlist": {
            "ps": [201, 200], "dur": [900, 600], "transition": [30, 20], "repeat": 0, "end": 0, "r": 1,
        }}
        self.assertTrue(server.preset_matches(saved, wanted, legacy=True))
        self.assertFalse(server.preset_matches(saved, wanted))
        saved["playlist"]["dur"].reverse()
        self.assertFalse(server.preset_matches(saved, wanted, legacy=True))

    def test_dates_pick_program_and_weekday_slot_in_installation_timezone(self):
        self.schedule["weeklyLooks"] = {"4": "flag"}
        self.schedule["weeklyBodies"] = {"4": self.schedule["default"]}
        self.schedule["programs"] = [
            {"name": "Season", "start": "2026-11-01", "end": "2026-11-30", "body": self.body},
            {"name": "Veterans", "start": "2026-11-11", "end": "2026-11-12", "body": self.body},
        ]
        app = {"schedule": self.schedule}
        first = server.scheduled_selection(app, datetime(2026, 11, 13, 2, tzinfo=timezone.utc))
        second = server.scheduled_selection(app, datetime(2026, 11, 13, 6, tzinfo=timezone.utc))
        self.assertEqual((first["program"], first["slot"]), ("Veterans", 248))
        self.assertEqual((second["program"], second["slot"]), ("Season", 240))
        base = server.make_schedule_fingerprint("controller", second)
        self.assertEqual(base, server.make_schedule_fingerprint("controller", {**second, "date": "2026-11-14"}))

    def test_schedule_save_rejects_conflict_before_controller_traffic(self):
        status, _ = self.post("/api/schedule/save", {"expectedSchedule": None})
        self.assertEqual(status, 409)
        self.assertEqual(self.controller.calls, [])

    def test_schedule_save_keeps_led_settings_and_skips_unchanged_writes(self):
        timers = [{"en": 1, "hour": 254, "min": -5, "macro": 240, "dow": 127}]
        request = {"schedule": self.schedule, "expectedSchedule": self.schedule, "timers": timers, "presets": []}
        status, result = self.post("/api/schedule/save", request)
        self.assertEqual((status, result["timers"]), (200, 1))
        config_write = self.controller.writes[1][1]
        self.assertEqual(config_write["hw"]["led"], {"fps": 80})
        self.assertEqual(config_write["light"]["gc"], {"bri": False, "val": 2.8})
        self.assertEqual(config_write["if"]["ntp"]["tz"], 5)
        self.assertEqual(len(self.controller.writes), 2)
        self.assertEqual(self.post("/api/schedule/save", request)[0], 200)
        self.assertEqual(len(self.controller.writes), 2)

    def test_disjoint_app_saves_keep_records_and_stale_schedule_is_rejected(self):
        barrier = threading.Barrier(2)
        results = []

        def save(body):
            barrier.wait(timeout=3)
            results.append(self.post("/api/app", body)[0])

        workers = [threading.Thread(target=save, args=(body,)) for body in (
            {"roofSections": []}, {"schedule": {**self.schedule, "onMode": "none"}, "expectedSchedule": self.schedule},
        )]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(3)
        self.assertEqual(sorted(results), [200, 200])
        with server.database() as conn:
            app = server.read_state(conn, "app")
        self.assertEqual(app["roofSections"], [])
        self.assertEqual(app["schedule"]["onMode"], "none")
        self.assertEqual(self.post("/api/app", {"schedule": self.schedule, "expectedSchedule": self.schedule})[0], 409)

    def test_backup_restore_accepts_studio_arrays_and_keeps_pause(self):
        self.post("/api/scheduler/status", {"enabled": False})
        app = {"userLooks": [], "roofSections": [], "playlists": [], "schedule": self.schedule}
        backup = {"format": "trimlight-home-studio-wled-backup", "version": 1, "application": app, "controller": server.DEFAULT_SETTINGS}
        self.assertEqual(self.post("/api/restore", backup)[0], 200)
        with server.database() as conn:
            self.assertEqual(server.read_state(conn, "app"), app)
            self.assertFalse(server.scheduler_enabled(conn))
        self.assertEqual(self.controller.calls, [])


if __name__ == "__main__":
    unittest.main()
