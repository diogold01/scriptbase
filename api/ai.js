// Função Serverless da Vercel: /api/ai
// Executada no backend da Vercel sem expor a chave do Gemini ao navegador.

const CANDIDATE_MODELS = [
    'gemini-3.5-flash-lite',
    'gemini-3.1-flash-lite',
    'gemini-3.8-flash',
    'gemini-flash-latest'
];

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
            if (!error || !Array.isArray(scripts) || scripts.length === 0) {
                return res.status(400).json({ error: 'Dados inválidos para diagnóstico.' });
            }

            // O código SQL NUNCA é enviado para o Gemini (apenas id, title, description, errorText, tags)
            const safeScripts = scripts.slice(0, 30).map((s) => ({
                id: String(s.id),
                title: String(s.title || '').slice(0, 150),
                description: String(s.description || '').slice(0, 300),
                errorText: String(s.errorText || '').slice(0, 300),
                tags: Array.isArray(s.tags) ? s.tags.slice(0, 8) : []
            }));

            const prompt = `Você é um especialista em suporte técnico e banco de dados ERP.
Um usuário relatou a seguinte mensagem de erro ou problema:
"""
${String(error).slice(0, 1000)}
"""

Analise a lista de scripts disponíveis abaixo e identifique qual(is) deles resolvem ou se relacionam com o erro:
${JSON.stringify(safeScripts)}

Responda ESTRITAMENTE em formato JSON com o seguinte formato, sem markdown ao redor:
{
  "summary": "Explicação curta e profissional em português do Brasil sobre o diagnóstico.",
  "matches": [
    {
      "id": "id_do_script",
      "reason": "Motivo claro pelo qual este script se aplica ao erro.",
      "confidence": 0.95
    }
  ]
}`;

            const parsed = await generateWithGemini(prompt, apiKey, true);
            return res.status(200).json(parsed);
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
