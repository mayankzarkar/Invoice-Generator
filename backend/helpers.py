"""Shared database, calculation, and serialization helpers for API routes."""

import json
import os
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path

from dotenv import load_dotenv
from fastapi import HTTPException

from .schemas import InvoiceIn

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")
DB_PATH = Path(os.getenv("DATABASE_PATH", BASE_DIR / "data" / "invoices.db"))
DB_PATH.parent.mkdir(parents=True, exist_ok=True)


@contextmanager
def connection():
    """Open a short-lived SQLite connection with foreign keys enabled."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def to_decimal(value, field_name):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=422, detail=f"{field_name} must be a valid number.")
    if not result.is_finite():
        raise HTTPException(status_code=422, detail=f"{field_name} must be finite.")
    return result


def cents(value: Decimal) -> int:
    return int((value * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def money_string(cents_value: int) -> str:
    return f"{cents_value / 100:.2f}"


def calculate(payload: InvoiceIn):
    """Apply the app's per-line rounding and discounted-tax calculation rules."""
    line_totals = []
    subtotal = 0
    for item in payload.items:
        line_total = cents(item.quantity * item.unit_price)
        line_totals.append(line_total)
        subtotal += line_total
    discount = cents(payload.discount)
    if discount > subtotal:
        raise HTTPException(status_code=422, detail="Discount cannot exceed the subtotal.")
    taxable = subtotal - discount
    tax = int((Decimal(taxable) * payload.tax_rate / Decimal(100)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    return line_totals, subtotal, discount, tax, taxable + tax


def invoice_dict(row, items):
    data = dict(row)
    data["discount"] = money_string(data.pop("discount_cents"))
    data["subtotal"] = money_string(data.pop("subtotal_cents"))
    data["tax"] = money_string(data.pop("tax_cents"))
    data["total"] = money_string(data.pop("total_cents"))
    data["tax_rate"] = str(data["tax_rate"])
    data["custom_fields"] = json.loads(data.pop("custom_fields_json") or "[]")
    data["items"] = [{
        "description": item["description"],
        "quantity": item["quantity"],
        "unit_price": money_string(item["unit_price_cents"]),
        "line_total": money_string(item["line_total_cents"])
    } for item in items]
    return data


def fetch_invoice(conn, invoice_id):
    row = conn.execute("SELECT * FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
    if not row:
        return None
    items = conn.execute(
        "SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position", (invoice_id,)
    ).fetchall()
    return invoice_dict(row, items)


def get_payload_values(payload: InvoiceIn):
    line_totals, subtotal, discount, tax, total = calculate(payload)
    now = datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    values = (
        payload.invoice_number, payload.business_name, payload.business_email.strip(),
        payload.business_address, payload.client_name, payload.client_email.strip(),
        payload.client_address, payload.issue_date.isoformat(), payload.due_date.isoformat(),
        payload.notes, discount, str(payload.tax_rate), subtotal, tax, total,
        json.dumps([field.model_dump() for field in payload.custom_fields]), now
    )
    return values, line_totals, now
