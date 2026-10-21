/* Small browser utilities shared by the admin dashboard and invoice editor. */
(() => {
    let toastTimer;

    const $ = id => document.getElementById(id);
    const money = value => new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(Number(value) || 0);
    const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    }[char]));
    const formatDate = value => {
        if (!value) return '—';
        const date = new Date(`${value}T12:00:00`);
        return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString('en-US', {
            month: 'short',
            day: '2-digit',
            year: 'numeric'
        });
    };

    function toast(message, isError = false) {
        const element = $('toast');
        if (!element) return;
        element.textContent = message;
        element.classList.toggle('toast-error', isError);
        element.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => element.classList.remove('show'), 4000);
    }

    async function api(url, options = {}) {
        const response = await fetch(url, {
            headers: {'Content-Type': 'application/json', ...(options.headers || {})},
            ...options
        });
        if (!response.ok) {
            let data = {};
            try { data = await response.json() } catch {}
            const detail = Array.isArray(data.detail)
                ? data.detail.map(issue => issue.msg).join(', ')
                : data.detail;
            throw new Error(detail || `Request failed (${response.status})`);
        }
        if (response.status === 204) return null;
        return response.json();
    }

    window.Forma = Object.freeze({$, money, escapeHTML, formatDate, toast, api});
})();
