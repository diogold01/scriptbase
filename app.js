/* ==========================================================
   ScriptBase | app.js
   Interface: login/visitante, cards, busca, filtros, editor,
   variáveis ao copiar, diagnóstico e sugestão com IA.
   Segurança: nada vindo do usuário entra via innerHTML.
   Tudo é montado com textContent/DOM. A única exceção é a
   saída do Prism, que já escapa o HTML.
   ========================================================== */
(() => {
    'use strict';

    const DEFAULT_TAGS = ['Fiscal', 'Estoque', 'Financeiro', 'Vendas', 'NFe/NFCe', 'Banco de Dados', 'Geral'];
    const $ = (id) => document.getElementById(id);

    const state = {
        mode: null,
        scripts: [],
        filterTag: 'Todas',
        search: '',
        sort: 'recent',
        extraTags: new Set(), // tags criadas nesta sessão, ainda não usadas em nenhum script
        editor: { id: '', favorite: false, tags: [], image: '', logs: [], createdAt: '', useCount: 0, snapshot: '' },
        vars: { code: '', names: [], scriptId: null }
    };

    /* ==========================================================
       UTILITÁRIOS
       ========================================================== */
    function el(tag, props = {}, ...children) {
        const node = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (v === null || v === undefined || v === false) continue;
            if (k === 'class') node.className = v;
            else if (k === 'text') node.textContent = v;
            else if (k === 'dataset') Object.assign(node.dataset, v);
            else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
            else node.setAttribute(k, v === true ? '' : v);
        }
        children.flat().forEach((c) => {
            if (c !== null && c !== undefined && c !== false) node.append(c);
        });
        return node;
    }

    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Ícone de linha vindo do sprite no index.html (sem innerHTML)
    function icon(name) {
        const NS = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(NS, 'svg');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        const use = document.createElementNS(NS, 'use');
        use.setAttribute('href', '#i-' + name);
        svg.append(use);
        return svg;
    }
    const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const formatDate = (iso) => new Date(iso).toLocaleDateString('pt-BR');
    const formatDateTime = (iso) => new Date(iso).toLocaleString('pt-BR');

    function highlightSql(code) {
        if (window.Prism && Prism.languages && Prism.languages.sql) {
            try {
                return Prism.highlight(code, Prism.languages.sql, 'sql');
            } catch (_) { /* cai no texto simples */ }
        }
        return escapeHtml(code);
    }

    let toastTimer;
    function toast(msg, type = 'ok') {
        const t = $('toast');
        t.textContent = msg;
        t.className = type === 'error' ? 'error' : '';
        void t.offsetWidth;
        t.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
    }

    function setStatus(node, msg, isError = false) {
        node.textContent = msg;
        node.classList.toggle('error', !!isError);
    }

    const Session = {
        get() { try { return sessionStorage.getItem('scriptbase_mode'); } catch (_) { return null; } },
        set(m) { try { sessionStorage.setItem('scriptbase_mode', m); } catch (_) { /* ignora */ } },
        clear() { try { sessionStorage.removeItem('scriptbase_mode'); } catch (_) { /* ignora */ } }
    };

    /* ---------- área de transferência ---------- */
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        } catch (_) { /* tenta o método antigo */ }
        try {
            const ta = el('textarea', { style: 'position:fixed;opacity:0;top:0;left:0' });
            ta.value = text;
            document.body.append(ta);
            ta.select();
            const ok = document.execCommand('copy');
            ta.remove();
            return ok;
        } catch (_) {
            return false;
        }
    }

    /* ==========================================================
       SQL: variáveis e riscos
       ========================================================== */
    // @VAR, {VAR} e [VAR] (colchetes só em MAIÚSCULAS, para não confundir com [dbo].[Tabela]); ignora @@
    const varRegex = () => /(?<![@\w])@[A-Za-z_]\w*|\{[A-Za-z_]\w*\}|\[[A-Z][A-Z0-9_]*\]/g;

    function findVariables(code) {
        return [...new Set(code.match(varRegex()) || [])];
    }

    function applyVars(code, values) {
        // Uma passada só: evita que @ID quebre @ID_CLIENTE
        return code.replace(varRegex(), (m) => (values[m] ? values[m] : m));
    }

    function stripSql(code) {
        return code
            .replace(/\/\*[\s\S]*?\*\//g, ' ')
            .replace(/--[^\n]*/g, ' ')
            .replace(/'(?:[^']|'')*'/g, "''");
    }

    // Heurística simples. Não é um parser, serve como alerta
    function detectRisks(code) {
        const clean = stripSql(code);
        const risks = [];

        const semWhere = clean.split(';').some((st) => {
            const t = st.trim();
            return /^(delete\s+from|update)\b/i.test(t) && !/\bwhere\b/i.test(t);
        });
        if (semWhere) risks.push('DELETE/UPDATE sem WHERE afeta todas as linhas da tabela.');
        if (/\bdrop\s+(table|database|schema|view|index|procedure|trigger|column)\b/i.test(clean) ||
            /\balter\s+table\s+\S+\s+drop\b/i.test(clean)) {
            risks.push('Contém DROP: remove objetos ou colunas de forma definitiva.');
        }
        if (/\btruncate\b/i.test(clean)) risks.push('Contém TRUNCATE: apaga todos os dados da tabela.');
        return risks;
    }

    /* ==========================================================
       TAGS
       ========================================================== */
    function usedTags() {
        const set = new Set();
        state.scripts.forEach((s) => s.tags.forEach((t) => set.add(t)));
        return set;
    }

    function filterTags() {
        const list = [...DEFAULT_TAGS];
        [...usedTags()]
            .filter((t) => !DEFAULT_TAGS.includes(t))
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
            .forEach((t) => list.push(t));
        return list;
    }

    function editorTags() {
        const list = filterTags();
        [...state.extraTags, ...state.editor.tags].forEach((t) => {
            if (!list.includes(t)) list.push(t);
        });
        return list;
    }

    function renderFilterBar() {
        const tags = ['Todas', ...filterTags()];
        if (!tags.includes(state.filterTag)) state.filterTag = 'Todas';
        const bar = $('tagsFilterBar');
        bar.replaceChildren(
            ...tags.map((t) =>
                el('button', {
                    type: 'button',
                    class: 'tag-chip' + (t === state.filterTag ? ' active' : ''),
                    dataset: { tag: t },
                    text: t,
                    onclick: () => {
                        state.filterTag = t;
                        renderFilterBar();
                        renderCards();
                    }
                })
            )
        );
    }

    function renderEditorTags() {
        $('tagsSelector').replaceChildren(
            ...editorTags().map((t) =>
                el('span', {
                    class: 'tag-pill' + (state.editor.tags.includes(t) ? ' active' : ''),
                    role: 'button',
                    tabindex: '0',
                    text: t,
                    onclick: () => toggleEditorTag(t),
                    onkeydown: (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleEditorTag(t);
                        }
                    }
                })
            )
        );
    }

    function toggleEditorTag(tag) {
        const tags = state.editor.tags;
        const i = tags.indexOf(tag);
        if (i >= 0) tags.splice(i, 1);
        else tags.push(tag);
        renderEditorTags();
    }

    function registerEditorTag(raw) {
        const name = String(raw || '').trim().replace(/\s+/g, ' ').slice(0, 30);
        if (!name) return null;
        const existing = editorTags().find((t) => t.toLowerCase() === name.toLowerCase());
        const tag = existing || name;
        if (!existing) state.extraTags.add(tag);
        if (!state.editor.tags.includes(tag)) state.editor.tags.push(tag);
        return tag;
    }

    function addTagFromInput() {
        const input = $('newTagInput');
        if (registerEditorTag(input.value)) {
            input.value = '';
            renderEditorTags();
        }
    }

    /* ==========================================================
       LISTA / CARDS
       ========================================================== */
    async function refresh() {
        state.scripts = await ScriptStore.list();
        renderFilterBar();
        renderCards();
    }

    function matchesSearch(s, terms) {
        if (!terms.length) return true;
        const hay = norm([s.title, s.description, s.errorText, s.code, s.tags.join(' ')].join('\n'));
        return terms.every((t) => hay.includes(t));
    }

    function sortScripts(list) {
        return [...list].sort((a, b) => {
            if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
            if (state.sort === 'alpha') return a.title.localeCompare(b.title, 'pt-BR', { sensitivity: 'base' });
            if (state.sort === 'used' && b.useCount !== a.useCount) return b.useCount - a.useCount;
            return b.updatedAt.localeCompare(a.updatedAt);
        });
    }

    function snippet(code) {
        return code
            .split('\n')
            .slice(0, 4)
            .map((l) => (l.length > 64 ? l.slice(0, 64) + '…' : l))
            .join('\n');
    }

    function buildCard(s) {
        const risks = detectRisks(s.code);

        const card = el('div', {
            class: 'card' + (s.favorite ? ' favorite' : ''),
            tabindex: '0',
            role: 'button',
            'aria-label': 'Abrir script ' + s.title
        });

        const star = el('button', {
            class: 'btn-star',
            type: 'button',
            title: s.favorite ? 'Desafixar do topo' : 'Fixar no topo',
            'aria-label': s.favorite ? 'Desafixar do topo' : 'Fixar no topo',
            'aria-pressed': String(!!s.favorite)
        }, icon('star'));
        star.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleFavorite(s.id);
        });

        const title = el('h3', { title: s.title }, s.title || 'Sem título');
        if (s.image) title.append(el('span', { class: 'icon-image', title: 'Possui imagem' }, icon('image')));

        const tagBox = el('div', { class: 'card-tags' }, s.tags.map((t) => el('span', { text: t })));
        if (risks.length) tagBox.prepend(el('span', { class: 'badge-danger', title: risks.join(' ') }, icon('alert'), 'Destrutivo'));

        const copyBtn = el('button', { class: 'btn btn-sm btn-outline', type: 'button' }, icon('copy'), 'Copiar');
        copyBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            startCopy(s.code, s.id);
        });

        card.append(
            star,
            title,
            el('p', { class: 'card-desc', text: s.description || 'Nenhuma descrição informada.' }),
            el('div', { class: 'card-snippet', text: snippet(s.code) }),
            tagBox,
            el('div', { class: 'card-footer' }, el('span', { text: 'Atualizado: ' + formatDate(s.updatedAt) }), copyBtn)
        );

        card.addEventListener('click', () => openEditor(s.id));
        card.addEventListener('keydown', (e) => {
            if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                openEditor(s.id);
            }
        });
        return card;
    }

    function emptyState() {
        const total = state.scripts.length;
        const box = el(
            'div',
            { class: 'empty-state' },
            el('h2', { text: total ? 'Nenhum script encontrado.' : 'Sua biblioteca está vazia.' }),
            el('p', { text: total ? 'Mude o filtro ou busque outro termo.' : 'Crie o primeiro em "+ Novo Script".' })
        );
        if (!total && state.mode === 'visitor') {
            box.append(el('button', { class: 'btn btn-outline', type: 'button', text: 'Restaurar scripts de exemplo', onclick: restoreDemo }));
        }
        return box;
    }

    function renderCards() {
        const grid = $('cardsGrid');
        const terms = norm(state.search).split(/\s+/).filter(Boolean);
        const list = state.scripts.filter(
            (s) => (state.filterTag === 'Todas' || s.tags.includes(state.filterTag)) && matchesSearch(s, terms)
        );
        grid.replaceChildren();
        if (!list.length) {
            grid.append(emptyState());
            return;
        }
        sortScripts(list).forEach((s) => grid.append(buildCard(s)));
    }

    async function restoreDemo() {
        try {
            await ScriptStore.resetDemo();
            await refresh();
            toast('Scripts de exemplo restaurados.');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    async function toggleFavorite(id) {
        const s = state.scripts.find((x) => x.id === id);
        if (!s) return;
        try {
            await ScriptStore.save({ ...s, favorite: !s.favorite });
            await refresh();
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    /* ==========================================================
       COPIAR (com variáveis)
       ========================================================== */
    async function doCopy(text, scriptId, okMsg) {
        const ok = await copyText(text);
        if (!ok) {
            toast('Não foi possível copiar. Selecione o texto e copie manualmente.', 'error');
            return;
        }
        toast(okMsg || 'Código copiado!');
        if (scriptId) registerUse(scriptId);
    }

    async function registerUse(id) {
        try {
            const updated = await ScriptStore.incrementUse(id);
            const i = state.scripts.findIndex((x) => x.id === id);
            if (updated && i >= 0) state.scripts[i] = updated;
            if (state.sort === 'used') renderCards();
        } catch (_) { /* contador não é crítico */ }
    }

    function startCopy(code, scriptId) {
        if (!code || !code.trim()) {
            toast('Não há código para copiar.', 'error');
            return;
        }
        const names = findVariables(code);
        if (!names.length) {
            doCopy(code, scriptId);
            return;
        }
        openVars(code, names, scriptId);
    }

    function collectVarValues() {
        const values = {};
        $('varsFields').querySelectorAll('input').forEach((i) => {
            values[i.dataset.var] = i.value;
        });
        return values;
    }

    function updateVarsPreview() {
        const out = applyVars(state.vars.code, collectVarValues());
        $('varsPreview').innerHTML = highlightSql(out);
    }

    function openVars(code, names, scriptId) {
        state.vars = { code, names, scriptId };
        const box = $('varsFields');
        box.replaceChildren(
            ...names.map((name, i) =>
                el(
                    'div',
                    { class: 'input-group' },
                    el('label', { for: 'var_' + i, text: name }),
                    el('input', {
                        type: 'text',
                        id: 'var_' + i,
                        dataset: { var: name },
                        placeholder: 'valor (use aspas se for texto)',
                        autocomplete: 'off',
                        oninput: updateVarsPreview
                    })
                )
            )
        );
        updateVarsPreview();
        openOverlay($('varsOverlay'));
        const first = box.querySelector('input');
        if (first) first.focus();
    }

    function closeVars() {
        closeOverlay($('varsOverlay'));
    }

    /* ==========================================================
       MODAIS (abrir/fechar)
       ========================================================== */
    function openOverlay(o) { o.classList.add('active'); }
    function closeOverlay(o) { o.classList.remove('active'); }

    function topOverlay() {
        for (const id of ['varsOverlay', 'aiOverlay', 'editorOverlay']) {
            if ($(id).classList.contains('active')) return id;
        }
        return null;
    }

    /* ==========================================================
       EDITOR
       ========================================================== */
    function captureEditor() {
        return JSON.stringify({
            title: $('scriptTitle').value,
            error: $('scriptError').value,
            desc: $('scriptDesc').value,
            code: $('scriptCode').value,
            tags: [...state.editor.tags].sort(),
            image: state.editor.image
        });
    }

    const isDirty = () => captureEditor() !== state.editor.snapshot;

    function syncCode() {
        const code = $('scriptCode').value;
        $('codeHighlight').innerHTML = highlightSql(code.endsWith('\n') ? code + ' ' : code || ' ');
        updateRiskBox(code);
    }

    function syncScroll() {
        const ta = $('scriptCode');
        const pre = ta.nextElementSibling;
        pre.scrollTop = ta.scrollTop;
        pre.scrollLeft = ta.scrollLeft;
    }

    function updateRiskBox(code) {
        const box = $('sqlWarning');
        const risks = detectRisks(code);
        box.hidden = risks.length === 0;
        if (risks.length) box.replaceChildren(el('strong', {}, icon('alert'), 'Atenção: '), risks.join(' '));
    }

    /* ---------- imagem ---------- */
    function showImagePreview() {
        $('imagePreview').src = state.editor.image;
        $('imagePreview').hidden = false;
        $('dropZoneText').hidden = true;
        $('btnRemoveImage').hidden = false;
        $('dropZone').classList.add('has-image');
    }

    function clearImageUI() {
        $('scriptImageFile').value = '';
        $('imagePreview').removeAttribute('src');
        $('imagePreview').hidden = true;
        $('dropZoneText').hidden = false;
        $('btnRemoveImage').hidden = true;
        $('dropZone').classList.remove('has-image');
    }

    function removeImage() {
        state.editor.image = '';
        clearImageUI();
    }

    function processImageFile(file) {
        if (!file || !file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const MAX_WIDTH = 800;
                const scale = img.width > MAX_WIDTH ? MAX_WIDTH / img.width : 1;
                const canvas = document.createElement('canvas');
                canvas.width = Math.round(img.width * scale);
                canvas.height = Math.round(img.height * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                state.editor.image = canvas.toDataURL('image/jpeg', 0.7);
                showImagePreview();
            };
            img.onerror = () => toast('Não foi possível ler essa imagem.', 'error');
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    /* ---------- abrir / fechar ---------- */
    function openEditor(id = null, prefill = null) {
        const existing = id ? state.scripts.find((x) => x.id === id) : null;
        if (id && !existing) return;

        const base = existing || {
            title: '', errorText: '', description: '', code: '', tags: [], favorite: false, image: '',
            logs: [], createdAt: '', useCount: 0, ...(prefill || {})
        };

        state.editor = {
            id: existing ? existing.id : '',
            favorite: !!base.favorite,
            tags: [...(base.tags || [])],
            image: base.image || '',
            logs: existing ? [...existing.logs] : [],
            createdAt: existing ? existing.createdAt : '',
            useCount: existing ? existing.useCount : 0,
            snapshot: ''
        };

        $('scriptId').value = state.editor.id;
        $('scriptTitle').value = base.title || '';
        $('scriptError').value = base.errorText || '';
        $('scriptDesc').value = base.description || '';
        $('scriptCode').value = base.code || '';
        $('newTagInput').value = '';
        setStatus($('aiSuggestStatus'), '');

        clearImageUI();
        if (state.editor.image) showImagePreview();

        $('editorTitle').textContent = existing ? 'Editando Script' : 'Novo Script';
        $('btnDelete').hidden = !existing;
        $('btnDuplicate').hidden = !existing;
        $('btnModalCopy').hidden = !existing;

        const logs = state.editor.logs;
        $('logsContainer').hidden = logs.length === 0;
        $('logsList').replaceChildren(
            ...[...logs].reverse().map((l) =>
                el('div', { class: 'log-item' }, el('span', { class: 'log-date', text: `[${formatDateTime(l.date)}]` }), ' - ' + l.msg)
            )
        );

        renderEditorTags();
        syncCode();
        // Rascunho pré-preenchido (duplicar, erro da IA) conta como alteração não salva
        state.editor.snapshot = prefill && !existing ? '__prefill__' : captureEditor();

        openOverlay($('editorOverlay'));
        $('scriptCode').scrollTop = 0;
        $('scriptTitle').focus();
    }

    function closeEditor() {
        closeOverlay($('editorOverlay'));
    }

    function requestCloseEditor() {
        if (isDirty() && !confirm('Há alterações não salvas. Deseja descartar?')) return;
        closeEditor();
    }

    /* ---------- salvar / excluir / duplicar ---------- */
    async function saveScript() {
        const title = $('scriptTitle').value.trim();
        const code = $('scriptCode').value.trim();

        if (!title || !code) {
            toast('Preencha o Título e o Script SQL.', 'error');
            (title ? $('scriptCode') : $('scriptTitle')).focus();
            return;
        }

        const now = new Date().toISOString();
        const isEdit = !!state.editor.id;
        let logs = state.editor.logs;

        if (isEdit) {
            const reason = prompt('O que você alterou? (resumo para o histórico)', '');
            if (reason === null) return;
            logs = [...logs, { date: now, msg: reason.trim() ? 'Editado: ' + reason.trim() : 'Atualização de rotina' }];
        } else {
            logs = [{ date: now, msg: 'Script criado' }];
        }

        const script = {
            id: isEdit ? state.editor.id : ScriptStore.newId(),
            title,
            errorText: $('scriptError').value.trim(),
            description: $('scriptDesc').value.trim(),
            code,
            tags: [...state.editor.tags],
            favorite: state.editor.favorite,
            useCount: state.editor.useCount,
            image: state.editor.image,
            logs: logs.slice(-50),
            createdAt: isEdit ? state.editor.createdAt : now,
            updatedAt: now
        };

        const btn = $('btnSave');
        btn.disabled = true;
        try {
            await ScriptStore.save(script);
            await refresh();
            state.editor.snapshot = captureEditor();
            closeEditor();
            toast('Script salvo.');
        } catch (e) {
            toast(e.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function deleteScript() {
        const id = state.editor.id;
        if (!id || !confirm('Tem certeza que deseja excluir este script permanentemente?')) return;
        try {
            await ScriptStore.remove(id);
            await refresh();
            closeEditor();
            toast('Script excluído.');
        } catch (e) {
            toast(e.message, 'error');
        }
    }

    function duplicateScript() {
        openEditor(null, {
            title: ($('scriptTitle').value.trim() || 'Script') + ' (cópia)',
            errorText: $('scriptError').value,
            description: $('scriptDesc').value,
            code: $('scriptCode').value,
            tags: [...state.editor.tags],
            image: state.editor.image
        });
    }

    /* ---------- sugestão com IA ---------- */
    async function aiSuggest() {
        const code = $('scriptCode').value.trim();
        const status = $('aiSuggestStatus');
        if (!code) {
            setStatus(status, 'Cole o SQL antes de pedir sugestões.', true);
            return;
        }
        const btn = $('btnAiSuggest');
        btn.disabled = true;
        setStatus(status, 'Analisando…');
        try {
            const r = await AI.suggest(code, editorTags());
            const applied = [];

            if (r.title && !$('scriptTitle').value.trim()) {
                $('scriptTitle').value = r.title;
                applied.push('título');
            }
            if (r.description && !$('scriptDesc').value.trim()) {
                $('scriptDesc').value = r.description;
                applied.push('descrição');
            }
            const before = state.editor.tags.length;
            (r.tags || []).forEach(registerEditorTag);
            if (state.editor.tags.length > before) applied.push('tags');
            renderEditorTags();

            const origin = r.source === 'ai' ? 'com IA' : 'modo local, sem IA';
            setStatus(status, (applied.length ? 'Preenchido: ' + applied.join(', ') : 'Nada novo para preencher') + ` (${origin}).`);
        } catch (e) {
            setStatus(status, 'Falha: ' + e.message, true);
        } finally {
            btn.disabled = false;
        }
    }

    /* ==========================================================
       DIAGNÓSTICO DE ERRO COM IA
       ========================================================== */
    function openAi() {
        $('aiResult').hidden = true;
        $('aiResult').replaceChildren();
        setStatus($('aiRunStatus'), '');
        openOverlay($('aiOverlay'));
        $('aiErrorInput').focus();
    }

    function closeAi() {
        closeOverlay($('aiOverlay'));
    }

    function renderDiagnosis(result, errorText) {
        const box = $('aiResult');
        box.replaceChildren();

        if (result.summary) box.append(el('div', { class: 'ai-summary', text: result.summary }));

        result.matches.forEach((m) => {
            const s = state.scripts.find((x) => x.id === m.id);
            if (!s) return;

            const pct = Math.round(m.confidence * 100);
            const level = m.confidence >= 0.7 ? '' : m.confidence >= 0.4 ? ' mid' : ' low';

            const openBtn = el('button', { class: 'btn btn-sm btn-outline', type: 'button', text: 'Abrir' });
            const copyBtn = el('button', { class: 'btn btn-sm btn-outline', type: 'button' }, icon('copy'), 'Copiar');

            const openIt = () => {
                closeAi();
                openEditor(s.id);
            };
            openBtn.addEventListener('click', (e) => { e.stopPropagation(); openIt(); });
            copyBtn.addEventListener('click', (e) => { e.stopPropagation(); startCopy(s.code, s.id); });

            const cand = el(
                'div',
                { class: 'ai-candidate', tabindex: '0' },
                el('h4', {}, el('span', { text: s.title }), el('span', { class: 'ai-confidence' + level, text: pct + '%' })),
                m.reason ? el('p', { text: m.reason }) : null,
                el('div', { class: 'ai-row' }, openBtn, copyBtn)
            );
            cand.addEventListener('click', openIt);
            box.append(cand);
        });

        if (!box.querySelector('.ai-candidate')) {
            box.append(
                el('button', {
                    class: 'btn btn-outline',
                    type: 'button',
                    onclick: () => {
                        closeAi();
                        openEditor(null, { errorText: errorText });
                    }
                }, icon('plus'), 'Cadastrar este erro como novo script')
            );
        }
        box.hidden = false;
    }

    async function runDiagnose() {
        const errorText = $('aiErrorInput').value.trim();
        const status = $('aiRunStatus');
        if (!errorText) {
            setStatus(status, 'Cole o erro primeiro.', true);
            return;
        }
        if (!state.scripts.length) {
            setStatus(status, 'Sua biblioteca está vazia. Cadastre scripts antes.', true);
            return;
        }
        const btn = $('btnAiRun');
        btn.disabled = true;
        setStatus(status, 'Analisando…');
        $('aiResult').hidden = true;
        try {
            // Só metadados: o código SQL não sai do navegador
            const metas = state.scripts.map((s) => ({
                id: s.id, title: s.title, description: s.description, errorText: s.errorText, tags: s.tags
            }));
            const r = await AI.diagnose(errorText, metas);
            renderDiagnosis(r, errorText);
            setStatus(status, r.source === 'ai' ? 'Resposta da IA.' : 'Análise local por palavras-chave (IA indisponível).');
        } catch (e) {
            setStatus(status, 'Falha: ' + e.message, true);
        } finally {
            btn.disabled = false;
        }
    }

    /* ==========================================================
       EXPORTAR / IMPORTAR
       ========================================================== */
    function exportData() {
        if (!state.scripts.length) {
            toast('Nenhum script para exportar.', 'error');
            return;
        }
        const blob = new Blob([JSON.stringify(state.scripts, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = el('a', { href: url, download: `scriptbase_backup_${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function importData(ev) {
        const input = ev.target;
        const file = input.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const json = JSON.parse(e.target.result);
                const arr = Array.isArray(json) ? json : Array.isArray(json && json.scripts) ? json.scripts : null;
                if (!arr) throw new Error('formato');
                const list = arr.map((x) => ScriptStore.normalize(x)).filter((s) => s.title && s.code);
                if (!list.length) throw new Error('vazio');
                if (!confirm(`Importar ${list.length} script(s)? Eles serão mesclados com os atuais (mesmo ID substitui).`)) return;
                await ScriptStore.upsertMany(list);
                await refresh();
                toast(`${list.length} script(s) importado(s).`);
            } catch (_) {
                toast('Arquivo inválido ou não foi possível importar.', 'error');
            } finally {
                input.value = '';
            }
        };
        reader.readAsText(file);
    }

    /* ==========================================================
       ENTRADA / SAÍDA
       ========================================================== */
    function showAuthError(msg) {
        const box = $('authError');
        box.textContent = msg;
        box.hidden = !msg;
    }

    async function startApp(mode) {
        try {
            await ScriptStore.init(mode);
        } catch (e) {
            showAuthError(e.message);
            return;
        }
        showAuthError('');
        state.mode = mode;
        Session.set(mode);

        const badge = $('userBadge');
        badge.textContent = mode === 'visitor' ? 'Visitante' : 'Conectado';
        badge.classList.toggle('owner', mode === 'owner');

        state.filterTag = 'Todas';
        state.search = '';
        $('searchInput').value = '';

        $('authScreen').hidden = true;
        $('appShell').hidden = false;
        await refresh();
    }

    async function logout() {
        try { await Auth.signOut(); } catch (_) { /* ignora */ }
        Session.clear();
        ['varsOverlay', 'aiOverlay', 'editorOverlay'].forEach((id) => closeOverlay($(id)));
        state.scripts = [];
        state.mode = null;
        $('appShell').hidden = true;
        $('authScreen').hidden = false;
        showAuthError('');
    }

    /* ==========================================================
       EVENTOS
       ========================================================== */
    function isTyping(target) {
        return target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable);
    }

    function bind() {
        // Entrada
        $('btnVisitor').addEventListener('click', () => startApp('visitor'));
        $('loginForm').addEventListener('submit', async (e) => {
            e.preventDefault();
            showAuthError('');
            try {
                await Auth.signIn($('loginEmail').value.trim(), $('loginPassword').value);
                await startApp('owner');
            } catch (err) {
                showAuthError(err.message);
            }
        });
        $('btnLogout').addEventListener('click', logout);

        // Topo e filtros
        let searchTimer;
        $('searchInput').addEventListener('input', (e) => {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => {
                state.search = e.target.value;
                renderCards();
            }, 120);
        });
        $('sortSelect').addEventListener('change', (e) => {
            state.sort = e.target.value;
            renderCards();
        });
        $('btnNew').addEventListener('click', () => openEditor());
        $('btnExport').addEventListener('click', exportData);
        $('btnImport').addEventListener('click', () => $('importFile').click());
        $('importFile').addEventListener('change', importData);
        $('btnAiDiagnose').addEventListener('click', openAi);

        // Editor
        $('btnCloseEditor').addEventListener('click', requestCloseEditor);
        $('btnCancel').addEventListener('click', requestCloseEditor);
        $('btnSave').addEventListener('click', saveScript);
        $('btnDelete').addEventListener('click', deleteScript);
        $('btnDuplicate').addEventListener('click', duplicateScript);
        $('btnModalCopy').addEventListener('click', () => startCopy($('scriptCode').value, state.editor.id || null));
        $('btnAiSuggest').addEventListener('click', aiSuggest);
        $('btnAddTag').addEventListener('click', addTagFromInput);
        $('newTagInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                addTagFromInput();
            }
        });

        const code = $('scriptCode');
        code.addEventListener('input', syncCode);
        code.addEventListener('scroll', syncScroll);
        code.addEventListener('keydown', (e) => {
            if (e.key === 'Tab' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
                e.preventDefault();
                if (!document.execCommand('insertText', false, '    ')) {
                    const { selectionStart: s, selectionEnd: en, value } = code;
                    code.value = value.slice(0, s) + '    ' + value.slice(en);
                    code.selectionStart = code.selectionEnd = s + 4;
                    syncCode();
                }
            }
        });

        // Imagem
        const dz = $('dropZone');
        const fileInput = $('scriptImageFile');
        dz.addEventListener('click', (e) => {
            if (e.target === fileInput || e.target === $('btnRemoveImage')) return;
            fileInput.click();
        });
        dz.addEventListener('keydown', (e) => {
            if (e.target === dz && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                fileInput.click();
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length) processImageFile(e.target.files[0]);
        });
        dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
        dz.addEventListener('drop', (e) => {
            e.preventDefault();
            dz.classList.remove('dragover');
            if (e.dataTransfer.files.length) processImageFile(e.dataTransfer.files[0]);
        });
        $('btnRemoveImage').addEventListener('click', (e) => {
            e.stopPropagation();
            removeImage();
        });
        document.addEventListener('paste', (e) => {
            if (topOverlay() !== 'editorOverlay') return;
            const items = (e.clipboardData && e.clipboardData.items) || [];
            for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    processImageFile(item.getAsFile());
                    break;
                }
            }
        });

        // IA
        $('btnAiClose').addEventListener('click', closeAi);
        $('btnAiRun').addEventListener('click', runDiagnose);
        $('aiErrorInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                runDiagnose();
            }
        });

        // Variáveis
        $('btnVarsCancel').addEventListener('click', closeVars);
        $('btnVarsCopyRaw').addEventListener('click', () => {
            const { code: c, scriptId } = state.vars;
            closeVars();
            doCopy(c, scriptId, 'Copiado sem preencher as variáveis.');
        });
        $('btnVarsCopyFilled').addEventListener('click', () => {
            const { code: c, names, scriptId } = state.vars;
            const values = collectVarValues();
            const missing = names.filter((n) => !values[n]);
            const out = applyVars(c, values);
            closeVars();
            doCopy(out, scriptId, missing.length ? `Copiado, mas ${missing.length} variável(is) ficaram sem valor.` : 'Código copiado com os valores!');
        });

        // Clique no fundo escuro fecha o modal
        $('editorOverlay').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) requestCloseEditor(); });
        $('aiOverlay').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeAi(); });
        $('varsOverlay').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) closeVars(); });

        // Atalhos globais
        document.addEventListener('keydown', (e) => {
            const top = topOverlay();
            const mod = e.ctrlKey || e.metaKey;

            if (e.key === 'Escape' && top) {
                e.preventDefault();
                if (top === 'varsOverlay') closeVars();
                else if (top === 'aiOverlay') closeAi();
                else requestCloseEditor();
                return;
            }
            if (mod && e.key.toLowerCase() === 's' && top === 'editorOverlay') {
                e.preventDefault();
                saveScript();
                return;
            }
            if (mod && e.shiftKey && e.key.toLowerCase() === 'c' && top === 'editorOverlay') {
                e.preventDefault();
                startCopy($('scriptCode').value, state.editor.id || null);
                return;
            }
            if (e.key === '/' && !top && !$('appShell').hidden && !isTyping(e.target)) {
                e.preventDefault();
                $('searchInput').focus();
            }
        });
    }

    /* ==========================================================
       INÍCIO
       ========================================================== */
    bind();
    $('authHint').textContent = Auth.isConfigured()
        ? 'Entre com seu e-mail e senha.'
        : 'Aguardando configuração de banco de dados.';

    (async () => {
        const saved = Session.get();
        if (saved === 'visitor') {
            await startApp('visitor');
            return;
        }
        const restored = await Auth.restore();
        if (restored) await startApp(restored);
    })();
})();
