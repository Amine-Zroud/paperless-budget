"""Tests for the Beobank VISA credit card statement reader (synthetic statement, invented amounts).

Real statements can be kept as text in tests/private_fixtures/beobank/ (git-ignored, with expected.json).
"""
import json
import re
from pathlib import Path

import pytest

from app import bank
from app import bank_beobank

PAD = " " * 43


def statement(rows, previous="100,00", used="209,73"):
    head = f"""
{PAD}Relevé de votre carte de crédit
{PAD}BEOBANK VISA                                     M JOHN DOE
{PAD}Numéro de votre carte de crédit:   4000XXXXXXXX1234
{PAD}Numéro de référence            :   950000000001
{PAD}Période de ce relevé           :   du 07/04/2030 au 07/05/2030

{PAD}  Résumé (détails au verso)
{PAD}  Solde précédent                          {previous} €
{PAD}  Montant utilisé                          {used} €

{PAD}Pour effectuer un remboursement, utilisez toujours le numéro de compte Beobank BE60 0000 0000 0000. Il est unique.

{PAD}Vos transactions
{PAD}Date           Description                                                   Montant (en €)
{PAD}              Carte JOHN DOE - 4000XXXXXXXX1234
"""
    tail = f"""

{PAD}Cash Transfer est idéal pour transférer de l'argent !   0800 99 259
{PAD}1/18 (ligne ≤ 5.000€) ou 1/20 du montant utilisé avec un minimum de 25€
"""
    return head + "\n".join(rows) + tail


ROWS = [
    f"{PAD}02/05/2030     SHOP ONE BRUSSEL BE                                                  25,50",
    f"{PAD}03/05/2030     PAIEMENT M JOHN DOE IBAN BE00000000000000                       -1 200,00",
    f"{PAD}04/05/2030     PAYPAL *SOMETHING 12345678 NL                                     1 200,50",
    f"{PAD}05/05/2030     SOME SHOP PHOENIX US                                                 53,26",
    f"{PAD}               60,00 USD TAUX DE CHANGE 0.887667",
    f"{PAD}               FRAIS DE CHANGE                                                       1,12",
    f"{PAD}06/05/2030     REMBOURSEMENT INTERETS                                                0,04",
    f"{PAD}07/05/2030     INTERETS DEBITEURS",
    f"{PAD}               Intérêts débiteurs du 07/04/2030 au 07/05/2030                    29,39 €",
]


def test_detection():
    assert bank_beobank.looks_like(statement(ROWS))
    assert not bank_beobank.looks_like("Kontoauszug PostFinance  Buchungsdatum Valuta")
    assert bank_beobank.parse("not a statement") == []


def test_metadata():
    m = bank_beobank.meta(statement(ROWS))
    assert m["card"] == "4000XXXXXXXX1234" and m["reference"] == "950000000001"
    assert m["period"] == ("2030-04-07", "2030-05-07")
    assert m["repayment_iban"] == "BE60000000000000"
    assert (m["previous"], m["used"]) == (100.00, 209.73)


def test_rows_signs_and_verification():
    rows = bank.parse_any(statement(ROWS), 7)
    assert [(b.date, b.amount) for b in rows] == [
        ("2030-05-02", -25.50),          # purchase = debit
        ("2030-05-03", 1200.00),         # payment of the card balance = credit, thousands separator is a space
        ("2030-05-04", -1200.50),
        ("2030-05-05", -53.26),
        ("2030-05-05", -1.12),           # exchange fee line without a date
        ("2030-05-06", 0.04),            # refund is printed positive but is a credit
        ("2030-05-07", -29.39),          # amount on the next line
    ]
    assert all(b.sign_source == "saldo" for b in rows)          # sum of rows = Montant utilisé − Solde précédent
    assert [b.internal for b in rows] == [False, True, False, False, False, False, False]
    assert "@0.887667" in rows[3].text and rows[4].text.startswith("FRAIS DE CHANGE")
    assert rows[0].merchant == "SHOP ONE BRUSSEL" and rows[0].card == "1234"
    assert "Intérêts débiteurs" in rows[6].text


def test_unverified_when_the_summary_does_not_add_up():
    rows = bank.parse_any(statement(ROWS, used="999,99"), 7)
    assert rows and all(b.sign_source == "stichwort" for b in rows)


def test_identical_rows_get_distinct_hashes_and_hashes_are_stable():
    twin = f"{PAD}02/05/2030     SHOP ONE BRUSSEL BE                                                  25,50"
    a = bank.parse_any(statement(ROWS + [twin], used="235,23"), 7)
    b = bank.parse_any(statement(ROWS + [twin], used="235,23"), 7)
    assert len({x.hash for x in a}) == len(a) == 8
    assert [x.hash for x in a] == [x.hash for x in b]


def collapse(text: str) -> str:
    """Paperless stores the text with every run of spaces collapsed to one."""
    return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n"))


def test_collapsed_whitespace_gives_the_same_result():
    wide = bank.parse_any(statement(ROWS), 7)
    narrow = bank.parse_any(collapse(statement(ROWS)), 7)
    assert [(b.date, b.text, b.amount, b.sign_source, b.hash) for b in narrow] == [(b.date, b.text, b.amount, b.sign_source, b.hash) for b in wide]
    assert bank_beobank.meta(collapse(statement(ROWS)))["repayment_iban"] == "BE60000000000000"


def test_space_thousands_separator_is_not_split_from_the_amount():
    rows = bank.parse_any(collapse(statement(ROWS)), 7)
    assert rows[1].amount == 1200.00 and rows[2].amount == -1200.50 and rows[2].merchant.startswith("PAYPAL *SOMETHING")


def test_marketing_text_after_the_list_is_ignored():
    assert len(bank.parse_any(statement(ROWS), 7)) == 7


# --- real statements (local only) -------------------------------------------------------------------------------
PRIVATE = Path(__file__).parent / "private_fixtures" / "beobank"


@pytest.mark.skipif(not (PRIVATE / "expected.json").exists(), reason="no local real statements")
def test_real_statements_all_verify():
    expected = json.loads((PRIVATE / "expected.json").read_text())
    files = sorted(PRIVATE.glob("*.txt"))
    assert len(files) == expected["statements"]
    total = 0
    for f in files:
        text = f.read_text(encoding="utf-8")
        rows = bank.parse_any(text, 1)
        assert rows and all(b.sign_source == "saldo" for b in rows), f.name
        assert len({b.hash for b in rows}) == len(rows), f.name
        narrow = bank.parse_any(collapse(text), 1)           # what Paperless stores
        assert [(b.date, b.amount, b.hash) for b in narrow] == [(b.date, b.amount, b.hash) for b in rows], f.name
        total += len(rows)
    assert total == expected["rows"]
