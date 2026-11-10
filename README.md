# ScriptBase

Biblioteca web para organizacao, busca e execucao segura de scripts SQL em rotinas de suporte tecnico, com diagnostico assistido por inteligencia artificial.

Link da aplicacao: [LINK DA DEMO]

> Nota: Para testar a ferramenta, clique em "Entrar como visitante". Os registros exibidos na demonstracao sao scripts ficticios para protecao de dados.

[PRINT/GIF DA APLICACAO]

---

## O problema real

Trabalhando no suporte tecnico de ERPs e sistemas de gestao, a rotina de atendimento frequentemente lida com os mesmos incidentes de banco de dados repetidas vezes: notas fiscais presas em processamento, inconsistencias em tabelas de estoque apos quedas de energia, campos nulos apos atualizacoes de versao e erros conhecidos de integridade referencial.

Na pratica, a maioria das equipes mantem esses comandos salvos em blocos de notas, conversas de chat ou pastas locais no computador. Esse modelo traz tres riscos criticos:
1. Dificuldade de encontrar o script exato no momento em que o cliente esta aguardando atendimento.
2. Risco alto de rodar comandos UPDATE ou DELETE sem parametrizar clausulas WHERE ou sem preencher variaveis de identificacao.
3. Falta de historico sobre quando aquele comando foi usado ou alterado pela ultima vez.

O ScriptBase foi criado para centralizar essas solucoes em uma interface rapida e com travas de seguranca.

---

## O que a ferramenta faz

- Busca instantanea: pesquisa por titulo, descricao, trechos da mensagem de erro e texto dentro do proprio codigo SQL.
- Parametrizacao de variaveis: comandos que contem variaveis (como @ID, {ID} ou [ID]) abrem uma tela de preenchimento antes de copiar, evitando a execucao acidental de queries com valores de teste.
- Alerta visual para comandos destrutivos: destaque e aviso em scripts que contem instrucoes de DROP, TRUNCATE ou DELETE.
- Organizacao por tags e favoritos: categorizacao livre (Fiscal, Estoque, Financeiro, etc.) e acesso rapido aos scripts mais utilizados.
- Historico de manutencao: registro automatico de data de alteracao e anotacoes de mudancas em cada script.
- Backup e portabilidade: importacao e exportacao dos dados em formato JSON.

---

## Uso de Inteligencia Artificial

A ferramenta integra modelos de linguagem para agilizar o fluxo de resolucao de problemas sem comprometer dados sensiveis:

1. Diagnostico de erro: o analista cola a mensagem de erro retornada pelo banco ou pela aplicacao do cliente. A IA analisa os erros cadastrados na base e aponta o script com maior probabilidade de resolver o incidente.
2. Sugestao de metadados: ao cadastrar um novo comando SQL, o sistema sugere titulo conciso, descricao objetiva e tags pertinentes com base no conteudo da query.

### Privacidade e resiliencia (Fallback local)
- Protecao de dados: o codigo SQL e os dados do cliente nunca sao enviados na chamada de diagnostico. Apenas a mensagem de erro e os titulos/descricoes dos scripts sao processados.
- Modo de contingencia: se a conexao com a API de IA falhar ou estiver indisponivel, o sistema aciona automaticamente um algoritmo interno de analise lexico-semantica no navegador, identificando termos em comum e mantendo a ferramenta operacional.

---

## Arquitetura

O projeto foi desenhado de forma enxuta, sem etapa de build complexa, facilitando manutencao e execucao direta:

```text
Navegador (HTML5 / CSS / Vanilla JS)
  │
  ├── Modo Visitante  ──> Armazenamento local (localStorage)
  │
  ├── Conta Pessoal   ──> Supabase (Auth + PostgreSQL com Row Level Security)
  │
  └── Recursos de IA ──> /api/ai (Vercel Serverless Function) ──> Google Gemini API
```

---

## Seguranca e decisoes tecnicas

- Row Level Security (RLS): no banco de dados PostgreSQL (Supabase), o isolamento de dados e aplicado no nivel de linha. Consultas anonimas sao bloqueadas e usuarios autenticados so conseguem ler ou modificar exclusivamente os proprios scripts.
- Cadastro publico desativado: criacao de novas contas desabilitada no provedor de autenticacao, mantendo o banco restrito ao operador.
- Protecao de credenciais: a chave da API do Gemini fica restrita ao ambiente de execucao serverless na Vercel (variavel de ambiente), sem exposicao no codigo cliente.
- Prevencao contra XSS: manipulacao do DOM realizada com `textContent` e criacao estruturada de elementos, evitando interpolacoes inseguras com `innerHTML`.
- Sem complexidade de build: desenvolvido em HTML, CSS moderno e JavaScript puro para inicializacao instantanea e facilidade de auditoria.

---

## Como executar localmente

1. Clone o repositorio:
   ```bash
   git clone https://github.com/diogold01/scriptbase.git
   cd scriptbase
   ```

2. Abra o arquivo `index.html` diretamente em qualquer navegador.
   - O modo visitante funciona de forma imediata sem necessidade de configuracao externa.

3. Para conectar banco de dados e IA:
   - Configure o arquivo `config.js` com as chaves publicas do seu projeto no Supabase.
   - Execute o script `supabase/schema.sql` no SQL Editor do Supabase.
   - Configure a variavel de ambiente `GEMINI_API_KEY` na hospedagem da Vercel.

---

## Proximos passos

- Integracao com Supabase Storage para armazenamento dedicado de capturas de tela e diagramas de tabelas.
- Busca semantica avancada com embeddings vetoriais (pgvector).
- Formatador e validador sintatico de dialetos SQL (Postgres, Firebird, SQL Server).
- Controle de versoes com restauracao de alteracoes anteriores.

---

## Sobre o desenvolvimento

Projeto concebido e desenvolvido com foco em resolver um gargalo real de operacao de suporte tecnico a sistemas ERP, aliando arquitetura de dados segura e inteligencia artificial aplicada a produtividade diaria.
