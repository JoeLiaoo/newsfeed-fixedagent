#!/usr/bin/env python3
"""Fixed, one-request Unix socket adapter for the B0 Hermes CLI contract."""
import json
import os
import re
import shutil
import signal
import socketserver
import subprocess
import threading
import time
import uuid
from pathlib import Path

HERMES_BIN = os.environ.get("HERMES_BIN", "/opt/hermes-agent/home/installs/ac6d50ed0ecbd832/environments/c31d124ea4004ffda24628944ae3b7af/venv/bin/hermes")
SOCKET = Path(os.environ.get("HERMES_RUNNER_SOCKET", "/run/newsfeed-hermes/runner.sock"))
BASE = Path(os.environ.get("HERMES_RUNNER_BASE", "/var/lib/newsfeed-hermes"))
MODEL = os.environ.get("HERMES_MODEL", "")
MODEL_URL = os.environ.get("HERMES_MODEL_BASE_URL", "")
MODEL_KEY = os.environ.get("HERMES_MODEL_API_KEY", "")
LIMIT = threading.BoundedSemaphore(2)


def safe_scalar(value: str) -> str:
    # Values are operator configuration, never request fields. Restrict YAML to plain scalars.
    if not re.fullmatch(r"[A-Za-z0-9_./:@?&=%+,-]{1,300}", value):
        raise ValueError("invalid runner configuration")
    return value


def parse_result(raw: str) -> str:
    answer = None
    for line in raw.splitlines():
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if value.get("type") == "result":
            answer = value.get("text") if value.get("exit_code") == 0 else None
    if not isinstance(answer, str) or not answer.strip() or len(answer) > 6000:
        raise ValueError("missing final result")
    return answer.strip()


def cleanup_old_runs():
    # Homes remain while their isolated idle gateways live (configured for 60 seconds).
    for root in (BASE / "home", BASE / "work"):
        root.mkdir(parents=True, exist_ok=True, mode=0o700)
        for path in root.iterdir():
            if path.is_dir() and time.time() - path.stat().st_mtime > 180:
                shutil.rmtree(path)


def run(prompt: str) -> dict:
    cleanup_old_runs()
    key = uuid.uuid4().hex
    home = BASE / "home" / key
    work = BASE / "work" / key
    home.mkdir(mode=0o700)
    work.mkdir(mode=0o700)
    config = ("model:\n  provider: custom\n  base_url: " + safe_scalar(MODEL_URL) +
              "\n  key_env: PLATFORM_MODEL_KEY\n  default: " + safe_scalar(MODEL) +
              "\nagent:\n  disabled_toolsets:\n    - all\ngateway:\n  unmanaged_idle_exit_seconds: 60\n")
    (home / "config.yaml").write_text(config, encoding="utf-8")
    (home / "config.yaml").chmod(0o640)
    usage = work / "usage.json"
    argv = [HERMES_BIN, "--usage-file", str(usage), "chat", "--query-file", "-",
            "--oneshot", "--format", "stream-json", "-m", MODEL, "--ignore-rules"]
    env = {"HERMES_HOME": str(home), "HOME": str(home),
           "PATH": "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
           "LANG": "C.UTF-8", "LC_ALL": "C.UTF-8", "TERM": "dumb", "NO_COLOR": "1",
           "PYTHONUNBUFFERED": "1", "PLATFORM_MODEL_KEY": MODEL_KEY}
    with (work / "stdout").open("wb") as stdout, (work / "stderr").open("wb") as stderr:
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=stdout, stderr=stderr,
                                cwd=work, env=env, start_new_session=True, shell=False)
        try:
            assert proc.stdin is not None
            proc.stdin.write(prompt.encode("utf-8"))
            proc.stdin.close()
            code = proc.wait(timeout=45)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGTERM)
            try:
                proc.wait(timeout=2)
            except subprocess.TimeoutExpired:
                os.killpg(proc.pid, signal.SIGKILL)
                proc.wait()
            raise ValueError("timeout")
    if code != 0:
        raise ValueError("hermes_failed")
    if (work / "stdout").stat().st_size > 1_000_000 or usage.stat().st_size > 100_000:
        raise ValueError("oversize_result")
    answer = parse_result((work / "stdout").read_text(encoding="utf-8"))
    measured = json.loads(usage.read_text(encoding="utf-8"))
    total = measured.get("total_including_auxiliary", {})
    if not isinstance(total.get("api_calls"), int) or total["api_calls"] < 1:
        raise ValueError("missing_usage")
    return {"ok": True, "answer": answer, "usage": measured}


class Handler(socketserver.StreamRequestHandler):
    def handle(self):
        raw = self.rfile.readline(12_001)
        try:
            if len(raw) > 12_000 or not raw.endswith(b"\n"):
                raise ValueError("invalid_request")
            request = json.loads(raw)
            if set(request) != {"type", "id", "prompt"} or request["type"] != "chat" or \
               not isinstance(request["id"], str) or not re.fullmatch(r"[0-9a-f-]{36}", request["id"]) or \
               not isinstance(request["prompt"], str) or not 0 < len(request["prompt"]) <= 9000:
                raise ValueError("invalid_request")
            if not LIMIT.acquire(blocking=False):
                raise ValueError("busy")
            try:
                response = run(request["prompt"])
            finally:
                LIMIT.release()
        except Exception:
            # Neither prompt, model response, stderr nor credentials enter logs or errors.
            response = {"ok": False, "error": "unavailable"}
        self.wfile.write((json.dumps(response, ensure_ascii=False) + "\n").encode("utf-8"))


class Server(socketserver.ThreadingUnixStreamServer):
    daemon_threads = True


def main():
    if not Path(HERMES_BIN).is_absolute() or not Path(HERMES_BIN).is_file() or not MODEL_KEY:
        raise SystemExit("runner configuration incomplete")
    safe_scalar(MODEL)
    safe_scalar(MODEL_URL)
    BASE.mkdir(parents=True, exist_ok=True, mode=0o700)
    SOCKET.parent.mkdir(parents=True, exist_ok=True, mode=0o770)
    if SOCKET.exists():
        SOCKET.unlink()
    with Server(str(SOCKET), Handler) as server:
        SOCKET.chmod(0o660)
        server.serve_forever()


if __name__ == "__main__":
    main()
