"""Hermes gateway plugin for the CITIC member notification bridge.

Runs inside the gateway process so outbound sends reuse the live iLink adapter and
its context token store. Legacy manual-code binding is disabled until the
per-member iLink QR login flow is implemented and tested.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import os
import sqlite3
from contextlib import closing
from pathlib import Path

from aiohttp import web

_adapter = None
_server_task = None


def _bridge_token():
    token = os.getenv("CITIC_P3_BRIDGE_TOKEN", "")
    if len(token) < 32:
        raise RuntimeError("CITIC bridge token not configured")
    return token

def _db():
    path = Path(os.getenv("CITIC_P3_BRIDGE_DB", "/opt/hermes-agent/home/bridge-outbox.sqlite3"))
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path)
    db.execute("CREATE TABLE IF NOT EXISTS sends (id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, status TEXT NOT NULL, message_id TEXT)")
    db.commit()
    return db


async def _deliver(request):
    token = _bridge_token()
    authorization = request.headers.get("Authorization", "")
    if not hmac.compare_digest(authorization, "Bearer " + token):
        return web.json_response({"error": "unauthorized"}, status=401)
    try:
        body = await request.json()
        recipient = body["recipientId"]
        account = body["channelAccountId"]
        message = body["text"]
        key = body["idempotencyKey"]
        if not all(isinstance(x, str) and x for x in (recipient, account, message, key)):
            raise ValueError()
        if len(recipient) > 200 or len(account) > 200 or len(message) > 1600 or len(key) > 128:
            raise ValueError()
        if request.headers.get("x-idempotency-key") != key:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        return web.json_response({"error": "invalid_request"}, status=400)
    adapter = _adapter
    if adapter is None or not getattr(adapter, "_running", False):
        return web.json_response({"error": "gateway_unavailable"}, status=503)
    if account != str(getattr(adapter, "_account_id", "")):
        return web.json_response({"error": "channel_mismatch"}, status=409)
    digest = hashlib.sha256(json.dumps([recipient, account, message], ensure_ascii=False).encode()).hexdigest()
    with closing(_db()) as db:
        with db:
            old = db.execute("SELECT payload_hash,status,message_id FROM sends WHERE id=?", (key,)).fetchone()
            if old:
                if old[0] != digest:
                    return web.json_response({"error": "idempotency_conflict"}, status=409)
                if old[1] == "accepted":
                    return web.json_response({"accepted": True, "messageId": old[2]})
                return web.json_response({"error": "outcome_unknown"}, status=409)
            db.execute("INSERT INTO sends(id,payload_hash,status) VALUES(?,?,'unknown')", (key, digest))
    result = await adapter.send(recipient, message)
    if result.success:
        with closing(_db()) as db:
            with db:
                db.execute("UPDATE sends SET status='accepted',message_id=? WHERE id=?", (result.message_id or "", key))
        return web.json_response({"accepted": True, "messageId": result.message_id or ""})
    error = str(result.error or "")
    if "session not ready" in error or "expired" in error:
        return web.json_response({"error": "session_expired"}, status=410)
    return web.json_response({"error": "outcome_unknown"}, status=503)


async def _serve():
    _bridge_token()
    app = web.Application(client_max_size=8192)
    app.router.add_post("/deliver", _deliver)
    runner = web.AppRunner(app)
    await runner.setup()
    host = os.getenv("CITIC_P3_BRIDGE_HOST", "127.0.0.1")
    port = int(os.getenv("CITIC_P3_BRIDGE_PORT", "18765"))
    await web.TCPSite(runner, host, port).start()


def _connected(_native, adapter):
    global _adapter, _server_task
    _adapter = adapter
    if _server_task is None or _server_task.done():
        _server_task = asyncio.create_task(_serve(), name="citic-weixin-bridge")


def register(ctx):
    _bridge_token()
    ctx.register_platform_handler("weixin", _connected)
