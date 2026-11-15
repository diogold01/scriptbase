// Função Serverless da Vercel: /api/ai
// Executada no backend da Vercel sem expor a chave do Gemini ao navegador.

import fs from 'node:fs';
import path from 'node:path';

const CANDIDATE_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
    'gemini-flash-latest'
];

const STOPWORDS = new Set([
    'que', 'com', 'para', 'por', 'uma', 'uns', 'dos', 'das', 'nao', 'sem', 'esta', 'este', 'esse', 'essa',
    'the', 'and', 'for', 'not', 'error', 'erro', 'from', 'with', 'tabela', 'campo', 'valor', 'mensagem',
    'ao', 'na', 'no', 'da', 'do', 'de', 'em', 'ou', 'se', 'os', 'as', 'um', 'quando', 'como', 'para'
]);

let cachedKb = null;

function loadErpKb() {
    if (cachedKb) return cachedKb;
    try {
        const kbPath = path.join(process.cwd(), 'data', 'erp_errors_kb.json');
        const raw = fs.readFileSync(kbPath, 'utf8');
        const parsed = JSON.parse(raw);
        cachedKb = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
        console.warn('Falha ao carregar base RAG:', err.message);
        cachedKb = [];
    }
    return cachedKb;
}

function normalizeText(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
}

function tokenize(str) {
    const found = normalizeText(str).match(/[a-z0-9_$-]+/g) || [];
    return [...new Set(found.filter((t) => (t.length >= 2 || /^\d+$/.test(t)) && !STOPWORDS.has(t)))];
}

function retrieveErpDocs(query, kb, topK = 5) {
    if (!kb.length) return [];
    const qNorm = normalizeText(query);
    const qTokens = tokenize(query);
    if (!qTokens.length) return [];

    const scored = [];

    for (const doc of kb) {
        const titleNorm = normalizeText(doc.title);
        const solNorm = normalizeText(doc.solution);
        const catNorm = normalizeText(doc.category);
        const codeNorm = normalizeText(doc.code);

        let score = 0;

        // Peso forte para match exato de código numérico/fiscal (ex: 531, 386, uCom, qCom)
        if (codeNorm && codeNorm.length >= 2) {
            const codeRx = new RegExp(`(^|[^a-z0-9])${codeNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
            if (codeRx.test(qNorm)) {
                score += 12;
            }
        }

        const titleTokens = new Set(tokenize(doc.title));
        const solTokens = new Set(tokenize(doc.solution));

        for (const t of qTokens) {
            if (titleTokens.has(t)) score += 3.2;
            else if (titleNorm.includes(t)) score += 2.0;

            if (solTokens.has(t)) score += 1.5;
            else if (solNorm.includes(t)) score += 0.8;

            if (catNorm.includes(t)) score += 1.0;
        }

        if (score >= 2.5) {
            scored.push({
                ...doc,
                score,
                relevance: Math.min(0.99, Number((score / 18).toFixed(2)))
            });
        }
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
}

async function generateWithGemini(prompt, apiKey, isJson = true) {
    let lastError = null;

    for (const model of CANDIDATE_MODELS) {
        try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const body = {
                contents: [{ parts: [{ text: prompt }] }]
            };
            if (isJson) {
                body.generationConfig = { responseMimeType: 'application/json', temperature: 0.2 };
            }

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (response.ok) {
                const data = await response.json();
                const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
                if (text) {
                    return isJson ? JSON.parse(text) : text;
                }
            } else {
                lastError = await response.text();
            }
        } catch (err) {
            lastError = err.message;
        }
    }

    throw new Error(lastError || 'Nenhum modelo do Gemini respondeu no momento.');
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Método não permitido.' });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
        return res.status(503).json({ error: 'Chave do Gemini não configurada no servidor.' });
    }

    const { task, error, scripts, code, existingTags } = req.body || {};

    try {
        if (task === 'diagnose') {
            if (!error || typeof error !== 'string' || !error.trim()) {
                return res.status(400).json({ error: 'Mensagem de erro não informada.' });
            }

            // O código SQL NUNCA é enviado para o Gemini (apenas id, title, description, errorText, tags)
            const safeScripts = (Array.isArray(scripts) ? scripts : []).slice(0, 30).map((s) => ({
                id: String(s.id),
                title: String(s.title || '').slice(0, 150),
                description: String(s.description || '').slice(0, 300),
                errorText: String(s.errorText || '').slice(0, 300),
                tags: Array.isArray(s.tags) ? s.tags.slice(0, 8) : []
            }));

            // Etapa 1 do RAG: Retrieval na Base de Conhecimento ERP
            const kb = loadErpKb();
            const retrievedDocs = retrieveErpDocs(error, kb, 5);
            const safeKbContext = retrievedDocs.map((d) => ({
                id: d.id,
                code: d.code,
                category: d.category,
                title: d.title,
                solution: d.solution
            }));

            // Etapa 2 do RAG: Augmentation + Geração fundamentada no contexto recuperado
            const prompt = `Você é um especialista em suporte técnico de ERP, regras fiscais (NF-e, NFC-e, MDF-e, CFOP, CSOSN) e SQL.
Um analista relatou a seguinte mensagem de erro ou problema:
"""
${String(error).slice(0, 1000)}
"""

1) TRECHOS RECUPERADOS DA BASE DE CONHECIMENTO ERP (RAG):
${safeKbContext.length ? JSON.stringify(safeKbContext) : 'Nenhum trecho correspondente encontrado na base de conhecimento.'}

2) SCRIPTS SQL CADASTRADOS NA BIBLIOTECA DO USUÁRIO:
${safeScripts.length ? JSON.stringify(safeScripts) : 'Nenhum script cadastrado.'}

INSTRUÇÕES OBRIGATÓRIAS:
- Baseie seu diagnóstico prioritariamente nos trechos recuperados da Base de Conhecimento ERP e nos metadados dos scripts acima.
- Explique de forma objetiva e direta (em português do Brasil) a causa provável e o passo a passo prático de resolução.
- Se nenhum trecho da base nem script cadastrado responder exatamente ao erro, informe isso com transparência no resumo em vez de inventar etapas.
- Cite os IDs dos trechos da base usados na resposta em "citations".

Responda ESTRITAMENTE em formato JSON, sem markdown ao redor:
{
  "summary": "Diagnóstico objetivo e passo a passo de resolução em português do Brasil.",
  "matches": [
    {
      "id": "id_do_script",
      "reason": "Motivo claro pelo qual este script se aplica ao erro.",
      "confidence": 0.95
    }
  ],
  "citations": [
    {
      "id": "erp-000",
      "reason": "Como este registro da base ajuda na solução."
    }
  ]
}`;

            const parsed = await generateWithGemini(prompt, apiKey, true);

            const citationMap = new Map(
                (Array.isArray(parsed.citations) ? parsed.citations : [])
                    .filter((c) => c && c.id)
                    .map((c) => [String(c.id), String(c.reason || '').slice(0, 300)])
            );

            const ragSources = retrievedDocs.map((d) => ({
                id: d.id,
                code: d.code,
                title: d.title,
                category: d.category,
                solution: d.solution,
                relevance: d.relevance,
                cited: citationMap.has(d.id),
                citationReason: citationMap.get(d.id) || ''
            }));

            return res.status(200).json({
                summary: parsed.summary || '',
                matches: Array.isArray(parsed.matches) ? parsed.matches : [],
                ragSources
            });
        }

        if (task === 'suggest') {
            if (!code || typeof code !== 'string') {
                return res.status(400).json({ error: 'Código SQL não fornecido.' });
            }

            const prompt = `Analise o código SQL abaixo e sugira um título direto, uma descrição sucinta e até 4 tags:
"""
${code.slice(0, 2000)}
"""

Tags já conhecidas no sistema para você priorizar se fizer sentido: ${(existingTags || []).join(', ')}.

Responda ESTRITAMENTE em JSON sem formatação markdown:
{
  "title": "Título conciso (máx 150 caracteres)",
  "description": "Explicação objetiva da ação do script (máx 300 caracteres)",
  "tags": ["Tag1", "Tag2"]
}`;

            const parsed = await generateWithGemini(prompt, apiKey, true);
            return res.status(200).json(parsed);
        }

        return res.status(400).json({ error: 'Tarefa desconhecida.' });
    } catch (err) {
        console.error('API Error:', err);
        return res.status(500).json({ error: 'Erro ao processar IA: ' + err.message });
    }
}
