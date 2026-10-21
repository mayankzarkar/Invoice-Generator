# Forma Invoice Studio

A full-stack invoice generator built with FastAPI, SQLite, and vanilla HTML/CSS/JavaScript.

## Features

- Separate admin dashboard and invoice editor pages
- Create, view, update, search, filter, and delete invoices
- Client list derived from saved invoice records
- Line items with quantity, unit price, and per-line rounding to cents
- Fixed discount, percentage tax, and grand-total calculations
- Custom invoice fields with visibility controls
- Browser print / Save as PDF with print-only invoice styling
- SQLite persistence across reloads
- SMTP email delivery, configured only on the server
- Server-side validation and helpful API error messages
- Responsive layouts, labels, keyboard focus styles, and accessible status messages

## Requirements

- Python 3.10+
- SMTP account if you want to test actual email delivery

## Run locally

### Windows PowerShell

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# Create a .env file only if you need to configure SMTP email.
uvicorn app:app --reload
```

### macOS/Linux

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# Create a .env file only if you need to configure SMTP email.
uvicorn app:app --reload
```

Open <http://127.0.0.1:8000> for the admin dashboard and <http://127.0.0.1:8000/invoice> for the invoice editor.

The SQLite database is created automatically at `data/invoices.db` unless `DATABASE_PATH` is set.

## Project structure

```text
app.py                       FastAPI setup, template rendering, and static hosting
backend/
  api.py                     HTTP routes for invoices, status, and email
  helpers.py                 Shared database, money, and serialization functions
  migrations.py              Idempotent SQLite schema setup
  schemas.py                 Request models and validation rules
frontend/
  templates/
    layout.html              Shared page shell inherited by each screen
    admin.html               Dashboard, invoices, clients, and settings
    invoice.html             Create/edit invoice screen
  static/
    css/styles.css           Shared responsive theme and print styles
    js/common.js             Shared browser utilities and API client
    js/admin.js              Vue dashboard plus admin interactions
    js/invoice-vue.js        Reactive Vue invoice preview
    js/invoice.js            Invoice editor and API interactions
```

The shared HTML layout keeps document metadata, the stylesheet, Vue 3 CDN runtime, and browser utilities in one place without a frontend build step. Vue powers the dashboard summaries, revenue chart, and live invoice preview; the existing editor controls and backend API flows remain in their dedicated JavaScript modules. API endpoints, shared backend logic, and database setup live in separate modules.

## Run automated tests

```bash
pytest -q
```

The tests cover the required $99 calculation, invoice CRUD/status operations, date ordering, email-format validation, negative inputs, and discount limits.

**Testing status:** Automated tests were not run for this time-boxed demo, so test coverage has not been verified.

## Client demo narration

“Here’s **Forma**, a simple invoice management app designed to make creating and tracking invoices straightforward.

On the main screen, you can see invoices and their current statuses. Search and filters make it easier to find a specific invoice and keep track of what is pending or already sent.

To create an invoice, I enter the client and invoice details, add line items, and apply a discount if needed. The total updates from the invoice details, which helps reduce manual calculations. The form keeps key information easy to scan and enter.

Once an invoice is ready, I can save it and manage its status. If email is configured, I can also send it directly to the client. The responsive interface uses clear labels and status messages to make each step easy to follow.

Forma brings the everyday workflow—from creating an invoice to tracking its status—into one clear, approachable place.”

**Testing note for the walkthrough:** Automated tests were not run due to time constraints, so test coverage has not been verified.

## Configure email

Fill the SMTP variables in `.env`. Example values are intentionally omitted:

- `SMTP_HOST`: your email provider's SMTP hostname
- `SMTP_PORT`: commonly 587 for STARTTLS or 465 for SSL
- `SMTP_USE_SSL`: set `true` for implicit SSL, otherwise `false` for STARTTLS
- `SMTP_USER` and `SMTP_PASSWORD`: provider credentials or an app password
- `SMTP_FROM`: sender address authorized by your provider

Restart the app after editing `.env`. Test delivery only to an address you control. Credentials are read server-side and are not included in browser code. The email body includes invoice details; it does not attach a PDF.

## Calculation rules

- Each line total is rounded to cents using half-up rounding.
- The rounded line totals are summed to produce the subtotal.
- The fixed discount is applied to the subtotal.
- Tax is calculated on the discounted subtotal and rounded to cents.
- Grand total equals discounted subtotal plus rounded tax.
- Negative quantities, prices, discounts, and tax rates are rejected.
- Quantities must be greater than zero, and discount cannot exceed subtotal.

Required example: `2 × $50 - $10 discount + 10% tax = $99.00`.

## Storage and API

SQLite stores invoices and line items. The main endpoints are:

- `GET /api/health`
- `GET /api/invoices?search=&status=all`
- `POST /api/invoices`
- `GET /api/invoices/{id}`
- `PUT /api/invoices/{id}`
- `PATCH /api/invoices/{id}/status`
- `DELETE /api/invoices/{id}`
- `POST /api/invoices/{id}/email` with `{"to":"address-you-control@example.com"}`

This exercise prototype intentionally does not include authentication, payment processing, a PDF generation library, or a native mobile app. It is designed for local demonstration and should not be exposed publicly without authentication, authorization, rate limiting, deployment hardening, and a privacy/security review.

## Decisions and limitations

- FastAPI and SQLite keep setup simple for a time-boxed exercise.
- Plain JavaScript avoids a frontend build step.
- The admin client list is derived from invoice records rather than maintaining a separate client table.
- Invoice status is manually managed, except successful email delivery sets status to `Sent`.
- Email delivery depends on valid SMTP configuration and network access.
- No secrets or personal credentials belong in the repository.
- AI tools used: Cursor was used to help draft and review implementation code; the developer should verify and explain all submitted code.
- Time spent: fill in the actual time spent before submission.
- Unfinished work: no authentication, PDF email attachment, automated overdue status scheduler, deployment configuration.

## Before submission

1. Run the app and test the required $99 calculation.
2. Configure SMTP and send a test invoice to an address you control.
3. Confirm saved invoices survive a browser reload and app restart.
4. Inspect print preview: it should show the invoice only.
5. Fill in the actual time spent and any remaining unfinished work.
6. Push source code to a public GitHub repository and record its URL.
7. Record the required walkthrough with camera on and spoken narration; show editing, custom fields, persistence after reload, actual email delivery, design decisions, and limitations.
