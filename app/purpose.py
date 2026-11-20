"""Read the purpose of an invoice/receipt from the OCR text ("what is this receipt for?").

Order of the heuristics (the first one that yields something usable wins):
  1. keyword with colon: subject, re, payment purpose, reference, service, …
  2. Swiss QR bill: text under "Zusätzliche Informationen" (additional information)
  3. subject line such as "Rechnung für …", "Prämienrechnung 2026", "Rechnung Service Golf"
  4. first item of an article table (header with description/article + quantity/price/amount)
In addition, a service period is appended, if present.
Without dependencies so that it can be tested in isolation.
"""
from __future__ import annotations

import re
from typing import Optional

DATE = r"\d{1,2}\.\d{1,2}\.(?:\d{4}|\d{2})"
AMT = r"-?\d{1,3}(?:['’ ]\d{3})*[.,]\d{2}"

KEY_RE = re.compile(
    r"^\s*(betreff|betrifft|betr\.|zahlungszweck|verwendungszweck|zweck|leistung|leistungsart|leistungsbeschreibung|"
    r"beschreibung|mitteilung|grund|objekt|produkt|abonnement|abo|tarif|police(?:-nr\.?)?\s+für|auftrag|projekt)"
    r"\s*[:\-–]\s*(?P<v>.{3,})$",
    re.I,
)
QR_RE = re.compile(r"^\s*zus[äa]tzliche\s+informationen\s*:?\s*(?P<v>.*)$", re.I)
QR_STOP_RE = re.compile(r"^\s*(währung|betrag|annahmestelle|zahlbar|konto|referenz|empfangsschein|zahlteil|chf|eur)\b", re.I)
SUBJECT_RE = re.compile(
    r"^\s*(?P<v>(?:[\wäöüÄÖÜ-]*rechnung|quittung|abrechnung|gutschrift)\b.{0,70})$", re.I)
SUBJECT_FOR_RE = re.compile(r"\b(?:für|betreffend|betr\.)\s+(?P<v>[^\d].{2,70})$", re.I)
SUBJECT_JUNK_RE = re.compile(
    r"^(?:[\wäöüÄÖÜ-]*rechnung|quittung|abrechnung|gutschrift)\s*(?:nr\.?|nummer|datum|no\.?|#|betrag|total|an|vom|per|$)", re.I)
WEAK_RE = re.compile(r"^(bestellung|auftrag|order|lieferung|kunde)\b", re.I)   # only a fallback, the table is more meaningful
HEAD_RE = re.compile(r"\b(bezeichnung|beschreibung|artikel|leistung|position|produkt|text)\b", re.I)
HEAD2_RE = re.compile(r"\b(menge|anzahl|stk|preis|betrag|total|einheit)\b", re.I)
END_TABLE_RE = re.compile(r"^\s*(total|summe|zwischentotal|subtotal|mwst|netto|brutto|rabatt|versand)\b", re.I)
PERIOD_RE = re.compile(
    rf"(?:leistungs|abrechnungs|rechnungs|abo|versicherungs)?(?:zeitraum|periode|dauer)\s*:?\s*(?P<a>{DATE})\s*(?:-|–|bis)\s*(?P<b>{DATE})", re.I)
NOISE_RE = re.compile(r"\b(iban|mwst|uid|che-\d|tel\.|tel|telefon|e-?mail|www\.|seite \d)\b|@", re.I)
REFNO_RE = re.compile(r"\b(kunden-?nr|kd-?nr|kundennummer|ref(?:erenz)?|vertrags-?nr|rechnungs-?nr|police-?nr|nr)\.?\s*:?\s*[\w/-]*\d[\w/-]*", re.I)


def _clean(s: str, item: bool = False) -> str:
    s = REFNO_RE.sub(" ", s)
    s = re.sub(r"\b\d{1,2}:\d{2}(?::\d{2})?\b", " ", s)
    if item:
        s = re.sub(r"(?<![\d'’])\d+[.,]\d{2}\b", " ", s)   # prices without thousands separator (otherwise "1 420.00" swallows the quantity)
    s = re.sub(DATE, " ", s)
    s = re.sub(AMT, " ", s)
    s = re.sub(r"\b(chf|eur|stk\.?)\b", " ", s, flags=re.I)
    s = re.sub(r"\s+(vom|per|bis|am)\s*$", "", s, flags=re.I)
    s = re.sub(r"\s+(total|betrag|summe)\s*$", "", s, flags=re.I)
    if item:
        s = re.sub(r"^\s*[\d.]+\s+", "", s)               # Positionsnummer am Anfang
        s = re.sub(r"(\s+\d+(?:[.,]\d+)?\s*%?)+\s*$", "", s)  # Menge / MwSt am Ende
    s = re.sub(r"\s{2,}", " ", s).strip(" -–:|,;.")
    return s[:80]


def _useful(s: str) -> bool:
    return len(re.findall(r"[A-Za-zÄÖÜäöüéèà]", s)) >= 4 and not NOISE_RE.search(s)


def extract_purpose(content: str) -> Optional[str]:
    lines = [l.strip() for l in (content or "").splitlines() if l.strip()]
    if not lines:
        return None
    found: Optional[str] = None

    # 1. keyword with colon
    for l in lines:
        m = KEY_RE.match(l)
        if m:
            v = _clean(m.group("v"))
            if _useful(v):
                found = v
                break

    # 2. QR bill "Zusätzliche Informationen" (additional information)
    if not found:
        for i, l in enumerate(lines):
            m = QR_RE.match(l)
            if not m:
                continue
            parts = [m.group("v")] if m.group("v").strip() else []
            for nxt in lines[i + 1:i + 3]:
                if QR_STOP_RE.match(nxt):
                    break
                parts.append(nxt)
            v = _clean(" ".join(parts))
            if _useful(v):
                found = v
                break

    # 3. Betreffzeile
    weak: Optional[str] = None
    if not found:
        for l in lines[:60]:
            m = SUBJECT_RE.match(l)
            if not m:
                continue
            f = SUBJECT_FOR_RE.search(l)
            if f and _useful(_clean(f.group("v"))):
                v = _clean(f.group("v"))
                if WEAK_RE.match(v):
                    weak = weak or v
                    continue
                found = v
                break
            if not SUBJECT_JUNK_RE.match(l):
                v = _clean(m.group("v"))
                if _useful(v) and len(v.split()) >= 2:
                    found = v
                    break

    # 4. Erste Tabellenposition
    if not found:
        for i, l in enumerate(lines):
            if HEAD_RE.search(l) and HEAD2_RE.search(l):
                items = []
                for nxt in lines[i + 1:i + 15]:
                    if END_TABLE_RE.match(nxt):
                        break
                    if not re.search(AMT, nxt):
                        continue
                    v = _clean(nxt, item=True)
                    if _useful(v):
                        items.append(v)
                if items:
                    found = items[0] + (f" + {len(items) - 1} weitere" if len(items) > 1 else "")
                    break

    found = found or weak
    if found:
        p = PERIOD_RE.search(content or "")
        if p:
            found = f"{found} · {p.group('a')}–{p.group('b')}"
    return found
