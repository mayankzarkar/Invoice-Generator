const { $, money, escapeHTML: esc, formatDate: fmt, toast, api } = window.Forma;
const { createApp } = Vue;

function badge(s) {
    return `<span class="status-pill status-${esc(s).toLowerCase()}">${esc(s)}</span>`
}

function row(i, idx, compact = false) {
    const statuses = ['Draft', 'Sent', 'Paid', 'Overdue'];
    if (compact) return `<tr class="invoice-row-clickable" data-open="${i.id}"><td class="invoice-id">${esc(i.invoice_number)}</td><td><div class="client-name">${esc(i.client_name)}</div><div class="client-email">${esc(i.client_email)}</div></td><td>${fmt(i.due_date)}</td><td>${badge(i.status)}</td><td class="amount-cell">${money(i.total)}</td></tr>`;
    return `<tr><td>${esc(i.invoice_number)}<div style="font-size:10px;color:#8a968e;margin-top:3px">#${i.id}</div></td><td>${esc(i.client_name)}<div style="font-size:10px;color:#8a968e;margin-top:3px">${esc(i.client_email)}</div></td><td>${fmt(i.issue_date)}</td>${compact?'':`<td>${fmt(i.due_date)}</td>`}<td>${badge(i.status)}</td><td class="amount-cell">${money(i.total)}</td><td><div class="row-actions"><button data-open="${i.id}">Open</button><label class="status-action"><span class="sr-only">Change status for ${esc(i.invoice_number)}</span><select data-status="${i.id}" aria-label="Change status for invoice ${esc(i.invoice_number)}" title="${i.status==='Paid'?'Paid invoices are locked':'Choose a new invoice status'}"${i.status==='Paid'?' disabled':''}>${statuses.map(s=>`<option${s===i.status?' selected':''}>${s}</option>`).join('')}</select></label><button data-delete="${i.id}" aria-label="Delete invoice ${esc(i.invoice_number)}">Delete</button></div></td></tr>`
}
let all = [];
// Dashboard summaries and the SVG chart are reactive Vue views over API data.
const dashboardApp = createApp({
    data: () => ({ invoices: [], search: '', recentStatus: 'all', range: '6' }),
    computed: {
        totalInvoiced() { return this.invoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0) },
        awaitingInvoices() { return this.invoices.filter(invoice => ['Sent', 'Overdue'].includes(invoice.status)) },
        outstandingTotal() { return this.awaitingInvoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0) },
        paidInvoices() { return this.invoices.filter(invoice => invoice.status === 'Paid') },
        paidTotal() { return this.paidInvoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0) },
        overdueInvoices() { return this.invoices.filter(invoice => invoice.status === 'Overdue') },
        overdueTotal() { return this.overdueInvoices.reduce((sum, invoice) => sum + (Number(invoice.total) || 0), 0) },
        recentInvoices() {
            const query = this.search.trim().toLowerCase();
            return this.invoices.filter(invoice =>
                `${invoice.invoice_number} ${invoice.client_name} ${invoice.client_email}`.toLowerCase().includes(query) &&
                (this.recentStatus === 'all' || invoice.status === this.recentStatus)
            ).slice(0, 5)
        },
        recentActivity() {
            return [...this.invoices].sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at))).slice(0, 3)
        },
        revenueMonths() {
            const count = Number(this.range), now = new Date();
            const months = Array.from({length: count}, (_, index) => {
                const date = new Date(now.getFullYear(), now.getMonth() - count + index + 1, 1);
                return {date, key: `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}`, label: date.toLocaleDateString('en-US', {month:'short'}), value: 0}
            });
            const buckets = new Map(months.map(month => [month.key, month]));
            this.invoices.forEach(invoice => {
                const date = new Date(`${invoice.issue_date}T12:00:00`);
                const month = buckets.get(`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2, '0')}`);
                if (month && !Number.isNaN(date.getTime())) month.value += Number(invoice.total) || 0
            });
            return months
        },
        revenueTotal() { return this.revenueMonths.reduce((sum, month) => sum + month.value, 0) },
        revenueLine() {
            const months = this.revenueMonths, max = Math.max(1, ...months.map(month => month.value));
            return months.map((month, index) => `${index ? 'L' : 'M'}${index * 360 / (months.length - 1)},${112 - month.value / max * 98}`).join(' ')
        },
        revenueArea() { return `${this.revenueLine} L360,126 L0,126 Z` }
    },
    methods: {
        money,
        formatDate: fmt,
        activityVerb(invoice) { return invoice.status === 'Paid' ? 'marked paid' : invoice.status === 'Sent' ? 'sent to client' : `updated · ${invoice.status}` },
        activityTime(invoice) {
            const stamp = invoice.updated_at || invoice.created_at;
            return stamp ? new Date(stamp).toLocaleString('en-US', {month:'short', day:'numeric', hour:'numeric', minute:'2-digit'}) : ''
        }
    }
}).mount('#dashboardView');

async function loadInvoices() {
    try {
        all = await api('/api/invoices');
        dashboardApp.invoices = all;
        $('apiStatus').textContent = '● API connected';
        $('navInvoiceCount').textContent = all.length;
        render()
    } catch (e) {
        $('apiStatus').textContent = '● API unavailable';
        toast(e.message)
    }
}

function render() {
    const clients = uniqueClients();
    const q = ($('invoiceSearch')?.value || '').toLowerCase(),
        st = $('statusFilter')?.value || 'all';
    const filtered = all.filter(i => `${i.invoice_number} ${i.client_name} ${i.client_email}`.toLowerCase().includes(q) && (st === 'all' || i.status === st));
    $('allInvoices').innerHTML = filtered.map(i => row(i, i.id, false)).join('');
    $('invoiceEmpty').classList.toggle('hidden', filtered.length > 0);
    const cq = ($('clientSearch')?.value || '').toLowerCase(),
        cs = clients.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(cq));
    $('clientCountLabel').textContent = `${cs.length} client${cs.length===1?'':'s'}`;
    $('clientGrid').innerHTML = cs.map(c => `<article class="client-card"><div class="client-top"><div class="client-avatar">${esc((c.name[0]||'?').toUpperCase())}</div><div><strong>${esc(c.name)}</strong><span>${esc(c.email)}</span></div></div><div class="client-meta">${esc(c.address||'No billing address')}</div><div class="client-total"><span>${c.count} invoice${c.count===1?'':'s'}</span><strong>${money(c.total)}</strong></div><a class="text-link" href="/invoice?client=${encodeURIComponent(c.email)}" style="display:inline-block;margin-top:10px">Create invoice for client →</a></article>`).join('');
    $('clientsEmpty').classList.toggle('hidden', cs.length > 0);
}

function uniqueClients() {
    const map = new Map();
    all.forEach(i => {
        const key = (i.client_email || i.client_name).toLowerCase();
        if (!map.has(key)) map.set(key, {
            name: i.client_name,
            email: i.client_email,
            address: i.client_address,
            count: 0,
            total: 0
        });
        const c = map.get(key);
        c.count++;
        c.total += Number(i.total) || 0;
        if (!c.address) c.address = i.client_address
    });
    return [...map.values()]
}

function route() {
    const hash = location.hash.slice(1) || 'dashboard';
    const valid = ['dashboard', 'invoices', 'clients', 'settings'];
    const name = valid.includes(hash) ? hash : 'dashboard';
    document.querySelectorAll('.admin-main > section').forEach(s => s.classList.add('hidden'));
    $(name + 'View').classList.remove('hidden');
    $('crumbCurrent').textContent = ({dashboard: 'Overview', invoices: 'Invoices', clients: 'Clients', settings: 'Settings'})[name];
    document.querySelectorAll('.nav-item').forEach(a => a.classList.toggle('active', a.getAttribute('href') === (name === 'dashboard' ? '/' : '#' + name)));
    if (name === 'settings') loadSettings()
}
async function loadSettings() {
    try {
        const s = JSON.parse(localStorage.getItem('forma-settings') || '{}');
        $('settingName').value = s.business_name || '';
        $('settingEmail').value = s.business_email || '';
        $('settingAddress').value = s.business_address || '';
        $('settingTax').value = s.tax_rate ?? 10
    } catch {}
}
document.addEventListener('click', async e => {
    const open = e.target.closest('[data-open]');
    if (open) {
        location.href = '/invoice?id=' + open.dataset.open;
        return
    }
    const del = e.target.closest('[data-delete]');
    if (del) {
        const inv = all.find(i => i.id === Number(del.dataset.delete));
        if (!inv || !confirm(`Delete invoice ${inv.invoice_number}? This cannot be undone.`)) return;
        try {
            await api(`/api/invoices/${inv.id}`, {
                method: 'DELETE'
            });
            toast('Invoice deleted.');
            await loadInvoices()
        } catch (err) {
            toast(err.message)
        }
    }
});
document.addEventListener('change', async e => {
    const status = e.target.closest('[data-status]');
    if (!status) return;
    const inv = all.find(i => i.id === Number(status.dataset.status));
    if (!inv) return;
    const next = status.value;
    if (next === inv.status) return;
    status.disabled = true;
    try {
        await api(`/api/invoices/${inv.id}/status`, {
            method: 'PATCH',
            body: JSON.stringify({
                status: next
            })
        });
        toast(`${inv.invoice_number} marked ${next}.`);
        await loadInvoices()
    } catch (err) {
        status.value = inv.status;
        toast(err.message)
    } finally {
        status.disabled = false
    }
});
$('invoiceSearch').addEventListener('input', render);
$('statusFilter').addEventListener('change', render);
$('clientSearch').addEventListener('input', render);
$('saveSettings').addEventListener('click', () => {
    const data = {
        business_name: $('settingName').value.trim(),
        business_email: $('settingEmail').value.trim(),
        business_address: $('settingAddress').value,
        tax_rate: Number($('settingTax').value) || 0
    };
    if (!data.business_name) {
        $('settingsMessage').textContent = 'Business name is required.';
        return
    }
    localStorage.setItem('forma-settings', JSON.stringify(data));
    $('settingsMessage').textContent = 'Profile saved in this browser. The invoice editor can use these defaults.';
    toast('Business profile saved.')
});
$('saveTax').addEventListener('click', () => {
    const n = Number($('settingTax').value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
        $('taxMessage').textContent = 'Enter a tax rate from 0 to 100.';
        return
    }
    const s = JSON.parse(localStorage.getItem('forma-settings') || '{}');
    s.tax_rate = n;
    localStorage.setItem('forma-settings', JSON.stringify(s));
    $('taxMessage').textContent = 'Default tax rate saved.';
    toast('Tax default saved.')
});
window.addEventListener('hashchange', route);
route();
loadInvoices();
