"""Versioned database setup kept separate from request handling."""

from .helpers import connection


def init_db():
    """Create the current schema and indexes when the app starts."""
    with connection() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS invoices (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_number TEXT NOT NULL UNIQUE,
            business_name TEXT NOT NULL,
            business_email TEXT NOT NULL DEFAULT '',
            business_address TEXT NOT NULL DEFAULT '',
            client_name TEXT NOT NULL,
            client_email TEXT NOT NULL,
            client_address TEXT NOT NULL DEFAULT '',
            issue_date TEXT NOT NULL,
            due_date TEXT NOT NULL,
            notes TEXT NOT NULL DEFAULT '',
            discount_cents INTEGER NOT NULL DEFAULT 0,
            tax_rate TEXT NOT NULL DEFAULT '0',
            subtotal_cents INTEGER NOT NULL DEFAULT 0,
            tax_cents INTEGER NOT NULL DEFAULT 0,
            total_cents INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'Draft',
            custom_fields_json TEXT NOT NULL DEFAULT '[]',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS line_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            description TEXT NOT NULL,
            quantity TEXT NOT NULL,
            unit_price_cents INTEGER NOT NULL,
            line_total_cents INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_email);
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
        """)
