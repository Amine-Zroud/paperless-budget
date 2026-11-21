"""Beobank VISA credit card statements ("Relevé de votre carte de crédit", PDF text from Paperless).

Layout of a statement (pdftotext -layout style):

    Numéro de votre carte de crédit:  4000XXXXXXXX1234      Période de ce relevé : du 25/09/2024 au 24/10/2024
    Résumé:  Solde précédent  350,76 €   Dépenses  742,58 €   Autres débits  13,00 €   Paiements enregistrés  -360,00 €
             Montant utilisé  746,34 €
    Vos transactions
    22/09/2024   PAYPAL *OVH 35314369001 FR                                   29,58      <- purchase = positive on the statement
    27/09/2024   PAIEMENT M JOHN DOE IBAN BE00…                             -360,00      <- card payment (credit)
    12/03/2023   TUNISAIR TND TUNIS TTN                                      127,44
                 FRAIS DE CHANGE                                               2,68      <- fee line without a date: belongs to the row above
    25/02/2024   INTERETS DEBITEURS
                 Intérêts débiteurs du 25/01/2024 au 25/02/2024               29,39 €    <- amount on the next line

* Amounts in the list use a space as thousands separator ("1 200,00"); the summary uses "." or nothing.
* App convention: negative = debit. Purchases/fees are positive on the statement -> negated; payments and refunds
  (PAIEMENT, REMBOURS…, CASH BACK) are credits.
* Verification: sum of the rows = "Montant utilisé" − "Solde précédent" (old statements: "Montant épargné"). If it holds the
  rows are marked "saldo" (verified), otherwise "stichwort" (unverified, the app shows a warning).
* Card payments ("PAIEMENT …") are flagged `internal`: they are transfers from the user's own bank account.
Without dependency on FastAPI/Paperless so that it can be tested in isolation.
"""
from __future__ import annotations

import hashlib
import re
from datetime import date
from typing import Optional

from .bank import Booking

AMT = r"-?\d{1,3}(?:[ .]\d{3})*,\d{2}|-?\d+,\d{2}"
DATE = r"\d{2}/\d{2}/\d{4}"
DETECT_RE = re.compile(r"relev[ée]\s+de\s+votre\s+carte\s+de\s+cr[ée]dit", re.I)
# Paperless stores the text with runs of spaces collapsed to one, `pdftotext -layout` keeps wide gaps: accept both.
# Lazy description + amount at the end: "… IE 1 370,00" -> amount "1 370,00" (space as thousands separator).
ROW_RE = re.compile(rf"^\s*(?P<date>{DATE})\s+(?P<desc>\S.*?)\s+(?P<amt>{AMT})\s*$")
ROW_NO_AMT_RE = re.compile(rf"^\s*(?P<date>{DATE})\s+(?P<desc>\S.*?)\s*$")
DETAIL_RE = re.compile(rf"^\s*(?P<text>\S.*?)\s+(?P<amt>{AMT})\s*€\s*$")
FOREIGN_RE = re.compile(rf"^\s*(?P<amt>{AMT})\s+(?P<cur>[A-Z]{{3}})\s+TAUX\s+DE\s+CHANGE\s+(?P<rate>[\d.,]+)\s*$")
UNDATED_RE = re.compile(rf"^\s*(?P<desc>[A-ZÉÈ][A-ZÉÈ'’ .\-/]+?)\s+(?P<amt>{AMT})\s*$")
CARD_RE = re.compile(r"num[ée]ro\s+de\s+votre\s+carte\s+de\s+cr[ée]dit\s*:\s*(\d{4}X+\d{4})", re.I)
REF_RE = re.compile(r"num[ée]ro\s+de\s+r[ée]f[ée]rence\s*:\s*(\d+)", re.I)
PERIOD_RE = re.compile(rf"p[ée]riode\s+de\s+ce\s+relev[ée]\s*:\s*du\s+({DATE})\s+au\s+({DATE})", re.I)
IBAN_RE = re.compile(r"compte\s+Beobank\s+(BE\d\d(?:\s?\d{4}){3})", re.I)
CREDIT_LABEL_RE = re.compile(r"^(paiement\b|rembours|votre cash ?back|cash ?back|annulation)", re.I)
PAYMENT_RE = re.compile(r"^paiement\b", re.I)
COUNTRY_RE = re.compile(r"\s+[A-Z]{2,3}$")


def _num(s: str) -> float:
    return float(re.sub(r"[ .]", "", s).replace(",", "."))


def _iso(d: str) -> str:
    dd, mm, yy = d.split("/")
    return date(int(yy), int(mm), int(dd)).isoformat()


def looks_like(text: str) -> bool:
    return bool(DETECT_RE.search(text or "")) and "beobank" in (text or "").lower()


def _summary(text: str, label: str) -> Optional[float]:
    m = re.search(rf"{label}\s+({AMT})\s*€", text, re.I)
    return _num(m.group(1)) if m else None


def meta(text: str) -> dict:
    """Statement metadata: card, reference, period, repayment account (unique per card), summary figures."""
    card, ref, per, iban = CARD_RE.search(text), REF_RE.search(text), PERIOD_RE.search(text), IBAN_RE.search(text)
    used = _summary(text, "Montant utilis[ée]")
    if used is None:
        used = _summary(text, "Montant [ée]pargn[ée]")           # old statements: card in credit
    return {
        "card": card.group(1) if card else None,
        "reference": ref.group(1) if ref else None,
        "period": (_iso(per.group(1)), _iso(per.group(2))) if per else None,
        "repayment_iban": re.sub(r"\s", "", iban.group(1)) if iban else None,
        "previous": _summary(text, "Solde pr[ée]c[ée]dent"), "used": used,
    }


def merchant(desc: str) -> str:
    """"AMAZONMKTPLC*TH6S616D4 LUXEMBOURG LU" -> merchant text for rules (country code and long ids removed)."""
    m = COUNTRY_RE.sub("", desc)
    m = re.sub(r"\b\d{6,}\b", "", m)
    return re.sub(r"\s+", " ", m).strip(" *")


def parse(text: str, doc_id: int = 0) -> list[Booking]:
    """All transactions of one statement (empty list if the text is not a Beobank card statement)."""
    if not looks_like(text):
        return []
    info = meta(text)
    i = text.find("Vos transactions")
    if i < 0:
        return []
    lines = text[i:].split("\n")
    raw: list[tuple[str, str, float]] = []       # (iso date, description, statement amount)
    last_date = None
    in_row = False                               # the previous line belonged to a transaction (row, exchange-rate line, fee line)
    for k, line in enumerate(lines):
        m = ROW_RE.match(line)
        if m:
            last_date = _iso(m.group("date"))
            raw.append((last_date, re.sub(r"\s+", " ", m.group("desc")), _num(m.group("amt"))))
            in_row = True
            continue
        f = FOREIGN_RE.match(line)
        if f and in_row:                         # "60,00 USD TAUX DE CHANGE 0.887667": foreign currency of the purchase above
            d0, desc0, amt0 = raw[-1]
            raw[-1] = (d0, f"{desc0} · {f.group('amt')} {f.group('cur')} @{f.group('rate')}", amt0)
            continue
        m = ROW_NO_AMT_RE.match(line)
        if m:                                    # interest rows: the amount is on the next line ("… au 25/02/2024   29,39 €")
            nxt = lines[k + 1] if k + 1 < len(lines) else ""
            d = DETAIL_RE.match(nxt)
            in_row = bool(d)
            if d:
                last_date = _iso(m.group("date"))
                desc = re.sub(r"\s+", " ", m.group("desc"))
                raw.append((last_date, f"{desc} · {re.sub(chr(32) + '+', ' ', d.group('text'))}", _num(d.group("amt"))))
            continue
        u = UNDATED_RE.match(line)
        if u and last_date and in_row:           # e.g. "FRAIS DE CHANGE   2,68" under a purchase
            base = raw[-1][1].split(" · ")[0]
            raw.append((last_date, f"{u.group('desc').strip()} · {base}", _num(u.group("amt"))))
            continue
        if line.strip():
            in_row = in_row and bool(FOREIGN_RE.match(line))
    # interpret the signs first (app convention: negative = debit), then verify against the summary box
    items = []
    for d, desc, amt in raw:
        credit = bool(CREDIT_LABEL_RE.match(desc)) or amt < 0
        items.append((d, desc, round(abs(amt) if credit else -abs(amt), 2)))
    ok = info["used"] is not None and abs(-sum(v for _, _, v in items) - (info["used"] - (info["previous"] or 0.0))) < 0.01
    seen: dict = {}
    out: list[Booking] = []
    for d, desc, value in items:
        key = (d, value, desc)
        n = seen[key] = seen.get(key, 0) + 1
        b = Booking(date=d, text=desc, amount=value, sign_source="saldo" if ok else "stichwort",
                    merchant=merchant(desc), card=(info["card"] or "")[-4:])
        b.hash = hashlib.sha1(f"beocc|{info['reference'] or doc_id}|{d}|{value:.2f}|{desc}|{n}".encode()).hexdigest()
        b.internal = bool(PAYMENT_RE.match(desc))             # payment of the card balance = transfer between own accounts
        out.append(b)
    return out
