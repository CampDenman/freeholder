# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
"""C10.31 failure drills: real executor state machine, simulated Docker boundary."""
import contextlib
import datetime
import http.client
import importlib.util
import json
import io
from pathlib import Path
import socket
import socketserver
import tempfile
import threading
import unittest
from unittest.mock import patch

if not hasattr(socketserver, "UnixStreamServer"):
    socketserver.UnixStreamServer = socketserver.TCPServer # Windows: state-machine tests only.
spec = importlib.util.spec_from_file_location("updater", Path(__file__).resolve().parents[2] / "scripts/docker-updater.py")
updater = importlib.util.module_from_spec(spec)
spec.loader.exec_module(updater)
OLD = updater.IMAGE + "@sha256:" + "a" * 64
NEW = "sha256:" + "b" * 64
RealExecutor = updater.Executor


class Drill(updater.Executor):
    def __init__(self, root, failure=None, schema_changed=False):
        super().__init__({"directory": str(root), "state_directory": str(root / "state"), "socket": "/run/freeholder-updater/updater.sock"})
        self.failure, self.calls, self.reference = failure, [], OLD
        self.schema_changed = schema_changed
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
        if self.schema_changed and not self.config.get("allow_schema_changes", False):
            raise updater.Refused("Candidate changes the database schema or migration journal.")
        return {"version": "test", "schemaChanged": self.schema_changed}

    def restore_database(self, backup):
        self.calls.append("restore-db")

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

    def drill(self, failure=None, schema_changed=False):
        result = Drill(self.root, failure, schema_changed)
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

    def test_migration_lane_refuses_schema_change_without_operator_opt_in(self):
        executor = self.drill(schema_changed=True)
        with self.assertRaisesRegex(updater.Refused, "schema or migration journal"):
            executor.apply(NEW)
        self.assertNotIn("maintenance", executor.calls)
        self.assertNotIn("restore-db", executor.calls)
        self.assertEqual(executor.status()["status"], "failed")

    def test_migration_lane_completes_with_opt_in_and_needs_no_restore(self):
        executor = self.drill(schema_changed=True)
        executor.config["allow_schema_changes"] = True
        result = executor.apply(NEW)
        self.assertEqual(result["status"], "completed")
        self.assertNotIn("restore-db", executor.calls)

    def test_migration_lane_rollback_restores_backup_before_repinning_previous_image(self):
        executor = self.drill("candidate-health", schema_changed=True)
        executor.config["allow_schema_changes"] = True
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.status()["status"], "rolled_back")
        self.assertEqual(executor.reference, OLD)
        self.assertIn("restore-db", executor.calls)
        self.assertLess(executor.calls.index("restore-db"), executor.calls.index("pin:" + OLD))
        self.assertIn("database was restored", executor.status()["error"])

    def test_migration_lane_failed_recovery_keeps_maintenance_and_blocks_next_run(self):
        executor = self.drill("smoke", schema_changed=True)
        executor.config["allow_schema_changes"] = True
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.status()["status"], "recovery_required")
        self.assertIn("restore-db", executor.calls)
        with self.assertRaisesRegex(updater.Refused, "operator recovery"): executor.apply(NEW)

    def test_unchanged_candidate_in_migration_lane_keeps_image_swap_rollback(self):
        executor = self.drill("candidate-health")
        executor.config["allow_schema_changes"] = True
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.status()["status"], "rolled_back")
        self.assertNotIn("restore-db", executor.calls)
        self.assertIn("Database writes were preserved", executor.status()["error"])

    def test_migration_lane_failure_before_candidate_boot_needs_no_restore(self):
        executor = self.drill("production.dump", schema_changed=True)
        executor.config["allow_schema_changes"] = True
        with self.assertRaises(updater.Refused): executor.apply(NEW)
        self.assertEqual(executor.status()["status"], "rolled_back")
        self.assertNotIn("restore-db", executor.calls)

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

    def test_exact_operator_baseline_can_identify_an_unlabelled_current_image(self):
        executor = self.drill()
        executor.config.update(initial_image=OLD, initial_revision="a" * 40)
        with patch.object(executor, "run", side_effect=["null", json.dumps({
            "org.opencontainers.image.revision": "b" * 40,
        })]), patch.object(updater.urllib.request, "urlopen", return_value=io.BytesIO(json.dumps({
            "status": "ahead", "merge_base_commit": {"sha": "a" * 40},
        }).encode())) as compare:
            updater.Executor.verify_forward_update(executor, OLD, updater.IMAGE + "@" + NEW)
            self.assertIn("a" * 40 + "..." + "b" * 40, compare.call_args.args[0].full_url)

    def test_bootstrap_baseline_never_authorizes_another_image_or_unlabelled_candidate(self):
        for initial, labels in [(updater.IMAGE + "@" + NEW, ["null"]),
                                (OLD, ["null", "null"])]:
            with self.subTest(initial=initial, labels=labels):
                executor = self.drill()
                executor.config.update(initial_image=initial, initial_revision="a" * 40)
                with patch.object(executor, "run", side_effect=labels), patch.object(updater.urllib.request, "urlopen") as compare:
                    with self.assertRaisesRegex(updater.Refused, "exact upstream source revision"):
                        updater.Executor.verify_forward_update(executor, OLD, updater.IMAGE + "@" + NEW)
                    compare.assert_not_called()


def compose_config(**overrides):
    """The standard app/db/caddy recipe the executor supports."""
    config = {
        "services": {
            "app": {
                "image": "${FREEHOLDER_IMAGE}",
                "environment": {"FREEHOLDER_STORAGE": "s3"},
                "volumes": [{"type": "bind", "source": "/run/freeholder-updater",
                             "target": "/run/freeholder-updater", "read_only": True}],
            },
            "db": {"image": "postgres:16-alpine",
                   "environment": {"POSTGRES_USER": "freeholder", "POSTGRES_DB": "freeholder"}},
            "caddy": {"image": "caddy:2"},
        }
    }
    config["services"].update(overrides.pop("extra_services", {}))
    config["services"]["app"].update(overrides.pop("app", {}))
    config["services"]["db"].update(overrides.pop("db", {}))
    return config


class InventoryStub(updater.Executor):
    """Inventory boundary: canned compose config + canned docker answers."""
    def __init__(self, root, config, *, container="appcid", image_id="img1", digests=None):
        super().__init__({"directory": str(root), "state_directory": str(root / "state"),
                          "socket": "/run/freeholder-updater/updater.sock"})
        self._config, self._container, self._image_id = config, container, image_id
        self._digests = [OLD] if digests is None else digests

    def compose(self, *args, **_kwargs):
        if args[:1] == ("config",):
            return json.dumps(self._config)
        if args[:1] == ("ps",):
            return self._container
        return ""

    def _run(self, args, **_kwargs):
        if args[:2] == ["docker", "inspect"]:
            return self._image_id
        if args[:3] == ["docker", "image", "inspect"]:
            return json.dumps(self._digests)
        return ""


def stub(root, config, **kwargs):
    executor = InventoryStub(root, config, **kwargs)
    executor.run = executor._run
    return executor


class InventoryGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_standard_app_db_caddy_recipe_with_s3_is_accepted(self):
        executor = stub(self.root, compose_config())
        previous, db_image = updater.Executor.inventory(executor)
        self.assertEqual(previous, OLD)
        self.assertEqual(db_image, "postgres:16-alpine")
        self.assertEqual(executor.database_user, "freeholder")
        self.assertEqual(executor.database_name, "freeholder")

    def test_service_outside_the_supported_recipe_is_refused(self):
        config = compose_config(extra_services={"worker": {"image": "other"}})
        with self.assertRaisesRegex(updater.Refused, "app/db/caddy"):
            updater.Executor.inventory(stub(self.root, config))

    def test_published_app_port_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "only through Caddy"):
            updater.Executor.inventory(stub(self.root, compose_config(app={"ports": ["3000:3000"]})))

    def test_non_postgres_16_database_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "PostgreSQL 16"):
            updater.Executor.inventory(stub(self.root, compose_config(db={"image": "postgres:15-alpine"})))

    def test_app_mount_outside_the_private_socket_directory_is_refused(self):
        bad = {"type": "bind", "source": "/var/run/docker.sock", "target": "/var/run/docker.sock"}
        with self.assertRaisesRegex(updater.Refused, "Unsupported app mount"):
            updater.Executor.inventory(stub(self.root, compose_config(app={"volumes": [bad]})))

    def test_playground_cannot_control_host_updates(self):
        env = {"FREEHOLDER_STORAGE": "s3", "FREEHOLDER_PLAYGROUND": "1"}
        with self.assertRaisesRegex(updater.Refused, "playground"):
            updater.Executor.inventory(stub(self.root, compose_config(app={"environment": env})))

    def test_local_media_storage_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "S3"):
            updater.Executor.inventory(stub(self.root, compose_config(app={"environment": {}})))

    def test_missing_running_app_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "running"):
            updater.Executor.inventory(stub(self.root, compose_config(), container=""))

    def test_current_image_without_immutable_registry_identity_is_refused(self):
        digests = ["other/repo@sha256:" + "a" * 64]
        with self.assertRaisesRegex(updater.Refused, "immutable registry identity"):
            updater.Executor.inventory(stub(self.root, compose_config(), digests=digests))

    def test_unsafe_database_name_is_refused(self):
        db = {"environment": {"POSTGRES_USER": "freeholder", "POSTGRES_DB": "bad;name"}}
        with self.assertRaisesRegex(updater.Refused, "database name"):
            updater.Executor.inventory(stub(self.root, compose_config(db=db)))


class PublisherSignatureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_cosign_verifies_the_exact_publisher_workflow_identity(self):
        executor = stub(self.root, compose_config())
        calls = []
        executor.run = lambda args, **_kwargs: calls.append(args) or ""
        digest = "sha256:" + "c" * 64
        updater.Executor.verify(executor, digest)
        (invocation,) = calls
        self.assertEqual(invocation[:2], ["cosign", "verify"])
        self.assertEqual(invocation[2], updater.IMAGE + "@" + digest)
        identity = invocation[invocation.index("--certificate-identity") + 1]
        issuer = invocation[invocation.index("--certificate-oidc-issuer") + 1]
        self.assertEqual(identity,
                         "https://github.com/CampDenman/freeholder/.github/workflows/publish-image.yml@refs/heads/main")
        self.assertEqual(issuer, "https://token.actions.githubusercontent.com")
        self.assertNotIn("refs/tags/", identity)

    def test_candidate_resolution_requires_the_registry_identity(self):
        executor = stub(self.root, compose_config())
        good = ["", json.dumps([updater.IMAGE + "@sha256:" + "c" * 64])]
        executor.run = lambda args, **_kwargs: good.pop(0)
        self.assertEqual(updater.Executor.resolve_candidate(executor), "sha256:" + "c" * 64)
        executor = stub(self.root, compose_config())
        bad = ["", json.dumps(["other/repo@sha256:" + "c" * 64])]
        executor.run = lambda args, **_kwargs: bad.pop(0)
        with self.assertRaisesRegex(updater.Refused, "immutable image identity"):
            updater.Executor.resolve_candidate(executor)


class ConfigValidationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def write_config(self, **overrides):
        config = {"directory": "/opt/freeholder", "state_directory": "/var/lib/freeholder-updater",
                  "socket": "/run/freeholder-updater/updater.sock", "channel": "stable", **overrides}
        path = self.root / "updater.json"
        path.write_text(json.dumps(config))
        return path

    def load(self, path, *, uid=0, mode=0o600):
        stat = type("Stat", (), {"st_uid": uid, "st_mode": mode})()
        with patch.object(Path, "stat", return_value=stat):
            return updater.load_config(path)

    def test_root_owned_unwritable_config_loads(self):
        self.assertEqual(self.load(self.write_config())["channel"], "stable")

    def test_non_root_owned_config_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "root-owned"):
            self.load(self.write_config(), uid=1000)

    def test_group_or_other_writable_config_is_refused(self):
        # 0o022 is the write mask: group/other *read* is permitted, any
        # group/other *write* is not.
        for mode in (0o620, 0o646, 0o660, 0o602, 0o606, 0o666):
            with self.subTest(mode=oct(mode)):
                with self.assertRaisesRegex(updater.Refused, "root-owned"):
                    self.load(self.write_config(), mode=mode)

    def test_relative_paths_are_refused(self):
        with self.assertRaisesRegex(updater.Refused, "absolute"):
            self.load(self.write_config(directory="relative/path"))

    def test_unknown_channel_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "channel"):
            self.load(self.write_config(channel="nightly"))

    def test_non_boolean_automatic_is_refused(self):
        with self.assertRaisesRegex(updater.Refused, "boolean"):
            self.load(self.write_config(automatic="yes"))

    def test_utc_hour_outside_0_to_23_is_refused(self):
        for hour in (-1, 24, 2.5):
            with self.subTest(hour=hour):
                with self.assertRaises(updater.Refused):
                    self.load(self.write_config(utc_hour=hour))

    def test_allow_schema_changes_requires_a_boolean(self):
        with self.assertRaisesRegex(updater.Refused, "allow_schema_changes"):
            self.load(self.write_config(allow_schema_changes="yes"))
        config = self.load(self.write_config(allow_schema_changes=True))
        self.assertTrue(config["allow_schema_changes"])


class ScheduleGateTests(unittest.TestCase):
    CONFIG = {"automatic": True, "utc_hour": 10}

    def test_manual_installation_never_runs_unattended(self):
        now = datetime.datetime(2026, 9, 26, 10, 0, tzinfo=datetime.timezone.utc)
        self.assertFalse(updater.due_for_scheduled_run({"automatic": False, "utc_hour": 10}, now))

    def test_run_falls_only_inside_the_configured_utc_hour(self):
        def at(hour, minute):
            return updater.due_for_scheduled_run(self.CONFIG,
                                                 datetime.datetime(2026, 9, 26, hour, minute,
                                                                   tzinfo=datetime.timezone.utc))
        self.assertTrue(at(10, 0))
        self.assertTrue(at(10, 59))
        self.assertFalse(at(9, 59))
        self.assertFalse(at(11, 0))


class FakeExecutor:
    """The handler's Executor: records apply, writes a terminal status."""
    block = None
    applied = []

    def __init__(self, config):
        self.config = config
        self.state = Path(config["state_directory"])
        self.state.mkdir(parents=True, exist_ok=True)

    def status(self):
        path = self.state / "status.json"
        return json.loads(path.read_text()) if path.exists() else {"status": "idle"}

    def lock(self):
        return RealExecutor.lock(self)

    def apply(self, digest, request_id=None, locked=False):
        FakeExecutor.applied.append({"digest": digest, "id": request_id, "locked": locked})
        if FakeExecutor.block is not None:
            self.started = True
            FakeExecutor.block.wait(10)
        updater.atomic_json(self.state / "status.json", {"id": request_id, "status": "completed"})
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
        self.config = {"directory": str(self.root / "app"), "state_directory": str(self.root / "state"),
                       "socket": str(self.root / "updater.sock"), "automatic": False,
                       "channel": "stable", "utc_hour": 10}
        (self.root / "app").mkdir()
        (self.root / "state").mkdir()
        FakeExecutor.block = None
        FakeExecutor.applied = []
        patcher = patch.object(updater, "Executor", FakeExecutor)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.server = updater.Server(self.config["socket"], updater.make_handler(self.config))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)

    def stop_server(self):
        self.server.shutdown()
        self.server.server_close()

    def test_status_endpoint_reports_schedule_and_idle_state(self):
        status, body = unix_http(self.config["socket"], "GET", "/status")
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "idle")
        self.assertFalse(body["automatic"])
        self.assertEqual(body["utcHour"], 10)
        self.assertEqual(body["channel"], "stable")

    def test_unknown_paths_are_not_operations(self):
        status, _ = unix_http(self.config["socket"], "GET", "/apply")
        self.assertEqual(status, 404)
        status, _ = unix_http(self.config["socket"], "POST", "/status", "{}")
        self.assertEqual(status, 404)

    def test_apply_requires_a_valid_digest(self):
        for body in ['{"digest": "edge"}', '{"digest": "sha256:123"}',
                     json.dumps({"digest": "sha256:" + "c" * 64, "force": True})]:
            with self.subTest(body=body):
                status, _ = unix_http(self.config["socket"], "POST", "/apply", body)
                self.assertEqual(status, 400)
        self.assertEqual(FakeExecutor.applied, [])

    def test_apply_body_size_is_bounded(self):
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
        self.assertEqual(FakeExecutor.applied[0]["locked"], True)
        status, body = 0, {}
        for _ in range(100):
            status, body = unix_http(self.config["socket"], "GET", "/status")
            if body.get("status") == "completed":
                break
            threading.Event().wait(0.01)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "completed")

    def test_second_concurrent_apply_is_refused(self):
        FakeExecutor.block = threading.Event()
        status, _ = unix_http(self.config["socket"], "POST", "/apply", "{}")
        self.assertEqual(status, 202)
        for _ in range(100):
            if len(FakeExecutor.applied) == 1:
                break
            threading.Event().wait(0.01)
        self.assertEqual(len(FakeExecutor.applied), 1)
        status, _ = unix_http(self.config["socket"], "POST", "/apply", "{}")
        self.assertEqual(status, 409)
        FakeExecutor.block.set()
        for _ in range(100):
            if FakeExecutor.applied and self.read_status() == "completed":
                break
            threading.Event().wait(0.01)
        self.assertEqual(self.read_status(), "completed")

    def read_status(self):
        path = Path(self.config["state_directory"]) / "status.json"
        return json.loads(path.read_text())["status"]

    def test_interrupted_run_is_refused_with_409(self):
        updater.atomic_json(Path(self.config["state_directory"]) / "status.json", {"status": "deploying"})
        status, body = unix_http(self.config["socket"], "POST", "/apply", "{}")
        self.assertEqual(status, 409)
        self.assertIn("recovery", body["error"])
        self.assertEqual(FakeExecutor.applied, [])

    def test_refuses_to_replace_a_non_socket_path(self):
        blocker = self.root / "blocker"
        blocker.write_text("not a socket")
        config = dict(self.config, socket=str(blocker))
        with self.assertRaisesRegex(updater.Refused, "non-socket"):
            updater.prepare_socket_path(config)


if __name__ == "__main__": unittest.main()
