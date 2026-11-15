-- ScriptBase | Schema opcional para busca vetorial com pgvector (RAG escalável)
-- Execute no SQL Editor do Supabase caso deseje migrar a base JSON para pgvector.

create extension if not exists vector;

create table if not exists public.erp_error_chunks (
  id         text primary key,
  code       text not null default '',
  category   text not null default 'Geral ERP',
  title      text not null,
  solution   text not null,
  embedding  vector(768),
  created_at timestamptz not null default now()
);

create index if not exists erp_error_chunks_embedding_idx
  on public.erp_error_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 20);

create or replace function public.match_erp_errors(
  query_embedding vector(768),
  match_threshold float default 0.55,
  match_count int default 5
)
returns table (
  id text,
  code text,
  category text,
  title text,
  solution text,
  similarity float
)
language sql stable
as $$
  select
    e.id,
    e.code,
    e.category,
    e.title,
    e.solution,
    1 - (e.embedding <=> query_embedding) as similarity
  from public.erp_error_chunks e
  where 1 - (e.embedding <=> query_embedding) > match_threshold
  order by e.embedding <=> query_embedding
  limit match_count;
$$;
