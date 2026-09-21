# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
"""C10.31 failure drills: real executor state machine, simulated Docker boundary."""
import contextlib
import importlib.util
import json
import io
from pathlib import Path
import socketserver
import tempfile
import unittest
from unittest.mock import patch

if not hasattr(socketserver, "UnixStreamServer"):
    socketserver.UnixStreamServer = socketserver.TCPServer # Windows: state-machine tests only.
spec = importlib.util.spec_from_file_location("updater", Path(__file__).resolve().parents[2] / "scripts/docker-updater.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
OLD = updater.IMAGE + "@sha256:" + "a" * 64
NEW = "sha256:" + "b" * 64


class Drill(updater.Executor):
    def __init__(self, root, failure=None):
        super().__init__({"directory": str(root), "state_directory": str(root / "state"), "socket": "/run/freeholder-updater/updater.sock"})
        self.failure, self.calls, self.reference = failure, [], OLD
        for name in (".env", "compose.yml", "Caddyfile"):
            (root / name).write_text("original")

    @contextlib.contextmanager
    def lock(self):
        yield

    def check(self, stage):
        self.calls.append(stage)
        if self.failure == stage:
            raise updater.Refused(stage)

    def inventory(self):
        return OLD, "postgres:16-alpine"

    def verify(self, digest):
        self.check("signature")

    def verify_forward_update(self, *_args):
        self.check("ancestry")

    def run(self, *_args, **_kwargs):
        return ""

    def compose(self, *args, **kwargs):
        if args[0] == "stop": self.check("stop")
        return "app"

    def snapshot(self, name):
        self.check(name)
        return self.release / name

    def rehearse(self, *_args):
        self.check("rehearsal")
        return {"version": "test"}

    def maintenance(self, enabled):
        self.calls.append("maintenance" if enabled else "traffic")

    def pin(self, reference):
        self.reference = reference
        self.calls.append("pin:" + reference)

    def healthy(self, *_args):
        self.check("old-health" if self.reference == OLD else "candidate-health")

    def smoke(self, *_args):
        self.check("smoke")


class UpdaterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def drill(self, failure=None):
        result = Drill(self.root, failure)
        # Executor installs its injected subprocess runner on the instance.
        result.run = lambda *args, **kwargs: ""
        return result

    def test_rejects_arbitrary_image_and_shell_input(self):
        for value in ["edge", "sha256:123", "x; touch /tmp/pwn", "other/repo@" + NEW, None]:
            with self.assertRaises(updater.Refused): updater.validate_digest(value)

    def test_signature_backup_or_rehearsal_failure_never_stops_live_app(self):
        for phase in ["signature", "ancestry", "rehearsal.dump", "rehearsal"]:
            with self.subTest(phase=phase):
                executor = self.drill(phase)
                with self.assertRaises(updater.Refused): executor.apply(NEW)
                self.assertNotIn("stop", executor.calls)
                self.assertNotIn("maintenance", executor.calls)
                self.assertEqual(executor.status()["status"], "failed")

    def test_health_failure_restores_previous_image_without_restoring_database(self):
        executor = self.drill("candidate-health")
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.reference, OLD)
        self.assertEqual(executor.status()["status"], "rolled_back")
        self.assertLess(executor.calls.index("old-health"), executor.calls.index("traffic"))

    def test_final_backup_failure_restarts_previous_image(self):
        executor = self.drill("production.dump")
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.status()["status"], "rolled_back")
        self.assertIn("old-health", executor.calls)

    def test_failed_recovery_keeps_maintenance_and_blocks_next_run(self):
        executor = self.drill("smoke")
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.status()["status"], "recovery_required")
        self.assertNotIn("traffic", executor.calls)
        with self.assertRaisesRegex(updater.Refused, "operator recovery"): executor.apply(NEW)

    def test_interrupted_run_is_never_silently_retried(self):
        executor = self.drill()
        updater.atomic_json(executor.state / "status.json", {"status": "deploying"})
        with self.assertRaisesRegex(updater.Refused, "operator recovery"): executor.apply(NEW)
        self.assertEqual(executor.calls, [])

    def test_success_requires_backup_rehearsal_health_and_proxy_restore(self):
        executor = self.drill()
        result = executor.apply(NEW)
        self.assertEqual(result["status"], "completed")
        self.assertEqual(executor.reference, updater.IMAGE + "@" + NEW)
        self.assertLess(executor.calls.index("rehearsal"), executor.calls.index("maintenance"))
        self.assertLess(executor.calls.index("candidate-health"), executor.calls.index("traffic"))
        self.assertTrue((executor.release / "Caddyfile").exists())

    def test_real_rehearsal_refuses_schema_or_journal_change_and_removes_containers(self):
        executor = self.drill()
        executor.record = {"id": "123456789012"}
        executor.database_user = executor.database_name = "playground"
        executor.release = self.root / "rehearsal"
        executor.release.mkdir()
        backup = executor.release / "input.dump"
        backup.write_bytes(b"fixture")
        calls = []
        executor.run = lambda args, **kwargs: calls.append(args) or ""
        with patch.object(executor, "database_signature", side_effect=["before", "after"]):
            with self.assertRaisesRegex(updater.Refused, "schema or migration journal"):
                updater.Executor.rehearse(executor, NEW, "postgres:16-alpine", backup)
        self.assertEqual(sum(args[:3] == ["docker", "rm", "-f"] for args in calls), 2)
        self.assertEqual(calls[-1][:3], ["docker", "network", "rm"])
        self.assertNotIn("maintenance", executor.calls)

    @unittest.skipIf(__import__("os").name == "nt", "Unix host locking runs in Linux CI")
    def test_two_process_handles_cannot_acquire_the_same_host_lock(self):
        executor = self.drill()
        with updater.Executor.lock(executor):
            with self.assertRaisesRegex(updater.Refused, "already running"):
                with updater.Executor.lock(executor): pass

    def test_stale_or_divergent_signed_image_cannot_downgrade(self):
        executor = self.drill()
        for status in ["behind", "diverged", "identical"]:
            with self.subTest(status=status), patch.object(executor, "run", side_effect=[
                json.dumps({"org.opencontainers.image.revision": "a" * 40}),
                json.dumps({"org.opencontainers.image.revision": "b" * 40}),
            ]), patch.object(updater.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps({"status": status}).encode())):
                with self.assertRaisesRegex(updater.Refused, "not a forward update"):
                    updater.Executor.verify_forward_update(executor, OLD, updater.IMAGE + "@" + NEW)

    def test_forward_commit_must_have_current_revision_as_merge_base(self):
        executor = self.drill()
        with patch.object(executor, "run", side_effect=[
            json.dumps({"org.opencontainers.image.revision": "a" * 40}),
            json.dumps({"org.opencontainers.image.revision": "b" * 40}),
        ]), patch.object(updater.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps({"status": "ahead", "merge_base_commit": {"sha": "a" * 40}}).encode())):
            updater.Executor.verify_forward_update(executor, OLD, updater.IMAGE + "@" + NEW)

if __name__ == "__main__": unittest.main()
