import tempfile
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest
from fastapi.testclient import TestClient

import app as application


@pytest.fixture()
def client(monkeypatch):
    db = Path(tempfile.mkstemp(suffix=".db")[1])
    monkeypatch.setattr(application, "DB_PATH", db)
    application.init_db()
    with TestClient(application.app) as test_client:
        yield test_client
    db.unlink(missing_ok=True)


def payload(**overrides):
    data = {
        "invoice_number": "TEST-001",
        "business_name": "Northstar Studio",
        "business_email": "hello@example.com",
        "business_address": "18 Market Street",
        "client_name": "Olivia Chen",
        "client_email": "olivia@example.com",
        "client_address": "42 West 18th Street",
        "issue_date": "2026-10-20",
        "due_date": "2026-11-03",
        "notes": "Thank you.",
        "discount": "10",
        "tax_rate": "10",
        "items": [{"description": "Consulting", "quantity": "2", "unit_price": "50"}],
        "custom_fields": [{"label": "PO", "value": "PO-1", "visible": False}],
    }
    data.update(overrides)
    return data


def test_required_calculation_and_readback(client):
    response = client.post("/api/invoices", json=payload())
    assert response.status_code == 201
    invoice = response.json()
    assert invoice["subtotal"] == "100.00"
    assert invoice["discount"] == "10.00"
    assert invoice["tax"] == "9.00"
    assert invoice["total"] == "99.00"
    readback = client.get(f'/api/invoices/{invoice["id"]}')
    assert readback.status_code == 200
    assert readback.json()["items"][0]["line_total"] == "100.00"
    assert readback.json()["custom_fields"][0]["visible"] is False


@pytest.mark.parametrize("overrides", [
    {"discount": "-1"},
    {"tax_rate": "-1"},
    {"tax_rate": "101"},
    {"discount": "101"},
    {"due_date": "2026-10-01"},
    {"items": [{"description": "Bad quantity", "quantity": "-1", "unit_price": "20"}]},
    {"items": [{"description": "Bad price", "quantity": "1", "unit_price": "-20"}]},
    {"client_email": "not-an-email"},
])
def test_invalid_inputs_are_rejected(client, overrides):
    response = client.post("/api/invoices", json=payload(invoice_number="INVALID", **overrides))
    assert response.status_code == 422


def test_update_status_and_delete(client):
    created = client.post("/api/invoices", json=payload()).json()
    invoice_id = created["id"]
    updated = client.put(f"/api/invoices/{invoice_id}", json=payload(notes="Updated"))
    assert updated.status_code == 200
    assert updated.json()["notes"] == "Updated"
    status = client.patch(f"/api/invoices/{invoice_id}/status", json={"status": "Paid"})
    assert status.status_code == 200
    assert status.json()["status"] == "Paid"
    assert client.delete(f"/api/invoices/{invoice_id}").status_code == 204
    assert client.get(f"/api/invoices/{invoice_id}").status_code == 404
