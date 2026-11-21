"""API: bank connections through Open Banking (Enable Banking) – connect, import history, scheduled sync.

Flow: POST /api/openbanking/connect -> the user approves in the bank's app and is redirected to
GET /api/openbanking/callback (or pastes the redirect URL into POST /api/openbanking/complete) -> accounts are stored and the
history is imported -> a background task fetches new transactions a few times a day.
Imported rows land in the same `transactions` table as PDF statements (statement_doc_id = -account id), so rules, invoice
matching, rent/contract assignment and the budget work unchanged. Transfers between own accounts are ignored automatically.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
import secrets
import time
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional
from urllib.parse import parse_qs, urlparse

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import RedirectResponse

from . import main as core
from . import openbanking as ob
from .i18n import _t

router = APIRouter()
log = logging.getLogger("bank_api")

APP_ID = os.environ.get("ENABLEBANKING_APP_ID", "").strip()
KEY_FILE = Path(os.environ.get("ENABLEBANKING_KEY_FILE") or (Path(core.DB_PATH).parent / "enablebanking.pem"))
API_URL = os.environ.get("ENABLEBANKING_API_URL", ob.API_URL)
REDIRECT_URL = os.environ.get("ENABLEBANKING_REDIRECT_URL", "").strip()
COUNTRIES = [c.strip().upper() for c in os.environ.get("ENABLEBANKING_COUNTRIES", "BE,LT,IE").split(",") if c.strip()]
SYNC_HOURS = float(os.environ.get("BANK_SYNC_HOURS", "8") or 8)      # <= 3 background syncs per day and account
CONSENT_DAYS = 180
RATE_LIMIT_WAIT = 6 * 3600
TRANSPORT = None                                                       # tests inject an httpx transport here
AUTO_IMPORT = os.environ.get("BANK_AUTO_IMPORT", "1") != "0"           # bulk-import the history right after connecting

with core.db() as _con:
    _con.executescript(
        """
        CREATE TABLE IF NOT EXISTS bank_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL DEFAULT 'enablebanking',
            bank TEXT NOT NULL, country TEXT,
            session_id TEXT, state TEXT,
            status TEXT NOT NULL DEFAULT 'pending',     -- pending | active | expired
            valid_until TEXT, created TEXT, last_error TEXT
        );
        CREATE TABLE IF NOT EXISTS bank_accounts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            connection_id INTEGER NOT NULL,
            uid TEXT NOT NULL, iban TEXT, name TEXT, currency TEXT,
            balance REAL, last_sync TEXT, last_booking_date TEXT,
            next_allowed REAL,                          -- epoch seconds: rate limited by the bank until then
            enabled INTEGER NOT NULL DEFAULT 1,
            from_date TEXT,                             -- ignore older transactions (e.g. already imported from PDF statements)
            UNIQUE(connection_id, uid)
        );
        """
    )

_banks_cache: dict = {"t": 0.0, "data": []}
_TASKS: set = set()


# ---------------------------------------------------------------- helpers
def configured() -> bool:
    return bool(APP_ID) and KEY_FILE.is_file()


def client() -> ob.EnableBanking:
    if not configured():
        raise HTTPException(409, _t("Open Banking is not configured – see Settings → Bank & reconciliation."))
    return ob.EnableBanking(APP_ID, KEY_FILE.read_text(), API_URL, TRANSPORT)


def _fail(e: ob.OpenBankingError) -> HTTPException:
    return HTTPException(502, str(e))


def _days_left(valid_until: Optional[str]) -> Optional[int]:
    try:
        return (date.fromisoformat((valid_until or "")[:10]) - date.today()).days
    except ValueError:
        return None


def _effective_status(c: dict) -> str:
    left = _days_left(c.get("valid_until"))
    return "expired" if c["status"] == "active" and left is not None and left < 0 else c["status"]


def _default_redirect(request: Request) -> str:
    return REDIRECT_URL or f"{str(request.base_url).rstrip('/')}/api/openbanking/callback"


def _keep(task: asyncio.Task) -> None:
    _TASKS.add(task)
    task.add_done_callback(_TASKS.discard)


# ---------------------------------------------------------------- status and bank list
@router.get("/api/openbanking/status")
def ob_status(request: Request):
    with core.db() as con:
        conns = [dict(r) for r in con.execute("SELECT * FROM bank_connections WHERE status != 'pending' ORDER BY id")]
        accs = [dict(r) for r in con.execute("SELECT * FROM bank_accounts ORDER BY id")]
    for c in conns:
        c["status"] = _effective_status(c)
        c["days_left"] = _days_left(c.get("valid_until"))
        c["accounts"] = [a for a in accs if a["connection_id"] == c["id"]]
        c.pop("state", None)
        c.pop("session_id", None)
    return {"configured": configured(), "app_id": (APP_ID[:8] + "…") if APP_ID else "", "key_file": str(KEY_FILE),
            "key_present": KEY_FILE.is_file(), "redirect_url": _default_redirect(request), "sync_hours": SYNC_HOURS,
            "currency": core.CURRENCY, "connections": conns}


@router.get("/api/openbanking/banks")
async def ob_banks():
    """Banks of the configured countries (Belgium by default, Lithuania/Ireland for Revolut); KBC/ING/Belfius/Revolut first."""
    if time.time() - _banks_cache["t"] > 6 * 3600 or not _banks_cache["data"]:
        c = client()
        try:
            lists = await asyncio.gather(*[c.banks(cc) for cc in COUNTRIES], return_exceptions=True)
        except ob.OpenBankingError as e:
            raise _fail(e)
        banks, seen = [], set()
        for lst in lists:
            if isinstance(lst, ob.OpenBankingError):
                log.warning("Bank list failed: %s", lst)
                continue
            if isinstance(lst, Exception):
                raise lst
            for b in lst:
                if "business" in b["psu_types"] and "personal" not in b["psu_types"]:
                    continue                               # business-only bank connections
                k = (b["name"], b["country"])
                if b["name"] and k not in seen:
                    seen.add(k)
                    b["featured"] = ob.is_featured(b["name"])
                    banks.append(b)
        banks.sort(key=lambda b: (not b["featured"], (b["name"] or "").lower()))
        _banks_cache.update(t=time.time(), data=banks)
    banks = _banks_cache["data"]
    missing = [n for n in ("KBC", "ING", "Belfius", "Revolut") if not any(re.search(rf"\b{n}\b", b["name"], re.I) for b in banks)]
    return {"banks": banks, "missing": missing}


# ---------------------------------------------------------------- connect
@router.post("/api/openbanking/connect")
async def ob_connect(request: Request, body: dict = Body(...)):
    bank, country = (body.get("bank") or "").strip(), (body.get("country") or "BE").upper()
    if not bank:
        raise HTTPException(400, _t("Choose a bank"))
    days = CONSENT_DAYS
    known = next((b for b in _banks_cache["data"] if b["name"] == bank and b["country"] == country), None)
    if known and known.get("max_days"):
        days = min(days, known["max_days"])
    state, redirect = secrets.token_urlsafe(24), _default_redirect(request)
    try:
        res = await client().start_auth(bank, country, redirect, state, ob.iso_in(days))
    except ob.OpenBankingError as e:
        raise _fail(e)
    with core.db() as con:
        con.execute("DELETE FROM bank_connections WHERE status = 'pending' AND created < ?", ((datetime.now() - timedelta(hours=2)).isoformat(),))
        con.execute("INSERT INTO bank_connections(bank, country, state, status, created) VALUES (?, ?, ?, 'pending', ?)",
                    (bank, country, state, datetime.now().isoformat(timespec="seconds")))
    return {"url": res["url"], "redirect_url": redirect}


async def _complete(code: str, state: str) -> dict:
    with core.db() as con:
        row = con.execute("SELECT * FROM bank_connections WHERE state = ? AND status = 'pending'", (state,)).fetchone()
    if not row:
        raise HTTPException(400, _t("Unknown or expired authorisation – connect the bank again."))
    try:
        sess = await client().create_session(code)
    except ob.OpenBankingError as e:
        raise _fail(e)
    with core.db() as con:
        con.execute("UPDATE bank_connections SET session_id = ?, status = 'active', valid_until = ?, state = NULL, last_error = NULL WHERE id = ?",
                    (sess["session_id"], sess["valid_until"] or None, row["id"]))
        ids = []
        for a in sess["accounts"]:
            ours = (a["currency"] or "EUR") == core.CURRENCY      # other currencies (Revolut pockets) are not summed with the budget
            cur = con.execute("INSERT OR IGNORE INTO bank_accounts(connection_id, uid, iban, name, currency, enabled) VALUES (?, ?, ?, ?, ?, ?)",
                              (row["id"], a["uid"], a["iban"], a["name"], a["currency"], int(ours)))
            if cur.rowcount:
                ids.append(cur.lastrowid)
            core.register_own_account(con, a["iban"], f"{row['bank']} {a['name']}".strip(), "openbanking")
    for aid in ids if AUTO_IMPORT else []:                       # bulk-import the history right away (banks cut it after ~1 hour)
        _keep(asyncio.get_running_loop().create_task(_safe_sync(aid, full=True)))
    return {"connection_id": row["id"], "accounts": len(sess["accounts"]), "bank": row["bank"]}


async def _safe_sync(account_id: int, full: bool = False) -> None:
    try:
        await sync_account(account_id, full=full)
    except Exception as e:                                       # background: never raise
        log.warning("Bank sync of account %s failed: %s", account_id, getattr(e, "detail", e))


@router.get("/api/openbanking/callback")
async def ob_callback(code: str = "", state: str = "", error: str = "", error_description: str = ""):
    if error or not code:
        return RedirectResponse(f"/?bank=error&msg={(error_description or error or 'no code')[:120]}", status_code=302)
    try:
        await _complete(code, state)
    except HTTPException as e:
        return RedirectResponse(f"/?bank=error&msg={str(e.detail)[:120]}", status_code=302)
    return RedirectResponse("/?bank=connected", status_code=302)


@router.post("/api/openbanking/complete")
async def ob_complete(body: dict = Body(...)):
    """Manual fallback: paste the URL the bank redirected to (it contains `code` and `state`)."""
    q = parse_qs(urlparse(body.get("redirect_url") or "").query)
    code, state = (q.get("code") or [body.get("code")])[0], (q.get("state") or [body.get("state")])[0]
    if not code or not state:
        raise HTTPException(400, _t("The URL must contain code and state."))
    return await _complete(code, state)


# ---------------------------------------------------------------- sync
def _since(acc: dict) -> str:
    last = acc.get("last_booking_date")
    return (date.fromisoformat(last) - timedelta(days=7)).isoformat() if last else (date.today() - timedelta(days=90)).isoformat()


async def sync_account(account_id: int, full: bool = False) -> dict:
    """Fetch new booked transactions of one account. `full` = bulk history (as far back as the bank allows)."""
    with core.db() as con:
        row = con.execute("SELECT a.*, c.status AS cstatus, c.valid_until, c.id AS cid FROM bank_accounts a "
                          "JOIN bank_connections c ON c.id = a.connection_id WHERE a.id = ?", (account_id,)).fetchone()
    if not row:
        raise HTTPException(404, _t("Account not found"))
    acc = dict(row)
    if not acc["enabled"]:
        return {"account": account_id, "skipped": "disabled", "fetched": 0, "added": 0}
    if _effective_status({"status": acc["cstatus"], "valid_until": acc["valid_until"]}) != "active":
        raise HTTPException(409, _t("The consent for this bank has expired – connect it again."))
    if acc["next_allowed"] and acc["next_allowed"] > time.time():
        raise HTTPException(429, _t("The bank limits background access; try again after {time}.",
                                    time=datetime.fromtimestamp(acc["next_allowed"]).strftime("%H:%M")))
    c = client()
    date_from = None if full else _since(acc)
    if acc["from_date"] and (date_from is None or date_from < acc["from_date"]):
        date_from = acc["from_date"]
    try:
        raw = await c.transactions(acc["uid"], date_from, "longest" if full else "default")
    except ob.ExpiredSession:
        with core.db() as con:
            con.execute("UPDATE bank_connections SET status = 'expired', last_error = ? WHERE id = ?", ("EXPIRED_SESSION", acc["cid"]))
        raise HTTPException(409, _t("The consent for this bank has expired – connect it again."))
    except ob.RateLimited:
        with core.db() as con:
            con.execute("UPDATE bank_accounts SET next_allowed = ? WHERE id = ?", (time.time() + RATE_LIMIT_WAIT, account_id))
        raise HTTPException(429, _t("The bank limits background access; try again after {time}.",
                                    time=datetime.fromtimestamp(time.time() + RATE_LIMIT_WAIT).strftime("%H:%M")))
    except ob.OpenBankingError as e:
        with core.db() as con:
            con.execute("UPDATE bank_connections SET last_error = ? WHERE id = ?", (str(e)[:300], acc["cid"]))
        raise _fail(e)
    txs = ob.dedupe([t for t in (ob.normalize(r, acc["uid"], core.CURRENCY) for r in raw) if t])
    if acc["from_date"]:
        txs = [t for t in txs if t.date >= acc["from_date"]]
    new_ids: list[int] = []
    with core.db() as con:
        for t in txs:
            cur = con.execute(
                "INSERT OR IGNORE INTO transactions(statement_doc_id, hash, date, text, amount, sign_source, merchant, account_id, status) "
                "VALUES (?, ?, ?, ?, ?, 'api', ?, ?, 'open')", (-account_id, t.hash, t.date, t.text, t.amount, t.merchant, account_id))
            if cur.rowcount:
                new_ids.append(cur.lastrowid)
        # the counterparty IBAN of a transaction can be one of our own accounts: handled by post_import (transfer between own accounts)
        core.post_import(con, new_ids)
    balance = None
    try:
        balance = ob.pick_balance(await c.balances(acc["uid"]))
    except ob.OpenBankingError:
        pass
    last = max((t.date for t in txs), default=acc["last_booking_date"])
    with core.db() as con:
        con.execute("UPDATE bank_accounts SET last_sync = ?, last_booking_date = ?, balance = COALESCE(?, balance) WHERE id = ?",
                    (datetime.now().isoformat(timespec="seconds"), last, balance, account_id))
        con.execute("UPDATE bank_connections SET last_error = NULL WHERE id = ?", (acc["cid"],))
    return {"account": account_id, "fetched": len(raw), "added": len(new_ids)}


@router.post("/api/openbanking/accounts/{account_id}/sync")
async def ob_sync_account(account_id: int, body: dict = Body(default={})):
    return await sync_account(account_id, full=bool(body.get("full")))


@router.post("/api/openbanking/sync")
async def ob_sync_all(body: dict = Body(default={})):
    with core.db() as con:
        ids = [r["id"] for r in con.execute("SELECT a.id FROM bank_accounts a JOIN bank_connections c ON c.id = a.connection_id "
                                            "WHERE a.enabled = 1 AND c.status = 'active' ORDER BY a.id")]
    results = []
    for i in ids:
        try:
            results.append(await sync_account(i, full=bool(body.get("full"))))
        except HTTPException as e:
            results.append({"account": i, "error": e.detail})
    return {"accounts": len(ids), "added": sum(r.get("added", 0) for r in results), "results": results}


@router.put("/api/openbanking/accounts/{account_id}")
def ob_update_account(account_id: int, body: dict = Body(...)):
    sets, vals = [], []
    if "enabled" in body:
        sets.append("enabled = ?"); vals.append(int(bool(body["enabled"])))
    if "from_date" in body:
        fd = (body["from_date"] or "").strip() or None
        if fd:
            try:
                date.fromisoformat(fd)
            except ValueError:
                raise HTTPException(400, _t("Invalid date"))
        sets.append("from_date = ?"); vals.append(fd)
    if not sets:
        raise HTTPException(400, _t("Nothing to change"))
    with core.db() as con:
        con.execute(f"UPDATE bank_accounts SET {', '.join(sets)} WHERE id = ?", [*vals, account_id])
    return {"ok": True}


@router.delete("/api/openbanking/connections/{conn_id}")
async def ob_delete_connection(conn_id: int):
    with core.db() as con:
        row = con.execute("SELECT * FROM bank_connections WHERE id = ?", (conn_id,)).fetchone()
    if not row:
        raise HTTPException(404, _t("Connection not found"))
    if row["session_id"] and configured():
        try:
            await client().close_session(row["session_id"])
        except ob.OpenBankingError as e:               # already expired etc.: removing it locally is still right
            log.info("Closing session failed: %s", e)
    with core.db() as con:
        con.execute("DELETE FROM bank_accounts WHERE connection_id = ?", (conn_id,))
        con.execute("DELETE FROM bank_connections WHERE id = ?", (conn_id,))
    return {"ok": True}


# ---------------------------------------------------------------- background sync
def _due_accounts() -> list[int]:
    now, limit = time.time(), datetime.now() - timedelta(hours=SYNC_HOURS)
    out = []
    with core.db() as con:
        for r in con.execute("SELECT a.id, a.last_sync, a.next_allowed, c.status, c.valid_until FROM bank_accounts a "
                             "JOIN bank_connections c ON c.id = a.connection_id WHERE a.enabled = 1 AND c.status = 'active'"):
            if _effective_status({"status": r["status"], "valid_until": r["valid_until"]}) != "active":
                continue
            if r["next_allowed"] and r["next_allowed"] > now:
                continue
            if not r["last_sync"] or datetime.fromisoformat(r["last_sync"]) < limit:
                out.append(r["id"])
    return out


async def _poller():
    await asyncio.sleep(45)
    while True:
        try:
            if configured():
                for aid in _due_accounts():
                    await _safe_sync(aid)
                    await asyncio.sleep(2)
        except Exception as e:
            log.warning("Bank poller: %s", e)
        await asyncio.sleep(3600)


def start_poller():
    _keep(asyncio.get_event_loop().create_task(_poller()))
