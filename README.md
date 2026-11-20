# Paperless Budget

[**English**](README.md) · [Deutsch](README.de.md)

**Household budget, bank statement reconciliation and vehicle costs – straight from your documents in [Paperless-ngx](https://github.com/paperless-ngx/paperless-ngx).**

> A self-hosted budgeting web app that uses the Paperless-ngx REST API as its data source.
> Invoices and receipts with a monetary custom field become expenses, tags become budget categories.
> It parses bank statement PDFs from Paperless, reconciles payments with invoices and marks them as paid,
> and tracks vehicle costs with mileage from [Traccar](https://www.traccar.org/) (cost per km, fuel consumption).
> For landlords it manages buildings, flats, fixed distribution keys, rent payments and generates the yearly
> utility cost statement as Word/PDF. Projects collect full or partial receipts.
> The UI is available in **English (default) and German** – switch language in the top bar.

> [!NOTE]
> **About this fork:** the UI, API messages and docs are translated (English default, German kept as the second
> language). The document readers (bank statements, payslips, invoices, the tenant statement) were written for
> German-language Swiss documents and still expect that content. The screenshots below show the German UI with demo data.
> The original German README is in [README.de.md](README.de.md).

![Overview](docs/screenshots/uebersicht.png)

## Why?

If you already archive your invoices and receipts in Paperless-ngx, you already have the data for a household
budget. Paperless Budget turns it into reports without entering receipts a second time: Paperless stays the single
source for documents, the app only adds budgets, income, rules and bank transactions.

## Features

### Budget
- **Expenses from Paperless**: documents with a custom field of type *Monetary* (default: "Total")
- **Categories via Paperless tags**: freely selectable, with a monthly budget and a warning when exceeded
- **Dashboard**: income, expenses, balance, distribution by category, 12-month trend
- **Capture**: show receipts without an amount with an OCR excerpt, type in amount and category –
  written straight back to Paperless
- **Income**: one-off or recurring monthly
- **Purpose detected automatically**: the app reads from the invoice text what a receipt is for (subject, payment
  purpose, QR bill, first line item) and shows it on the overview – correctable with a click
- **Exclude**: untick and optionally give a reason (e.g. "Business", "Reimbursed") – or exclude whole Paperless tags
  such as "Business" automatically

![Expenses in the month](docs/screenshots/ausgaben-monat.png)

### Reconciliation with bank statements
- **Import PDF bank statements from Paperless** (OCR text) – the layout is detected automatically
- **Every transaction is verified against the balance**, also across page breaks
- **Match payments with invoices** (amount, date, name in the booking text); on a match the app sets the tag "paid"
  and the date field "Paid on" in Paperless
- **Payments without a receipt** (e.g. card payments) count towards the budget; **rules** assign them
  automatically or ignore internal transfers
- **Open invoices**: receipts for which no payment has been found yet

![Reconciliation](docs/screenshots/abgleich.png)

### Vehicles
- **Costs per vehicle** from fuel card invoices, Paperless receipts (vehicle tag) and bank transactions
- **Kilometres from Traccar** per month
- **Key figures**: cost/km, fuel/km, consumption (L or kWh/100 km), price per litre/kWh
- **Fuel card invoices** are read per refuelling and assigned to the vehicle via the card number

![Vehicles](docs/screenshots/fahrzeuge.png)

### Properties & utility cost statement
- **Buildings and flats** with area, owner occupation and tenancies (rent, advance payment, move-in/out)
- **Distribution keys** with fixed percentages per flat, by area or evenly
- **Cost types** as in a classic heating and utility cost statement: heating pool (heating oil, electricity,
  chimney sweep …) is split into space heating/hot water, other costs (water, waste, caretaker …) by key
- **Costs from three sources**: Paperless receipts (via tag or assignment, also partial amounts), **fixed costs**
  (per year/month) and **manual costs** – each distributed or **charged individually to one flat**
- **Detected automatically**: cost type via keywords, quantity (e.g. "2'700 litres") from the receipt
- **Rent received** from the bank statements, monthly overview with arrears
- **Statement per tenant** by days of use, with advance payments, rounded to 5 centimes – as **Word and PDF**,
  filed automatically in Paperless; overview of tenant shares, owner occupation and vacancy

![Properties](docs/screenshots/immobilien.png)
![Costs of a property](docs/screenshots/immobilien-kosten.png)

<details>
<summary>Statement: preview and generated document</summary>

![Statement](docs/screenshots/nebenkostenabrechnung.png)
![Sample PDF](docs/screenshots/abrechnung-beispiel.png)
</details>

### Projects
- Projects with a budget, e.g. a renovation or garden shed
- Assign receipts and bank transactions **in full or partially** (percentage or amount) – or via a Paperless tag
- Optionally "not in household budget" (e.g. for business projects)

![Projects](docs/screenshots/projekte.png)

### Left of salary & planned items
- Tile on the overview: income − already spent − still-due contract/loan payments − planned orders =
  **freely available** (annual premiums in full in the month they fall due)
- **Plan orders**: by hand or automatically from order confirmations in Paperless (tag "Order",
  e.g. imported by a mail rule); the amount is read from the text
- As soon as an invoice or debit from the same merchant with the same amount appears, the planned item is completed automatically

![Left of salary](docs/screenshots/rest-vom-lohn.png)

### Subscriptions
- Own tab with all subscriptions (streaming, music, software, newspaper, fitness …): cost per month/year, next debit,
  last payment, cancellation deadline
- **Detects recurring payments** in the bank statements (same merchant, same amount, monthly/quarterly/yearly)
  and known subscription providers – adopt with one click as a subscription or hide as "not a subscription"
- Subscriptions are contracts: price changes, payments and receipts under "Details"

### Meters & expected statement
- Electricity from the AMS reader, later water (Shelly) or any Home Assistant sensor – read automatically
- Consumption since the start of the period, projection to the end of the period (like last year or daily average)
- Expected invoice with tariff and base fee, minus paid and still-due advance payments → additional payment or credit
- Meters per building (general) or flat; general electricity appears in the utility statement as "(expected …)"

![Meters](docs/screenshots/zaehler.png)

### Contracts & loans
- Contracts with price versions, cost per month/year, cancellation deadlines and payments from the bank statements
- Loans with outstanding balance, interest and repayment schedule
- Contract documents straight from Paperless (via correspondent or tag)

![Contracts and loans](docs/screenshots/vertraege.png)

<details>
<summary>Another view: capture receipts</summary>

![Capture](docs/screenshots/erfassen.png)
</details>

*All screenshots show invented demo data (German UI).*

## Requirements

- Docker and Docker Compose
- Paperless-ngx 2.x (with custom fields) and an API token
- optional: Traccar (for vehicle kilometres)

## Installation

```bash
git clone https://github.com/pebu1977/paperless-budget.git
cd paperless-budget
cp .env.example .env
nano .env            # enter PAPERLESS_URL, PAPERLESS_TOKEN, PAPERLESS_PUBLIC_URL
docker compose up -d --build
```

Then open `http://<host>:8088`.

**API token**: in Paperless click the user at the top right → *My Profile* → *API Auth Token*.
Best create a dedicated Paperless user that may only view and edit documents.

**Paperless on the same Docker host**: copy `docker-compose.override.example.yml` to
`docker-compose.override.yml`, check the network name with `docker network ls` and set `PAPERLESS_URL`
to the container, e.g. `http://paperless-webserver-1:8000`. The override file is ignored by Git
and not overwritten by updates.

> [!IMPORTANT]
> The app can modify documents in Paperless and shows financial data. Do not expose it unprotected to the internet –
> put it behind a reverse proxy with access protection (e.g. Nginx Proxy Manager with an access list) or
> set `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` in the `.env`.

### Updating

```bash
cd paperless-budget
git pull
docker compose up -d --build
```

`.env`, `data/` and `docker-compose.override.yml` stay untouched; the database is migrated automatically on
start. Backing up `data/` first never hurts.

## Language

The UI is available in **English** (default) and **German**. Use the language selector in the top bar (also on the
sign-in page and under *Settings → My account*). The choice is stored per browser; the app also sends it to the
server so that error messages, status texts and CSV exports use the same language.

- Texts live in `app/static/locales/de.js` (English text → German) for the UI and in `app/i18n.py` for server messages.
  English is the source language: the English text is the key, so a missing German entry simply shows English.
- To add a language, add `locales/<code>.js` (+ an entry in `LANGS`/`LOCALES` in `app/static/i18n.js` and in
  `app/i18n.py`).
- Number, date and currency formatting follow the language (`en-BE` for English, `de-CH` for German).
- Default names of tags and fields (`paid`-tag, date field, order tag, statement tag) are still the German originals
  (see the table below) so existing installations keep working – set the `*_NAME` variables to English names for a
  fresh install, e.g. `PAID_TAG_NAME=paid`, `PAID_FIELD_NAME=Paid on`, `ORDER_TAG_NAME=Order`.

## Setup

1. **Overview**: if the amount field is missing in Paperless, the app creates it at the push of a button.
2. **Settings → Connection & status**: shows whether Paperless and Traccar are reachable and whether the
   required tags/fields exist – missing ones can be created with a button.
3. **Settings → Budget**: tick tags as categories, set the order
   (if a document has several, the top one counts), enter monthly budgets, choose tags that are "never in budget".
4. **Settings → Receipts & capture**: e.g. only document types *Invoice* and *Receipt*.
5. **Income**: under *Automatically from bank statements* create a rule for the salary (keyword, e.g. the employer's
   name – easiest is to click "detect as income" on the salary credit). Detected credits count as
   income; if it is still missing in the current month, the expected amount counts. Enter other income by hand.
   The app also reads **payslips** (title with "Lohnabrechnung", or document type/tag): gross, deductions
   (social security, pension fund, insurance, withholding tax), net and paid-out amount – matched against the credit and
   with a yearly overview per person (handy for the tax return). Without a credit the amount from the payslip counts.

The settings are grouped into sections (Budget, Receipts, Bank & reconciliation, Planned items, Vehicles,
Contracts, Properties, Data & maintenance) and are saved immediately. Under **Data & maintenance** you find
backup/restore of the app database and CSV exports.

![Settings](docs/screenshots/einstellungen.png)

### Purpose and "exclude"

On the overview (list "Expenses this month"), under *Expenses* and when *capturing*, every receipt shows what it
is for. The app reads this from the OCR text – in this order: subject/payment purpose,
"additional information" of the QR bill, subject line ("Invoice for …"), first article line.
A service period is appended. Correct the purpose with ✎; the correction is kept.

If you untick the checkbox, the receipt no longer counts towards the budget and does not appear in capture or in
the open invoices. During reconciliation it is still found – so the related bank payment does not count as an
expense either. For bank transactions without a receipt the checkbox corresponds to "ignore".

Tip: a Paperless **workflow** can assign the amount field (empty) to new invoices automatically and
matching rules can set the category tags – then you only have to type in the amount in the app.

## Belgian payslips ("Billet de paie")

The app reads French-language Belgian payslips of social secretariats (one payslip per PDF page) and shows what you
actually received each month:

- **Paid out** = `*** Net à payer` of every payslip of the pay period. Several payslips in one month are added up
  (salary + "Bonus salarial", holiday pay "pécule de vacances", annual "prime" …).
- Also read: period, person, gross (`Total brut soumis ONSS`), net, withholding tax (`Précompte professionnel`), social
  security (`Retenue ONSS personnelle`, `Cotisation spéciale sécurité sociale`), meal vouchers, special payments.
- **Eco-cheques** (no `Net à payer`) are shown as a voucher item and are *not* counted as money received.
- Numbers use Belgian notation (`1.234,56`). PDFs whose text layer has a broken font encoding (`Þ` for spaces, `º` for
  é …) are repaired automatically.

### Paperless setup for payslips

1. Create a **document type** "Payslip" and (optionally) a **tag** "Payslips" and one **correspondent** per employer.
2. Create a **workflow** so that uploads are classified automatically:
   *Trigger* "Consumption started", filename filter `*Billet_de_paie*` → *Action* assign document type "Payslip" and the
   tag "Payslips". (Filename-based on purpose: matching on content does not work when the text layer is garbled.) A second
   workflow with the filter `*Billet_de_paie_<EMPLOYER>*` can assign the correspondent.
3. In the app: *Settings → Planned items & salary* → choose the document type "Payslip" (and/or the tag) under
   *Recognise payslips*. Documents with "Billet de paie", "fiche de paie", "Lohnabrechnung", "loonbrief" or "payslip" in
   the title are found even without this.
4. Open the **Income** tab (it imports new payslips automatically) or press *Import new*.

Paperless OCR needs no change: the app reads the text Paperless stored and, for Belgian payslips, also the original PDF
(`pdftotext -layout`), and uses the more complete result. Optional, for clean searchable text inside Paperless:
`PAPERLESS_OCR_MODE=force` and `PAPERLESS_OCR_LANGUAGE=fra+nld+eng` on the Paperless server.

Payslips are never counted as expenses. The income of a month comes from the payslips, or from the matching bank credit
once you import bank statements.

## Reconciling bank statements

1. Store bank statements as PDF in Paperless, e.g. with document type *Bank statement*.
2. **Settings → Bank statements & reconciliation**: choose this document type (or a tag).
3. **Reconcile → Import new**.
4. **Match unambiguous** accepts all hits where amount *and* name match. For recurring invoices
   with the same amount (rent, premiums, subscriptions) the closest in time wins.
   Hits on the amount alone remain suggestions to confirm.
5. For payments without a receipt choose a category or create a **rule**. Several terms can be joined
   with `+`, also with card end digits, e.g. `Tankomat + 1234` → vehicle.
6. **Ignore** transfers between your own accounts so they don't count as an expense.

A matched payment is not counted twice – only the invoice (at the invoice date).

### Supported banks

The reader detects two common layouts automatically:

| Layout | Columns | Tested with |
|---|---|---|
| A | `[Date] Text Amount Value-date [Balance]` | PostFinance, Zürcher Kantonalbank |
| B | `Date Text Value-date Amount [Balance]` | Bank Zimmerberg |
| Single document | Credit/debit advice: `Reference Value-date Currency Amount` | Zürcher Kantonalbank |

Single documents (e.g. the ZKB credit advice of a rent payment) are treated like a statement with one transaction –
choose the document type or tag of these documents as bank statement under *Settings → Bank* as well. If the same
transaction later appears in the monthly statement (same amount, ±4 days), it is not recorded twice.

Other banks with a similar structure often work too. Whether everything is right is visible immediately: transactions
whose sign could not be confirmed via the balance are marked "unverified".

**Your bank doesn't work?** Please open an issue with the OCR text of a statement
(Paperless → document → tab *Content*) – **blank out IBAN, account number, names and address first.**

## Setting up properties

1. **Properties → + Building**, then under **Setup**: address, landlord, IBAN, start of the billing period
   (e.g. March), Paperless tag for the building's receipts.
2. Add **flats** (area, owner-occupied).
3. **Create default keys & cost types** – then enter the percentages per flat (sum 100 %),
   choose the space heating/hot water keys and adjust cost types as needed.
4. **Tenancies**: tenant, address, salutation, start/end, rent and advance payment per month and keywords
   for the rent payment (e.g. surname).
5. Add **fixed costs** and **manual costs** (per year/month or one-off, distributed or one flat only).
6. Under **Costs** check that every receipt has the right cost type. "Not allocatable" (e.g. maintenance of the building)
   stays with the owner.
7. **Statement**: choose the tenant, check the advance payments (from the rent received or per contract), generate.
   The Word document follows the classic structure: letter, cost overview with coloured groups, detail pages
   with allocation (shares, CHF per unit, your share) and optionally heating oil consumption.
8. **Interim statement** (e.g. on move-out): under *Statement* choose type "Interim statement" and set the period
   up to the cut-off date. Costs booked until then count, advance payments only for the months in the period.

**Heating oil by consumption:** in the setup under *Heating oil stock* choose the heating oil cost type and record the
tank level (litres, price per 100 l) at the start and end of the period – or on the cut-off date of an
interim statement. The app then calculates opening stock + purchases − closing stock instead of the purchases.
You can also record **deliveries** (date, litres, amount): from these the app calculates the moving
**average price per 100 l** of the tank content – (residual value + deliveries) ÷ (remaining quantity + litres delivered). For a
reading this average applies; a recorded price only counts for the opening stock (as long as no average exists yet). If deliveries are recorded, they replace the heating oil receipts in the statement.

How it is calculated: share = amount × key of the flat × days of use ÷ days in period. Individually charged
items count in full if they fall within the tenancy. The owner bears the share of vacant flats.
Property costs do not count towards the household budget by default (can be switched off).

## Vehicles

1. In the `.env` set `TRACCAR_URL` and `TRACCAR_TOKEN` (or `TRACCAR_USER` / `TRACCAR_PASSWORD`).
2. In Paperless create a tag per vehicle (e.g. "Car estate") and attach it to service, insurance,
   tax and repair receipts.
3. **Settings → Vehicles**: create the vehicle with drive type, Traccar device, Paperless tag and fuel card no.
   (last digits are enough, several separated by commas). Below that choose the correspondent of the fuel card invoices.
4. **Vehicles → Import new** reads the fuel card invoices (Vögtlin-Meyer and AVIA / A.H. Meyer & Cie AG –
   with AVIA every vehicle has its own card no.; enter several numbers per vehicle separated by commas).
   If the OCR text in Paperless is jumbled column by column, the app reads the text directly from the PDF.
5. Assign refuellings paid by debit card to the vehicle in the reconciliation or by rule. For correct
   consumption add the litres via "Add refuelling manually" – or the charged kWh for electric cars.

Consumption is only calculated from months in which every refuelling has a quantity.

**Parkingpay:** store the Parkingpay statements (PDF from the Parkingpay account) in Paperless and choose the correspondent or
tag under *Settings → Vehicles → Recognise Parkingpay statements*. Enter the **licence plate** (or badge no.) on each
vehicle. Under *Vehicles → Parkingpay statements → Import new* the app reads every
parking session (date, time, place, plate, amount) and assigns it to the vehicle; unknown plates
can be assigned individually. In the budget the payment to Parkingpay (top-up or invoice) still counts – so
do not assign top-ups to a vehicle, otherwise they count twice there.
In car parks the statement often shows the Parkingpay badge no. instead of the plate – just enter it on the
vehicle as well (field "Licence plate / badge no.", comma-separated).

**km source:** the default is the Traccar report. If a device delivers a wrong or frozen odometer,
"km: calculate from GPS" can be chosen per vehicle – the app then calculates the distance itself from the GPS positions
(once in the background, then cached).

## Planning orders automatically (e-mail)

1. In Paperless create a tag **Bestellung** (another name: `ORDER_TAG_NAME` in the `.env`).
2. Paperless → **Mail**: add a mail account and create a rule, e.g.
   - Subject contains `order confirmation` (or sender `@amazon.com`, …)
   - Action: *Process mail as .eml* or *Mail and attachments* – assign the tag **Bestellung**,
     correspondent from the sender
3. The app picks up new order confirmations when the overview is opened. If it doesn't recognise the amount,
   set the "Total" field in Paperless or edit the planned item in the app.

Documents with the order tag never count as an expense – the invoice or debit is counted later.
The invoice or debit is expected 30 days after the order by default (`ORDER_EXPECT_DAYS`).

## Contracts & loans

In the **Contracts** tab ongoing contracts (insurance, health insurance, phone/internet, energy,
subscriptions …) and loans (mortgage, leasing, personal loan) are managed:

- **Versions**: every price or terms change from a date, optionally with a Paperless receipt
  ("→ as version" takes date and amount from an invoice)
- **Costs** per interval, per month and per year – totals at the top of the tab
- **Term and cancellation**: the next cancellation deadline is calculated from start, renewal (months) and notice period;
  deadlines within the next 4 months are highlighted
- **Payments** from the bank statements: assigned automatically via "bank transaction keywords" or manually;
  comparison paid / expected per year
- **Documents**: all Paperless documents of the chosen correspondent and/or tag
- **Loans**: outstanding balance per plan (initial amount minus repayment), interest per year,
  development of the balance over the next years. If the amount is left empty, the instalment is calculated from interest and repayment.

## Meters (AMS reader, Shelly, Home Assistant)

In the *Meters* tab add a meter:

- **Electricity (AMS reader)**: enter the IP address of the AMS reader (e.g. `192.168.1.50`). The app reads `http://<ip>/data.json`,
  field `ic` = cumulative import in kWh (`ec` for export). The container must be able to reach the reader on the network.
- **Water (Shelly, planned)**: creates an inactive meter. As soon as the Shelly is mounted, enter the address
  (e.g. `http://<shelly-ip>/rpc/Input.GetStatus?id=2`, field `counts.total`), adjust the factor
  (pulses per litre → `0.001` gives m³), *Test source* and set *active*.
- **Home Assistant**: set `HOMEASSISTANT_URL` and `HOMEASSISTANT_TOKEN` (long-lived access token) in the `.env` and enter the
  entity ID of a meter reading sensor (not an instantaneous value in W).
- **Manual**: record meter readings yourself (*Record reading*), e.g. from the old water meter.

For the forecast fill in under the meter's *Settings*: **tariff** per kWh or m³ (all components incl. VAT),
**base fee** per month, start of the **billing period**, the **meter reading of the last invoice** (otherwise the
first reading counts as the start) and the **advance-payment contract**. Record the advance-payment contract under *Contracts* (amount, interval and
keyword in the booking text) – the paid advance payments come from the bank statements, the still-due ones from the contract.

**Assignment:** create one meter per AMS reader and choose the **building (general)** – e.g. common electricity –
or a **flat** under *Assignment*. Meters are shown grouped by building. If a tenant pays the electricity directly to the utility, just choose
no advance-payment contract – then the meter only shows consumption and estimated costs.

In the utility statement (preview and Word/PDF) meters of "Building (general)" show the **expected** costs of the
period (consumption × tariff + base fee) in brackets after the category, e.g. "Electricity general (expected 1'318.73)".
Billing is still based on the invoices. You choose the category on the meter under *Show in utility statement at*
(empty = category with "Strom" in its name).

Meters are read every `METER_POLL_MINUTES` (default 60) and when the tab is opened. From the second year the forecast
extrapolates the rest of the period with last year's consumption, before that with the daily average. The result is an
estimate – tariff changes and the utility's reading date may differ.

## Users & permissions

Without users the app is open (or protected by `BASIC_AUTH_USER`). Under *Settings → Users & permissions* first create
your own account as **administrator** – afterwards everyone signs in with username and password.

Per user and area (budget, reconciliation, vehicles, properties, projects, contracts & subscriptions, income & salary, meters & energy):
**–** = not visible, **view** = read only, **edit** = change. Administrators may also do settings,
users, backup and export. The server checks permissions on every request; without permission for "Income & salary" income
is also hidden on the overview. The last administrator cannot be deleted or downgraded.
Passwords are stored hashed (PBKDF2), sessions last 30 days. Every user changes their password under *Account*.

**Forgot the administrator password?** Remove all users on the server – afterwards the app is open again and you
create the administrator anew:
```bash
docker exec paperless-budget python -c "import sqlite3;c=sqlite3.connect('/data/budget.db');c.execute('DELETE FROM sessions');c.execute('DELETE FROM users');c.commit()"
```

## Configuration

The `.env` contains addresses and credentials. Names of tags and fields (`AMOUNT_FIELD_NAME`, `PAID_*`,
`ORDER_*`, `NK_TAG_NAME`) are only initial values – they can be changed afterwards in the app under *Settings*.

| Variable | Default | Meaning |
|---|---|---|
| `PAPERLESS_URL` | `http://paperless:8000` | Address under which the container reaches Paperless |
| `PAPERLESS_TOKEN` | – | API token |
| `PAPERLESS_PUBLIC_URL` | = `PAPERLESS_URL` | For the "open document" links in the browser |
| `PAPERLESS_HOST_HEADER` | empty | Host name for requests to Paperless if Paperless rejects the internal address (error 400, `PAPERLESS_ALLOWED_HOSTS`). If empty, the app automatically tries the host from `PAPERLESS_PUBLIC_URL` on this error. |
| `PAPERLESS_VERIFY_SSL` | `true` | `false` for a self-signed certificate |
| `PAPERLESS_API_VERSION` | empty | Pin the API version if necessary |
| `AMOUNT_FIELD_NAME` | `Total` | Name of the monetary field (case-insensitive) |
| `CURRENCY` | `EUR` | Currency |
| `PAID_TAG_NAME` | `bezahlt` | Tag for paid invoices |
| `PAID_FIELD_NAME` | `Bezahlt am` | Date field for the payment date |
| `ORDER_TAG_NAME` | `Bestellung` | Tag for order confirmations |
| `ORDER_EXPECT_DAYS` | `30` | Days after the order until the invoice/debit is expected |
| `MATCH_BEFORE_DAYS` | `5` | Invoice may be dated this many days after the payment |
| `TRACCAR_URL` | empty | Traccar server, e.g. `http://traccar:8082` |
| `TRACCAR_TOKEN` | empty | Traccar token (alternatively `TRACCAR_USER` / `TRACCAR_PASSWORD`) |
| `TRACCAR_VERIFY_SSL` | `true` | `false` for a self-signed certificate |
| `HOMEASSISTANT_URL` | empty | Home Assistant for meter sensors, e.g. `http://homeassistant:8123` |
| `HOMEASSISTANT_TOKEN` | empty | Long-lived access token from the Home Assistant profile |
| `METER_POLL_MINUTES` | `60` | How often the meters are read |
| `NK_TAG_NAME` | `Nebenkostenabrechnung` | Tag for statements filed in Paperless |
| `FILES_DIR` | `/data/abrechnungen` | Storage of the generated Word/PDF files |
| `BASIC_AUTH_USER` / `BASIC_AUTH_PASSWORD` | empty | Optional login |

Budgets, income, rules, imported transactions and vehicles live in `./data/budget.db` (SQLite) –
include this folder in your backup or download a backup under *Settings → Data & maintenance*.

## What is changed in Paperless

The app only writes when you trigger it:

- amount (monetary field) and category tag when capturing or changing an expense
- tag "paid" and field "Paid on" when matching a payment (unmatching removes both again)
- once: the amount field, the "paid" tag and the "Paid on" field, if they are missing

All other custom fields and tags of a document stay unchanged. Purpose and "exclude"
are stored only in the app's own database – Paperless is not touched by them.

## Structure

```
app/main.py          FastAPI backend: proxy to the Paperless/Traccar API, SQLite, reports
app/i18n.py          Backend translations (English source, German) and request language
app/bank.py          Bank statement reader and reconciliation logic
app/vehicles.py      Read fuel card invoices, vehicle key figures
app/parking.py       Read Parkingpay statements (parking sessions with licence plates)
app/payslip.py       Read payslips (gross, deductions, net, payout); Swiss German format, dispatches to payslip_be
app/payslip_be.py    Read Belgian French payslips ("Billet de paie", Net à payer, multi-page documents)
app/purpose.py       Read the purpose from the invoice text
app/realestate.py    Calculate utility costs, generate the statement as Word
app/re_api.py        API for properties, rents, projects and assignments
app/contracts_api.py Contracts and loans (versions, payments, cancellation deadlines, outstanding balance)
app/meters_api.py    Read meters (AMS, HTTP-JSON, Home Assistant), forecast and advance-payment balance
app/planning_api.py  Planned items (orders) and "left of salary"
app/static/settings.js  Settings (sections, instant save, status, backup, users)
app/auth.py          Users & permissions: password hashing, assignment of API routes to areas
app/static/          Frontend (HTML, CSS, vanilla JS, Chart.js bundled locally)
app/static/i18n.js   Frontend translation helper (__(), applyI18n); texts in app/static/locales/
```

The Paperless token stays in the backend, the browser only talks to the app.
The API is documented at `/docs` (Swagger UI).

### Tests

```bash
pip install -r requirements.txt -r requirements-dev.txt
python -m pytest tests/
```

The payslip tests use synthetic documents. If you keep real payslips as text files in `tests/private_fixtures/` (git-ignored,
with an `expected.json` of `{file: payout}`), they are checked too.

### Developing locally

```bash
pip install -r requirements.txt
PAPERLESS_URL=http://localhost:8000 PAPERLESS_TOKEN=... DB_PATH=./data/budget.db \
  uvicorn app.main:app --reload --port 8088
```

New UI texts: write them in English with `__("Text {name}", {name: value})` (JS) or `_t("Text {name}", name=value)`
(Python) and add the German version to `app/static/locales/de.js` or `app/i18n.py`. Static HTML text is translated
automatically from the same dictionary (the text node must match an English key exactly).

## Limitations

- Bank statements are read from the OCR text. Poor scans or unusual layouts can
  fail – digitally generated PDFs from e-banking work best.
- Only one currency per installation.
- The document readers (bank statements, payslips, invoices, fuel cards) and the generated tenant statement expect
  German-language Swiss documents; the UI and server messages are translated.
- No multi-tenant system: everyone with access to the app sees all data.
- Heating/hot water costs are distributed with fixed percentages; billing by meter reading (HKV) is not built in.
- The Docker image contains LibreOffice (for PDF generation) and is therefore about 600 MB.
- The statement is an aid – please check legal requirements (lease, local law) yourself.

## Contributing

Issues and pull requests are welcome – especially examples of further bank and fuel card layouts
(always anonymised).

## License

[MIT](LICENSE)

Not officially affiliated with Paperless-ngx or Traccar.
Chart.js is included under the MIT license.
