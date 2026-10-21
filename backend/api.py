"""HTTP endpoints for invoice CRUD, status changes, and email delivery."""

import html
import os
import re
import smtplib
import sqlite3
from datetime import datetime, timezone
from decimal import Decimal
from email.message import EmailMessage

from fastapi import APIRouter, HTTPException

from .helpers import cents, connection, fetch_invoice, get_payload_values, invoice_dict
from .schemas import InvoiceIn

router = APIRouter(prefix="/api")

@router.get("/health")
def health():
    return {"ok": True, "service": "Forma Invoice Studio"}


@router.get("/invoices")
def list_invoices(search: str = "", status: str = "all"):
    with connection() as conn:
        rows = conn.execute("SELECT * FROM invoices ORDER BY created_at DESC, id DESC").fetchall()
        result = []
        for row in rows:
            items = conn.execute("SELECT * FROM line_items WHERE invoice_id = ? ORDER BY position", (row["id"],)).fetchall()
            invoice = invoice_dict(row, items)
            haystack = f'{invoice["invoice_number"]} {invoice["client_name"]} {invoice["client_email"]}'.lower()
            if search.lower() not in haystack:
                continue
            current_status = invoice["status"]
            if status != "all" and current_status != status:
                continue
            result.append(invoice)
        return result


@router.get("/invoices/{invoice_id}")
def get_invoice(invoice_id: int):
    with connection() as conn:
        invoice = fetch_invoice(conn, invoice_id)
        if not invoice:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        return invoice


@router.post("/invoices", status_code=201)
def create_invoice(payload: InvoiceIn):
    values, line_totals, now = get_payload_values(payload)
    try:
        with connection() as conn:
            cursor = conn.execute("""
                INSERT INTO invoices (
                    invoice_number,business_name,business_email,business_address,
                    client_name,client_email,client_address,issue_date,due_date,notes,
                    discount_cents,tax_rate,subtotal_cents,tax_cents,total_cents,
                    custom_fields_json,created_at,updated_at
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """, values[:-1] + (now, now))
            invoice_id = cursor.lastrowid
            for pos, (item, line_total) in enumerate(zip(payload.items, line_totals)):
                conn.execute("""INSERT INTO line_items
                    (invoice_id,position,description,quantity,unit_price_cents,line_total_cents)
                    VALUES (?,?,?,?,?,?)""",
                    (invoice_id, pos, item.description, str(item.quantity), cents(item.unit_price), line_total))
            return fetch_invoice(conn, invoice_id)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Invoice number already exists. Use a unique invoice number.")


@router.put("/invoices/{invoice_id}")
def update_invoice(invoice_id: int, payload: InvoiceIn):
    values, line_totals, now = get_payload_values(payload)
    try:
        with connection() as conn:
            exists = conn.execute("SELECT id, status FROM invoices WHERE id = ?", (invoice_id,)).fetchone()
            if not exists:
                raise HTTPException(status_code=404, detail="Invoice not found.")
            if exists["status"] == "Paid":
                raise HTTPException(status_code=409, detail="Paid invoices are read-only and cannot be edited.")
            conn.execute("""
                UPDATE invoices SET invoice_number=?,business_name=?,business_email=?,business_address=?,
                client_name=?,client_email=?,client_address=?,issue_date=?,due_date=?,notes=?,
                discount_cents=?,tax_rate=?,subtotal_cents=?,tax_cents=?,total_cents=?,
                custom_fields_json=?,updated_at=? WHERE id=?
            """, values + (invoice_id,))
            conn.execute("DELETE FROM line_items WHERE invoice_id=?", (invoice_id,))
            for pos, (item, line_total) in enumerate(zip(payload.items, line_totals)):
                conn.execute("""INSERT INTO line_items
                    (invoice_id,position,description,quantity,unit_price_cents,line_total_cents)
                    VALUES (?,?,?,?,?,?)""",
                    (invoice_id, pos, item.description, str(item.quantity), cents(item.unit_price), line_total))
            return fetch_invoice(conn, invoice_id)
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="Invoice number already exists. Use a unique invoice number.")


@router.patch("/invoices/{invoice_id}/status")
def update_status(invoice_id: int, body: dict):
    status = body.get("status")
    if status not in {"Draft", "Sent", "Paid", "Overdue"}:
        raise HTTPException(status_code=422, detail="Status must be Draft, Sent, Paid, or Overdue.")
    with connection() as conn:
        current = conn.execute("SELECT status FROM invoices WHERE id=?", (invoice_id,)).fetchone()
        if not current:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        if current["status"] == "Paid" and status != "Paid":
            raise HTTPException(status_code=409, detail="Paid invoices cannot be moved to another status.")
        cur = conn.execute("UPDATE invoices SET status=?, updated_at=? WHERE id=?",
                           (status, datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), invoice_id))
        if not cur.rowcount:
            raise HTTPException(status_code=404, detail="Invoice not found.")
        return fetch_invoice(conn, invoice_id)


@router.delete("/invoices/{invoice_id}", status_code=204)
def delete_invoice(invoice_id: int):
    with connection() as conn:
        cur = conn.execute("DELETE FROM invoices WHERE id=?", (invoice_id,))
        if not cur.rowcount:
            raise HTTPException(status_code=404, detail="Invoice not found.")
    return None


@router.post("/invoices/{invoice_id}/email")
def send_invoice_email(invoice_id: int, body: dict):
    recipient = str(body.get("to", "")).strip()
    import re
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", recipient):
        raise HTTPException(status_code=422, detail="Enter a valid recipient email address.")
    with connection() as conn:
        invoice = fetch_invoice(conn, invoice_id)
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found.")
    host = os.getenv("SMTP_HOST", "").strip()
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "")
    fallback_from_email = os.getenv("SMTP_FROM", user).strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    use_ssl = os.getenv("SMTP_USE_SSL", "false").lower() == "true"
    from_email = invoice["business_email"].strip() or fallback_from_email
    if not host or not from_email:
        raise HTTPException(status_code=503, detail="Email is not configured. Set SMTP_HOST, SMTP_FROM, and SMTP credentials in .env.")
    lines = "\n".join(f'{i["description"]} | Qty {i["quantity"]} | ${i["unit_price"]} | ${i["line_total"]}' for i in invoice["items"])
    is_paid = invoice["status"] == "Paid"
    body_text = f"""Hello {invoice['client_name']},

{"This is your payment receipt for paid invoice" if is_paid else "Please find the details of invoice"} {invoice['invoice_number']}.

{lines}

Subtotal: ${invoice['subtotal']}
Discount: -${invoice['discount']}
Tax ({invoice['tax_rate']}%): ${invoice['tax']}
{"Total paid" if is_paid else "Total due"}: ${invoice['total']}

Issue date: {invoice['issue_date']}
Due date: {invoice['due_date']}

{invoice['notes']}

Regards,
{invoice['business_name']}
{invoice['business_email']}
"""
    escape = lambda value: html.escape(str(value or ""), quote=True)
    line_rows_html = "".join(
        "<tr>"
        f"<td style='padding:12px 10px;border-bottom:1px solid #f0ebf5;color:#302642'>{escape(item['description'])}</td>"
        f"<td style='padding:12px 10px;border-bottom:1px solid #f0ebf5;text-align:right;color:#53645a'>{escape(item['quantity'])}</td>"
        f"<td style='padding:12px 10px;border-bottom:1px solid #f0ebf5;text-align:right;color:#53645a;white-space:nowrap'>${escape(item['unit_price'])}</td>"
        f"<td style='padding:12px 10px;border-bottom:1px solid #f0ebf5;text-align:right;font-weight:700;color:#302642;white-space:nowrap'>${escape(item['line_total'])}</td>"
        "</tr>"
        for item in invoice["items"]
    )
    custom_rows_html = "".join(
        f"<tr><td style='padding:5px 0;color:#968ca0;font-size:12px'>{escape(field['label'])}</td>"
        f"<td style='padding:5px 0;text-align:right;color:#302642;font-size:12px'>{escape(field['value'])}</td></tr>"
        for field in invoice["custom_fields"] if field.get("visible") and field.get("label", "").strip()
    )
    sender_address_html = "<br>".join(escape(invoice["business_address"]).splitlines())
    client_address_html = "<br>".join(escape(invoice["client_address"]).splitlines())
    notes_html = "<br>".join(escape(invoice["notes"]).splitlines())
    discount_html = "" if Decimal(invoice["discount"]) == 0 else (
        f"<tr><td style='padding:5px 0;color:#968ca0'>Discount</td>"
        f"<td style='padding:5px 0;text-align:right;color:#302642'>−${escape(invoice['discount'])}</td></tr>"
    )
    html_body = f"""<!doctype html>
<html lang="en"><body style="margin:0;padding:24px 12px;background:#faf8fd;font-family:Arial,Helvetica,sans-serif;color:#302642">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #ece7f3;border-radius:12px;overflow:hidden">
    <tr><td style="height:6px;background:#8a65c8;font-size:0;line-height:0">&nbsp;</td></tr>
    <tr><td style="padding:30px 34px 22px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td style="vertical-align:top"><table role="presentation" cellspacing="0" cellpadding="0"><tr>
          <td width="42" height="42" align="center" valign="middle" style="width:42px;height:42px;border-radius:11px;background:#eee7fa;color:#6947a5;font-size:21px;font-weight:800">{escape(invoice['business_name'][:1].upper() or 'B')}</td>
          <td style="vertical-align:middle;padding-left:11px"><div style="font-size:19px;font-weight:700;color:#302642">{escape(invoice['business_name'])}</div>
          <div style="padding-top:5px;font-size:12px;line-height:1.6;color:#968ca0">{escape(invoice['business_email'])}<br>{sender_address_html}</div></td>
        </tr></table></td>
        <td style="vertical-align:top;text-align:right"><div style="font-size:27px;letter-spacing:-1px;font-weight:800;color:#302642">{'RECEIPT' if is_paid else 'INVOICE'}</div>
          <div style="padding-top:5px;font-size:12px;color:#968ca0">No. <strong style="color:#302642">{escape(invoice['invoice_number'])}</strong></div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:18px 34px;border-top:1px solid #ece7f3;border-bottom:1px solid #ece7f3">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        <td width="50%" style="vertical-align:top;padding-right:12px"><div style="font-size:10px;letter-spacing:1px;font-weight:700;color:#968ca0">BILLED BY</div>
          <div style="padding-top:8px;font-size:13px;font-weight:700">{escape(invoice['business_name'])}</div><div style="padding-top:4px;font-size:12px;line-height:1.6;color:#746384">{sender_address_html}</div></td>
        <td width="50%" style="vertical-align:top;padding-left:12px"><div style="font-size:10px;letter-spacing:1px;font-weight:700;color:#968ca0">BILLED TO</div>
          <div style="padding-top:8px;font-size:13px;font-weight:700">{escape(invoice['client_name'])}</div><div style="padding-top:4px;font-size:12px;line-height:1.6;color:#746384">{escape(invoice['client_email'])}<br>{client_address_html}</div></td>
      </tr></table>
    </td></tr>
    <tr><td style="padding:18px 34px 8px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td><div style="font-size:10px;color:#968ca0">ISSUE DATE</div><div style="padding-top:5px;font-size:12px;font-weight:700">{escape(invoice['issue_date'])}</div></td>
      <td><div style="font-size:10px;color:#968ca0">DUE DATE</div><div style="padding-top:5px;font-size:12px;font-weight:700">{escape(invoice['due_date'])}</div></td>
    </tr></table></td></tr>
    <tr><td style="padding:12px 34px"><table width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse">
      <thead><tr style="background:#f6f1fc"><th align="left" style="padding:10px;color:#746384;font-size:10px;letter-spacing:.6px">DESCRIPTION</th><th align="right" style="padding:10px;color:#746384;font-size:10px">QTY</th><th align="right" style="padding:10px;color:#746384;font-size:10px">RATE</th><th align="right" style="padding:10px;color:#746384;font-size:10px">AMOUNT</th></tr></thead>
      <tbody>{line_rows_html}</tbody>
    </table></td></tr>
    <tr><td style="padding:12px 34px 28px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td width="52%" style="vertical-align:top;padding-right:18px"><div style="font-size:10px;letter-spacing:1px;font-weight:700;color:#968ca0">ADDITIONAL DETAILS</div>
        <div style="padding-top:8px;font-size:12px;line-height:1.6;color:#746384">{notes_html}</div>
        {f"<table role='presentation' width='100%' cellspacing='0' cellpadding='0' style='margin-top:12px'>{custom_rows_html}</table>" if custom_rows_html else ""}</td>
      <td width="48%" style="vertical-align:top"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-size:12px">
        <tr><td style="padding:5px 0;color:#968ca0">Subtotal</td><td align="right" style="padding:5px 0;font-weight:700">${escape(invoice['subtotal'])}</td></tr>
        {discount_html}
        <tr><td style="padding:5px 0;color:#968ca0">Tax ({escape(invoice['tax_rate'])}%)</td><td align="right" style="padding:5px 0;font-weight:700">${escape(invoice['tax'])}</td></tr>
        <tr><td style="padding:12px 0 0;border-top:1px solid #ece7f3;font-weight:700;font-size:14px">{'Total paid' if is_paid else 'Total due'}</td><td align="right" style="padding:12px 0 0;border-top:1px solid #ece7f3;font-size:20px;font-weight:800;color:#8a65c8">${escape(invoice['total'])}</td></tr>
      </table></td>
    </tr></table></td></tr>
    <tr><td style="padding:14px 34px;border-top:1px solid #ece7f3;text-align:center;font-size:11px;color:#968ca0">Thank you for your business · {escape(invoice['business_name'])}</td></tr>
  </table>
</body></html>"""
    message = EmailMessage()
    message["Subject"] = f"{'Receipt' if is_paid else 'Invoice'} {invoice['invoice_number']} from {invoice['business_name']}"
    message["From"] = from_email
    message["To"] = recipient
    message.set_content(body_text)
    message.add_alternative(html_body, subtype="html")
    try:
        if use_ssl:
            with smtplib.SMTP_SSL(host, port, timeout=20) as server:
                if user:
                    server.login(user, password)
                server.send_message(message)
        else:
            with smtplib.SMTP(host, port, timeout=20) as server:
                server.starttls()
                if user:
                    server.login(user, password)
                server.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        raise HTTPException(status_code=502, detail=f"Email provider error: {str(exc)[:220]}")
    if not is_paid:
        with connection() as conn:
            conn.execute("UPDATE invoices SET status='Sent', updated_at=? WHERE id=?",
                         (datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"), invoice_id))
    return {"ok": True, "message": f"{'Receipt' if is_paid else 'Invoice'} emailed to {recipient}.", "status": invoice["status"] if is_paid else "Sent"}
