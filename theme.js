/* ==========================================================
   ScriptBase | theme.js
   Tema Claro / Auto / Escuro. A preferência fica salva no
   navegador (chave sb-theme). Carregado no <head> para o tema
   ser aplicado antes da tela aparecer.
   ========================================================== */
(() => {
    'use strict';

    const KEY = 'sb-theme';
    const VALID = ['light', 'system', 'dark'];

    function read() {
        try {
            const v = localStorage.getItem(KEY);
            return VALID.includes(v) ? v : 'system';
        } catch (_) {
            return 'system';
        }
    }

    function apply(theme) {
        const root = document.documentElement;
        if (theme === 'light' || theme === 'dark') root.setAttribute('data-theme', theme);
        else root.removeAttribute('data-theme');
    }

    function mark(theme) {
        document.querySelectorAll('.seg button[data-t]').forEach((b) => {
            b.setAttribute('aria-pressed', String(b.dataset.t === theme));
        });
    }

    function set(theme) {
        apply(theme);
        mark(theme);
        try { localStorage.setItem(KEY, theme); } catch (_) { /* ignora */ }
    }

    apply(read());

    document.addEventListener('DOMContentLoaded', () => {
        mark(read());
        const seg = document.querySelector('.seg');
        if (!seg) return;
        seg.addEventListener('click', (e) => {
            const b = e.target.closest('button[data-t]');
            if (b) set(b.dataset.t);
        });
    });
})();
