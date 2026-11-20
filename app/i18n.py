"""Backend translations (gettext style): the English text is the key, German is the second language.

The language of a request is set by a middleware in main.py (header ``X-Lang``, cookie ``lang`` or
``Accept-Language``) and read here via a ContextVar. Usage: ``_t("Vehicle not found")`` or
``_t("Traccar error {status}", status=r.status_code)``.
"""
from contextvars import ContextVar

LANGS = ("en", "de")
DEFAULT_LANG = "en"
_lang: ContextVar[str] = ContextVar("lang", default=DEFAULT_LANG)

DE = {
    # --- authentication / permissions
    "Not signed in": "Nicht angemeldet",
    "No permission for this area": "Keine Berechtigung für diesen Bereich",
    "Wrong username or password": "Benutzername oder Passwort falsch",
    "User management is not active": "Benutzerverwaltung ist nicht aktiv",
    "Current password is incorrect": "Bisheriges Passwort stimmt nicht",
    "Enter a username": "Benutzername angeben",
    "User not found": "Benutzer nicht gefunden",
    "The last administrator cannot be deleted": "Der letzte Administrator kann nicht gelöscht werden",
    "Name is missing": "Name fehlt",
    "Unknown kind": "Unbekannte Art",
    "Budget (overview, expenses, capture)": "Budget (Übersicht, Ausgaben, Erfassen)",
    "Reconciliation / bank statements": "Abgleich / Kontoauszüge",
    "Vehicles": "Fahrzeuge",
    "Properties": "Immobilien",
    "Projects": "Projekte",
    "Contracts & subscriptions": "Verträge & Abos",
    "Income & salary": "Einnahmen & Lohn",
    "Meters & energy": "Zähler & Energie",
    # --- Paperless / Traccar connection
    "Paperless not reachable ({url}): {err}": "Paperless nicht erreichbar ({url}): {err}",
    "Paperless rejects the host name “{host}” (error 400). Check PAPERLESS_ALLOWED_HOSTS in Paperless and PAPERLESS_URL here – or set PAPERLESS_URL to an address Paperless allows (e.g. the public one) or set PAPERLESS_HOST_HEADER.":
        "Paperless lehnt den Host-Namen „{host}“ ab (Fehler 400). In Paperless PAPERLESS_ALLOWED_HOSTS bzw. PAPERLESS_URL prüfen – oder hier PAPERLESS_URL auf eine Adresse setzen, die Paperless erlaubt (z.B. die öffentliche) bzw. PAPERLESS_HOST_HEADER setzen.",
    "Paperless rejects the API token (401/403). Check PAPERLESS_TOKEN.": "Paperless lehnt den API-Token ab (401/403). PAPERLESS_TOKEN prüfen.",
    "Paperless error {status}: {text}": "Paperless-Fehler {status}: {text}",
    "Custom field '{name}' does not exist in Paperless – create it in the app under 'Overview'.":
        "Custom Field '{name}' existiert in Paperless nicht – in der App unter 'Übersicht' anlegen.",
    "Traccar is not configured (TRACCAR_URL in .env).": "Traccar ist nicht konfiguriert (TRACCAR_URL in .env).",
    "Traccar not reachable ({url}): {err}": "Traccar nicht erreichbar ({url}): {err}",
    "Traccar not reachable ({err})": "Traccar nicht erreichbar ({err})",
    "Traccar rejects the login (check TRACCAR_TOKEN or TRACCAR_USER/PASSWORD).": "Traccar lehnt die Anmeldung ab (TRACCAR_TOKEN bzw. TRACCAR_USER/PASSWORD prüfen).",
    "Traccar error {status}: {text}": "Traccar-Fehler {status}: {text}",
    "Traccar returns an error for {day} (server error in Traccar)": "Traccar liefert für den {day} einen Fehler (Server-Fehler in Traccar)",
    # --- validation / not found
    "Specify the month as YYYY-MM": "Monat im Format JJJJ-MM angeben",
    "Enter a keyword": "Stichwort angeben",
    "Enter a keyword with at least 3 characters": "Stichwort mit mindestens 3 Zeichen angeben",
    "Choose a category, vehicle or 'ignore'": "Kategorie, Fahrzeug oder 'ignorieren' wählen",
    "Income not found": "Einnahme nicht gefunden",
    "Nothing to change": "Nichts zu ändern",
    "Not yet defined which documents are bank statements – choose under Settings.": "Noch nicht festgelegt, welche Dokumente Kontoauszüge sind – unter Einstellungen wählen.",
    "Transaction not found": "Buchung nicht gefunden",
    "Only debits can be assigned to an invoice": "Nur Belastungen können einer Rechnung zugeordnet werden",
    "Vehicle not found": "Fahrzeug nicht gefunden",
    "Contract not found": "Vertrag nicht gefunden",
    "This is not a backup file of this app.": "Das ist keine Backup-Datei dieser App.",
    "The file contains no data of this app.": "Die Datei enthält keine Daten dieser App.",
    "Enter a merchant": "Händler angeben",
    "Not found": "Nicht gefunden",
    "Enter source_type doc|tx and target_type property|project": "source_type doc|tx und target_type property|project angeben",
    "Building not found": "Haus nicht gefunden",
    "Choose a flat or tenancy": "Wohnung oder Mietverhältnis wählen",
    "Cost types already exist for this building.": "Es gibt bereits Kostenarten für dieses Haus.",
    "Statement not found": "Abrechnung nicht gefunden",
    "Only the most recently generated statement of this tenancy can be deleted.": "Nur die zuletzt erzeugte Abrechnung dieses Mietverhältnisses kann gelöscht werden.",
    "Document not found in Paperless – please delete it there manually": "Dokument in Paperless nicht gefunden – bitte dort von Hand löschen",
    "not deleted ({err})": "nicht gelöscht ({err})",
    "deleted": "gelöscht",
    "PDF could not be generated ({err}).": "PDF konnte nicht erzeugt werden ({err}).",
    # --- labels / texts in responses
    "Fuel · {n} refuellings": "Treibstoff · {n} Tankvorgänge",
    "Parking · {n} parking sessions": "Parkieren · {n} Parkvorgänge",
    "excluding {amount} for {names}": "ohne {amount} für {names}",
    "13th-month pay": "13. Monatslohn",
    "Bonus": "Bonus/Prämie",
    "{employer} · no credit found yet": "{employer} · noch keine Gutschrift gefunden",
    "Bank transaction without receipt": "Bankbuchung ohne Beleg",
    "Amount field “{name}” (currency)": "Betragsfeld „{name}“ (Währung)",
    "Tag “{name}”": "Tag „{name}“",
    "Date field “{name}”": "Datumsfeld „{name}“",
    "Tag “{name}” (orders)": "Tag „{name}“ (Bestellungen)",
    "Amount matches, keyword “{kw}” not in the booking text": "Betrag passt, Stichwort „{kw}“ nicht im Buchungstext",
    "Keyword matches, but amount ≠ monthly rent {exp} (check rent + advance payment in the setup)": "Stichwort passt, aber Betrag ≠ Monatsmiete {exp} (Miete + Akonto in der Einrichtung prüfen)",
    "{days} of {days_total} days": "{days} von {days_total} Tagen",
    "Heating oil consumption": "Heizöl-Verbrauch",
    # --- meters
    "Meter not found": "Zähler nicht gefunden",
    "Manual meter – enter the reading by hand": "Manueller Zähler – Stand von Hand erfassen",
    "Meter not readable: {err}": "Zähler nicht lesbar: {err}",
    "Enter date and meter reading": "Datum und Zählerstand angeben",
    "Address is missing": "Adresse fehlt",
    "manual meter": "manueller Zähler",
    "no numeric value ({raw})": "kein Zahlenwert ({raw})",
    "Sensor {entity} does not exist in Home Assistant": "Sensor {entity} gibt es in Home Assistant nicht",
    "Tariff is missing on the meter": "Tarif fehlt beim Zähler",
    "no data": "keine Daten",
    "No data": "Keine Daten",
    "not enough data": "zu wenig Daten",
    "Meter reading lower than at the start – check the start value": "Zählerstand kleiner als zu Beginn – Startwert prüfen",
    "no meter reading around {date}": "kein Zählerstand um den {date}",
    "not enough readings for a projection": "zu wenig Ablesungen für eine Hochrechnung",
    "Meter": "Zähler",
    "Receipt": "Beleg",
    "Salary": "Lohn",
    "Payslip (income)": "Lohnabrechnung (Einnahme)",
    "Upload to Paperless failed ({err}).": "Upload zu Paperless fehlgeschlagen ({err}).",
    "Other": "Sonstiges",
    "Owner": "Eigentümer",
    # --- planned items
    "deleted by hand": "gelöscht",
    "marked done by hand": "von Hand erledigt",
    "cancelled": "storniert",
    "Invoice: {title}": "Rechnung: {title}",
    # --- CSV export headers
    "Date": "Datum", "Merchant": "Händler", "Booking text": "Buchungstext", "Amount": "Betrag", "Status": "Status",
    "Invoice": "Rechnung", "Title": "Titel", "Purpose": "Zweck", "Correspondent": "Korrespondent", "Category": "Kategorie",
    "Source": "Quelle", "Type": "Art", "Name": "Name", "Provider": "Anbieter", "Number": "Nummer", "Interval": "Intervall",
    "per month": "pro Monat", "per year": "pro Jahr", "Start": "Beginn", "Term until": "Laufzeit bis", "Cancel by": "Kündigen bis",
    "Outstanding balance": "Restschuld",
}


def set_lang(lang: str) -> None:
    _lang.set(lang if lang in LANGS else DEFAULT_LANG)


def get_lang() -> str:
    return _lang.get()


def pick_lang(x_lang: str | None, cookie: str | None, accept: str | None) -> str:
    """Request language: X-Lang header, then lang cookie, then Accept-Language, then English."""
    for cand in (x_lang, cookie):
        if cand and cand.lower()[:2] in LANGS:
            return cand.lower()[:2]
    for part in (accept or "").split(","):
        code = part.split(";")[0].strip().lower()[:2]
        if code in LANGS:
            return code
    return DEFAULT_LANG


def _t(text: str, **params) -> str:
    """Translate ``text`` (English source) into the request language and fill in ``{name}`` placeholders."""
    s = DE.get(text, text) if _lang.get() == "de" else text
    return s.format(**params) if params else s
