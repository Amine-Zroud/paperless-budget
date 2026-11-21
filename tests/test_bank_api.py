"""Bank connections through the FastAPI app: connect -> callback -> import -> sync, with a mocked aggregator."""
import json
import time
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app            # import main first: it registers the API modules (circular by design)
from app import bank_api, main

SAVINGS_IBAN = "BE11111111111111"


class Aggregator:
    """Fake Enable Banking: one session with a current account, a savings account and a USD pocket."""

    def __init__(self):
        self.calls, self.fail, self.txs = [], None, []

    def __call__(self, req: httpx.Request) -> httpx.Response:
        body = json.loads(req.content or b"{}")
        self.calls.append((req.method, req.url.path, dict(req.url.params), body))
        p = req.url.path
        if p == "/aspsps":
            c = req.url.params["country"]
            names = {"BE": ["KBC", "ING", "Belfius", "Argenta"], "LT": ["Revolut"], "IE": []}[c]
            return httpx.Response(200, json={"aspsps": [{"name": n, "country": c, "psu_types": ["personal"], "maximum_consent_validity": 15552000} for n in names]})
        if p == "/auth":
            return httpx.Response(200, json={"url": "https://bank.test/approve?x=1", "authorization_id": "A1"})
        if p == "/sessions" and req.method == "POST":
            return httpx.Response(200, json={"session_id": "S1", "access": {"valid_until": "2099-01-01T00:00:00Z"}, "aspsp": {"name": "KBC"}, "accounts": [
                {"uid": "u-eur", "account_id": {"iban": "BE68539007547034"}, "currency": "EUR", "name": "Current"},
                {"uid": "u-sav", "account_id": {"iban": SAVINGS_IBAN}, "currency": "EUR", "name": "Savings"},
                {"uid": "u-usd", "account_id": {"iban": "BE71096123456769"}, "currency": "USD", "name": "Dollar"}]})
        if p == "/sessions/S1" and req.method == "DELETE":
            return httpx.Response(204)
        if p.endswith("/balances"):
            return httpx.Response(200, json={"balances": [{"balance_type": "CLBD", "balance_amount": {"amount": "1234.50", "currency": "EUR"}}]})
        if p.endswith("/transactions"):
            if self.fail:
                return httpx.Response(self.fail[0], json=self.fail[1])
            uid = p.split("/")[2]
            return httpx.Response(200, json={"transactions": self.txs if uid == "u-eur" else []})
        return httpx.Response(404, json={"error": "NOT_FOUND"})


def tx(ref, amount, day, indicator="DBIT", name="Shop One", iban=None, remit="Card payment"):
    t = {"entry_reference": ref, "status": "BOOK", "booking_date": day, "credit_debit_indicator": indicator,
         "transaction_amount": {"amount": amount, "currency": "EUR"}, "remittance_information": [remit]}
    t["creditor" if indicator == "DBIT" else "debtor"] = {"name": name}
    if iban:
        t["creditor_account" if indicator == "DBIT" else "debtor_account"] = {"iban": iban}
    return t


@pytest.fixture()
def env(monkeypatch):
    agg = Aggregator()
    monkeypatch.setattr(bank_api, "TRANSPORT", httpx.MockTransport(agg))
    monkeypatch.setattr(bank_api, "AUTO_IMPORT", False)               # tests start the sync themselves
    monkeypatch.setattr(bank_api, "REDIRECT_URL", "http://localhost:8088/api/openbanking/callback")
    bank_api._banks_cache.update(t=0.0, data=[])
    with main.db() as con:
        for t in ("bank_accounts", "bank_connections", "transactions", "own_accounts", "rules"):
            con.execute(f"DELETE FROM {t}")
    with TestClient(app, follow_redirects=False) as c:
        yield c, agg


def connect(c, agg, via="callback"):
    r = c.post("/api/openbanking/connect", json={"bank": "KBC", "country": "BE"})
    assert r.status_code == 200 and r.json()["url"].startswith("https://bank.test/")
    state = sql("SELECT state FROM bank_connections WHERE status = 'pending'")[0]["state"]
    if via == "callback":
        resp = c.get("/api/openbanking/callback", params={"code": "the-code", "state": state})
        assert resp.status_code == 302 and resp.headers["location"] == "/?bank=connected"
    else:
        resp = c.post("/api/openbanking/complete", json={"redirect_url": f"http://localhost:8088/cb?code=the-code&state={state}"})
        assert resp.status_code == 200 and resp.json()["accounts"] == 3
    return {a["name"]: a for a in c.get("/api/openbanking/status").json()["connections"][0]["accounts"]}


def sql(query, *args):
    with main.db() as con:
        cur = con.execute(query, args)
        return [dict(r) for r in cur.fetchall()] if cur.description else None


def rows():
    with main.db() as con:
        return [dict(r) for r in con.execute("SELECT * FROM transactions ORDER BY id")]


def test_status_before_connecting(env):
    c, _ = env
    s = c.get("/api/openbanking/status").json()
    assert s["configured"] is True and s["connections"] == [] and s["currency"] == "EUR"


def test_banks_are_listed_with_the_wanted_ones_first_and_missing_ones_reported(env):
    c, agg = env
    r = c.get("/api/openbanking/banks").json()
    assert [b["name"] for b in r["banks"][:4]] == ["Belfius", "ING", "KBC", "Revolut"] and r["banks"][-1]["name"] == "Argenta"
    assert r["missing"] == []
    agg_names = {call[2].get("country") for call in agg.calls if call[1] == "/aspsps"}
    assert agg_names == {"BE", "LT", "IE"}


def test_connect_callback_creates_accounts_and_only_euro_accounts_are_enabled(env):
    c, agg = env
    accounts = connect(c, agg)
    assert set(accounts) == {"Current", "Savings", "Dollar"}
    assert accounts["Current"]["enabled"] == 1 and accounts["Dollar"]["enabled"] == 0      # other currencies are not summed into the budget
    auth = next(call for call in agg.calls if call[1] == "/auth")
    assert auth[3]["aspsp"] == {"name": "KBC", "country": "BE"} and auth[3]["redirect_url"].endswith("/api/openbanking/callback")
    with main.db() as con:
        assert {r["iban"] for r in con.execute("SELECT iban FROM own_accounts")} >= {"BE68539007547034", SAVINGS_IBAN}


def test_manual_completion_with_the_pasted_redirect_url(env):
    c, agg = env
    assert set(connect(c, agg, via="complete")) == {"Current", "Savings", "Dollar"}


def test_callback_with_unknown_state_or_error_redirects_with_a_message(env):
    c, _ = env
    r = c.get("/api/openbanking/callback", params={"code": "x", "state": "nope"})
    assert r.status_code == 302 and r.headers["location"].startswith("/?bank=error")
    r = c.get("/api/openbanking/callback", params={"error": "access_denied", "error_description": "User cancelled"})
    assert "bank=error" in r.headers["location"] and "cancelled" in r.headers["location"]


def test_bulk_import_then_incremental_sync_is_idempotent(env):
    c, agg = env
    agg.txs = [tx("1", "25.50", "2026-05-02"), tx("2", "4200.00", "2026-05-03", "CRDT", "Employer", remit="Salary"),
               tx("3", "500.00", "2026-05-04", name="Own savings", iban=SAVINGS_IBAN, remit="Move to savings")]
    acc = connect(c, agg)["Current"]
    r = c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={"full": True}).json()
    assert r["fetched"] == 3 and r["added"] == 3
    call = [x for x in agg.calls if x[1] == "/accounts/u-eur/transactions"][-1]
    assert call[2]["strategy"] == "longest" and "date_from" not in call[2]
    got = {r["amount"]: r for r in rows()}
    assert got[-25.50]["status"] == "open" and got[-25.50]["sign_source"] == "api" and got[-25.50]["merchant"] == "Shop One"
    assert got[-25.50]["statement_doc_id"] == -acc["id"] and got[-25.50]["account_id"] == acc["id"]
    assert got[4200.00]["status"] == "open"
    assert got[-500.00]["status"] == "ignored" and "own accounts" in got[-500.00]["note"]          # transfer to the own savings account
    again = c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={}).json()
    assert again["fetched"] == 3 and again["added"] == 0 and len(rows()) == 3
    inc = [x for x in agg.calls if x[1] == "/accounts/u-eur/transactions"][-1]
    assert inc[2]["strategy"] == "default" and inc[2]["date_from"] == "2026-04-27"                # last booking date - 7 days
    st = c.get("/api/openbanking/status").json()["connections"][0]["accounts"]
    assert {a["name"]: a["balance"] for a in st}["Current"] == 1234.50


def test_rules_apply_to_imported_transactions(env):
    c, agg = env
    sql("INSERT INTO rules(keyword, ignore) VALUES ('shop one', 1)")
    agg.txs = [tx("1", "25.50", "2026-05-02")]
    acc = connect(c, agg)["Current"]
    c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={"full": True})
    assert rows()[0]["status"] == "ignored"


def test_start_date_filters_older_transactions(env):
    c, agg = env
    agg.txs = [tx("1", "10.00", "2026-01-10"), tx("2", "20.00", "2026-05-02")]
    acc = connect(c, agg)["Current"]
    assert c.put(f"/api/openbanking/accounts/{acc['id']}", json={"from_date": "2026-03-01"}).status_code == 200
    assert c.put(f"/api/openbanking/accounts/{acc['id']}", json={"from_date": "nonsense"}).status_code == 400
    assert c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={"full": True}).json()["added"] == 1
    assert [r["amount"] for r in rows()] == [-20.00]


def test_disabled_account_is_skipped(env):
    c, agg = env
    acc = connect(c, agg)["Dollar"]
    r = c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={}).json()
    assert r["skipped"] == "disabled"
    assert not [x for x in agg.calls if x[1] == "/accounts/u-usd/transactions"]


def test_rate_limit_sets_a_wait_and_stops_calling_the_bank(env):
    c, agg = env
    acc = connect(c, agg)["Current"]
    agg.fail = (429, {"error": "ASPSP_RATE_LIMIT_EXCEEDED", "message": "slow"})
    assert c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={}).status_code == 429
    n = len(agg.calls)
    assert c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={}).status_code == 429
    assert len(agg.calls) == n                                              # no second request to the aggregator
    with main.db() as con:
        wait = con.execute("SELECT next_allowed FROM bank_accounts WHERE id = ?", (acc["id"],)).fetchone()[0]
    assert wait > time.time() + 5 * 3600
    assert acc["id"] not in bank_api._due_accounts()


def test_expired_session_marks_the_connection_expired(env):
    c, agg = env
    acc = connect(c, agg)["Current"]
    agg.fail = (401, {"error": "EXPIRED_SESSION", "message": "gone"})
    assert c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={}).status_code == 409
    assert c.get("/api/openbanking/status").json()["connections"][0]["status"] == "expired"
    agg.fail = None
    assert c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={}).status_code == 409      # needs a new authorisation


def test_consent_past_its_end_date_counts_as_expired(env):
    c, agg = env
    connect(c, agg)
    with main.db() as con:
        con.execute("UPDATE bank_connections SET valid_until = '2020-01-01'")
    s = c.get("/api/openbanking/status").json()["connections"][0]
    assert s["status"] == "expired" and s["days_left"] < 0 and bank_api._due_accounts() == []


def test_due_accounts_follow_the_sync_interval(env):
    c, agg = env
    accs = connect(c, agg)
    cur = accs["Current"]["id"]
    assert cur in bank_api._due_accounts() and accs["Dollar"]["id"] not in bank_api._due_accounts()
    c.post(f"/api/openbanking/accounts/{cur}/sync", json={})
    assert cur not in bank_api._due_accounts()                              # just synced


def test_sync_all_and_delete_connection(env):
    c, agg = env
    agg.txs = [tx("1", "25.50", "2026-05-02")]
    connect(c, agg)
    r = c.post("/api/openbanking/sync", json={"full": True}).json()
    assert r["accounts"] == 2 and r["added"] == 1                            # enabled accounts only
    conn = c.get("/api/openbanking/status").json()["connections"][0]
    assert c.delete(f"/api/openbanking/connections/{conn['id']}").status_code == 200
    assert any(x[0] == "DELETE" and x[1] == "/sessions/S1" for x in agg.calls)
    assert c.get("/api/openbanking/status").json()["connections"] == []
    assert len(rows()) == 1                                                   # imported transactions stay


def test_not_configured_gives_a_clear_error(env, monkeypatch):
    c, _ = env
    monkeypatch.setattr(bank_api, "APP_ID", "")
    assert c.get("/api/openbanking/status").json()["configured"] is False
    assert c.get("/api/openbanking/banks").status_code == 409


def test_history_is_imported_automatically_right_after_connecting(env, monkeypatch):
    c, agg = env
    monkeypatch.setattr(bank_api, "AUTO_IMPORT", True)
    agg.txs = [tx("1", "25.50", "2026-05-02"), tx("2", "4200.00", "2026-05-03", "CRDT", "Employer")]
    connect(c, agg)
    for _ in range(50):
        if len(rows()) == 2:
            break
        time.sleep(0.1)
    assert len(rows()) == 2
    call = [x for x in agg.calls if x[1] == "/accounts/u-eur/transactions"][0]
    assert call[2]["strategy"] == "longest"                       # as far back as the bank allows


def test_one_malformed_transaction_is_skipped_not_fatal(env):
    c, agg = env
    bad = tx("9", "1.00", "2026-05-05")
    bad["transaction_amount"] = {"amount": None, "currency": "EUR"}
    bad2 = tx("8", "2.00", "2026-05-05", name=None)
    agg.txs = [tx("1", "25.50", "2026-05-02"), bad, bad2]
    acc = connect(c, agg)["Current"]
    r = c.post(f"/api/openbanking/accounts/{acc['id']}/sync", json={"full": True}).json()
    assert r["added"] == 2 and len(rows()) == 2
