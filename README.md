# ScriptBase

Biblioteca web colaborativa para organização, busca e preparação de scripts SQL antes de copiar em rotinas de suporte técnico a sistemas ERP, com diagnóstico de erros assistido por **RAG (Retrieval-Augmented Generation)** e API Google Gemini.

Aplicação no ar: https://scriptbase-gules.vercel.app

> Acesse como visitante para testar imediatamente com dados de demonstração ou clique em **Diagnosticar erro (RAG)** no topo para consultar a base fiscal/ERP.

![Diagnóstico de Erro com RAG e Fontes Citadas](docs/screenshots/05-diagnostico-ia.png)

## O Problema

No suporte técnico de ERPs, o analista lida diariamente com os mesmos incidentes de banco de dados: notas fiscais travadas, inconsistências de estoque, campos nulos após atualizações e erros de integridade.

Na maioria das equipes, esses comandos ficam dispersos em blocos de notas, conversas de chat ou pastas locais. Essa desorganização gera riscos práticos:

- Perda de tempo procurando consultas enquanto o cliente aguarda atendimento.
- Risco de copiar e rodar comandos de atualização ou exclusão sem os filtros corretos no banco do cliente.
- Ausência de histórico e falta de alinhamento sobre quais scripts estão atualizados e revisados pela equipe.

## Por que o ScriptBase

O ScriptBase centraliza esse acervo em uma ferramenta de bancada simples e padronizada para o time de suporte:

- Preparação segura antes de copiar: consultas com variáveis (`@VAR`, `{VAR}`, `[VAR]`) exigem preenchimento dos valores antes da cópia, e comandos destrutivos (`DELETE` ou `UPDATE` sem `WHERE`, `DROP`, `TRUNCATE`) disparam alertas visuais imediatos.
- Resposta rápida no atendimento: busca instantânea por título, erro ou trecho SQL, com atalhos de teclado para as ações principais.
- Diagnóstico assistido: quando o cliente relata um erro desconhecido, a IA analisa a mensagem e sugere o script mais adequado da base.
- Trabalho em equipe: a biblioteca é compartilhada por link de convite, com acesso por equipe e histórico de autoria em cada edição.

![Visualização de Código SQL na Lista](docs/screenshots/03-preview-codigo.png)

## Funcionalidades

- Busca instantânea por título, descrição, mensagem de erro ou código SQL.
- Pré-visualização rápida da consulta na lista com realce de sintaxe em temas claro e escuro.
- Janela para preenchimento de variáveis antes de copiar a consulta pronta.
- Alerta visual automático para comandos destrutivos sem cláusula de filtro.
- Atalhos de teclado para busca, navegação, cópia e favoritos.
- Diagnóstico de mensagens de erro via API Gemini com busca local de contingência.
- Sugestão automática de título, descrição e tags ao cadastrar um novo script SQL.
- Colaboração em equipe por link de convite com registro de quem criou ou editou cada script.
- Modo visitante local (dados de exemplo no navegador) e modo conectado sincronizado no Supabase.

![Editor de Scripts e Histórico de Alterações](docs/screenshots/02-editor-script.png)

## Como a IA e o RAG Funcionam

```mermaid
flowchart LR
    A[Erro do ERP / Fiscal] --> B[Retrieval: Base ERP 106 chunks]
    A --> C[Metadados dos Scripts SQL]
    B --> D[Prompt Fundamentado - Gemini]
    C --> D
    D --> E[Diagnóstico + Fontes Citadas]
```

A integração com a API do Google Gemini (via função serverless em `api/ai.js`) atua em duas frentes independentes:

- **Diagnóstico com RAG (`AI.diagnose`):** ao receber uma mensagem de erro ou sintoma fiscal, o backend executa primeiro a recuperação (*retrieval*) dos trechos mais relevantes na base de conhecimento ERP (`data/erp_errors_kb.json`, com 106 registros de erros e resoluções higienizados) combinando correspondência exata de código fiscal/SEFAZ e pontuação lexical ponderada. Em seguida, injeta os trechos recuperados e os metadados dos scripts SQL do usuário (sem enviar o código SQL) no prompt do Gemini, que sintetiza a causa provável, o passo a passo e cita as fontes utilizadas.
- **Sugestão de metadados (`AI.suggest`):** ao cadastrar ou documentar um script, analisa até 2.000 caracteres do comando SQL para sugerir título, descrição resumida e tags padronizadas.
- **Contingência local (`ai.js`):** se a chave de API não estiver configurada ou o serviço externo falhar, o sistema executa localmente a mesma busca sobre `data/erp_errors_kb.json` e sobre os scripts da biblioteca.

## Limites Atuais

- A aplicação não conecta nem executa comandos diretamente no banco de dados do ERP; ela prepara, valida variáveis e copia a consulta para o analista executar no gerenciador do banco.
- A etapa de recuperação (RAG) utiliza busca híbrida por código exato e termos ponderados em memória sobre `data/erp_errors_kb.json` (não depende de extensão vetorial ativa no runtime, mantendo o schema opcional `supabase/schema_rag.sql` para futura migração para `pgvector`).
- O endpoint `/api/ai` utiliza cadeia de fallback entre modelos rápidos do Gemini, mas ainda não possui controle próprio de *rate limit* por usuário.

## Stack

- HTML5, CSS3 e JavaScript (sem etapa de build)
- Supabase (banco de dados em nuvem, autenticação e políticas de acesso RLS)
- Google Gemini API (função serverless na Vercel)
- Prism.js (realce de sintaxe SQL)

## Atalhos de Teclado

- Barra (`/`): Focar no campo de busca
- Setas para cima e para baixo: Navegar pelos scripts da lista
- Enter: Expandir ou recolher o código SQL
- C: Copiar o script (abre janela se houver variáveis)
- F: Marcar como favorito
- Esc: Fechar janelas abertas

## Como Executar Localmente

Abra o arquivo `index.html` em qualquer navegador moderno. O modo visitante funciona imediatamente sem necessidade de instalação.

Para ativar a persistência na nuvem e a IA:
1. Configure a URL e a chave pública do projeto Supabase no arquivo `config.js`.
2. Execute o conteúdo de `supabase/schema.sql` no SQL Editor do Supabase.
3. Na Vercel (ou ambiente serverless equivalente), defina a variável de ambiente `GEMINI_API_KEY` para habilitar as chamadas em `api/ai.js`.
