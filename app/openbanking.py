"""Open Banking account information through an aggregator (PSD2 AIS) – provider interface + Enable Banking.

Enable Banking (https://enablebanking.com) is free for personal use of your own accounts ("restricted production": only
accounts you link yourself are returned). Flow:

  1. `banks()`                       list the banks (ASPSPs) of a country
  2. `start_auth(bank, redirect…)`   -> URL the user opens to approve access in the bank's app (itsme, card reader …)
  3. `create_session(code)`          the bank redirects back with `code`; returns the session and its accounts
  4. `transactions(account, …)`      booked transactions, paged with `continuation_key`
  5. consent expires after at most 180 days (per bank) -> `ExpiredSession`, the user must authorise again

Limits to respect: unattended (scheduled) access is limited by the banks to about 4 requests per account and day
(`RateLimited`, wait ~6 hours); many banks only deliver ~90 days of history shortly after the authorisation, so bulk-import
the history right after connecting (`strategy="longest"`).

Other aggregators (Ponto, …) implement the same small `Provider` protocol.
Without dependency on FastAPI/Paperless so that it can be tested in isolation (an `httpx` transport can be injected).
"""
from __future__ import annotations

import hashlib
import re
import time
from dataclasses import dataclass
from datetime import date
from typing import Any, Optional, Protocol

import httpx

API_URL = "https://api.enablebanking.com"


class OpenBankingError(Exception):
    """Error answered by the aggregator or the bank."""

    def __init__(self, message: str, code: str = "", status: int = 0):
        super().__init__(message)
        self.code, self.status = code, status


class ExpiredSession(OpenBankingError):
    """The user's consent is gone: a new authorisation is needed."""


class RateLimited(OpenBankingError):
    """The bank limits background access (about 4 times a day): try again later."""


@dataclass
class Tx:
    """A booked bank transaction in the app's convention (negative = debit)."""
    key: str                # stable id (entry reference / transaction id / content hash)
    date: str               # ISO date
    amount: float
    currency: str
    text: str
    merchant: str
    counter_iban: str = ""
    hash: str = ""


class Provider(Protocol):
    async def banks(self, country: str) -> list[dict]: ...
    async def start_auth(self, bank: str, country: str, redirect_url: str, state: str, valid_until: str) -> dict: ...
    async def create_session(self, code: str) -> dict: ...
    async def transactions(self, uid: str, date_from: Optional[str], strategy: str = "default") -> list[dict]: ...
    async def balances(self, uid: str) -> list[dict]: ...
    async def close_session(self, session_id: str) -> None: ...


# ---------------------------------------------------------------- normalisation
def _name(party: Any) -> str:
    return str(party.get("name") or "").strip() if isinstance(party, dict) else ""      # banks send "name": null


def _iban(acc: Any) -> str:
    return re.sub(r"\s", "", ((acc or {}).get("iban") or "")).upper() if isinstance(acc, dict) else ""


def normalize(raw: dict, account_uid: str, default_currency: str = "EUR") -> Optional[Tx]:
    """Enable Banking transaction -> `Tx`; pending transactions are skipped (they come back booked later)."""
    if (raw.get("status") or "BOOK").upper() != "BOOK":
        return None
    d = raw.get("booking_date") or raw.get("value_date") or raw.get("transaction_date")
    ta = raw.get("transaction_amount") or {}
    try:
        amount = float(ta.get("amount"))
    except (TypeError, ValueError):
        return None
    if not d:
        return None
    debit = (raw.get("credit_debit_indicator") or "").upper() == "DBIT"
    value = -abs(amount) if debit else abs(amount)
    cp, cp_acc = (raw.get("creditor"), raw.get("creditor_account")) if debit else (raw.get("debtor"), raw.get("debtor_account"))
    name, iban = _name(cp), _iban(cp_acc)
    info = raw.get("remittance_information") or []
    info = [info] if isinstance(info, str) else info
    remit = " ".join(str(x).strip() for x in info if x and str(x).strip())
    cur = ta.get("currency") or default_currency
    parts: list[str] = []
    for p in (name, remit, str(raw.get("note") or "").strip(), f"IBAN {iban}" if iban else ""):
        if p and p not in parts:
            parts.append(p)
    if cur != default_currency:
        parts.append(f"{abs(amount):.2f} {cur}")
    text = re.sub(r"\s+", " ", " · ".join(parts))[:600]
    merchant = name or re.sub(r"\s+", " ", remit)[:60]
    key = raw.get("entry_reference") or raw.get("transaction_id") or ""
    base = f"api|{account_uid}|{key}" if key else f"api|{account_uid}|{d}|{value:.2f}|{text}"
    return Tx(key=key, date=d[:10], amount=round(value, 2), currency=cur, text=text, merchant=merchant, counter_iban=iban,
              hash=hashlib.sha1(base.encode()).hexdigest())


def dedupe(txs: list[Tx]) -> list[Tx]:
    """Banks without a stable reference can deliver identical rows (same day, amount, text): keep them distinct, in order."""
    seen: dict = {}
    for t in txs:
        n = seen[t.hash] = seen.get(t.hash, 0) + 1
        if n > 1:
            t.hash = hashlib.sha1(f"{t.hash}|{n}".encode()).hexdigest()
    return txs


# ---------------------------------------------------------------- Enable Banking
class EnableBanking:
    def __init__(self, app_id: str, private_key_pem: str, base_url: str = API_URL, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.app_id, self.key, self.base = app_id, private_key_pem, base_url.rstrip("/")
        self.http = httpx.AsyncClient(base_url=self.base, timeout=60, transport=transport)

    def token(self, ttl: int = 3600) -> str:
        import jwt   # PyJWT[crypto]
        now = int(time.time())
        return jwt.encode({"iss": "enablebanking.com", "aud": "api.enablebanking.com", "iat": now, "exp": now + min(ttl, 86400)},
                          self.key, algorithm="RS256", headers={"typ": "JWT", "kid": self.app_id})

    async def _req(self, method: str, path: str, **kw) -> Any:
        try:
            r = await self.http.request(method, path, headers={"Authorization": f"Bearer {self.token()}"}, **kw)
        except httpx.HTTPError as e:
            raise OpenBankingError(f"Enable Banking not reachable: {e}") from e
        if r.status_code >= 400:
            try:
                body = r.json()
            except ValueError:
                body = {}
            code, msg = str(body.get("error") or body.get("code") or ""), str(body.get("message") or r.text[:300])
            if code == "EXPIRED_SESSION" or (r.status_code == 401 and "SESSION" in code.upper()):
                raise ExpiredSession(msg, code, r.status_code)
            if code == "ASPSP_RATE_LIMIT_EXCEEDED" or r.status_code == 429:
                raise RateLimited(msg, code or "ASPSP_RATE_LIMIT_EXCEEDED", r.status_code)
            raise OpenBankingError(msg or f"HTTP {r.status_code}", code, r.status_code)
        return r.json() if r.content else None

    async def banks(self, country: str) -> list[dict]:
        out = []
        for a in (await self._req("GET", "/aspsps", params={"country": country})).get("aspsps", []):
            mc = a.get("maximum_consent_validity")
            out.append({"name": a.get("name"), "country": a.get("country") or country, "logo": a.get("logo"),
                        "psu_types": a.get("psu_types") or [],
                        "max_days": int(mc // 86400) if isinstance(mc, (int, float)) and mc > 1000 else (int(mc) if mc else None)})
        return out

    async def start_auth(self, bank: str, country: str, redirect_url: str, state: str, valid_until: str) -> dict:
        r = await self._req("POST", "/auth", json={
            "access": {"valid_until": valid_until}, "aspsp": {"name": bank, "country": country}, "state": state,
            "redirect_url": redirect_url, "psu_type": "personal"})
        return {"url": r["url"], "authorization_id": r.get("authorization_id")}

    async def create_session(self, code: str) -> dict:
        r = await self._req("POST", "/sessions", json={"code": code})
        accounts = []
        for a in r.get("accounts") or []:
            iban = _iban(a.get("account_id"))
            accounts.append({"uid": a.get("uid"), "iban": iban, "currency": a.get("currency") or "EUR",
                             "name": a.get("name") or (a.get("details") or "") or iban})
        return {"session_id": r.get("session_id"), "accounts": accounts,
                "valid_until": ((r.get("access") or {}).get("valid_until") or "")[:10],
                "bank": (r.get("aspsp") or {}).get("name")}

    async def transactions(self, uid: str, date_from: Optional[str], strategy: str = "default") -> list[dict]:
        out: list[dict] = []
        params: dict = {"transaction_status": "BOOK", "strategy": strategy}
        if date_from:
            params["date_from"] = date_from
        for _ in range(200):        # page limit as a safety net
            r = await self._req("GET", f"/accounts/{uid}/transactions", params=params)
            out += r.get("transactions") or []
            if not r.get("continuation_key"):
                break
            params["continuation_key"] = r["continuation_key"]
        return out

    async def balances(self, uid: str) -> list[dict]:
        return (await self._req("GET", f"/accounts/{uid}/balances")).get("balances") or []

    async def close_session(self, session_id: str) -> None:
        await self._req("DELETE", f"/sessions/{session_id}")


def pick_balance(balances: list[dict]) -> Optional[float]:
    """Closing booked balance if the bank gives one, else the first balance."""
    pref = {"CLBD": 0, "ITBD": 1, "XPCD": 2, "CLAV": 3, "ITAV": 4}
    best = sorted(balances, key=lambda b: pref.get((b.get("balance_type") or "").upper(), 9))
    try:
        return float(best[0]["balance_amount"]["amount"]) if best else None
    except (KeyError, TypeError, ValueError):
        return None


def is_featured(name: str) -> bool:
    return bool(re.search(r"\bkbc\b|\bing\b|belfius|revolut", name or "", re.I))


def iso_in(days: int) -> str:
    """RFC 3339 UTC timestamp `days` from now (for the consent validity)."""
    return time.strftime("%Y-%m-%dT%H:%M:%S+00:00", time.gmtime(time.time() + days * 86400))


def today() -> date:
    return date.today()
