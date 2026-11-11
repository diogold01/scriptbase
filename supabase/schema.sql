-- ScriptBase | schema do Supabase
-- Rode inteiro no SQL Editor. Pode rodar de novo sem quebrar.

-- 1. Tabela de scripts
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

-- 2. Tabela de equipes (cada dono possui uma equipe com código único de convite)
create table if not exists public.teams (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null unique references auth.users(id) on delete cascade,
  owner_email text not null default '',
  invite_code text not null unique default replace(gen_random_uuid()::text, '-', ''),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Garante as colunas e padrão caso a tabela já tenha sido criada
alter table public.teams add column if not exists owner_email text not null default '';
alter table public.teams alter column invite_code set default replace(gen_random_uuid()::text, '-', '');

create index if not exists teams_owner_idx on public.teams (owner_id);
create index if not exists teams_invite_code_idx on public.teams (invite_code);

-- 3. Tabela de membros da equipe
create table if not exists public.team_members (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  email      text not null default '',
  role       text not null default 'editor' check (role in ('editor', 'viewer')),
  joined_at  timestamptz not null default now(),
  constraint team_member_unique unique (team_id, user_id)
);

create index if not exists team_members_user_idx on public.team_members (user_id);
create index if not exists team_members_team_idx on public.team_members (team_id);

-- 4. Função auxiliar de segurança para checar se o usuário logado pertence à equipe do dono
create or replace function public.is_team_member(p_owner_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
      from public.teams t
      join public.team_members tm on tm.team_id = t.id
     where t.owner_id = p_owner_id
       and tm.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_team_member(uuid) from public, anon;
grant execute on function public.is_team_member(uuid) to authenticated;

-- 5. Segurança RLS na tabela de scripts
alter table public.scripts enable row level security;
revoke all on public.scripts from anon;
grant select, insert, update, delete on public.scripts to authenticated;

drop policy if exists "scripts_owner_all" on public.scripts;
drop policy if exists "scripts_team_access" on public.scripts;
drop policy if exists "scripts_access" on public.scripts;

create policy "scripts_access" on public.scripts
  for all to authenticated
  using (
    (select auth.uid()) = user_id
    or public.is_team_member(user_id)
  )
  with check (
    (select auth.uid()) = user_id
    or public.is_team_member(user_id)
  );

-- 6. Segurança RLS nas tabelas de equipe
alter table public.teams enable row level security;
revoke all on public.teams from anon;
grant select, update on public.teams to authenticated;

drop policy if exists "teams_owner_access" on public.teams;
create policy "teams_owner_access" on public.teams
  for all to authenticated
  using ((select auth.uid()) = owner_id)
  with check ((select auth.uid()) = owner_id);

alter table public.team_members enable row level security;
revoke all on public.team_members from anon;
grant select, delete on public.team_members to authenticated;

drop policy if exists "team_members_access" on public.team_members;
create policy "team_members_access" on public.team_members
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.teams t
       where t.id = team_members.team_id
         and t.owner_id = (select auth.uid())
    )
  );

-- 7. Funções de equipe (geração de convite, entrada, listagem e remoção)

-- Cria ou recupera a equipe do dono com o código de convite atual
create or replace function public.get_or_create_my_team()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team record;
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
begin
  if v_user_id is null then
    raise exception 'Não autenticado';
  end if;

  select * into v_team from public.teams where owner_id = v_user_id;
  if not found then
    insert into public.teams (owner_id, owner_email, invite_code)
    values (v_user_id, coalesce(v_user_email, ''), replace(gen_random_uuid()::text, '-', ''))
    returning * into v_team;
  elsif v_team.owner_email = '' and v_user_email is not null and v_user_email <> '' then
    update public.teams
       set owner_email = v_user_email
     where id = v_team.id;
  end if;

  return jsonb_build_object(
    'id', v_team.id,
    'owner_id', v_team.owner_id,
    'invite_code', v_team.invite_code,
    'created_at', v_team.created_at
  );
end;
$$;

-- Gera um novo código de convite invalidando o link antigo
create or replace function public.regenerate_invite_code()
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_new_code text := replace(gen_random_uuid()::text, '-', '');
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
begin
  if v_user_id is null then
    raise exception 'Não autenticado';
  end if;

  insert into public.teams (owner_id, owner_email, invite_code)
  values (v_user_id, coalesce(v_user_email, ''), v_new_code)
  on conflict (owner_id) do update
    set invite_code = v_new_code,
        owner_email = coalesce(nullif(excluded.owner_email, ''), public.teams.owner_email),
        updated_at = now();

  return v_new_code;
end;
$$;

-- Aceita o convite e vincula o usuário autenticado à equipe do dono
create or replace function public.join_team(p_invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_team record;
  v_user_id uuid := auth.uid();
  v_user_email text := auth.jwt() ->> 'email';
begin
  if v_user_id is null then
    raise exception 'Você precisa estar logado para aceitar o convite.';
  end if;

  select * into v_team from public.teams where invite_code = trim(coalesce(p_invite_code, ''));
  if not found then
    raise exception 'Convite inválido ou expirado.';
  end if;

  if v_team.owner_id = v_user_id then
    return jsonb_build_object('status', 'owner', 'team_id', v_team.id);
  end if;

  insert into public.team_members (team_id, user_id, email, joined_at)
  values (v_team.id, v_user_id, coalesce(v_user_email, ''), now())
  on conflict (team_id, user_id) do update
    set joined_at = now(),
        email = coalesce(nullif(excluded.email, ''), public.team_members.email);

  return jsonb_build_object(
    'status', 'joined',
    'team_id', v_team.id,
    'owner_id', v_team.owner_id,
    'owner_email', coalesce(nullif(v_team.owner_email, ''), 'Proprietário')
  );
end;
$$;

-- Lista os membros da equipe para o dono
create or replace function public.get_team_members()
returns table (
  id uuid,
  user_id uuid,
  email text,
  joined_at timestamptz,
  role text
)
language sql
security definer
set search_path = public, extensions
as $$
  select tm.id, tm.user_id, coalesce(nullif(tm.email, ''), 'Colaborador') as email, tm.joined_at, tm.role
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where t.owner_id = auth.uid()
   order by tm.joined_at desc;
$$;

-- Remove um membro da equipe (ação do dono)
create or replace function public.remove_team_member(p_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.team_members tm
   using public.teams t
   where tm.id = p_member_id
     and tm.team_id = t.id
     and t.owner_id = auth.uid();
  return found;
end;
$$;

-- Retorna as equipes ativas das quais o usuário logado participa
create or replace function public.get_my_active_teams()
returns table (
  team_id uuid,
  owner_id uuid,
  owner_email text,
  joined_at timestamptz,
  role text
)
language sql
security definer
set search_path = public, extensions
as $$
  select t.id as team_id,
         t.owner_id,
         coalesce(nullif(t.owner_email, ''), 'Proprietário') as owner_email,
         tm.joined_at,
         tm.role
    from public.team_members tm
    join public.teams t on t.id = tm.team_id
   where tm.user_id = auth.uid()
   order by tm.joined_at desc;
$$;

-- Sai de uma equipe (ação do próprio membro)
create or replace function public.leave_team(p_team_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  delete from public.team_members
   where team_id = p_team_id
     and user_id = auth.uid();
  return found;
end;
$$;

-- Contador de cópias compatível com dono e membros da equipe
create or replace function public.increment_script_use(p_id uuid)
returns public.scripts
language sql
security definer
set search_path = public, extensions
as $$
  update public.scripts
     set use_count = use_count + 1
   where id = p_id
     and (user_id = (select auth.uid()) or public.is_team_member(user_id))
  returning *;
$$;

-- Permissões de execução para usuários autenticados
revoke all on function public.get_or_create_my_team() from public, anon;
grant execute on function public.get_or_create_my_team() to authenticated;

revoke all on function public.regenerate_invite_code() from public, anon;
grant execute on function public.regenerate_invite_code() to authenticated;

revoke all on function public.join_team(text) from public, anon;
grant execute on function public.join_team(text) to authenticated;

revoke all on function public.get_team_members() from public, anon;
grant execute on function public.get_team_members() to authenticated;

revoke all on function public.remove_team_member(uuid) from public, anon;
grant execute on function public.remove_team_member(uuid) to authenticated;

revoke all on function public.get_my_active_teams() from public, anon;
grant execute on function public.get_my_active_teams() to authenticated;

revoke all on function public.leave_team(uuid) from public, anon;
grant execute on function public.leave_team(uuid) to authenticated;

revoke all on function public.increment_script_use(uuid) from public, anon;
grant execute on function public.increment_script_use(uuid) to authenticated;
