"""Tests for the Belgian (French) payslip reader.

Run with:  python -m pytest tests/
The synthetic payslips below use invented amounts. If you keep real payslips as text in tests/private_fixtures/
(git-ignored, with an expected.json {file: payout}) they are checked too.
"""
import json
from pathlib import Path

import pytest

from app import payslip
from app import payslip_be

SALARY = """
   Secrétariat Social
   2600 ANTWERPEN                         SA ACMECORP
                                          RUE EXEMPLE 1
                                          1000 BRUXELLES

                                  Billet de paie          COPIE
                                  01.03.2030-31.03.2030
                                  Sorte
                                  Rémunération            Monsieur DOE JOHN
 Code       Heures
 salaire Jours   ou   Valeur    Montant
 000   20  160,00                2.500,00  Rémunération
                                 2.500,00  ** Total brut soumis ONSS
                                  -326,75  Retenue ONSS personnelle
                                 2.173,25  ** Imposable
                                  -500,00  * Précompte professionnel
                                 1.673,25  ** Net
 81E                                +20,00  Frais internet/périph.
 045   15  1,0900                   -16,35  Chèques-repas
 680                                 -30,00  Cotisation spéciale sécurité sociale
                                 1.646,90  *** Net à payer
                                 1.646,90  Au compte fin. :
 715                                 -41,70  Diminution forfaitaire de l'imposable
                                 1.000,00  Cotisation ONSS patronale
"""

BONUS_PAGE = """
                                  Billet de paie          COPIE
                                  01.03.2030-31.03.2030
 217                                 1.200,00  Bonus Salarial
                                 1.200,00  ** Total brut non soumis ONSS
                                  -156,84  Retenue ONSS personnelle
 282                                -1.043,16  Bonus salarial dispense fiscale
                                     0,00  ** Imposable
                                     0,00  ** Net
 282                                +1.043,16  Bonus salarial dispense fiscale
                                 1.043,16  *** Net à payer
                                 1.043,16  Au compte fin. :
"""

SINGLE_BONUS = SALARY.replace(" 000   20  160,00                2.500,00  Rémunération",
                              " 000   20  160,00                2.500,00  Rémunération\n 359                                 1.000,00  Bonus")

VOUCHERS = """
                                  Billet de paie          COPIE
                                  01.03.2030-31.03.2030
                                  Rémunération            Monsieur DOE JOHN
 208                                   250,00  Montant total d'écochèques
"""

SWISS = """
Lohnabrechnung Mai 2026
Frau Anna Muster
Bruttolohn                                          7'400.00
AHV-Beitrag                                          -371.00
Nettolohn                                           6'800.00
Ausbezahlter Lohn                                   6'800.00
"""


def garble(text: str) -> str:
    """Mimic the broken font encoding seen in real PDFs (Þ = space, º = é, ª = è, ¸ = à)."""
    return text.replace("é", "º").replace("è", "ª").replace("à", "¸").replace("°", "õ").replace(" ", "Þ")


def test_normalize_repairs_known_substitutions():
    assert payslip_be.normalize("RºmunºrationÞdeÞbase Barªme ¸ payer") == "Rémunération de base Barème à payer"


def test_belgian_number_format():
    assert payslip_be._num("1.234,56") == 1234.56
    assert payslip_be._num("-326,75") == -326.75
    assert payslip_be._num("+20,00") == 20.0


@pytest.mark.parametrize("encode", [lambda t: t, garble], ids=["clean", "garbled"])
def test_regular_salary(encode):
    ps = payslip.parse_payslip(encode(SALARY))
    assert ps.ok
    assert ps.month == "2030-03"
    assert ps.person == "Doe John"
    assert ps.employer == "SA ACMECORP"
    assert ps.gross == 2500.00
    assert ps.net == 1673.25
    assert ps.payout == 1646.90
    assert ps.extras == []
    by_kind: dict = {}
    for d in ps.deductions:
        by_kind[d["kind"]] = round(by_kind.get(d["kind"], 0) + d["amount"], 2)
    assert by_kind == {"onss": 356.75, "tax": 500.00, "other": 16.35}   # ONSS + special contribution, withholding tax, meal vouchers
    assert not any("imposable" in d["label"].lower() for d in ps.deductions)


def test_two_payslips_in_one_document_are_summed():
    ps = payslip.parse_payslip(SALARY + BONUS_PAGE)
    assert ps.payout == round(1646.90 + 1043.16, 2)
    assert ps.month == "2030-03"
    (bonus,) = ps.extras
    assert bonus["kind"] == "bonus" and bonus["amount"] == 1200.00 and bonus["net"] == 1043.16


def test_bonus_inside_a_payslip_is_an_extra():
    ps = payslip.parse_payslip(SINGLE_BONUS)
    assert [(e["kind"], e["amount"]) for e in ps.extras] == [("bonus", 1000.00)]


def test_eco_cheques_are_a_voucher_not_money_received():
    ps = payslip.parse_payslip(VOUCHERS)
    assert ps.ok                          # recognised, so it is not shown as "not recognised"
    assert ps.payout == 0.0
    assert [(e["kind"], e["amount"]) for e in ps.extras] == [("voucher", 250.00)]


def test_swiss_payslip_still_works():
    ps = payslip.parse_payslip(SWISS)
    assert ps.ok and ps.payout == 6800.0 and ps.month == "2026-05"


# --- real payslips (local only) ---------------------------------------------------------------------------------
PRIVATE = Path(__file__).parent / "private_fixtures"


@pytest.mark.skipif(not (PRIVATE / "expected.json").exists(), reason="no local real payslips")
def test_real_payslips():
    expected = json.loads((PRIVATE / "expected.json").read_text())
    for name, payout in expected.items():
        ps = payslip.parse_payslip((PRIVATE / name).read_text(encoding="utf-8"))
        assert ps.ok, name
        assert ps.payout == payout, name
