#!/usr/bin/env python3
# Copyright (C) 2026 Tony Aly
# SPDX-License-Identifier: Apache-2.0
"""C10.06/C10.10: narrow host executor for one Docker Compose installation.

No Docker socket enters the app. A root-owned configuration fixes every path,
service and image repository. The app can request only a verified image digest.
The first supported automatic lane requires an unchanged database schema and
migration journal; schema-changing releases require a manual operator upgrade.
"""
import argparse
import contextlib
import datetime
import hashlib
import http.server
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socketserver
import subprocess
import threading
import time
import uuid
import urllib.request

IMAGE = "ghcr.io/campdenman/freeholder"
DIGEST = re.compile(r"^sha256:[a-f0-9]{64}$")
TERMINAL = {"completed", "rolled_back", "failed", "unchanged"}


class Refused(RuntimeError):
    pass


def validate_digest(value):
    if not isinstance(value, str) or not DIGEST.fullmatch(value):
        raise Refused("An immutable sha256 image digest is required.")
    return value


def atomic_json(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.chmod(0o600)
    temporary.replace(path)


def command(args, *, data=None, output=None, timeout=300, cwd=None):
    result = subprocess.run(args, input=data, stdout=output or subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=timeout, cwd=cwd)
    if result.returncode:
        # Do not expose Compose environment values, SQL, or provider secrets.
        raise Refused("Host operation failed: " + args[0])
    return result.stdout.decode() if output is None else ""


def load_config(path):
    path = Path(path).resolve()
    if path.stat().st_uid != 0 or path.stat().st_mode & 0o022:
        raise Refused("Updater configuration must be root-owned and not writable by other users.")
    config = json.loads(path.read_text())
    for field in ("directory", "state_directory", "socket"):
        if not Path(config[field]).is_absolute():
            raise Refused("Updater paths must be absolute.")
    if config.get("channel", "stable") not in ("stable", "edge"):
        raise Refused("Unsupported release channel.")
    if type(config.get("automatic", False)) is not bool or type(config.get("utc_hour", 10)) is not int or not 0 <= config.get("utc_hour", 10) <= 23:
        raise Refused("Automatic scheduling requires a boolean and a UTC hour from 0 to 23.")
    return config


class Executor:
    def __init__(self, config, run=command):
        self.config = config
        self.run = run
        self.directory = Path(config["directory"]).resolve()
        self.state = Path(config["state_directory"]).resolve()
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.state.chmod(0o700)
        self.record = None

    def compose(self, *args, **kwargs):
        return self.run(["docker", "compose", "--project-directory", str(self.directory),
                         "-f", str(self.directory / "compose.yml"), *args], **kwargs)

    @contextlib.contextmanager
    def lock(self):
        import fcntl
        with (self.state / "executor.lock").open("a") as handle:
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise Refused("An update is already running.") from error
            try:
                yield
            finally:
                fcntl.flock(handle, fcntl.LOCK_UN)

    def status(self):
        path = self.state / "status.json"
        return json.loads(path.read_text()) if path.exists() else {"status": "idle"}

    def stage(self, phase, **values):
        self.record.update(status=phase, **values)
        atomic_json(self.state / "status.json", self.record)
        atomic_json(self.release / "status.json", self.record)

    def verify(self, digest):
        # The promotion workflow verifies CI provenance before signing. Require
        # its exact main-branch identity, not merely any signature by this repo.
        self.run(["cosign", "verify", IMAGE + "@" + validate_digest(digest),
                  "--certificate-identity", "https://github.com/CampDenman/freeholder/.github/workflows/publish-image.yml@refs/heads/main",
                  "--certificate-oidc-issuer", "https://token.actions.githubusercontent.com"], timeout=180)

    def resolve_candidate(self):
        tag = "edge" if self.config.get("channel") == "edge" else "latest"
        self.run(["docker", "pull", IMAGE + ":" + tag], timeout=600)
        digests = json.loads(self.run(["docker", "image", "inspect", IMAGE + ":" + tag,
                                      "--format", "{{json .RepoDigests}}"] ))
        for ref in digests:
            if ref.startswith(IMAGE + "@"):
                return validate_digest(ref.split("@", 1)[1])
        raise Refused("Registry did not supply the expected immutable image identity.")

    def verify_forward_update(self, previous, candidate):
        revisions = []
        for image in (previous, candidate):
            labels = json.loads(self.run(["docker", "image", "inspect", image,
                                          "--format", "{{json .Config.Labels}}"] ))
            revision = (labels or {}).get("org.opencontainers.image.revision", "")
            if not re.fullmatch(r"[a-f0-9]{40}", revision):
                raise Refused("Both images must identify their exact upstream source revision.")
            revisions.append(revision)
        if revisions[0] == revisions[1]:
            return
        request = urllib.request.Request(
            "https://api.github.com/repos/CampDenman/freeholder/compare/" + "...".join(revisions) + "?per_page=1",
            headers={"Accept": "application/vnd.github+json", "User-Agent": "Freeholder-host-updater",
                     "X-GitHub-Api-Version": "2026-03-10"})
        try:
            with urllib.request.urlopen(request, timeout=20) as response:
                evidence = json.loads(response.read(2 * 1024 * 1024))
        except Exception as error:
            raise Refused("Cannot verify upstream commit ancestry. No deployment was changed.") from error
        if evidence.get("status") != "ahead" or evidence.get("merge_base_commit", {}).get("sha") != revisions[0]:
            raise Refused("Candidate is not a forward update. A stale channel tag must not downgrade this installation.")

    def inventory(self):
        config = json.loads(self.compose("config", "--format", "json"))
        if set(config["services"]) != {"app", "db", "caddy"}:
            raise Refused("This executor supports the app/db/caddy Compose recipe only.")
        app = config["services"]["app"]
        database = config["services"]["db"]
        if not database["image"].startswith("postgres:16"):
            raise Refused("This executor currently requires PostgreSQL 16.")
        if app.get("ports"):
            raise Refused("The app must be reachable only through Caddy during maintenance.")
        if app.get("volumes"):
            # Persistent object media stays in S3. Only the restricted host socket
            # directory is an allowed app mount; no plugin/config mount swapping.
            expected = str(Path(self.config["socket"]).parent)
            for mount in app["volumes"]:
                if mount.get("type") != "bind" or mount.get("source") != expected or mount.get("target") != "/run/freeholder-updater":
                    raise Refused("Unsupported app mount; use the manual deployment path.")
        environment = app.get("environment", {})
        if environment.get("FREEHOLDER_PLAYGROUND") == "1":
            raise Refused("The playground cannot control host updates.")
        if environment.get("FREEHOLDER_STORAGE") != "s3":
            raise Refused("Updates require independently persisted S3 media.")
        container = self.compose("ps", "-q", "app").strip()
        if not container:
            raise Refused("The existing app must be running.")
        image_id = self.run(["docker", "inspect", container, "--format", "{{.Image}}"] ).strip()
        refs = json.loads(self.run(["docker", "image", "inspect", image_id, "--format", "{{json .RepoDigests}}"] ))
        previous = next((ref for ref in refs if ref.startswith(IMAGE + "@")), None)
        if not previous:
            raise Refused("The current image has no immutable registry identity.")
        self.database_user = database.get("environment", {}).get("POSTGRES_USER", "postgres")
        self.database_name = database.get("environment", {}).get("POSTGRES_DB", self.database_user)
        if not re.fullmatch(r"[a-zA-Z_][a-zA-Z0-9_]*", self.database_name):
            raise Refused("Unsupported database name.")
        return previous, database["image"]

    def snapshot(self, name):
        if shutil.disk_usage(self.state).free < 2 * 1024 ** 3:
            raise Refused("At least 2 GiB of free backup space is required. Review retained backups.")
        path = self.release / name
        with path.open("wb") as output:
            self.compose("exec", "-T", "db", "pg_dump", "-U", self.database_user,
                         "--format=custom", self.database_name, output=output, timeout=600)
        path.chmod(0o600)
        if path.stat().st_size < 1024:
            raise Refused("Database backup is unexpectedly small.")
        return path

    def database_signature(self, container):
        # Compare catalogs in the same PostgreSQL version. Journal identity is
        # checked too: no silent data migration can pass an unchanged schema.
        schema = self.run(["docker", "exec", container, "pg_dump", "-U", self.database_user,
                           "--schema-only", "--no-owner", "--no-privileges", self.database_name])
        schema = "\n".join(line for line in schema.splitlines()
                           if not line.startswith(("--", "\\restrict", "\\unrestrict")))
        journal = self.run(["docker", "exec", container, "psql", "-U", self.database_user,
                            "-d", self.database_name, "-Atc",
                            "SELECT hash || '|' || created_at FROM drizzle.__drizzle_migrations ORDER BY created_at"])
        return hashlib.sha256((schema + journal).encode()).hexdigest()

    def healthy(self, container, timeout=180):
        script = ('fetch("http://127.0.0.1:3000/api/health").then(async r=>'
                  '{const b=await r.json();if(!r.ok||!b.ok||!b.jobs?.ready)process.exit(1);'
                  'console.log(JSON.stringify({version:b.version,workers:b.jobs.mountedWorkers}));})'
                  '.catch(()=>process.exit(1))')
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            try:
                return json.loads(self.run(["docker", "exec", container, "node", "-e", script], timeout=10))
            except (Refused, subprocess.TimeoutExpired):
                time.sleep(2)
        raise Refused("Candidate did not become healthy before the deadline.")

    def smoke(self, container):
        script = ('Promise.all(["/","/login","/api/openapi.json"].map(async p=>'
                  '{const r=await fetch("http://127.0.0.1:3000"+p);'
                  'if(!r.ok)throw Error(p);})).catch(()=>process.exit(1))')
        self.run(["docker", "exec", container, "node", "-e", script], timeout=45)

    def rehearse(self, digest, postgres_image, backup):
        suffix = self.record["id"][:12]
        network, database, app = ["fh-update-" + suffix + ending for ending in ("-net", "-db", "-app")]
        password = secrets.token_hex(32)
        db_env = self.release / "rehearsal-db.env"
        app_env = self.release / "rehearsal-app.env"
        db_env.write_text(f"POSTGRES_USER={self.database_user}\nPOSTGRES_DB={self.database_name}\nPOSTGRES_PASSWORD={password}\n")
        app_env.write_text(f"DATABASE_URL=postgres://{self.database_user}:{password}@{database}:5432/{self.database_name}\nSESSION_SECRET={secrets.token_hex(32)}\nAPP_URL=http://localhost:3000\nFREEHOLDER_JOBS=on\nFREEHOLDER_UPDATE_CHECK=off\nMAIL_ADAPTER=console\n")
        for path in (db_env, app_env):
            path.chmod(0o600)
        self.run(["docker", "network", "create", "--internal", network])
        try:
            self.run(["docker", "run", "-d", "--name", database, "--network", network,
                      "--memory", "512m", "--env-file", str(db_env), postgres_image])
            # The image's init server temporarily accepts connections before
            # restarting. Wait until its entrypoint has exec'd the final server.
            for _ in range(60):
                try:
                    self.run(["docker", "exec", database, "sh", "-c",
                              "test \"$(cat /proc/1/comm)\" = postgres && pg_isready -U \"$POSTGRES_USER\""], timeout=5)
                    break
                except Refused:
                    time.sleep(1)
            else:
                raise Refused("Restore database failed to start.")
            self.run(["docker", "exec", "-i", database, "pg_restore", "-U", self.database_user,
                      "-d", self.database_name, "--no-owner", "--no-privileges", "--exit-on-error"],
                     data=backup.read_bytes(), timeout=600)
            before = self.database_signature(database)
            self.run(["docker", "run", "-d", "--name", app, "--network", network,
                      "--memory", "1g", "--cpus", "1", "--pids-limit", "256",
                      "--env-file", str(app_env), IMAGE + "@" + digest])
            evidence = self.healthy(app)
            self.smoke(app)
            self.run(["docker", "stop", "-t", "40", app], timeout=60)
            after = self.database_signature(database)
            if before != after:
                raise Refused("Candidate changes the database schema or migration journal. Use the manual migration procedure.")
            return evidence
        finally:
            for container in (app, database):
                try:
                    self.run(["docker", "rm", "-f", "-v", container])
                except Refused:
                    pass
            self.run(["docker", "network", "rm", network])

    def maintenance(self, enabled):
        target = self.directory / "Caddyfile"
        if enabled:
            target.write_text('{$FREEHOLDER_DOMAIN} {\n respond "Freeholder is updating. Please try again shortly." 503\n}\n')
        else:
            target.write_bytes((self.release / "Caddyfile").read_bytes())
        self.compose("exec", "-T", "caddy", "caddy", "reload", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile")

    def pin(self, reference):
        if not reference.startswith(IMAGE + "@"):
            raise Refused("Unsupported image repository.")
        validate_digest(reference.split("@", 1)[1])
        path = self.directory / ".env"
        lines = [line for line in path.read_text().splitlines() if not line.startswith("FREEHOLDER_IMAGE=")]
        path.write_text("\n".join([*lines, "FREEHOLDER_IMAGE=" + reference]) + "\n")
        path.chmod(0o600)

    def apply(self, digest=None, trigger="admin", request_id=None, locked=False):
        with contextlib.nullcontext() if locked else self.lock():
            old = self.status()
            if old.get("status") not in TERMINAL | {"idle", "queued"}:
                raise Refused("An interrupted run requires operator recovery before another update.")
            self.record = {"id": request_id or str(uuid.uuid4()), "status": "verifying", "trigger": trigger,
                           "startedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
            self.release = self.state / self.record["id"]
            self.release.mkdir(mode=0o700)
            maintenance = False
            switched = False
            stopped = False
            try:
                previous, postgres_image = self.inventory()
                digest = validate_digest(digest) if digest else self.resolve_candidate()
                self.stage("verifying", previousImage=previous, image=IMAGE + "@" + digest)
                if previous == IMAGE + "@" + digest:
                    self.stage("unchanged")
                    return self.record
                self.verify(digest)
                self.run(["docker", "pull", IMAGE + "@" + digest], timeout=600)
                self.verify_forward_update(previous, IMAGE + "@" + digest)
                for filename in (".env", "compose.yml", "Caddyfile"):
                    shutil.copyfile(self.directory / filename, self.release / filename)
                    (self.release / filename).chmod(0o600)
                self.stage("backing_up")
                backup = self.snapshot("rehearsal.dump")
                self.stage("rehearsing")
                evidence = self.rehearse(digest, postgres_image, backup)
                self.stage("maintenance", candidate=evidence)
                maintenance = True
                self.maintenance(True)
                stopped = True
                self.compose("stop", "-t", "45", "app", timeout=60)
                self.snapshot("production.dump")
                self.stage("deploying")
                self.pin(IMAGE + "@" + digest)
                switched = True
                self.compose("up", "-d", "--no-deps", "app", timeout=120)
                app = self.compose("ps", "-q", "app").strip()
                self.healthy(app)
                self.smoke(app)
                self.maintenance(False)
                maintenance = False
                self.stage("completed", completedAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
                return self.record
            except Exception as error:
                if switched or stopped:
                    try:
                        # The rehearsal proved schema and journal unchanged:
                        # preserve writes, never rewind the production database.
                        self.pin(previous)
                        self.compose("up", "-d", "--no-deps", "app", timeout=120)
                        app = self.compose("ps", "-q", "app").strip()
                        self.healthy(app)
                        self.smoke(app)
                        self.maintenance(False)
                        maintenance = False
                        self.stage("rolled_back", error="Candidate failed; the previous image is healthy. Database writes were preserved.")
                    except Exception:
                        self.stage("recovery_required", error="Recovery did not verify. Maintenance remains enabled; inspect the retained backup and host logs.")
                else:
                    if maintenance:
                        try:
                            self.maintenance(False)
                        except Exception:
                            self.stage("recovery_required", error="Unable to restore the proxy configuration.")
                            raise
                    message = str(error) if isinstance(error, Refused) else "Host operation failed; inspect the host locally."
                    self.stage("failed", error=message)
                raise


class Server(socketserver.ThreadingMixIn, socketserver.UnixStreamServer):
    daemon_threads = True


def serve(config):
    socket_path = Path(config["socket"])
    socket_path.parent.mkdir(parents=True, exist_ok=True, mode=0o755)
    if socket_path.exists():
        if not socket_path.is_socket():
            raise Refused("Refusing to replace a non-socket path.")
        socket_path.unlink()
    queue_lock = threading.Lock()

    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass

        def reply(self, status, body):
            data = json.dumps(body).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path != "/status":
                return self.reply(404, {"error": "Unknown operation"})
            self.reply(200, {**Executor(config).status(), "automatic": config.get("automatic", False),
                             "channel": config.get("channel", "stable"), "utcHour": config.get("utc_hour", 10)})

        def do_POST(self):
            if self.path != "/apply":
                return self.reply(404, {"error": "Unknown operation"})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 512:
                    return self.reply(400, {"error": "Invalid request size"})
                body = json.loads(self.rfile.read(size))
                if not isinstance(body, dict) or set(body) - {"digest"}:
                    return self.reply(400, {"error": "Unsupported request"})
                digest = validate_digest(body["digest"]) if body.get("digest") else None
            except (ValueError, Refused):
                return self.reply(400, {"error": "Invalid digest"})
            if not queue_lock.acquire(blocking=False):
                return self.reply(409, {"error": "An update is already running"})
            executor = Executor(config)
            lease = executor.lock()
            acquired = False
            try:
                lease.__enter__()
                acquired = True
                if executor.status().get("status") not in TERMINAL | {"idle"}:
                    raise Refused("An interrupted run needs operator recovery.")
            except Refused as error:
                if acquired:
                    lease.__exit__(None, None, None)
                queue_lock.release()
                return self.reply(409, {"error": str(error)})
            request_id = str(uuid.uuid4())
            atomic_json(executor.state / "status.json", {"id": request_id, "status": "queued"})

            def work():
                try:
                    executor.apply(digest, request_id=request_id, locked=True)
                except Exception:
                    pass # The durable status records failure; no fake completion.
                finally:
                    lease.__exit__(None, None, None)
                    queue_lock.release()
            threading.Thread(target=work, daemon=False).start()
            self.reply(202, {"id": request_id, "status": "queued"})

    with Server(str(socket_path), Handler) as server:
        os.chown(socket_path, 0, int(config.get("app_gid", 1001)))
        socket_path.chmod(0o660)
        server.serve_forever()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("operation", choices=("serve", "apply", "scheduled", "status"))
    parser.add_argument("--config", default="/etc/freeholder/updater.json")
    parser.add_argument("--digest")
    args = parser.parse_args()
    os.umask(0o077)
    config = load_config(args.config)
    if args.operation == "serve":
        serve(config)
    elif args.operation == "status":
        print(json.dumps(Executor(config).status()))
    else:
        if args.operation == "scheduled":
            now = datetime.datetime.now(datetime.timezone.utc)
            if not config.get("automatic", False) or now.hour != config.get("utc_hour", 10):
                return
        print(json.dumps(Executor(config).apply(args.digest, trigger="schedule" if args.operation == "scheduled" else "cli")))


if __name__ == "__main__":
    try:
        main()
    except (Refused, subprocess.TimeoutExpired) as error:
        print(str(error), file=__import__("sys").stderr)
        raise SystemExit(1)
