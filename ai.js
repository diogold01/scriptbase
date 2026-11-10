/* ==========================================================
   ScriptBase | ai.js
   Dois recursos de IA:
     AI.diagnose(erro, scripts)  -> qual script resolve este erro
     AI.suggest(codigo, tags)    -> título, descrição e tags
   Tenta a rota /api/ai (função serverless na Vercel + Gemini).
   Se a rota não existir (abrindo o arquivo local, por exemplo)
   ou falhar, usa uma análise local por palavras-chave.
   O resultado sempre traz source: 'ai' ou 'local', e a
   interface mostra isso ao usuário (sem fingir que é IA).

   Contrato da rota /api/ai (POST, JSON):
     { task:'diagnose', error, scripts:[{id,title,description,errorText,tags}] }
       -> { summary, matches:[{ id, reason, confidence(0..1) }] }
     { task:'suggest', code, existingTags:[...] }
       -> { title, description, tags:[...] }
   ========================================================== */
(() => {
    'use strict';

    const ENDPOINT = '/api/ai';
    const TIMEOUT_MS = 25000;

    /* ---------- chamada à API (null = indisponível) ---------- */
    async function callApi(payload) {
        if (location.protocol === 'file:') return null; // sem servidor, não adianta tentar
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
        try {
            const res = await fetch(ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
                signal: ctrl.signal
            });
            if (!res.ok) return null;
            return await res.json();
        } catch (_) {
            return null;
        } finally {
            clearTimeout(timer);
        }
    }

    /* ---------- texto ---------- */
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const STOPWORDS = new Set([
        'que', 'com', 'para', 'por', 'uma', 'uns', 'dos', 'das', 'nao', 'sem', 'esta', 'este', 'esse', 'essa',
        'the', 'and', 'for', 'not', 'error', 'erro', 'from', 'with', 'tabela', 'campo', 'valor', 'mensagem'
    ]);

    function tokens(text) {
        const found = norm(text).match(/[a-z0-9_$]+/g) || [];
        return found.filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    }

    /* ---------- diagnóstico local ---------- */
    function localDiagnose(errorText, scripts) {
        const query = [...new Set(tokens(errorText))];
        const queryNorm = norm(errorText);
        const ranked = [];

        scripts.forEach((s) => {
            const inError = new Set(tokens(s.errorText));
            const inTitle = new Set(tokens(s.title));
            const inDesc = new Set(tokens(s.description));
            const inTags = new Set(tokens((s.tags || []).join(' ')));
            let score = 0;
            const hits = [];

            query.forEach((t) => {
                let w = 0;
                if (inError.has(t)) w += 4;
                if (inTitle.has(t)) w += 3;
                if (inDesc.has(t)) w += 1.5;
                if (inTags.has(t)) w += 1;
                if (w > 0) {
                    score += w;
                    hits.push(t);
                }
            });

            // Bônus se a primeira linha do erro salvo aparece inteira no erro colado
            const firstLine = norm(s.errorText).split('\n')[0].trim();
            if (firstLine.length >= 15 && queryNorm.includes(firstLine)) score += 10;

            if (score >= 3) {
                ranked.push({
                    id: s.id,
                    confidence: Math.min(0.95, score / 12),
                    reason: hits.length
                        ? 'Termos em comum: ' + hits.slice(0, 5).join(', ') + '.'
                        : 'O erro colado é muito parecido com o cadastrado neste script.',
                    score
                });
            }
        });

        ranked.sort((a, b) => b.score - a.score);
        const matches = ranked.slice(0, 3).map(({ id, confidence, reason }) => ({ id, confidence, reason }));

        return {
            source: 'local',
            summary: matches.length
                ? `Encontrei ${matches.length} script(s) com termos parecidos com o erro. Confira antes de rodar.`
                : 'Nenhum script parecido na sua base. Que tal cadastrar este erro com a solução?',
            matches
        };
    }

    /* ---------- sugestão local ---------- */
    const VERBS = {
        select: 'Consulta', with: 'Consulta', insert: 'Inserção', update: 'Atualização', delete: 'Exclusão',
        alter: 'Alteração de estrutura', create: 'Criação de objeto', drop: 'Remoção de objeto',
        execute: 'Execução de procedure', merge: 'Merge'
    };

    const TAG_RULES = [
        ['Fiscal', /cfop|icms|\bcst\b|\bncm\b|\bpis\b|cofins|tributa|fiscal|\bcest\b/],
        ['NFe/NFCe', /nfe|nfce|nf_e|nfc_e|\bxml\b|protocolo|sefaz|danfe|chave_acesso/],
        ['Estoque', /estoque|saldo|inventario|\blote\b|kardex/],
        ['Financeiro', /titulo|financ|receber|pagar|vencimento|baixa|\bcaixa\b/],
        ['Vendas', /venda|pedido|cliente|orcamento|vendedor/],
        ['Banco de Dados', /rdb\$|\bindex\b|indice|trigger|procedure|constraint|backup|generator|sequence|alter\s+table|create\s+table|\bview\b/]
    ];

    function localSuggest(code, existingTags) {
        const clean = code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
        const verbMatch = clean.match(/\b(select|insert|update|delete|alter|create|drop|execute|with|merge)\b/i);
        const verb = verbMatch ? VERBS[verbMatch[1].toLowerCase()] : 'Script SQL';

        const tables = [];
        const re = /\b(?:from|join|update|into|table|view)\s+["[]?([A-Za-z_][\w$.]*)/gi;
        let m;
        while ((m = re.exec(clean)) !== null) {
            const name = m[1].replace(/[."[\]]+$/g, '');
            if (name && !tables.some((t) => t.toLowerCase() === name.toLowerCase())) tables.push(name);
            if (tables.length >= 4) break;
        }

        const title = tables.length ? `${verb} em ${tables.slice(0, 2).join(' / ')}` : verb;
        const description = tables.length
            ? `${verb} envolvendo ${tables.join(', ')}. Complete com o contexto do problema e quando usar.`
            : 'Complete com o contexto do problema e quando usar.';

        const haystack = norm(clean);
        const tags = [];
        TAG_RULES.forEach(([tag, rx]) => {
            if (rx.test(haystack)) tags.push(tag);
        });
        if (!tags.length) tags.push('Geral');

        // Respeita a grafia de tags que já existem
        const known = Array.isArray(existingTags) ? existingTags : [];
        const finalTags = tags.slice(0, 4).map((t) => known.find((k) => k.toLowerCase() === t.toLowerCase()) || t);

        return { source: 'local', title, description, tags: finalTags };
    }

    /* ---------- validação das respostas da API ---------- */
    function cleanDiagnosis(data, scripts) {
        if (!data || !Array.isArray(data.matches)) return null;
        const ids = new Set(scripts.map((s) => s.id));
        const matches = data.matches
            .filter((x) => x && ids.has(String(x.id)))
            .slice(0, 5)
            .map((x) => ({
                id: String(x.id),
                reason: typeof x.reason === 'string' ? x.reason.slice(0, 400) : '',
                confidence: Math.max(0, Math.min(1, Number(x.confidence) || 0))
            }));
        return {
            source: 'ai',
            summary: typeof data.summary === 'string' ? data.summary.slice(0, 800) : '',
            matches
        };
    }

    function cleanSuggestion(data) {
        if (!data || typeof data.title !== 'string') return null;
        return {
            source: 'ai',
            title: data.title.slice(0, 150),
            description: typeof data.description === 'string' ? data.description.slice(0, 600) : '',
            tags: (Array.isArray(data.tags) ? data.tags : [])
                .filter((t) => typeof t === 'string' && t.trim())
                .map((t) => t.trim().slice(0, 30))
                .slice(0, 5)
        };
    }

    /* ---------- API pública ---------- */
    window.AI = {
        // scripts: [{ id, title, description, errorText, tags }]  (o código SQL não é enviado)
        async diagnose(errorText, scripts) {
            const data = await callApi({ task: 'diagnose', error: errorText, scripts });
            return cleanDiagnosis(data, scripts) || localDiagnose(errorText, scripts);
        },

        async suggest(code, existingTags) {
            const data = await callApi({ task: 'suggest', code, existingTags });
            return cleanSuggestion(data) || localSuggest(code, existingTags);
        }
    };
})();
