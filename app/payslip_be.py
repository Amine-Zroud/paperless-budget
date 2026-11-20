"""Belgian payslips (French, "Billet de paie"): period, person, gross, deductions, net and the amount paid out.

Payslips of Belgian social secretariats list one block per payslip (one per PDF page):

    000  22  176,00        2.500,00  Rémunération              <- pay lines (code, days, hours, amount, label)
                           2.500,00  ** Total brut soumis ONSS
                            -326,75  Retenue ONSS personnelle
                            -500,00  * Précompte professionnel
                           1.673,25  ** Net
                             -16,35  Chèques-repas             <- items after the net
                           1.646,90  *** Net à payer           <- what lands on the bank account

* Numbers use "." for thousands and "," for decimals (2.500,00).
* One PDF can hold several payslips (e.g. salary + "Bonus salarial"); each page has its own "Net à payer".
* The text layer of such PDFs often has a broken font encoding (Þ = space, º = é, ª = è, ¸ = à, õ = °);
  `normalize()` repairs the known substitutions.
* Eco-cheques (meal/eco vouchers) have no "Net à payer": they are recorded as a voucher item, not as money received.
* Works on `pdftotext -layout` style text (amount before the label on the same line).
Without dependency on FastAPI/Paperless so that it can be tested in isolation.
"""
from __future__ import annotations

import re
from typing import Optional

from .payslip import Payslip

# font-encoding substitutions seen in these PDFs ("ö" is only rule/line noise)
_CHARS = str.maketrans({"Þ": " ", "º": "é", "ª": "è", "¸": "à", "õ": "°", "ö": " "})

HEADER_RE = re.compile(r"(?mi)^\W*billet\s+de\s+paie\b(?!\s+fait)")
DETECT_RE = re.compile(r"billet\s+de\s+paie|net\s+[àa]\s+payer|\bonss\b", re.I)
PERIOD_RE = re.compile(r"(\d{2})\.(\d{2})\.(\d{4})\s*-\s*(\d{2})\.(\d{2})\.(\d{4})")
PERSON_RE = re.compile(r"\b(?:monsieur|madame|mademoiselle|mevrouw|meneer|de\s+heer)\s+([^\W\d_][^\n]*?)(?:\s{2,}|[ \t]*$)", re.I | re.M)
PERSON_BANK_RE = re.compile(r"\bau\s+nom\s+de\s*:\s*([^\W\d_][^\n]*?)(?:\s{2,}|[ \t]*$)", re.I | re.M)
# the employer is the right-hand column of the address block above the header: "2600 ANTWERPEN      SA ACMECORP"
EMPLOYER_BLOCK_RE = re.compile(r"(?m)^\s*\d{4}\s+[^\W\d_][^\n]*?\s{2,}(\S[^\n]*?)\s*$")
EMPLOYER_RE = re.compile(r"\b((?:SA|SRL|SPRL|BV|BVBA|NV|ASBL|VZW|SC)\s+[A-Z0-9][A-Z0-9&.\-]*(?: [A-Z0-9&.\-]{2,})*)(?:\s{2,}|[ \t]*$)", re.M)

# the amount that comes before the label: "-500,00  * Précompte professionnel", "000 22 176,00 2.500,00 Rémunération"
AMT = r"[-+]?\d{1,3}(?:\.\d{3})*,\d{2}"
LINE_RE = re.compile(rf"^(?P<pre>.*?)(?<![\d.,])(?P<amt>{AMT})(?![\d,])\s+(?P<label>[^\d\s].*)$")

BONUS_RE = re.compile(r"bonus|prime|p[ée]c(?:ule|\.)|gratification|treizi[èe]me|\b13\s*[eè]", re.I)
THIRTEEN_RE = re.compile(r"treizi[èe]me|\b13\s*[eè]", re.I)
VOUCHER_RE = re.compile(r"[ée]coch[èe]que|eco-?cheque", re.I)
SKIP_DEDUCTION_RE = re.compile(r"avantage|dispense|diminution|imposable|total", re.I)


def normalize(text: str) -> str:
    """Repair the known font-encoding substitutions of the text layer."""
    return (text or "").translate(_CHARS)


def looks_belgian(text: str) -> bool:
    return bool(DETECT_RE.search(normalize(text)))


def _num(s: str) -> float:
    return float(s.replace(" ", "").replace(".", "").replace(",", "."))


def split_pages(text: str) -> list[str]:
    """One chunk per payslip ("Billet de paie" header); the whole text if there is no header."""
    starts = [m.start() for m in HEADER_RE.finditer(text)]
    if not starts:
        return [text]
    return [text[a:b] for a, b in zip(starts, starts[1:] + [len(text)])]


def _kind(label: str) -> str:
    low = label.lower()
    if "onss" in low or "sécurité sociale" in low or "securite sociale" in low:
        return "onss"
    if "précompte" in low or "precompte" in low:
        return "tax"
    return "other"


def _parse_page(page: str) -> Optional[dict]:
    """One payslip block -> dict, or None if it contains neither a payout nor vouchers."""
    gross_sub = gross_non = net = payout = None
    deductions: list = []
    pay_lines: list = []
    vouchers = 0.0
    phase = 0                                    # 0 pay lines, 1 after the gross total, 2 after "Net à payer"
    for raw in page.splitlines():
        line = re.sub(r"[ \t]+", " ", raw).strip()
        m = LINE_RE.match(line)
        if not m:
            continue
        amt, label = _num(m.group("amt")), m.group("label").lstrip("* ").strip()   # "* Précompte professionnel" -> "Précompte professionnel"
        key = label.strip("* ").lower()
        if VOUCHER_RE.search(key) and amt > 0:
            vouchers += amt
        elif "total brut non soumis" in key:
            gross_non, phase = amt, max(phase, 1)
        elif "total brut soumis" in key:
            gross_sub, phase = amt, max(phase, 1)
        elif re.search(r"net\s+[àa]\s+payer", key):
            payout, phase = amt, 2
        elif key == "net" and net is None:
            net = amt
        elif phase == 0 and amt > 0:
            pay_lines.append({"label": label[:60], "amount": round(amt, 2)})
        elif phase == 1 and amt < 0 and not SKIP_DEDUCTION_RE.search(key):
            deductions.append({"label": label[:60], "amount": round(-amt, 2), "kind": _kind(label)})
    if payout is None and not vouchers:
        return None
    pm = PERIOD_RE.search(page)
    return {
        "month": f"{pm.group(6)}-{pm.group(5)}" if pm else None,
        "gross": gross_sub if gross_sub else gross_non,
        "net": net, "payout": payout, "deductions": deductions, "pay_lines": pay_lines, "vouchers": round(vouchers, 2),
    }


def _person(text: str) -> Optional[str]:
    m = PERSON_RE.search(text) or PERSON_BANK_RE.search(text)
    return " ".join(w.capitalize() for w in m.group(1).split()) if m else None


def _employer(text: str) -> Optional[str]:
    head = text[:HEADER_RE.search(text).start()] if HEADER_RE.search(text) else text[:3000]
    m = EMPLOYER_RE.search(head)
    if not m:
        m = next((x for x in EMPLOYER_BLOCK_RE.finditer(head)
                  if not re.match(r"(rue|avenue|av\.|chauss[ée]e|boulevard|bd|place|\w+straat|\w+laan)\b", x.group(1), re.I)), None)
    return re.sub(r"\s+", " ", m.group(1)).strip() if m else None


def parse(text: str) -> Payslip:
    """All payslips of a document, combined: amounts are summed (salary + bonus pages), special payments listed as extras."""
    text = normalize(text)
    pages = [p for p in (_parse_page(c) for c in split_pages(text)) if p]
    if not pages:
        return Payslip(None, None, None, None, None)
    extras: list = []
    for p in pages:
        base = any(re.fullmatch(r"r[ée]mun[ée]ration", l["label"], re.I) for l in p["pay_lines"])
        # a page without base pay ("Rémunération") only pays special amounts (bonus, holiday pay …)
        special = [l for l in p["pay_lines"] if not base or BONUS_RE.search(l["label"])]
        total = sum(l["amount"] for l in special) or 1
        for l in special:
            e = {"label": l["label"], "amount": l["amount"], "kind": "13" if THIRTEEN_RE.search(l["label"]) else "bonus"}
            if not base and p["payout"]:   # a page that only pays special amounts: its payout is that special net
                e["net"] = round(p["payout"] * l["amount"] / total, 2)
            extras.append(e)
        if p["vouchers"]:
            extras.append({"label": "Eco-cheques", "amount": p["vouchers"], "kind": "voucher"})
    paid = [p for p in pages if p["payout"] is not None]
    has_pay = bool(paid)
    return Payslip(
        month=next((p["month"] for p in reversed(pages) if p["month"]), None),
        person=_person(text),
        gross=round(sum(p["gross"] or 0 for p in paid), 2) if has_pay else 0.0,
        net=round(sum(p["net"] or 0 for p in paid), 2) if has_pay else 0.0,
        payout=round(sum(p["payout"] for p in paid), 2) if has_pay else 0.0,
        deductions=[d for p in paid for d in p["deductions"]],
        extras=extras,
        employer=_employer(text),
    )
