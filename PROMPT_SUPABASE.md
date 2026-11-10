# PROMPT: ScriptBase — conectar Supabase, finalizar e documentar

Cole este arquivo inteiro no agente (IDE) que está aberto na pasta do projeto, ou peça para ele ler `PROMPT_SUPABASE.md`.

---

## 1. Seu papel e como trabalhar

Você é um engenheiro de software sênior ajudando um estudante a terminar o **ScriptBase**, projeto que será o centro do portfólio para a vaga **AI Builder (iFood)**. O prazo é curto: a candidatura sai por volta de **15/11/2026**. Priorize o que funciona e está no ar, não o que é sofisticado.

Regras de trabalho:

1. **Trabalhe uma etapa por vez** (as etapas estão na seção 5). Ao terminar cada uma, responda com **um parágrafo curto** do que foi feito e **pare**. Só avance quando o usuário disser **"continue"**.
2. **Não reescreva arquivos que já funcionam.** Faça alterações mínimas e pontuais nos arquivos existentes. Mostre ao usuário o que mudou em cada arquivo (em uma frase).
3. **Sem etapa de build e sem dependências novas**, exceto a biblioteca `@supabase/supabase-js` por CDN. É HTML, CSS e JS puros, publicado como site estático na Vercel, mais uma função em `api/`.
4. **Nunca** coloque em arquivo nenhum: chave secreta do Supabase (`sb_secret_...`), `service_role`, chave do Gemini, senhas ou e-mails reais. Os únicos valores que vão para o código do navegador são a **URL do projeto** e a **chave publicável** (`sb_publishable_...`), que são públicas por desenho. A segurança vem do RLS no banco.
5. **Nada vindo do usuário entra via `innerHTML`.** Use `textContent` ou o helper `el()` do `app.js`. A única exceção já existente é a saída do Prism.
6. O usuário é **iniciante em GitHub**. Quando precisar de comandos ou cliques de Git, Vercel ou Supabase, explique um passo por vez, em português simples.
7. Tudo na interface e nos comentários em **português do Brasil**.
8. **Não invente funcionalidades** no README nem na interface. Descreva só o que existe e funciona.

---

## 2. O que já existe (não refazer)

Site estático na raiz do projeto:

| Arquivo | Função |
|---|---|
| `index.html` | Estrutura: tela de entrada (visitante/dono), topo, filtros, cards, modais (editor, diagnóstico com IA, variáveis) |
| `styles.css` | Tema escuro, responsivo |
| `seed.js` | `window.DEMO_SCRIPTS`: 9 scripts **fictícios** do modo visitante |
| `storage.js` | `window.ScriptStore` (dados) e `window.Auth` (login). Hoje só o modo visitante em `localStorage` |
| `ai.js` | `window.AI.diagnose()` e `window.AI.suggest()`: chama `/api/ai`, e cai para análise local se falhar |
| `app.js` | Toda a lógica de interface |
| `api/ai.js` | Função serverless da Vercel que chama o Gemini (variável `GEMINI_API_KEY`) |

Ordem atual dos `<script>` no `index.html`: `seed.js` → `storage.js` → `ai.js` → `app.js`.

### Contrato que a interface usa (NÃO mudar a assinatura)

```
Auth.isConfigured()            -> boolean
Auth.restore()                 -> Promise<'owner' | null>
Auth.signIn(email, password)   -> Promise (lança Error com mensagem em pt-BR)
Auth.signOut()                 -> Promise

ScriptStore.init(mode)         -> 'visitor' | 'owner'
ScriptStore.list()             -> Promise<Script[]>
ScriptStore.save(script)       -> Promise<Script>      (insere ou atualiza pelo id)
ScriptStore.upsertMany(list)   -> Promise
ScriptStore.remove(id)         -> Promise
ScriptStore.incrementUse(id)   -> Promise<Script|null> (+1 em useCount, sem mexer em updatedAt)
ScriptStore.resetDemo()        -> só faz algo no visitante
ScriptStore.normalize(raw)     -> Script
ScriptStore.newId()            -> string (uuid)
```

Formato `Script` na interface:

```
{ id, title, errorText, description, code, tags: string[], favorite: boolean,
  useCount: number, image: string (data URL ou ''), logs: [{date ISO, msg}],
  createdAt ISO, updatedAt ISO }
```

### Regras que precisam continuar valendo

- **Visitante nunca fala com o Supabase.** Os dados dele ficam só no `localStorage` do navegador (chave `scriptbase_visitor_v1`) e nunca se misturam com os do dono.
- **Dono** = login por e-mail e senha no Supabase. É a única conta que existe (cadastro público desligado).
- Ao trocar de visitante para dono, ou o contrário, nada de um vaza para o outro.

---

## 3. Decisões já tomadas (não rediscutir)

- **Modelo de dados simples:** uma tabela `scripts`, com `tags` como `text[]` e `logs` como `jsonb`. (Uma versão normalizada com 4 tabelas foi considerada e descartada pelo prazo.)
- **Imagem na fase 1:** continua como data URL (JPEG até 800 px) em uma coluna `text`. **Não implementar Supabase Storage agora.** Fica como melhoria futura no README.
- **Chave no navegador:** usar a **chave publicável** (`sb_publishable_...`). Se o projeto só tiver a chave legada `anon`, ela serve igual no mesmo parâmetro do `createClient`.
- **Sem full-text search, sem pgvector agora.** Isso entra na seção "Próximos passos" do README (busca semântica/RAG).
- **IA:** a rota `/api/ai` é pública para que visitantes testem. A proteção é o limite de gasto na chave do Gemini, mais o rate limit e as validações que já estão na função.

---

## 4. Passos MANUAIS do usuário (o agente não consegue fazer)

Apresente esta lista ao usuário no momento certo (Etapa 3) e espere ele confirmar cada item:

1. Criar um projeto no **Supabase** (supabase.com), guardando a senha do banco em local seguro.
2. No **SQL Editor**, colar e executar o conteúdo de `supabase/schema.sql`.
3. Em **Authentication > Users**, criar o usuário dono (**Add user**), com e-mail e senha forte, marcando a confirmação automática do e-mail.
4. **Desligar o cadastro público** de novos usuários (Authentication, na área de configuração de provedores/Sign In, opção de permitir novos cadastros). Conferir também que **Anonymous sign-ins** está desligado. Os nomes dos menus mudam com o tempo; se não achar, buscar na documentação atual do Supabase.
5. Em **Settings > API Keys**, copiar a **Project URL** e a **chave publicável** (`sb_publishable_...`).
6. Colar os dois valores em `config.js`.
7. Subir as mudanças no GitHub. A Vercel republica sozinha.

---

## 5. ETAPAS (uma por vez; parar e esperar "continue")

### ETAPA 1 — Banco de dados: criar `supabase/schema.sql`

Crie o arquivo com **exatamente** este conteúdo (revise só se achar erro de sintaxe e explique o motivo):

```sql
-- ScriptBase | schema do Supabase
-- Rode inteiro no SQL Editor. Pode rodar de novo sem quebrar.

create table if not exists public.scripts (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title       text not null check (char_length(title) between 1 and 150),
  description text not null default '',
  error_text  text not null default '',
  code        text not null check (char_length(code) > 0),
  tags        text[] not null default '{}',
  favorite    boolean not null default false,
  use_count   integer not null default 0 check (use_count >= 0),
  image       text not null default '',
  logs        jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists scripts_user_updated_idx on public.scripts (user_id, updated_at desc);
create index if not exists scripts_tags_gin on public.scripts using gin (tags);

-- Segurança: cada usuário só enxerga e altera as próprias linhas
alter table public.scripts enable row level security;

revoke all on public.scripts from anon;
grant select, insert, update, delete on public.scripts to authenticated;

drop policy if exists "scripts_owner_all" on public.scripts;
create policy "scripts_owner_all" on public.scripts
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Contador de cópias sem alterar updated_at (respeita o RLS: security invoker)
create or replace function public.increment_script_use(p_id uuid)
returns public.scripts
language sql
security invoker
set search_path = public
as $$
  update public.scripts
     set use_count = use_count + 1
   where id = p_id and user_id = (select auth.uid())
  returning *;
$$;

revoke all on function public.increment_script_use(uuid) from public, anon;
grant execute on function public.increment_script_use(uuid) to authenticated;
```

Ao terminar: explique em 3 linhas o que o RLS faz e por que a chave publicável pode ficar no navegador. **Pare.**

### ETAPA 2 — Cliente: `config.js`, `index.html`, `storage.js`

**2.1** Crie `config.js` na raiz:

```js
// Valores PÚBLICOS (seguros no navegador). A proteção real é o RLS no banco.
// NUNCA coloque aqui: chave secreta (sb_secret_...), service_role ou chave do Gemini.
window.SCRIPTBASE_CONFIG = {
    SUPABASE_URL: '',
    SUPABASE_PUBLISHABLE_KEY: ''
};
```

**2.2** Em `index.html`, deixe a ordem dos scripts assim (adicionando só os dois novos):

```
seed.js -> config.js -> supabase-js (CDN jsdelivr @supabase/supabase-js@2) -> storage.js -> ai.js -> app.js
```

**2.3** Em `storage.js`, **sem mudar o contrato da seção 2**:

- Trocar o `CONFIG` fixo por `window.SCRIPTBASE_CONFIG`. `Auth.isConfigured()` é verdadeiro só se URL e chave existem **e** `window.supabase` (a biblioteca) carregou.
- Criar o client uma única vez, de forma preguiçosa: `window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } })`.
- **Auth:**
  - `signIn`: `signInWithPassword`. Traduzir o erro de credencial inválida para **"E-mail ou senha incorretos."** e erro de rede para **"Não foi possível conectar ao Supabase."**
  - `restore`: `getSession()`; devolve `'owner'` se houver sessão, senão `null`.
  - `signOut`: `auth.signOut()`.
- **`ScriptStore.init('owner')`:** exigir sessão ativa (senão lançar "Sessão expirada. Entre novamente.") e usar o adaptador do Supabase. O modo `'visitor'` continua exatamente como está.
- **Adaptador do Supabase** (mapeamento entre a interface e as colunas):
  - linha → Script: `error_text→errorText`, `use_count→useCount`, `created_at→createdAt`, `updated_at→updatedAt`; passar o resultado por `normalize()`.
  - Script → linha: `errorText→error_text`, `useCount→use_count`, `createdAt→created_at`, `updatedAt→updated_at`. **Não enviar `user_id`** (o banco preenche com `auth.uid()`).
  - `list`: `select('*')` ordenado por `updated_at` decrescente.
  - `save`: `upsert` com `onConflict: 'id'` e devolver o registro salvo.
  - `upsertMany`: `upsert` em **lotes de 50** (as imagens são pesadas).
  - `remove`: `delete().eq('id', id)`.
  - `incrementUse`: `rpc('increment_script_use', { p_id: id })`, mapeando o retorno.
  - Erros do Supabase viram `Error` com mensagem curta em português (nunca vazar detalhes técnicos na tela; use `console.error` para o detalhe).
- **Aviso de privacidade da IA:** em `index.html`, no modal "Diagnosticar erro", abaixo do campo de texto, adicionar uma linha pequena: *"O erro e os títulos/descrições dos scripts são enviados ao Gemini para a análise. O código SQL não é enviado. Não inclua nomes ou dados de clientes."* Reutilizar a classe `.label-hint` ou `.auth-hint` (sem CSS novo, se possível).
- `app.js`: só mexer se algo realmente precisar. O fluxo de login já chama `Auth.signIn` e depois `startApp('owner')`.

Ao terminar: diga quais arquivos mudaram e liste os **passos manuais da seção 4** para o usuário executar agora. **Pare.**

### ETAPA 3 — Conferir a ligação (com o usuário)

Espere o usuário dizer que concluiu os passos manuais. Então, junto com ele, valide cada item e pare no primeiro que falhar para diagnosticar:

1. Abrir o site publicado: **login com senha errada** mostra "E-mail ou senha incorretos.".
2. **Login correto** entra como **Dono** (selo verde) e a lista começa **vazia**.
3. Criar um script, recarregar a página: continua lá. Abrir em **janela anônima**, entrar de novo: continua lá.
4. Editar (aparece no histórico), favoritar, copiar e recarregar: favorito e contador persistem.
5. **Importar** o backup JSON do ScriptBase antigo (botão Exportar do `ScriptBase1.1.html`) e conferir que os scripts reais aparecem. Este é o único caminho dos scripts reais para o sistema; eles **não** devem entrar no repositório nem no `seed.js`.
6. **Sair**, entrar como **visitante**: só aparecem os 9 scripts fictícios, nenhum do dono. Na aba Network do DevTools, não deve haver chamada a `supabase.co` no modo visitante.
7. **Teste de RLS sem login** (o usuário roda no terminal, trocando URL e chave): a resposta tem que ser uma lista vazia `[]` ou erro, nunca os scripts do dono.
   ```
   curl "https://SEU-PROJETO.supabase.co/rest/v1/scripts?select=id,title" -H "apikey: SUA_CHAVE_PUBLICAVEL"
   ```
8. **IA no ar:** diagnosticar um erro e pedir sugestão no editor devem mostrar **"Resposta da IA"** (e não "modo local").

Ao terminar: um parágrafo com o resultado dos 8 testes e o que falhou, se algo falhou. **Pare.**

### ETAPA 4 — Repositório e README (peça central do portfólio)

**4.1** Criar `.gitignore` com `.env*`, `.vercel`, `node_modules`, `.DS_Store`.

**4.2** Criar `README.md` em português, direto e honesto, com estas seções:

1. **ScriptBase** — uma frase do que é + link do deploy (deixar `[LINK DA DEMO]` para o usuário preencher) + aviso: *"Entre como visitante para testar. Os scripts da demo são fictícios."*
2. **O problema** — analista de suporte de ERP resolvendo erros de cliente repetidos, com scripts SQL espalhados em pastas e documentos. (Texto sobre a experiência real, sem expor cliente, empresa ou dados.)
3. **O que faz** — busca (inclusive dentro do código), tags livres, favoritos, histórico de alterações, preenchimento de variáveis antes de copiar, aviso de SQL destrutivo, exportar/importar backup.
4. **IA no fluxo** — (a) *Diagnosticar erro*: cola o erro e a IA indica o script mais provável; (b) *Sugerir título/descrição/tags* a partir do SQL. Explicar o fallback local quando a IA está indisponível e que o código SQL nunca é enviado no diagnóstico.
5. **Arquitetura** — diagrama em texto simples: Navegador → (visitante: localStorage) / (dono: Supabase Auth + Postgres com RLS) / `api/ai.js` (Vercel) → Gemini.
6. **Decisões técnicas e segurança** — RLS por usuário; cadastro público desligado; chave do Gemini só no servidor; visitante isolado; renderização sem `innerHTML` com dados do usuário (XSS); limites de tamanho e rate limit na função de IA; sem etapa de build de propósito.
7. **Como rodar localmente** — abrir `index.html` (modo visitante funciona sem nada). Para o modo dono e a IA: variáveis e `config.js`.
8. **Limitações e próximos passos** — busca semântica com embeddings (pgvector/RAG), imagens no Supabase Storage em vez de base64, histórico com restauração de versão, formatador de SQL. Escrever como **próximos passos**, não como feito.
9. **Sobre o desenvolvimento** — um parágrafo curto e verdadeiro. Perguntar ao usuário como ele quer descrever o uso de ferramentas de IA no desenvolvimento; **não inventar** esse texto.

Regras do README: sem selos decorativos, sem listas de "tecnologias dominadas", sem números inventados. Deixar um espaço `[PRINT/GIF]` para o usuário inserir imagens da demo.

**4.3** Ajudar o usuário, passo a passo, a enviar tudo ao GitHub (repositório `scriptbase`), conferindo antes com `git status` que **nenhum arquivo com dados reais** vai junto (backups `.json` exportados, por exemplo).

Ao terminar: um parágrafo. **Pare.**

### ETAPA 5 — Acabamento (só se sobrar tempo)

Nesta ordem, uma por vez, com aprovação do usuário:

1. Prints e um GIF curto (diagnosticar erro → script → copiar com variáveis) para o README.
2. Favicon e `<meta>` de título/descrição/Open Graph no `index.html`.
3. Revisão de acessibilidade básica (foco visível, `aria-label`, contraste).
4. Pequena seção "Caso de uso" no README com o antes e depois do fluxo de trabalho (sem números inventados; se o usuário tiver medição real, incluir).

---

## 6. Definição de pronto

- [ ] Site no ar na Vercel, modo visitante funcionando com scripts fictícios.
- [ ] Login de dono funcionando, dados persistindo no Supabase, RLS comprovado (teste 7).
- [ ] IA respondendo pelo Gemini no site publicado.
- [ ] Nenhum segredo e nenhum dado real no repositório.
- [ ] README completo e verdadeiro, com link da demo.
