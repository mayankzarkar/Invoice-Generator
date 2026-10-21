// Vue owns the invoice preview; the editor remains connected through sync().
const invoicePreviewApp = Vue.createApp({
    data: () => ({
        preview: {
            business: 'Your business', businessEmail: '', businessAddress: '', number: '',
            client: '', clientEmail: '', clientAddress: '', issue: '?', due: '?', notes: '',
            items: [], customFields: [], calculation: {lineTotals: [], subtotal: 0, discount: 0, rate: 0, tax: 0, total: 0}
        }
    }),
    methods: {
        formatMoney(value) { return window.Forma.money(value); },
        sync(data) { this.preview = data; }
    }
}).mount('#invoicePaper');
window.invoicePreview = invoicePreviewApp;
