# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
"""C10.06 drills for the non-Docker host executor: real state machine, fake hooks."""
import contextlib
import datetime
import hashlib
import importlib.util
import json
from pathlib import Path
import socket
import socketserver
import tempfile
import threading
import unittest
from unittest.mock import patch

if not hasattr(socketserver, "UnixStreamServer"):
    socketserver.UnixStreamServer = socketserver.TCPServer # Windows: state-machine tests only.
spec = importlib.util.spec_from_file_location("host_updater", Path(__file__).resolve().parents[2] / "scripts/host-updater.py")
host_updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(host_updater)
RealExecutor = host_updater.Executor


def config(root, **overrides):
    value = {
        "state_directory": str(root / "state"),
        "socket": str(root / "updater.sock"),
        "backup_produces": str(root / "backups" / "pre-update.dump"),
        "health_timeout_seconds": 180,
        "artifact": {"url": "https://releases.example.test/freeholder.tar.gz",
                     "sha256": hashlib.sha256(b"artifact-bytes").hexdigest()},
        "hooks": {
            "backup": "pg_dump > /dev/null",
            "apply": "deploy.sh",
            "health": "check.sh",
            "rollback": "rollback.sh",
        },
        "automatic": False,
        "utc_hour": 10,
    }
    for key, item in overrides.items():
        if key == "artifact" and isinstance(item, dict):
            value["artifact"].update(item)
        elif key == "hooks" and isinstance(item, dict):
            value["hooks"].update(item)
        else:
            value[key] = item
    return value


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "state").mkdir()

    def executor(self, **overrides):
        return host_updater.Executor(config(self.root, **overrides))

    def test_digest_mismatch_refuses_before_any_hook_runs(self):
        executor = self.executor()
        executor.fetch = lambda url: b"different-bytes"
        executor.hook = lambda name, **kw: (_ for _ in ()).throw(AssertionError("hook ran: " + name))
        with self.assertRaisesRegex(host_updater.Refused, "digest mismatch"):
            executor.apply()
        self.assertEqual(executor.status()["status"], "failed")

    def test_matching_digest_verifies_and_stores_the_artifact(self):
        executor = self.executor()
        executor.fetch = lambda url: b"artifact-bytes"
        calls = []

        def hook(name, **kw):
            calls.append(name)
            if name == "backup":
                target = Path(executor.config["backup_produces"])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"dump")

        executor.hook = hook
        executor.health = lambda *a, **kw: calls.append("health-ok")
        result = executor.apply()
        self.assertEqual(result["status"], "completed")
        artifact = executor.release / "artifact"
        self.assertEqual(artifact.read_bytes(), b"artifact-bytes")
        self.assertLess(calls.index("backup"), calls.index("apply"))
        self.assertEqual(calls[-1], "health-ok")

    def test_cosign_identity_requires_an_https_signature_url(self):
        executor = self.executor(artifact={
            "cosign_identity": "https://github.com/example/repo/.github/workflows/release.yml@refs/heads/main",
        })
        executor.fetch = lambda url: b"artifact-bytes"
        calls = []
        executor.run = lambda args, **kw: calls.append(args)
        with self.assertRaisesRegex(host_updater.Refused, "signature_url"):
            executor.apply()
        self.assertFalse([args for args in calls if args[:2] == ["cosign", "verify-blob"]])

    def test_cosign_verifies_blob_with_the_exact_identity(self):
        executor = self.executor(artifact={
            "cosign_identity": "https://github.com/example/repo/.github/workflows/release.yml@refs/heads/main",
            "signature_url": "https://releases.example.test/freeholder.tar.gz.sig",
        })
        executor.fetch = lambda url: b"artifact-bytes"
        calls = []
        executor.run = lambda args, **kw: calls.append(args)

        def hook(name, **kw):
            if name == "backup":
                target = Path(executor.config["backup_produces"])
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b"dump")
        executor.hook = hook
        executor.health = lambda *a, **kw: None
        result = executor.apply()
        self.assertEqual(result["status"], "completed")
        cosign = [args for args in calls if args[:2] == ["cosign", "verify-blob"]]
        self.assertEqual(len(cosign), 1)
        invocation = cosign[0]
        identity = invocation[invocation.index("--certificate-identity") + 1]
        issuer = invocation[invocation.index("--certificate-oidc-issuer") + 1]
        self.assertEqual(identity, "https://github.com/example/repo/.github/workflows/release.yml@refs/heads/main")
        self.assertEqual(issuer, "https://token.actions.githubusercontent.com")


class BackupGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / "state").mkdir()
        (self.root / "backups").mkdir()

    def executor(self):
        return host_updater.Executor(config(self.root))

    def test_backup_hook_must_produce_a_recoverable_file(self):
        executor = self.executor()
        executor.fetch = lambda url: b"artifact-bytes"
        executor.hook = lambda name, **kw: None # backup hook writes nothing
        with self.assertRaisesRegex(host_updater.Refused, "no recoverable backup"):
            executor.apply()
        self.assertEqual(executor.status()["status"], "failed")

    def test_empty_backup_file_is_not_a_backup(self):
        target = Path(self.executor().config["backup_produces"])
        def hook(name, **kw):
            if name == "backup":
                target.write_bytes(b"")
        executor = self.executor()
        executor.fetch = lambda url: b"artifact-bytes"
        executor.hook = hook
        with self.assertRaisesRegex(host_updater.Refused, "no recoverable backup"):
            executor.apply()

    def test_stale_backup_from_a_previous_run_is_not_reused(self):
        target = Path(self.executor().config["backup_produces"])
        target.write_text("stale")
        executor = self.executor()
        executor.fetch = lambda url: b"artifact-bytes"
        executor.hook = lambda name, **kw: None
        with self.assertRaisesRegex(host_updater.Refused, "no recoverable backup"):
            executor.apply()
        self.assertEqual(executor.status()["status"], "failed")


class Drill(host_updater.Executor):
    def __init__(self, root, failures=()):
        cfg = config(root)
        cfg["hooks"]["maintenance_on"] = "maintenance on"
        cfg["hooks"]["maintenance_off"] = "maintenance off"
        super().__init__(cfg)
        self.failures, self.calls = set(failures), []

    @contextlib.contextmanager
    def lock(self):
        yield

    def check(self, stage):
        self.calls.append(stage)
        if stage in self.failures:
            raise host_updater.Refused(stage)

    def fetch(self, url):
        self.check("fetch")
        return b"artifact-bytes"

    def hook(self, name, timeout=None):
        self.check(name)
        if name == "backup":
            target = Path(self.config["backup_produces"])
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b"dump")
        return ""

    def health(self, timeout=None):
        self.calls.append("health")
        if "health" in self.failures and self.calls.count("health") == 1:
            raise host_updater.Refused("health")
        if "rollback-health" in self.failures and self.calls.count("health") == 2:
            raise host_updater.Refused("rollback health")
        return ""


class StateMachineTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def drill(self, *failures):
        return Drill(self.root, failures)

    def test_success_requires_backup_apply_and_health_in_order(self):
        executor = self.drill()
        result = executor.apply()
        self.assertEqual(result["status"], "completed")
        self.assertEqual(executor.calls,
                         ["fetch", "backup", "maintenance_on", "apply", "health", "maintenance_off"])

    def test_health_failure_runs_rollback_and_reverifies(self):
        executor = self.drill("health")
        with self.assertRaises(host_updater.Refused):
            executor.apply()
        self.assertEqual(executor.status()["status"], "rolled_back")
        self.assertIn("rollback", executor.calls)
        # Health is independently re-run after rollback, before completion.
        self.assertLess(executor.calls.index("rollback"), executor.calls.index("health", executor.calls.index("rollback")))
        self.assertEqual(executor.calls[-1], "maintenance_off")
        self.assertIn("rollback ran and the health hook verified", executor.status()["error"])

    def test_failed_rollback_recovery_blocks_the_next_run(self):
        executor = self.drill("health", "rollback")
        with self.assertRaises(host_updater.Refused):
            executor.apply()
        self.assertEqual(executor.status()["status"], "recovery_required")
        self.assertNotIn("maintenance_off", executor.calls)
        with self.assertRaisesRegex(host_updater.Refused, "operator recovery"):
            executor.apply()

    def test_rollback_that_cannot_verify_health_blocks_the_next_run(self):
        executor = self.drill("health", "rollback-health")
        with self.assertRaises(host_updater.Refused):
            executor.apply()
        self.assertEqual(executor.status()["status"], "recovery_required")
        self.assertNotIn("maintenance_off", executor.calls)

    def test_failure_before_apply_never_runs_rollback(self):
        executor = self.drill("backup")
        with self.assertRaises(host_updater.Refused):
            executor.apply()
        self.assertEqual(executor.status()["status"], "failed")
        self.assertNotIn("rollback", executor.calls)

    def test_interrupted_run_is_never_silently_retried(self):
        executor = self.drill()
        host_updater.atomic_json(executor.state / "status.json", {"status": "deploying"})
        with self.assertRaisesRegex(host_updater.Refused, "operator recovery"):
            executor.apply()
        self.assertEqual(executor.calls, [])


class ConfigValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write_config(self, mutate=None):
        value = config(self.root)
        if mutate:
            mutate(value)
        path = self.root / "updater.json"
        path.write_text(json.dumps(value))
        return path

    def load(self, path, *, uid=0, mode=0o600):
        stat = type("Stat", (), {"st_uid": uid, "st_mode": mode})()
        with patch.object(Path, "stat", return_value=stat):
            return host_updater.load_config(path)

    def test_root_owned_config_loads(self):
        self.assertEqual(self.load(self.write_config())["utc_hour"], 10)

    def test_non_root_owned_config_is_refused(self):
        with self.assertRaisesRegex(host_updater.Refused, "root-owned"):
            self.load(self.write_config(), uid=1000)

    def test_http_artifact_url_is_refused(self):
        with self.assertRaisesRegex(host_updater.Refused, "https"):
            self.load(self.write_config(lambda c: c["artifact"].update(url="http://insecure.example/a.tgz")))

    def test_malformed_artifact_digest_is_refused(self):
        with self.assertRaises(host_updater.Refused):
            self.load(self.write_config(lambda c: c["artifact"].update(sha256="not-a-digest")))

    def test_missing_required_hook_is_refused(self):
        with self.assertRaisesRegex(host_updater.Refused, "rollback"):
            self.load(self.write_config(lambda c: c["hooks"].update(rollback="  ")))

    def test_relative_backup_path_is_refused(self):
        with self.assertRaisesRegex(host_updater.Refused, "absolute"):
            self.load(self.write_config(lambda c: c.update(backup_produces="backups/relative.dump")))

    def test_health_timeout_bounds_are_enforced(self):
        for seconds in (0, 901, "60"):
            with self.subTest(seconds=seconds):
                with self.assertRaises(host_updater.Refused):
                    self.load(self.write_config(lambda c: c.update(health_timeout_seconds=seconds)))


class ScheduleGateTests(unittest.TestCase):
    def test_run_falls_only_inside_the_configured_utc_hour(self):
        at = datetime.datetime(2026, 9, 26, 10, 30, tzinfo=datetime.timezone.utc)
        self.assertTrue(host_updater.due_for_scheduled_run({"automatic": True, "utc_hour": 10}, at))
        self.assertFalse(host_updater.due_for_scheduled_run({"automatic": False, "utc_hour": 10}, at))
        self.assertFalse(host_updater.due_for_scheduled_run({"automatic": True, "utc_hour": 11}, at))


class FakeExecutor:
    block = None
    applied = []

    def __init__(self, config):
        self.state = Path(config["state_directory"])
        self.state.mkdir(parents=True, exist_ok=True)

    def status(self):
        path = self.state / "status.json"
        return json.loads(path.read_text()) if path.exists() else {"status": "idle"}

    def lock(self):
        return RealExecutor.lock(self)

    def apply(self, trigger="socket", request_id=None, locked=False):
        FakeExecutor.applied.append({"trigger": trigger, "id": request_id, "locked": locked})
        if FakeExecutor.block is not None:
            FakeExecutor.block.wait(10)
        host_updater.atomic_json(self.state / "status.json", {"id": request_id, "status": "completed"})
        return {"id": request_id, "status": "completed"}


def unix_http(socket_path, method, path, body=None):
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(5)
    connection.connect(str(socket_path))
    payload = b"" if body is None else body.encode()
    request = f"{method} {path} HTTP/1.1\r\nHost: updater\r\nConnection: close\r\n"
    if body is not None:
        request += f"Content-Length: {len(payload)}\r\nContent-Type: application/json\r\n"
    request += "\r\n"
    connection.sendall(request.encode() + payload)
    response = b""
    while True:
        chunk = connection.recv(65536)
        if not chunk:
            break
        response += chunk
    connection.close()
    head, _, response_body = response.partition(b"\r\n\r\n")
    return int(head.split(b" ")[1]), json.loads(response_body)


class SocketServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = config(self.root)
        (self.root / "state").mkdir()
        (self.root / "backups").mkdir()
        FakeExecutor.block = None
        FakeExecutor.applied = []
        patcher = patch.object(host_updater, "Executor", FakeExecutor)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.server = host_updater.Server(self.config["socket"], host_updater.make_handler(self.config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()

    def test_status_reports_idle_and_schedule(self):
        status, body = unix_http(self.config["socket"], "GET", "/status")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "idle")
        self.assertFalse(body["automatic"])
        self.assertEqual(body["utcHour"], 10)

    def test_unknown_and_non_empty_bodies_are_refused(self):
        status, _ = unix_http(self.config["socket"], "GET", "/apply")
        self.assertEqual(status, 404)
        status, _ = unix_http(self.config["socket"], "POST", "/apply", '{"url": "https://x"}')
        self.assertEqual(status, 400)
        status, _ = unix_http(self.config["socket"], "POST", "/apply", "a" * 600)
        self.assertEqual(status, 400)
        self.assertEqual(FakeExecutor.applied, [])

    def test_apply_is_queued_then_durable_status_records_completion(self):
        status, body = unix_http(self.config["socket"], "POST", "/apply", "{}")
        self.assertEqual(status, 202)
        self.assertEqual(body["status"], "queued")
        for _ in range(100):
            if len(FakeExecutor.applied) == 1:
                break
            threading.Event().wait(0.01)
        status, body = 0, {}
        for _ in range(100):
            status, body = unix_http(self.config["socket"], "GET", "/status")
            if body.get("status") == "completed":
                break
            threading.Event().wait(0.01)
        self.assertEqual(body["status"], "completed")

    def test_interrupted_run_is_refused_with_409(self):
        host_updater.atomic_json(Path(self.config["state_directory"]) / "status.json", {"status": "deploying"})
        status, body = unix_http(self.config["socket"], "POST", "/apply", "{}")
        self.assertEqual(status, 409)
        self.assertIn("recovery", body["error"])
        self.assertEqual(FakeExecutor.applied, [])


if __name__ == "__main__":
    unittest.main()
