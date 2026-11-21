"""Enable Banking client against a mocked aggregator (no network): JWT, endpoints, paging, errors, normalisation."""
import asyncio
import json

import httpx
import jwt
import pytest

from app import openbanking as ob
from tests.conftest import KEY_PEM, PUBLIC_KEY


def client(handler):
    return ob.EnableBanking("my-app", KEY_PEM, "https://api.test", httpx.MockTransport(handler))


def run(coro):
    return asyncio.run(coro)


def test_jwt_has_the_claims_enable_banking_expects():
    token = client(lambda r: httpx.Response(200, json={})).token()
    header = jwt.get_unverified_header(token)
    assert header["alg"] == "RS256" and header["typ"] == "JWT" and header["kid"] == "my-app"
    claims = jwt.decode(token, PUBLIC_KEY, algorithms=["RS256"], audience="api.enablebanking.com", issuer="enablebanking.com")
    assert 0 < claims["exp"] - claims["iat"] <= 86400


def test_every_request_is_signed_and_banks_are_mapped():
    seen = {}

    def handler(req):
        seen["auth"], seen["q"], seen["path"] = req.headers["authorization"], dict(req.url.params), req.url.path
        return httpx.Response(200, json={"aspsps": [
            {"name": "KBC", "country": "BE", "psu_types": ["personal", "business"], "maximum_consent_validity": 15552000},
            {"name": "Revolut", "country": "LT", "psu_types": ["personal"]}]})

    banks = run(client(handler).banks("BE"))
    assert seen["path"] == "/aspsps" and seen["q"] == {"country": "BE"} and seen["auth"].startswith("Bearer ey")
    assert [(b["name"], b["max_days"]) for b in banks] == [("KBC", 180), ("Revolut", None)]


def test_start_auth_and_session():
    calls = []

    def handler(req):
        body = json.loads(req.content or b"{}")
        calls.append((req.method, req.url.path, body))
        if req.url.path == "/auth":
            return httpx.Response(200, json={"url": "https://bank.test/approve", "authorization_id": "A1"})
        return httpx.Response(200, json={"session_id": "S1", "access": {"valid_until": "2027-03-01T10:00:00Z"}, "aspsp": {"name": "KBC"},
                                         "accounts": [{"uid": "u1", "account_id": {"iban": "BE68 5390 0754 7034"}, "currency": "EUR", "name": "Current"}]})

    c = client(handler)
    res = run(c.start_auth("KBC", "BE", "http://localhost/cb", "state123", "2027-01-01T00:00:00+00:00"))
    assert res["url"] == "https://bank.test/approve"
    sent = calls[0][2]
    assert sent["aspsp"] == {"name": "KBC", "country": "BE"} and sent["state"] == "state123" and sent["psu_type"] == "personal"
    assert sent["redirect_url"] == "http://localhost/cb" and sent["access"]["valid_until"].startswith("2027")
    sess = run(c.create_session("the-code"))
    assert calls[1][2] == {"code": "the-code"}
    assert sess["session_id"] == "S1" and sess["valid_until"] == "2027-03-01"
    assert sess["accounts"] == [{"uid": "u1", "iban": "BE68539007547034", "currency": "EUR", "name": "Current"}]


def test_transactions_are_paged_with_continuation_key():
    pages = []

    def handler(req):
        q = dict(req.url.params)
        pages.append(q)
        if "continuation_key" not in q:
            return httpx.Response(200, json={"transactions": [{"entry_reference": "1"}], "continuation_key": "next"})
        return httpx.Response(200, json={"transactions": [{"entry_reference": "2"}]})

    txs = run(client(handler).transactions("u1", "2026-01-01", "longest"))
    assert [t["entry_reference"] for t in txs] == ["1", "2"]
    assert pages[0] == {"transaction_status": "BOOK", "strategy": "longest", "date_from": "2026-01-01"}
    assert pages[1]["continuation_key"] == "next"


@pytest.mark.parametrize("status,body,exc", [
    (401, {"error": "EXPIRED_SESSION", "message": "gone"}, ob.ExpiredSession),
    (429, {"error": "ASPSP_RATE_LIMIT_EXCEEDED", "message": "slow down"}, ob.RateLimited),
    (429, {}, ob.RateLimited),
    (500, {"error": "X", "message": "boom"}, ob.OpenBankingError),
])
def test_errors_are_mapped(status, body, exc):
    with pytest.raises(exc):
        run(client(lambda r: httpx.Response(status, json=body)).transactions("u1", None))


def raw(**kw):
    base = {"entry_reference": "R1", "status": "BOOK", "booking_date": "2026-05-02", "credit_debit_indicator": "DBIT",
            "transaction_amount": {"amount": "25.50", "currency": "EUR"}, "creditor": {"name": "Shop One"},
            "creditor_account": {"iban": "BE00 1111 2222 3333"}, "remittance_information": ["Card payment", "ref 42"]}
    base.update(kw)
    return base


def test_debit_and_credit_signs_and_counterparty():
    d = ob.normalize(raw(), "u1")
    assert d.amount == -25.50 and d.date == "2026-05-02" and d.merchant == "Shop One" and d.counter_iban == "BE00111122223333"
    assert "Shop One" in d.text and "Card payment ref 42" in d.text and "IBAN BE00111122223333" in d.text
    c = ob.normalize(raw(credit_debit_indicator="CRDT", debtor={"name": "Employer"}, debtor_account={"iban": "BE99"}, creditor=None), "u1")
    assert c.amount == 25.50 and c.merchant == "Employer" and c.counter_iban == "BE99"


def test_pending_and_incomplete_are_skipped():
    assert ob.normalize(raw(status="PDNG"), "u1") is None
    assert ob.normalize(raw(booking_date=None, value_date=None, transaction_date=None), "u1") is None
    assert ob.normalize(raw(transaction_amount={"amount": "abc"}), "u1") is None


def test_value_date_fallback_foreign_currency_and_merchant_from_remittance():
    t = ob.normalize(raw(booking_date=None, value_date="2026-05-03", creditor=None, creditor_account=None,
                         transaction_amount={"amount": "10.00", "currency": "USD"}), "u1")
    assert t.date == "2026-05-03" and "10.00 USD" in t.text and t.merchant.startswith("Card payment")


def test_hash_is_stable_per_account_and_reference_and_identical_rows_stay_distinct():
    a, b = ob.normalize(raw(), "u1"), ob.normalize(raw(), "u1")
    assert a.hash == b.hash != ob.normalize(raw(), "u2").hash
    noref = raw(entry_reference=None)
    twins = ob.dedupe([ob.normalize(noref, "u1"), ob.normalize(noref, "u1")])
    assert len({t.hash for t in twins}) == 2


def test_pick_balance_prefers_closing_booked():
    bals = [{"balance_type": "ITAV", "balance_amount": {"amount": "5"}}, {"balance_type": "CLBD", "balance_amount": {"amount": "123.45"}}]
    assert ob.pick_balance(bals) == 123.45 and ob.pick_balance([]) is None


def test_featured_banks():
    assert all(ob.is_featured(n) for n in ("KBC Bank", "ING Belgium", "Belfius Bank", "Revolut"))
    assert not ob.is_featured("Argenta")


def test_null_names_and_odd_remittance_do_not_break_normalisation():
    """Revolut sends counterparties like {"name": null}; remittance can be a plain string."""
    t = ob.normalize(raw(creditor={"name": None}, creditor_account=None, remittance_information="Coffee"), "u1")
    assert t.amount == -25.50 and t.merchant == "Coffee" and t.text == "Coffee"
    t2 = ob.normalize(raw(creditor=None, debtor=None, note=None, remittance_information=None), "u1")
    assert t2 is not None and t2.merchant == ""
