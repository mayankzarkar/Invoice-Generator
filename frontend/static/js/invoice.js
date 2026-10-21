const { $, money, escapeHTML: esc, formatDate: fmtDate, toast, api } = window.Forma;
let invoiceId = null,
    invoiceStatus = 'Draft',
    items = [],
    custom = [{
        label: 'Purchase order',
        value: '',
        visible: false
    }];
let validationAttempted = false;
const today = new Date(),
    dateInput = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

function getForm() {
    return {
        invoice_number: $('invoiceNumber').value.trim(),
        business_name: $('businessName').value.trim(),
        business_email: $('businessEmail').value.trim(),
        business_address: $('businessAddress').value,
        client_name: $('clientName').value.trim(),
        client_email: $('clientEmail').value.trim(),
        client_address: $('clientAddress').value,
        issue_date: $('issueDate').value,
        due_date: $('dueDate').value,
        notes: $('notes').value,
        discount: $('discount').value === '' ? '0' : $('discount').value,
        tax_rate: $('taxRate').value === '' ? '0' : $('taxRate').value,
        items: items.map(i => ({
            description: i.description,
            quantity: i.quantity,
            unit_price: i.unit_price
        })),
        custom_fields: custom
    }
}

function clearInlineErrors() {
    document.querySelectorAll('.field-error').forEach(error => error.remove());
    document.querySelectorAll('.input-invalid').forEach(control => {
        control.classList.remove('input-invalid');
        control.removeAttribute('aria-invalid');
        control.removeAttribute('aria-describedby')
    });
}

function setInlineError(control, message, errorId) {
    if (!control) return;
    const id = errorId || `${control.id || control.dataset.key || 'field'}-error`;
    control.classList.add('input-invalid');
    control.setAttribute('aria-invalid', 'true');
    control.setAttribute('aria-describedby', id);
    const error = document.createElement('span');
    error.className = 'field-error';
    error.id = id;
    error.setAttribute('role', 'alert');
    error.textContent = message;
    control.insertAdjacentElement('afterend', error)
}

function validateClient(showFeedback = false) {
    const p = getForm(), fieldErrors = new Map(), itemErrors = new Map(), messages = [];
    const addFieldError = (id, message) => {
        if (!fieldErrors.has(id)) fieldErrors.set(id, message);
        messages.push(message)
    };
    if (showFeedback) validationAttempted = true;
    clearInlineErrors();
    const required = {
        invoice_number: 'invoiceNumber', business_name: 'businessName', client_name: 'clientName',
        client_email: 'clientEmail', issue_date: 'issueDate', due_date: 'dueDate'
    };
    for (const [key, id] of Object.entries(required))
        if (!String(p[key]).trim()) addFieldError(id, `${key.replaceAll('_', ' ')} is required.`);
    if (p.client_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.client_email)) addFieldError('clientEmail', 'Client email must be valid.');
    if (p.business_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.business_email)) addFieldError('businessEmail', 'Business email must be valid.');
    if (p.due_date && p.issue_date && p.due_date < p.issue_date) {
        addFieldError('issueDate', 'Issue date must be on or before the due date.');
        addFieldError('dueDate', 'Due date cannot be earlier than the issue date.')
    }
    if (!items.length) {
        messages.push('Add at least one line item.');
        if (validationAttempted) setInlineError($('addItemBtn'), 'Add at least one line item.', 'items-error')
    }
    items.forEach((item, index) => {
        const errors = {};
        if (!item.description.trim()) errors.description = 'Description is required.';
        if (item.quantity === '' || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0) errors.quantity = 'Quantity must be greater than zero.';
        if (item.unit_price === '' || !Number.isFinite(Number(item.unit_price)) || Number(item.unit_price) < 0) errors.unit_price = 'Enter a non-negative unit price.';
        if (Object.keys(errors).length) {
            itemErrors.set(index, errors);
            messages.push(...Object.values(errors))
        }
    });
    const c = calculate();
    if (!Number.isFinite(Number(p.discount)) || Number(p.discount) < 0) addFieldError('discount', 'Discount cannot be negative.');
    if (!Number.isFinite(Number(p.tax_rate)) || Number(p.tax_rate) < 0 || Number(p.tax_rate) > 100) addFieldError('taxRate', 'Tax rate must be between 0 and 100%.');
    if (Number(p.discount) > c.subtotal) addFieldError('discount', 'Discount cannot exceed the subtotal.');

    if (validationAttempted) {
        fieldErrors.forEach((message, id) => setInlineError($(id), message));
        itemErrors.forEach((errors, index) => Object.entries(errors).forEach(([key, message]) => {
            const control = document.querySelector(`[data-item="${index}"][data-key="${key}"]`);
            setInlineError(control, message, `item-${index}-${key}-error`)
        }));
        if (showFeedback && messages.length) {
            const first = document.querySelector('.input-invalid');
            first?.focus();
            first?.scrollIntoView({behavior: 'smooth', block: 'center'})
        }
    }
    return messages.length === 0;
}

function calculate() {
    const lineTotals = items.map(i => Math.round((Math.max(0, Number(i.quantity) || 0) * Math.max(0, Number(i.unit_price) || 0) + Number.EPSILON) * 100) / 100);
    const subtotal = Math.round((lineTotals.reduce((a, b) => a + b, 0) + Number.EPSILON) * 100) / 100,
        discount = Math.max(0, Number($('discount').value) || 0),
        rate = Math.max(0, Number($('taxRate').value) || 0),
        base = Math.max(0, subtotal - discount),
        tax = Math.round((base * rate / 100 + Number.EPSILON) * 100) / 100,
        total = Math.round((base + tax + Number.EPSILON) * 100) / 100;
    return {
        lineTotals,
        subtotal,
        discount,
        rate,
        tax,
        total
    }
}

function renderItems() {
    $('lineItems').innerHTML = items.map((i, n) => `<tr><td><input class="desc" data-item="${n}" data-key="description" aria-label="Item ${n+1} description" value="${esc(i.description)}" placeholder="What did you do?"></td><td><input class="qty" data-item="${n}" data-key="quantity" aria-label="Item ${n+1} quantity" type="number" min="0.0001" step="any" value="${esc(i.quantity)}"></td><td><input class="price" data-item="${n}" data-key="unit_price" aria-label="Item ${n+1} unit price" type="number" min="0" step=".01" value="${esc(i.unit_price)}"></td><td class="amount" id="lineAmount${n}">${money(Math.round((Math.max(0,Number(i.quantity)||0)*Math.max(0,Number(i.unit_price)||0)+Number.EPSILON)*100)/100)}</td><td><button class="remove-line" data-remove="${n}" aria-label="Remove item ${n+1}">×</button></td></tr>`).join('');
    $('itemCount').textContent = `${items.length} ITEM${items.length===1?'':'S'}`
}

function renderCustom() {
    $('customFields').innerHTML = custom.map((f, n) => `<div class="custom-row"><input type="text" data-custom="${n}" data-key="label" aria-label="Custom field ${n+1} label" value="${esc(f.label)}" placeholder="Field label"><input type="text" data-custom="${n}" data-key="value" aria-label="Custom field ${n+1} value" value="${esc(f.value)}" placeholder="Field value"><label class="check-label"><input type="checkbox" data-custom="${n}" data-key="visible" ${f.visible?'checked':''}> Show</label><button class="remove-line" data-custom-remove="${n}" aria-label="Remove custom field ${n+1}">×</button></div>`).join('')
}

function render() {
    const c = calculate(), business = $('businessName').value.trim() || 'Your business';
    $('businessLabel').textContent = business;
    $('logoLetter').textContent = business[0].toUpperCase();
    $('editSubtotal').textContent = money(c.subtotal);
    $('editDiscount').textContent = '-' + money(c.discount);
    $('editTax').textContent = money(c.tax);
    $('editGrand').textContent = money(c.total);
    // Pass a snapshot into Vue so the printable preview mirrors the editor state.
    window.invoicePreview.sync({
        business,
        businessEmail: $('businessEmail').value.trim(),
        businessAddress: $('businessAddress').value,
        number: $('invoiceNumber').value.trim(),
        client: $('clientName').value.trim(),
        clientEmail: $('clientEmail').value.trim(),
        clientAddress: $('clientAddress').value,
        issue: fmtDate($('issueDate').value),
        due: fmtDate($('dueDate').value),
        notes: $('notes').value,
        items: items.map(item => ({...item})),
        customFields: custom.map(field => ({...field})),
        calculation: c
    });
    validateClient()
}

function fill(data) {
    invoiceId = data.id || null;
    invoiceStatus = String(data.status || 'Draft').trim();
    for (const key of ['invoice_number', 'business_name', 'business_email', 'business_address', 'client_name', 'client_email', 'client_address', 'issue_date', 'due_date', 'notes', 'discount', 'tax_rate']) {
        const id = ({
            invoice_number: 'invoiceNumber',
            business_name: 'businessName',
            business_email: 'businessEmail',
            business_address: 'businessAddress',
            client_name: 'clientName',
            client_email: 'clientEmail',
            client_address: 'clientAddress',
            issue_date: 'issueDate',
            due_date: 'dueDate',
            discount: 'discount',
            tax_rate: 'taxRate',
            notes: 'notes'
        })[key];
        if (data[key] !== undefined) $(id).value = data[key]
    }
    if (data.client_email) $('emailTo').value = data.client_email;
    items = (data.items || []).map(i => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: i.unit_price
    }));
    custom = data.custom_fields || [];
    renderItems();
    renderCustom();
    render();
    const paid = !!invoiceId && invoiceStatus.toLowerCase() === 'paid';
    $('pageTitle').textContent = paid ? 'Paid invoice' : invoiceId ? 'Edit invoice' : 'Create an invoice';
    $('saveStatus').textContent = paid ? '● Paid · read only' : invoiceId ? `● Invoice #${invoiceId}` : '● New invoice';
    document.querySelector('.page-heading p').textContent = paid ? 'This paid invoice is read-only. You can send its receipt or print a PDF.' : 'Make it yours. Preview updates as you edit.';
    $('invoiceStage').textContent = paid ? 'Paid · USD · Read only' : `${invoiceStatus} · USD`;
    $('invoiceStage').classList.toggle('paid-stage', paid);
    document.querySelectorAll('.editor input,.editor textarea,.editor select,.editor button').forEach(el => {
        if (!['emailTo', 'emailBtn'].includes(el.id)) el.disabled = paid
    });
    $('saveBtn').disabled = paid;
    $('saveBtn').classList.toggle('hidden', paid);
    $('previewSaveBtn').disabled = paid;
    $('previewSaveBtn').classList.toggle('hidden', paid);
    $('emailBtn').textContent = paid ? '✉ Send receipt' : '✉ Send invoice email';
    $('emailTo').readOnly = false
}

function showSaveError(message) {
    validationAttempted = true;
    const fields = [
        ['invoice number', 'invoiceNumber'], ['client email', 'clientEmail'],
        ['business email', 'businessEmail'], ['business name', 'businessName'],
        ['client name', 'clientName'], ['issue date', 'issueDate'],
        ['due date', 'dueDate'], ['discount', 'discount'], ['tax', 'taxRate']
    ];
    const text = String(message).toLowerCase();
    const match = fields.find(([term]) => text.includes(term));
    clearInlineErrors();
    const key = /description/.test(text) ? 'description' : /quantity/.test(text) ? 'quantity' : /unit price|price/.test(text) ? 'unit_price' : null;
    const target = match ? $(match[1]) : key ? document.querySelector(`[data-item][data-key="${key}"]`) : null;
    if (target) {
        setInlineError(target, message);
        target.focus();
        target.scrollIntoView({behavior: 'smooth', block: 'center'})
    }
}
async function save() {
    if (invoiceId && invoiceStatus.toLowerCase() === 'paid') {
        toast('Paid invoices are read-only.');
        return null
    }
    if (!validateClient(true)) return;
    try {
        const payload = getForm();
        const result = await api(invoiceId ? `/api/invoices/${invoiceId}` : '/api/invoices', {
            method: invoiceId ? 'PUT' : 'POST',
            body: JSON.stringify(payload)
        });
        fill(result);
        $('saveStatus').textContent = '● Saved to database';
        toast('Invoice saved to the database.');
        return result
    } catch (e) {
        showSaveError(e.message);
        return null
    }
}
document.addEventListener('input', e => {
    const el = e.target;
    if (el.matches('[data-item]')) {
        const i = Number(el.dataset.item),
            k = el.dataset.key;
        items[i][k] = el.value;
        const amt = $('lineAmount' + i);
        if (amt) amt.textContent = money(Math.round((Math.max(0, Number(items[i].quantity) || 0) * Math.max(0, Number(items[i].unit_price) || 0) + Number.EPSILON) * 100) / 100);
        render()
    } else if (el.matches('[data-custom]')) {
        const i = Number(el.dataset.custom),
            k = el.dataset.key;
        custom[i][k] = k === 'visible' ? el.checked : el.value;
        render()
    } else if (el.matches('input,textarea')) render()
});
document.addEventListener('change', e => {
    const el = e.target;
    if (el.matches('[data-custom][type=checkbox]')) {
        custom[Number(el.dataset.custom)].visible = el.checked;
        render()
    }
});
document.addEventListener('click', e => {
    const r = e.target.closest('[data-remove]');
    if (r) {
        items.splice(Number(r.dataset.remove), 1);
        renderItems();
        render()
    }
    const c = e.target.closest('[data-custom-remove]');
    if (c) {
        custom.splice(Number(c.dataset.customRemove), 1);
        renderCustom();
        render()
    }
});
$('addItemBtn').addEventListener('click', () => {
    items.push({
        description: '',
        quantity: 1,
        unit_price: 0
    });
    renderItems();
    render();
    $('lineItems').lastElementChild?.querySelector('input')?.focus()
});
$('addCustomBtn').addEventListener('click', () => {
    custom.push({
        label: '',
        value: '',
        visible: true
    });
    renderCustom();
    render();
    $('customFields').lastElementChild?.querySelector('input')?.focus()
});
$('saveBtn').addEventListener('click', save);
$('previewSaveBtn').addEventListener('click', save);
$('printBtn').addEventListener('click', () => {
    if (validateClient(true)) window.print()
});
$('emailBtn').addEventListener('click', async () => {
    const to = $('emailTo').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        $('emailHint').textContent = 'Enter a valid recipient email address.';
        toast('Enter a valid recipient email address.');
        $('emailTo').focus();
        return
    }
    const inv = invoiceStatus === 'Paid' && invoiceId ? {
        id: invoiceId
    } : await save();
    if (!inv) return;
    try {
        const res = await api(`/api/invoices/${inv.id}/email`, {
            method: 'POST',
            body: JSON.stringify({
                to
            })
        });
        $('emailHint').textContent = res.message;
        toast(res.message);
        if (invoiceStatus !== 'Paid') $('saveStatus').textContent = '● Sent'
    } catch (e) {
        $('emailHint').textContent = e.message;
        toast(e.message)
    }
});
document.querySelectorAll('input[type=number]').forEach(el => el.addEventListener('blur', () => {
    if (el.value !== '' && Number(el.value) < 0) {
        el.value = 0;
        render();
        toast('Negative values are not allowed.')
    }
}));
async function init() {
    const params = new URLSearchParams(location.search),
        id = params.get('id');
    try {
        if (id) {
            $('saveBtn').classList.add('hidden');
            $('previewSaveBtn').classList.add('hidden');
            $('saveBtn').disabled = true;
            $('previewSaveBtn').disabled = true;
            fill(await api(`/api/invoices/${id}`));
            return
        }
        const settings = JSON.parse(localStorage.getItem('forma-settings') || '{}');
        if (settings.business_name) $('businessName').value = settings.business_name;
        if (settings.business_email) $('businessEmail').value = settings.business_email;
        if (settings.business_address) $('businessAddress').value = settings.business_address;
        if (settings.tax_rate !== undefined) $('taxRate').value = settings.tax_rate;
        const clientEmail = params.get('client');
        if (clientEmail) {
            try {
                const all = await api('/api/invoices');
                const match = all.find(i => i.client_email === clientEmail);
                if (match) {
                    $('clientName').value = match.client_name;
                    $('clientEmail').value = match.client_email;
                    $('clientAddress').value = match.client_address
                }
            } catch {}
        }
        const now = new Date();
        $('issueDate').value = dateInput(now);
        const due = new Date(now);
        due.setDate(due.getDate() + 14);
        $('dueDate').value = dateInput(due);
        $('invoiceNumber').value = `INV-${now.getFullYear()}-${String(Date.now()).slice(-5)}`;
        items = [{
            description: '',
            quantity: 1,
            unit_price: 0
        }];
        renderItems();
        renderCustom();
        render()
    } catch (e) {
        toast(e.message)
    }
}
init();
