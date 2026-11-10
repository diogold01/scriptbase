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
