begin;

create extension if not exists pgcrypto;

do $$ begin
  create type public.app_user_status as enum ('invited', 'active', 'blocked', 'inactive');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.cycle_status as enum ('open', 'review', 'closed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.request_type as enum ('priority', 'transfer');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.request_status as enum ('draft', 'pending_review', 'in_review', 'correction_requested', 'resubmitted', 'approved', 'not_approved', 'cancelled', 'under_revision', 'admin_adjusted');
exception when duplicate_object then null; end $$;
do $$ begin
  create type public.movement_type as enum ('credit', 'reversal', 'positive_adjustment', 'negative_adjustment');
exception when duplicate_object then null; end $$;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code in ('analyst', 'manager', 'administrator')),
  name text not null,
  created_at timestamptz not null default now()
);

-- Compatibilidade temporária com as métricas históricas da SPA. Solicitações oficiais,
-- decisões e pontos novos nunca são gravados neste JSON.
create table if not exists public.rankpro_store (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  legacy_user_key text unique,
  first_name text not null,
  last_name text,
  display_name text generated always as (trim(first_name || ' ' || coalesce(last_name, ''))) stored,
  avatar_url text,
  -- Perfis importados do ranking legado ainda não possuem e-mail. O campo passa a
  -- ser obrigatório quando uma conta do Auth é vinculada à ficha.
  corporate_email text unique,
  phone text,
  job_title text,
  status public.app_user_status not null default 'invited',
  role_id uuid not null references public.roles(id),
  primary_team_id uuid references public.teams(id),
  responsible_manager_id uuid references public.users(id),
  team_joined_at date,
  team_left_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_access_at timestamptz,
  check (auth_user_id is null or corporate_email is not null)
);

create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  team_id uuid not null references public.teams(id),
  manager_id uuid references public.users(id),
  valid_from date not null,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  check (valid_to is null or valid_to >= valid_from)
);
create unique index if not exists team_memberships_one_current_idx on public.team_memberships(user_id) where valid_to is null;

create table if not exists public.manager_teams (
  manager_id uuid not null references public.users(id),
  team_id uuid not null references public.teams(id),
  valid_from date not null default current_date,
  valid_to date,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  primary key (manager_id, team_id, valid_from),
  check (valid_to is null or valid_to >= valid_from)
);

create table if not exists public.score_cycles (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  starts_on date not null,
  ends_on date not null,
  submission_deadline timestamptz,
  review_deadline timestamptz,
  status public.cycle_status not null default 'open',
  closed_at timestamptz,
  closed_by uuid references public.users(id),
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  check (ends_on >= starts_on)
);

create table if not exists public.point_rules (
  id uuid primary key default gen_random_uuid(),
  request_type public.request_type not null,
  team_id uuid not null references public.teams(id),
  cycle_id uuid references public.score_cycles(id),
  version integer not null check (version > 0),
  points numeric(12,2) not null check (points >= 0),
  criteria text not null,
  eligible_examples text,
  ineligible_examples text,
  required_evidences jsonb not null default '[]'::jsonb,
  registration_deadline_hours integer check (registration_deadline_hours is null or registration_deadline_hours > 0),
  review_sla_hours integer check (review_sla_hours is null or review_sla_hours > 0),
  effective_from timestamptz not null,
  effective_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id),
  unique (request_type, team_id, version),
  check (effective_until is null or effective_until > effective_from)
);

create table if not exists public.requests (
  id uuid primary key default gen_random_uuid(),
  public_number bigint generated always as identity unique,
  request_type public.request_type not null,
  status public.request_status not null default 'draft',
  analyst_id uuid not null references public.users(id),
  team_id uuid not null references public.teams(id),
  manager_id uuid references public.users(id),
  score_cycle_id uuid not null references public.score_cycles(id),
  point_rule_id uuid not null references public.point_rules(id),
  point_rule_version integer not null,
  expected_points numeric(12,2) not null,
  granted_points numeric(12,2),
  protocol text not null,
  client_name text not null,
  occurred_at timestamptz not null,
  description text not null,
  complementary_note text,
  category text,
  priority_reason text,
  criteria_evidence text,
  source_area text,
  destination_area text,
  destination_analyst_id uuid references public.users(id),
  transfer_reason text,
  duplicate_suspected boolean not null default false,
  duplicate_of_id uuid references public.requests(id),
  editable_fields text[] not null default '{}',
  version integer not null default 1,
  submitted_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (granted_points is null or granted_points >= 0)
);
create index if not exists requests_analyst_cycle_idx on public.requests(analyst_id, score_cycle_id, created_at desc);
create index if not exists requests_team_status_idx on public.requests(team_id, status, submitted_at);
create index if not exists requests_protocol_idx on public.requests(protocol);

create table if not exists public.request_evidences (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id),
  storage_path text not null,
  original_name text not null,
  mime_type text not null,
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  sha256 text,
  uploaded_by uuid not null references public.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.request_events (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id),
  event_type text not null,
  from_status public.request_status,
  to_status public.request_status,
  actor_id uuid not null references public.users(id),
  actor_role text not null,
  public_note text,
  private_note text,
  changed_fields jsonb,
  request_snapshot jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists request_events_request_idx on public.request_events(request_id, created_at);

create table if not exists public.manager_decisions (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.requests(id),
  manager_id uuid not null references public.users(id),
  decision text not null check (decision in ('approve', 'request_correction', 'not_approve')),
  standardized_reason text,
  explanation text,
  analyst_guidance text,
  allowed_fields text[] not null default '{}',
  expected_points numeric(12,2) not null,
  granted_points numeric(12,2) not null default 0,
  point_change_justification text,
  created_at timestamptz not null default now()
);

create table if not exists public.point_ledger (
  id uuid primary key default gen_random_uuid(),
  analyst_id uuid not null references public.users(id),
  request_id uuid references public.requests(id),
  movement_type public.movement_type not null,
  quantity numeric(12,2) not null check (quantity <> 0),
  score_cycle_id uuid not null references public.score_cycles(id),
  point_rule_id uuid references public.point_rules(id),
  point_rule_version integer,
  occurred_at timestamptz not null,
  approved_at timestamptz,
  manager_id uuid references public.users(id),
  reason text,
  reverses_entry_id uuid references public.point_ledger(id),
  valid boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid not null references public.users(id)
);
create unique index if not exists point_ledger_one_request_credit_idx on public.point_ledger(request_id) where request_id is not null and movement_type = 'credit';
create unique index if not exists point_ledger_one_request_reversal_idx on public.point_ledger(request_id) where request_id is not null and movement_type = 'reversal';
create index if not exists point_ledger_ranking_idx on public.point_ledger(score_cycle_id, analyst_id) where valid;

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id),
  notification_type text not null,
  title text not null,
  message text not null,
  link text,
  related_request_id uuid references public.requests(id),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id),
  actor_auth_user_id uuid,
  actor_role text,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  previous_state jsonb,
  new_state jsonb,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_logs_entity_idx on public.audit_logs(entity_type, entity_id, created_at desc);

create table if not exists public.cycle_ranking_snapshots (
  id uuid primary key default gen_random_uuid(),
  score_cycle_id uuid not null references public.score_cycles(id),
  team_id uuid not null references public.teams(id),
  analyst_id uuid not null references public.users(id),
  rank integer not null,
  final_points numeric(12,2) not null,
  prize_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(score_cycle_id, team_id, analyst_id)
);

insert into public.roles(code, name) values
  ('analyst', 'Analista'), ('manager', 'Gestor'), ('administrator', 'Administrador')
on conflict (code) do update set name = excluded.name;

insert into public.permissions(code, description) values
  ('request.create', 'Criar e acompanhar solicitações próprias'),
  ('request.review', 'Analisar solicitações das equipes gerenciadas'),
  ('request.adjust_points', 'Alterar pontos previstos com justificativa'),
  ('team.manage', 'Gerenciar usuários, equipes e gestores'),
  ('rules.manage', 'Gerenciar regras de pontuação'),
  ('cycles.manage', 'Gerenciar e fechar ciclos'),
  ('audit.read', 'Consultar auditoria')
on conflict (code) do update set description = excluded.description;

insert into public.role_permissions(role_id, permission_id)
select r.id, p.id from public.roles r join public.permissions p on
  (r.code = 'analyst' and p.code = 'request.create') or
  (r.code = 'manager' and p.code in ('request.create','request.review')) or
  (r.code = 'administrator')
on conflict do nothing;

insert into public.teams(code, name) values ('Sistema', 'Software'), ('Catraca', 'Catraca')
on conflict (code) do update set name = excluded.name;

insert into public.score_cycles(code,name,starts_on,ends_on,submission_deadline,review_deadline,status)
values('2026-08','Agosto de 2026','2026-08-01','2026-08-31','2026-08-31 23:59:59-03','2026-09-05 23:59:59-03','open')
on conflict(code) do nothing;

insert into public.point_rules(request_type,team_id,cycle_id,version,points,criteria,eligible_examples,ineligible_examples,required_evidences,registration_deadline_hours,review_sla_hours,effective_from,active)
select rule_type::public.request_type,t.id,c.id,1,points,criteria,eligible,ineligible,evidences::jsonb,deadline_hours,48,'2026-08-01 00:00:00-03',true
from public.teams t cross join public.score_cycles c cross join (values
  ('priority',50::numeric,'Demanda prioritária atribuída pela gestão, concluída e validada.','Prioridade concluída com protocolo e evidência verificável.','Pedido sem atribuição da gestão ou sem evidência.','["protocolo","justificativa","evidencia"]',744),
  ('transfer',1::numeric,'Transferência de atendimento registrada com protocolo, origem, destino e justificativa válida.','Transferência necessária e documentada entre áreas.','Transferência sem protocolo ou sem justificativa operacional.','["protocolo","origem","destino","justificativa"]',744)
) as seed(rule_type,points,criteria,eligible,ineligible,evidences,deadline_hours)
where t.code in ('Sistema','Catraca') and c.code='2026-08'
on conflict(request_type,team_id,version) do nothing;

create or replace function public.current_app_user_id()
returns uuid language sql stable security definer set search_path = public, auth as $$
  select id from public.users where auth_user_id = auth.uid() limit 1
$$;

create or replace function public.current_app_role()
returns text language sql stable security definer set search_path = public, auth as $$
  select r.code from public.users u join public.roles r on r.id = u.role_id
  where u.auth_user_id = auth.uid() and u.status = 'active' limit 1
$$;

create or replace function public.current_app_team_id()
returns uuid language sql stable security definer set search_path = public, auth as $$
  select primary_team_id from public.users where auth_user_id = auth.uid() and status = 'active' limit 1
$$;

create or replace function public.current_user_active()
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists(select 1 from public.users where auth_user_id = auth.uid() and status = 'active')
$$;

-- Converte as fichas existentes no rankpro_store em perfis oficiais sem copiar
-- solicitações ou créditos históricos. A legacy_user_key mantém o vínculo entre
-- dashboard, ranking e futura identidade autenticada. É seguro executar novamente:
-- perfis já vinculados ao Auth nunca têm papel, equipe ou status sobrescritos.
create or replace function public.import_legacy_profiles()
returns integer language plpgsql security definer set search_path = public, auth as $$
declare
  v_key text;
  v_legacy jsonb;
  v_name text;
  v_first_name text;
  v_last_name text;
  v_team_id uuid;
  v_role_id uuid;
  v_auth_user_id uuid;
  v_corporate_email text;
  v_user_id uuid;
  v_imported integer := 0;
begin
  if auth.uid() is not null and coalesce(public.current_app_role(), '') <> 'administrator' then
    raise exception 'Somente administradores podem importar fichas legadas';
  end if;

  for v_key, v_legacy in
    select legacy.key, legacy.value
    from public.rankpro_store store
    cross join lateral jsonb_each(coalesce(store.data->'users', '{}'::jsonb)) legacy
    where store.id = 'global_store'
  loop
    v_name := nullif(btrim(v_legacy->>'name'), '');
    if v_name is null then continue; end if;
    v_first_name := split_part(v_name, ' ', 1);
    v_last_name := nullif(btrim(substr(v_name, length(v_first_name) + 1)), '');

    select id into v_team_id from public.teams where code = v_legacy->>'team' limit 1;
    v_corporate_email := case
      when v_key = 'jo_o_gabriel_nr3' then 'jg@actuar.com'
      else null
    end;
    v_auth_user_id := null;
    if v_corporate_email is not null then
      select id into v_auth_user_id from auth.users
      where lower(email) = lower(v_corporate_email) limit 1;
    end if;

    select id into v_role_id from public.roles
      where code = case when v_legacy->>'role' = 'Gestor Adm' then 'administrator' else 'analyst' end
      limit 1;

    insert into public.users(
      auth_user_id, legacy_user_key, first_name, last_name, avatar_url, corporate_email,
      job_title, status, role_id, primary_team_id, team_joined_at
    ) values (
      v_auth_user_id, v_key, v_first_name, v_last_name, nullif(v_legacy->>'photo', ''), v_corporate_email,
      nullif(v_legacy->>'role', ''),
      case when coalesce((v_legacy->>'active')::boolean, true) then 'active'::public.app_user_status else 'inactive'::public.app_user_status end,
      v_role_id, v_team_id, '2026-08-01'
    )
    on conflict (legacy_user_key) do update set
      first_name = case when public.users.auth_user_id is null then excluded.first_name else public.users.first_name end,
      last_name = case when public.users.auth_user_id is null then excluded.last_name else public.users.last_name end,
      auth_user_id = coalesce(public.users.auth_user_id, excluded.auth_user_id),
      corporate_email = coalesce(public.users.corporate_email, excluded.corporate_email),
      avatar_url = coalesce(public.users.avatar_url, excluded.avatar_url),
      job_title = case when public.users.auth_user_id is null then excluded.job_title else public.users.job_title end,
      status = case when public.users.auth_user_id is null then excluded.status else public.users.status end,
      role_id = case when public.users.auth_user_id is null then excluded.role_id else public.users.role_id end,
      primary_team_id = case when public.users.auth_user_id is null then excluded.primary_team_id else public.users.primary_team_id end,
      team_joined_at = coalesce(public.users.team_joined_at, excluded.team_joined_at),
      updated_at = now()
    returning id into v_user_id;

    if v_team_id is not null and not exists (
      select 1 from public.team_memberships where user_id = v_user_id and valid_to is null
    ) then
      insert into public.team_memberships(user_id, team_id, valid_from)
      values(v_user_id, v_team_id, '2026-08-01');
    end if;
    v_imported := v_imported + 1;
  end loop;
  return v_imported;
end $$;

select public.import_legacy_profiles();

create or replace function public.get_legacy_performance_store()
returns jsonb language plpgsql stable security definer set search_path=public,auth as $$
declare v_data jsonb; v_version bigint; v_logs jsonb; v_history jsonb; v_users jsonb;
begin
  select data,version into v_data,v_version from public.rankpro_store where id='global_store';
  if v_data is null then return jsonb_build_object('data',null,'version',0); end if;
  if public.current_app_role()='administrator' then return jsonb_build_object('data',v_data,'version',v_version); end if;
  select coalesce(jsonb_agg(item - 'monitoramentoFeedback' - 'monitoramentoProtocolo' - 'reason' - 'clientId'),'[]'::jsonb)
    into v_logs from jsonb_array_elements(coalesce(v_data->'logs','[]'::jsonb)) item;
  select coalesce(jsonb_object_agg(user_key,user_value - 'email' - 'phone' - 'identifier' - 'hasPassword'),'{}'::jsonb)
    into v_users from jsonb_each(coalesce(v_data->'users','{}'::jsonb)) as legacy_user(user_key,user_value);
  if public.current_app_role()='manager' then
    select coalesce(jsonb_object_agg(user_key,user_value),'{}'::jsonb) into v_users
    from jsonb_each(v_users) scoped_user(user_key,user_value)
    where exists (
      select 1 from public.manager_teams mt join public.teams t on t.id=mt.team_id
      where mt.manager_id=public.current_app_user_id() and t.code=user_value->>'team'
        and mt.valid_from<=current_date and (mt.valid_to is null or mt.valid_to>=current_date)
    );
    select coalesce(jsonb_agg(item),'[]'::jsonb) into v_logs
    from jsonb_array_elements(v_logs) item where v_users ? (item->>'userId');
  end if;
  select coalesce(jsonb_agg(
    case when month ? 'logs' then jsonb_set(month,'{logs}',(
      select coalesce(jsonb_agg(log_item - 'monitoramentoFeedback' - 'monitoramentoProtocolo' - 'reason' - 'clientId'),'[]'::jsonb)
      from jsonb_array_elements(coalesce(month->'logs','[]'::jsonb)) log_item
      where public.current_app_role()<>'manager' or v_users ? (log_item->>'userId')
    )) else month end
  ),'[]'::jsonb) into v_history from jsonb_array_elements(coalesce(v_data->'history','[]'::jsonb)) month;
  v_data:=jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(v_data,'{users}',v_users),'{logs}',v_logs),'{history}',v_history),'{priorityRequests}','[]'::jsonb),'{transferRequests}','[]'::jsonb);
  return jsonb_build_object('data',v_data,'version',v_version);
end $$;

create or replace function public.has_permission(p_code text)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select exists(
    select 1 from public.users u
    join public.role_permissions rp on rp.role_id = u.role_id
    join public.permissions p on p.id = rp.permission_id
    where u.auth_user_id = auth.uid() and u.status = 'active' and p.code = p_code
  )
$$;

create or replace function public.manages_team(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public, auth as $$
  select public.current_app_role() = 'administrator' or exists(
    select 1 from public.manager_teams mt
    where mt.manager_id = public.current_app_user_id() and mt.team_id = p_team_id
      and mt.valid_from <= current_date and (mt.valid_to is null or mt.valid_to >= current_date)
  )
$$;

create or replace function public.audit_event(p_action text, p_entity_type text, p_entity_id uuid, p_previous jsonb, p_new jsonb, p_context jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, auth as $$
begin
  insert into public.audit_logs(actor_id, actor_auth_user_id, actor_role, action, entity_type, entity_id, previous_state, new_state, context)
  values(public.current_app_user_id(), auth.uid(), public.current_app_role(), p_action, p_entity_type, p_entity_id, p_previous, p_new, coalesce(p_context, '{}'::jsonb));
end $$;

create or replace function public.record_login()
returns public.users language plpgsql security definer set search_path = public, auth as $$
declare v_user public.users;
begin
  update public.users set last_access_at = now(), updated_at = now()
  where auth_user_id = auth.uid() and status = 'active' returning * into v_user;
  if v_user.id is null then raise exception 'Usuário não está ativo ou não possui perfil'; end if;
  perform public.audit_event('login', 'user', v_user.id, null, to_jsonb(v_user));
  return v_user;
end $$;

create or replace function public.handle_new_auth_user()
returns trigger language plpgsql security definer set search_path = public, auth as $$
declare v_role uuid;
begin
  select id into v_role from public.roles where code = 'analyst';
  insert into public.users(auth_user_id, first_name, last_name, corporate_email, role_id, status)
  values(new.id, coalesce(nullif(new.raw_user_meta_data->>'first_name',''), split_part(new.email,'@',1)), nullif(new.raw_user_meta_data->>'last_name',''), new.email, v_role, 'invited')
  on conflict (corporate_email) do update set auth_user_id = excluded.auth_user_id, updated_at = now();
  return new;
end $$;
drop trigger if exists on_auth_user_created_performance on auth.users;
create trigger on_auth_user_created_performance after insert on auth.users for each row execute function public.handle_new_auth_user();

-- Usada exclusivamente pela Edge Function com service role. Remove o perfil
-- provisório criado pelo trigger e associa a conta Auth à ficha histórica na mesma
-- transação, impedindo duplicidade de identidade.
create or replace function public.link_invited_auth_user(
  p_auth_user_id uuid,
  p_email text,
  p_first_name text,
  p_last_name text default null,
  p_legacy_user_key text default null
) returns public.users language plpgsql security definer set search_path = public, auth as $$
declare v_provisional_id uuid; v_target_id uuid; v_profile public.users;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Operação restrita ao serviço de autenticação';
  end if;
  if nullif(btrim(p_email), '') is null or nullif(btrim(p_first_name), '') is null then
    raise exception 'E-mail e nome são obrigatórios';
  end if;

  select id into v_provisional_id from public.users where auth_user_id = p_auth_user_id for update;
  if nullif(btrim(p_legacy_user_key), '') is not null then
    select id into v_target_id from public.users
      where legacy_user_key = btrim(p_legacy_user_key) for update;
    if v_target_id is null then raise exception 'Ficha legada não encontrada'; end if;
    if v_provisional_id is not null and v_provisional_id <> v_target_id then
      delete from public.users where id = v_provisional_id;
    end if;
  else
    v_target_id := v_provisional_id;
  end if;
  if v_target_id is null then raise exception 'Perfil provisório do convite não encontrado'; end if;

  update public.users set
    auth_user_id = p_auth_user_id,
    corporate_email = lower(btrim(p_email)),
    first_name = case when legacy_user_key is null then btrim(p_first_name) else first_name end,
    last_name = case when legacy_user_key is null then nullif(btrim(p_last_name), '') else last_name end,
    status = 'invited',
    updated_at = now()
  where id = v_target_id returning * into v_profile;
  return v_profile;
end $$;

create or replace function public.request_snapshot(p_request public.requests)
returns jsonb language sql immutable as $$ select to_jsonb(p_request) $$;

create or replace function public.create_request(
  p_type public.request_type, p_protocol text, p_client_name text, p_occurred_at timestamptz,
  p_description text, p_complementary_note text default null, p_category text default null,
  p_priority_reason text default null, p_criteria_evidence text default null,
  p_source_area text default null, p_destination_area text default null,
  p_destination_analyst_id uuid default null, p_transfer_reason text default null,
  p_submit boolean default true
) returns public.requests language plpgsql security definer set search_path = public, auth as $$
declare v_actor public.users; v_cycle public.score_cycles; v_rule public.point_rules; v_request public.requests; v_duplicate uuid;
begin
  select * into v_actor from public.users where auth_user_id = auth.uid() and status = 'active' for share;
  if v_actor.id is null then raise exception 'Usuário sem permissão'; end if;
  select * into v_cycle from public.score_cycles where p_occurred_at::date between starts_on and ends_on order by starts_on desc limit 1;
  if v_cycle.id is null then raise exception 'Nenhum ciclo cobre a data da ocorrência'; end if;
  if v_cycle.status <> 'open' then raise exception 'Ciclo não aceita novas solicitações'; end if;
  select * into v_rule from public.point_rules
    where request_type = p_type and team_id = v_actor.primary_team_id and active
      and effective_from <= p_occurred_at and (effective_until is null or effective_until > p_occurred_at)
      and (cycle_id is null or cycle_id = v_cycle.id)
    order by (cycle_id is not null) desc, version desc limit 1;
  if v_rule.id is null then raise exception 'Regra vigente não encontrada'; end if;
  select id into v_duplicate from public.requests where analyst_id = v_actor.id and protocol = trim(p_protocol)
    and request_type = p_type and status not in ('cancelled','not_approved') limit 1;
  insert into public.requests(request_type,status,analyst_id,team_id,manager_id,score_cycle_id,point_rule_id,point_rule_version,expected_points,
    protocol,client_name,occurred_at,description,complementary_note,category,priority_reason,criteria_evidence,source_area,destination_area,
    destination_analyst_id,transfer_reason,duplicate_suspected,duplicate_of_id,submitted_at)
  values(p_type,case when p_submit then 'pending_review' else 'draft' end,v_actor.id,v_actor.primary_team_id,v_actor.responsible_manager_id,
    v_cycle.id,v_rule.id,v_rule.version,v_rule.points,trim(p_protocol),trim(p_client_name),p_occurred_at,trim(p_description),p_complementary_note,
    p_category,p_priority_reason,p_criteria_evidence,p_source_area,p_destination_area,p_destination_analyst_id,p_transfer_reason,
    v_duplicate is not null,v_duplicate,case when p_submit then now() end) returning * into v_request;
  insert into public.request_events(request_id,event_type,to_status,actor_id,actor_role,public_note,request_snapshot)
  values(v_request.id,case when p_submit then 'submitted' else 'created' end,v_request.status,v_actor.id,public.current_app_role(),null,to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id)
  select mt.manager_id,'new_request','Nova solicitação',v_actor.display_name || ' enviou uma solicitação para análise.', '#/approvals/' || v_request.id,v_request.id
  from public.manager_teams mt where mt.team_id = v_actor.primary_team_id and mt.valid_from <= current_date and (mt.valid_to is null or mt.valid_to >= current_date) and p_submit;
  perform public.audit_event(case when p_submit then 'request.submitted' else 'request.created' end,'request',v_request.id,null,to_jsonb(v_request));
  return v_request;
end $$;

create or replace function public.submit_request(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_before jsonb;
begin
  select * into v_request from public.requests where id = p_request_id for update;
  if v_request.analyst_id <> public.current_app_user_id() or v_request.status <> 'draft' then raise exception 'Operação não permitida'; end if;
  if (select status from public.score_cycles where id = v_request.score_cycle_id) <> 'open' then raise exception 'Ciclo não está aberto'; end if;
  v_before := to_jsonb(v_request);
  update public.requests set status='pending_review',submitted_at=now(),updated_at=now(),version=version+1 where id=p_request_id returning * into v_request;
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,request_snapshot) values(v_request.id,'submitted','draft',v_request.status,public.current_app_user_id(),public.current_app_role(),to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id)
  select mt.manager_id,'new_request','Nova solicitação','Uma solicitação foi enviada para análise.','#/approvals/'||v_request.id,v_request.id
  from public.manager_teams mt where mt.team_id=v_request.team_id and mt.valid_from<=current_date and (mt.valid_to is null or mt.valid_to>=current_date);
  perform public.audit_event('request.submitted','request',v_request.id,v_before,to_jsonb(v_request));
  return v_request;
end $$;

create or replace function public.update_draft_request(p_request_id uuid,p_patch jsonb)
returns public.requests language plpgsql security definer set search_path=public,auth as $$
declare v_request public.requests; v_before jsonb; v_key text;
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if v_request.analyst_id<>public.current_app_user_id() or v_request.status<>'draft' then raise exception 'Somente o próprio rascunho pode ser editado'; end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if v_key<>all(array['protocol','client_name','occurred_at','description','complementary_note','category','priority_reason','criteria_evidence','source_area','destination_area','destination_analyst_id','transfer_reason']) then raise exception 'Campo não editável: %',v_key; end if;
  end loop;
  v_before:=to_jsonb(v_request);
  update public.requests set
    protocol=coalesce(p_patch->>'protocol',protocol),client_name=coalesce(p_patch->>'client_name',client_name),
    occurred_at=case when p_patch?'occurred_at' then (p_patch->>'occurred_at')::timestamptz else occurred_at end,
    description=coalesce(p_patch->>'description',description),complementary_note=case when p_patch?'complementary_note' then p_patch->>'complementary_note' else complementary_note end,
    category=case when p_patch?'category' then p_patch->>'category' else category end,priority_reason=case when p_patch?'priority_reason' then p_patch->>'priority_reason' else priority_reason end,
    criteria_evidence=case when p_patch?'criteria_evidence' then p_patch->>'criteria_evidence' else criteria_evidence end,source_area=case when p_patch?'source_area' then p_patch->>'source_area' else source_area end,
    destination_area=case when p_patch?'destination_area' then p_patch->>'destination_area' else destination_area end,
    destination_analyst_id=case when p_patch?'destination_analyst_id' then nullif(p_patch->>'destination_analyst_id','')::uuid else destination_analyst_id end,
    transfer_reason=case when p_patch?'transfer_reason' then p_patch->>'transfer_reason' else transfer_reason end,updated_at=now(),version=version+1
  where id=p_request_id returning * into v_request;
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,changed_fields,request_snapshot) values(v_request.id,'draft_updated','draft','draft',public.current_app_user_id(),public.current_app_role(),p_patch,to_jsonb(v_request));
  perform public.audit_event('request.draft_updated','request',v_request.id,v_before,to_jsonb(v_request)); return v_request;
end $$;

create or replace function public.begin_request_review(p_request_id uuid)
returns public.requests language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_actor uuid := public.current_app_user_id(); v_before jsonb;
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if not public.has_permission('request.review') or not public.manages_team(v_request.team_id) or v_request.analyst_id=v_actor then raise exception 'Sem permissão para analisar'; end if;
  if v_request.status not in ('pending_review','resubmitted') then raise exception 'Status não permite iniciar análise'; end if;
  v_before:=to_jsonb(v_request);
  update public.requests set status='in_review',manager_id=v_actor,updated_at=now(),version=version+1 where id=p_request_id returning * into v_request;
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,request_snapshot) values(v_request.id,'review_started',(v_before->>'status')::public.request_status,v_request.status,v_actor,public.current_app_role(),to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id) values(v_request.analyst_id,'request_in_review','Solicitação em análise','A gestão iniciou a análise da sua solicitação.','#/requests/'||v_request.id,v_request.id);
  perform public.audit_event('request.review_started','request',v_request.id,v_before,to_jsonb(v_request)); return v_request;
end $$;

create or replace function public.request_correction(p_request_id uuid,p_explanation text,p_allowed_fields text[])
returns public.requests language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_before jsonb; v_actor uuid:=public.current_app_user_id();
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if not public.has_permission('request.review') or not public.manages_team(v_request.team_id) or v_request.analyst_id=v_actor then raise exception 'Sem permissão'; end if;
  if v_request.status <> 'in_review' or trim(coalesce(p_explanation,''))='' or cardinality(p_allowed_fields)=0 then raise exception 'Informe a correção e os campos liberados'; end if;
  v_before:=to_jsonb(v_request);
  update public.requests set status='correction_requested',editable_fields=p_allowed_fields,updated_at=now(),version=version+1 where id=p_request_id returning * into v_request;
  insert into public.manager_decisions(request_id,manager_id,decision,explanation,allowed_fields,expected_points) values(v_request.id,v_actor,'request_correction',p_explanation,p_allowed_fields,v_request.expected_points);
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,public_note,request_snapshot) values(v_request.id,'correction_requested','in_review',v_request.status,v_actor,public.current_app_role(),p_explanation,to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id) values(v_request.analyst_id,'correction_requested','Correção solicitada',p_explanation,'#/requests/'||v_request.id,v_request.id);
  perform public.audit_event('request.correction_requested','request',v_request.id,v_before,to_jsonb(v_request)); return v_request;
end $$;

create or replace function public.resubmit_request(p_request_id uuid,p_patch jsonb,p_note text default null)
returns public.requests language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_before jsonb; v_allowed text; v_forbidden text[] := '{}';
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if v_request.analyst_id<>public.current_app_user_id() or v_request.status<>'correction_requested' then raise exception 'Operação não permitida'; end if;
  for v_allowed in select jsonb_object_keys(p_patch) loop if not (v_allowed=any(v_request.editable_fields)) then v_forbidden:=array_append(v_forbidden,v_allowed); end if; end loop;
  if cardinality(v_forbidden)>0 then raise exception 'Campos não autorizados: %',array_to_string(v_forbidden,', '); end if;
  v_before:=to_jsonb(v_request);
  update public.requests set
    protocol=case when p_patch?'protocol' then p_patch->>'protocol' else protocol end,
    client_name=case when p_patch?'client_name' then p_patch->>'client_name' else client_name end,
    description=case when p_patch?'description' then p_patch->>'description' else description end,
    complementary_note=case when p_patch?'complementary_note' then p_patch->>'complementary_note' else complementary_note end,
    priority_reason=case when p_patch?'priority_reason' then p_patch->>'priority_reason' else priority_reason end,
    criteria_evidence=case when p_patch?'criteria_evidence' then p_patch->>'criteria_evidence' else criteria_evidence end,
    transfer_reason=case when p_patch?'transfer_reason' then p_patch->>'transfer_reason' else transfer_reason end,
    status='resubmitted',editable_fields='{}',updated_at=now(),version=version+1
  where id=p_request_id returning * into v_request;
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,public_note,changed_fields,request_snapshot) values(v_request.id,'resubmitted','correction_requested',v_request.status,public.current_app_user_id(),public.current_app_role(),p_note,p_patch,to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id) select mt.manager_id,'request_resubmitted','Solicitação reenviada','Uma solicitação corrigida foi reenviada.','#/approvals/'||v_request.id,v_request.id from public.manager_teams mt where mt.team_id=v_request.team_id and mt.valid_from<=current_date and (mt.valid_to is null or mt.valid_to>=current_date);
  perform public.audit_event('request.resubmitted','request',v_request.id,v_before,to_jsonb(v_request)); return v_request;
end $$;

create or replace function public.approve_request(p_request_id uuid,p_granted_points numeric default null,p_comment text default null)
returns public.point_ledger language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_entry public.point_ledger; v_actor uuid:=public.current_app_user_id(); v_points numeric; v_before jsonb;
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if v_request.status='approved' then select * into v_entry from public.point_ledger where request_id=p_request_id and movement_type='credit'; return v_entry; end if;
  if not public.has_permission('request.review') or not public.manages_team(v_request.team_id) or v_request.analyst_id=v_actor then raise exception 'Sem permissão'; end if;
  if v_request.status<>'in_review' then raise exception 'Solicitação não está em análise'; end if;
  if (select status from public.score_cycles where id=v_request.score_cycle_id)='closed' then raise exception 'Ciclo fechado exige ajuste administrativo'; end if;
  v_points:=coalesce(p_granted_points,v_request.expected_points);
  if v_points<>v_request.expected_points and (not public.has_permission('request.adjust_points') or trim(coalesce(p_comment,''))='') then raise exception 'Alteração de pontos exige permissão e justificativa'; end if;
  v_before:=to_jsonb(v_request);
  insert into public.point_ledger(analyst_id,request_id,movement_type,quantity,score_cycle_id,point_rule_id,point_rule_version,occurred_at,approved_at,manager_id,reason,created_by)
  values(v_request.analyst_id,v_request.id,'credit',v_points,v_request.score_cycle_id,v_request.point_rule_id,v_request.point_rule_version,v_request.occurred_at,now(),v_actor,p_comment,v_actor)
  returning * into v_entry;
  update public.requests set status='approved',granted_points=v_points,manager_id=v_actor,decided_at=now(),updated_at=now(),editable_fields='{}',version=version+1 where id=p_request_id returning * into v_request;
  insert into public.manager_decisions(request_id,manager_id,decision,explanation,expected_points,granted_points,point_change_justification) values(v_request.id,v_actor,'approve',p_comment,v_request.expected_points,v_points,case when v_points<>v_request.expected_points then p_comment end);
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,public_note,request_snapshot) values(v_request.id,'approved','in_review',v_request.status,v_actor,public.current_app_role(),p_comment,to_jsonb(v_request));
  insert into public.request_events(request_id,event_type,to_status,actor_id,actor_role,public_note,request_snapshot) values(v_request.id,'points_credited',v_request.status,v_actor,public.current_app_role(),v_points||' pontos creditados',to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id) values(v_request.analyst_id,'request_approved','Solicitação aprovada',v_points||' pontos foram confirmados no seu extrato.','#/requests/'||v_request.id,v_request.id);
  perform public.audit_event('request.approved','request',v_request.id,v_before,to_jsonb(v_request));
  perform public.audit_event('points.credited','point_ledger',v_entry.id,null,to_jsonb(v_entry)); return v_entry;
end $$;

create or replace function public.not_approve_request(p_request_id uuid,p_reason text,p_explanation text,p_guidance text default null)
returns public.requests language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_before jsonb; v_actor uuid:=public.current_app_user_id();
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if not public.has_permission('request.review') or not public.manages_team(v_request.team_id) or v_request.analyst_id=v_actor then raise exception 'Sem permissão'; end if;
  if v_request.status<>'in_review' or trim(coalesce(p_reason,''))='' or trim(coalesce(p_explanation,''))='' then raise exception 'Motivo e explicação são obrigatórios'; end if;
  if p_reason='Outro motivo' and trim(coalesce(p_explanation,''))='' then raise exception 'Explique o outro motivo'; end if;
  v_before:=to_jsonb(v_request);
  update public.requests set status='not_approved',granted_points=0,manager_id=v_actor,decided_at=now(),updated_at=now(),editable_fields='{}',version=version+1 where id=p_request_id returning * into v_request;
  insert into public.manager_decisions(request_id,manager_id,decision,standardized_reason,explanation,analyst_guidance,expected_points,granted_points) values(v_request.id,v_actor,'not_approve',p_reason,p_explanation,p_guidance,v_request.expected_points,0);
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,public_note,request_snapshot) values(v_request.id,'not_approved','in_review',v_request.status,v_actor,public.current_app_role(),p_reason||': '||p_explanation,to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id) values(v_request.analyst_id,'request_not_approved','Solicitação não aprovada',p_reason||': '||p_explanation,'#/requests/'||v_request.id,v_request.id);
  perform public.audit_event('request.not_approved','request',v_request.id,v_before,to_jsonb(v_request)); return v_request;
end $$;

create or replace function public.cancel_approved_request(p_request_id uuid,p_reason text)
returns public.point_ledger language plpgsql security definer set search_path = public, auth as $$
declare v_request public.requests; v_credit public.point_ledger; v_reversal public.point_ledger; v_actor uuid:=public.current_app_user_id(); v_before jsonb;
begin
  select * into v_request from public.requests where id=p_request_id for update;
  if public.current_app_role()<>'administrator' or v_request.status<>'approved' or trim(coalesce(p_reason,''))='' then raise exception 'Operação administrativa inválida'; end if;
  select * into v_credit from public.point_ledger where request_id=p_request_id and movement_type='credit' for update;
  if v_credit.id is null then raise exception 'Crédito original não localizado'; end if;
  select * into v_reversal from public.point_ledger where request_id=p_request_id and movement_type='reversal';
  if v_reversal.id is not null then return v_reversal; end if;
  v_before:=to_jsonb(v_request);
  insert into public.point_ledger(analyst_id,request_id,movement_type,quantity,score_cycle_id,point_rule_id,point_rule_version,occurred_at,approved_at,manager_id,reason,reverses_entry_id,created_by)
  values(v_credit.analyst_id,v_credit.request_id,'reversal',-abs(v_credit.quantity),v_credit.score_cycle_id,v_credit.point_rule_id,v_credit.point_rule_version,v_credit.occurred_at,now(),v_actor,p_reason,v_credit.id,v_actor) returning * into v_reversal;
  update public.requests set status='cancelled',updated_at=now(),version=version+1 where id=p_request_id returning * into v_request;
  insert into public.request_events(request_id,event_type,from_status,to_status,actor_id,actor_role,public_note,request_snapshot) values(v_request.id,'cancelled_with_reversal','approved','cancelled',v_actor,public.current_app_role(),p_reason,to_jsonb(v_request));
  insert into public.notifications(user_id,notification_type,title,message,link,related_request_id) values(v_request.analyst_id,'points_reversed','Pontuação estornada',p_reason,'#/requests/'||v_request.id,v_request.id);
  perform public.audit_event('request.cancelled','request',v_request.id,v_before,to_jsonb(v_request)); perform public.audit_event('points.reversed','point_ledger',v_reversal.id,null,to_jsonb(v_reversal)); return v_reversal;
end $$;

create or replace function public.close_score_cycle(p_cycle_id uuid)
returns public.score_cycles language plpgsql security definer set search_path = public, auth as $$
declare v_cycle public.score_cycles; v_actor uuid:=public.current_app_user_id();
begin
  if not public.has_permission('cycles.manage') then raise exception 'Sem permissão'; end if;
  select * into v_cycle from public.score_cycles where id=p_cycle_id for update;
  if v_cycle.status='closed' then return v_cycle; end if;
  if exists(select 1 from public.requests where score_cycle_id=p_cycle_id and status in ('pending_review','in_review','correction_requested','resubmitted')) then raise exception 'Existem solicitações pendentes no ciclo'; end if;
  insert into public.cycle_ranking_snapshots(score_cycle_id,team_id,analyst_id,rank,final_points,prize_amount)
  select p_cycle_id,u.primary_team_id,u.id,dense_rank() over(partition by u.primary_team_id order by coalesce(sum(l.quantity) filter(where l.valid),0) desc),
    coalesce(sum(l.quantity) filter(where l.valid),0),
    case dense_rank() over(partition by u.primary_team_id order by coalesce(sum(l.quantity) filter(where l.valid),0) desc) when 1 then 1000 when 2 then 500 when 3 then 300 else 0 end
  from public.users u
  join public.roles ranking_role on ranking_role.id = u.role_id and ranking_role.code = 'analyst'
  left join public.point_ledger l on l.analyst_id=u.id and l.score_cycle_id=p_cycle_id
  where u.status='active' and u.primary_team_id is not null
    and coalesce(u.job_title, '') not in ('Gestor Adm', 'Envio/Coleta')
  group by u.id,u.primary_team_id
  on conflict(score_cycle_id,team_id,analyst_id) do nothing;
  update public.score_cycles set status='closed',closed_at=now(),closed_by=v_actor where id=p_cycle_id returning * into v_cycle;
  insert into public.notifications(user_id,notification_type,title,message,link) select id,'cycle_closed','Ciclo fechado',v_cycle.name||' foi fechado e o ranking agora é oficial.','#/ranking' from public.users where status='active';
  perform public.audit_event('cycle.closed','score_cycle',v_cycle.id,null,to_jsonb(v_cycle)); return v_cycle;
end $$;

create or replace function public.admin_update_user(
  p_user_id uuid, p_status public.app_user_status, p_role_code text,
  p_team_id uuid default null, p_manager_id uuid default null, p_job_title text default null
) returns public.users language plpgsql security definer set search_path = public, auth as $$
declare v_before public.users; v_after public.users; v_role_id uuid; v_actor uuid:=public.current_app_user_id();
begin
  if public.current_app_role()<>'administrator' then raise exception 'Somente administradores podem alterar usuários'; end if;
  select * into v_before from public.users where id=p_user_id for update;
  if v_before.id is null then raise exception 'Usuário não encontrado'; end if;
  select id into v_role_id from public.roles where code=p_role_code;
  if v_role_id is null then raise exception 'Perfil inválido'; end if;
  if v_before.primary_team_id is distinct from p_team_id then
    update public.team_memberships set valid_to=current_date-1 where user_id=p_user_id and valid_to is null;
    if p_team_id is not null then
      insert into public.team_memberships(user_id,team_id,manager_id,valid_from,created_by) values(p_user_id,p_team_id,p_manager_id,current_date,v_actor);
    end if;
  end if;
  update public.users set status=p_status,role_id=v_role_id,primary_team_id=p_team_id,responsible_manager_id=p_manager_id,
    job_title=p_job_title,team_joined_at=case when primary_team_id is distinct from p_team_id then current_date else team_joined_at end,
    team_left_at=case when p_team_id is null then current_date else null end,updated_at=now()
  where id=p_user_id returning * into v_after;
  perform public.audit_event('user.updated','user',p_user_id,to_jsonb(v_before),to_jsonb(v_after)); return v_after;
end $$;

create or replace function public.admin_assign_manager_team(p_manager_id uuid,p_team_id uuid,p_active boolean default true)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v_actor uuid:=public.current_app_user_id();
begin
  if public.current_app_role()<>'administrator' then raise exception 'Somente administradores podem atribuir gestores'; end if;
  if p_active then
    insert into public.manager_teams(manager_id,team_id,valid_from,created_by) values(p_manager_id,p_team_id,current_date,v_actor)
    on conflict(manager_id,team_id,valid_from) do update set valid_to=null;
  else
    update public.manager_teams set valid_to=current_date where manager_id=p_manager_id and team_id=p_team_id and valid_to is null;
  end if;
  perform public.audit_event('manager_team.updated','team',p_team_id,null,jsonb_build_object('manager_id',p_manager_id,'active',p_active));
end $$;

create or replace function public.admin_create_point_rule(
  p_type public.request_type,p_team_id uuid,p_points numeric,p_criteria text,
  p_effective_from timestamptz,p_required_evidences jsonb default '[]'::jsonb,
  p_registration_deadline_hours integer default null,p_review_sla_hours integer default 48
) returns public.point_rules language plpgsql security definer set search_path=public,auth as $$
declare v_rule public.point_rules; v_version integer; v_actor uuid:=public.current_app_user_id();
begin
  if not public.has_permission('rules.manage') then raise exception 'Sem permissão para criar regras'; end if;
  if p_points<0 or trim(coalesce(p_criteria,''))='' then raise exception 'Pontos e critérios inválidos'; end if;
  select coalesce(max(version),0)+1 into v_version from public.point_rules where request_type=p_type and team_id=p_team_id;
  insert into public.point_rules(request_type,team_id,version,points,criteria,required_evidences,registration_deadline_hours,review_sla_hours,effective_from,active,created_by)
  values(p_type,p_team_id,v_version,p_points,p_criteria,coalesce(p_required_evidences,'[]'::jsonb),p_registration_deadline_hours,p_review_sla_hours,p_effective_from,true,v_actor)
  returning * into v_rule;
  perform public.audit_event('point_rule.created','point_rule',v_rule.id,null,to_jsonb(v_rule)); return v_rule;
end $$;

create or replace function public.admin_create_cycle(p_code text,p_name text,p_starts_on date,p_ends_on date,p_submission_deadline timestamptz,p_review_deadline timestamptz)
returns public.score_cycles language plpgsql security definer set search_path=public,auth as $$
declare v_cycle public.score_cycles; v_actor uuid:=public.current_app_user_id();
begin
  if not public.has_permission('cycles.manage') then raise exception 'Sem permissão para criar ciclos'; end if;
  insert into public.score_cycles(code,name,starts_on,ends_on,submission_deadline,review_deadline,status,created_by)
  values(trim(p_code),trim(p_name),p_starts_on,p_ends_on,p_submission_deadline,p_review_deadline,'open',v_actor) returning * into v_cycle;
  perform public.audit_event('cycle.created','score_cycle',v_cycle.id,null,to_jsonb(v_cycle)); return v_cycle;
end $$;

create or replace function public.admin_set_cycle_review(p_cycle_id uuid)
returns public.score_cycles language plpgsql security definer set search_path=public,auth as $$
declare v_cycle public.score_cycles; v_before jsonb;
begin
  if not public.has_permission('cycles.manage') then raise exception 'Sem permissão'; end if;
  select * into v_cycle from public.score_cycles where id=p_cycle_id for update;
  if v_cycle.status<>'open' then raise exception 'Somente ciclo aberto pode entrar em conferência'; end if;
  v_before:=to_jsonb(v_cycle); update public.score_cycles set status='review' where id=p_cycle_id returning * into v_cycle;
  perform public.audit_event('cycle.review_started','score_cycle',v_cycle.id,v_before,to_jsonb(v_cycle)); return v_cycle;
end $$;

create or replace function public.admin_adjust_points(p_analyst_id uuid,p_cycle_id uuid,p_quantity numeric,p_reason text)
returns public.point_ledger language plpgsql security definer set search_path=public,auth as $$
declare v_entry public.point_ledger; v_actor uuid:=public.current_app_user_id();
begin
  if public.current_app_role()<>'administrator' or p_quantity=0 or trim(coalesce(p_reason,''))='' then raise exception 'Ajuste exige administrador, valor e justificativa'; end if;
  insert into public.point_ledger(analyst_id,movement_type,quantity,score_cycle_id,occurred_at,approved_at,manager_id,reason,created_by)
  values(p_analyst_id,case when p_quantity>0 then 'positive_adjustment' else 'negative_adjustment' end,p_quantity,p_cycle_id,now(),now(),v_actor,p_reason,v_actor)
  returning * into v_entry;
  insert into public.notifications(user_id,notification_type,title,message,link) values(p_analyst_id,'points_adjusted','Pontuação ajustada',p_reason,'#/ledger');
  perform public.audit_event('points.adjusted','point_ledger',v_entry.id,null,to_jsonb(v_entry)); return v_entry;
end $$;

create or replace view public.confirmed_score_totals with (security_invoker=true) as
select l.analyst_id,l.score_cycle_id,sum(l.quantity) as confirmed_points
from public.point_ledger l where l.valid group by l.analyst_id,l.score_cycle_id;

create or replace function public.get_confirmed_ranking(p_cycle_id uuid)
returns table(analyst_id uuid,team_id uuid,legacy_user_key text,display_name text,confirmed_points numeric)
language sql stable security definer set search_path=public,auth as $$
  select u.id,u.primary_team_id,u.legacy_user_key,u.display_name,coalesce(sum(l.quantity) filter(where l.valid),0)
  from public.users u
  join public.roles ranking_role on ranking_role.id = u.role_id and ranking_role.code = 'analyst'
  left join public.point_ledger l on l.analyst_id=u.id and l.score_cycle_id=p_cycle_id
  where public.current_user_active() and u.status='active' and u.primary_team_id is not null
    and coalesce(u.job_title, '') not in ('Gestor Adm', 'Envio/Coleta')
    and (public.current_app_role()='administrator' or public.manages_team(u.primary_team_id))
  group by u.id,u.primary_team_id,u.legacy_user_key,u.display_name
$$;

alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.teams enable row level security;
alter table public.users enable row level security;
alter table public.team_memberships enable row level security;
alter table public.manager_teams enable row level security;
alter table public.score_cycles enable row level security;
alter table public.point_rules enable row level security;
alter table public.requests enable row level security;
alter table public.request_evidences enable row level security;
alter table public.request_events enable row level security;
alter table public.manager_decisions enable row level security;
alter table public.point_ledger enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;
alter table public.cycle_ranking_snapshots enable row level security;

create policy "active users read roles" on public.roles for select to authenticated using (public.current_user_active());
create policy "active users read permissions" on public.permissions for select to authenticated using (public.current_user_active());
create policy "active users read role permissions" on public.role_permissions for select to authenticated using (public.current_user_active());
create policy "active users read teams" on public.teams for select to authenticated using (public.current_user_active());
create policy "users read self team and managed teams" on public.users for select to authenticated using (
  auth_user_id=auth.uid() or (public.current_user_active() and (id=public.current_app_user_id() or public.manages_team(primary_team_id) or public.current_app_role()='administrator'))
);
create policy "self update safe profile fields" on public.users for update to authenticated using (id=public.current_app_user_id()) with check (id=public.current_app_user_id());
create policy "memberships visible by scope" on public.team_memberships for select to authenticated using (user_id=public.current_app_user_id() or public.manages_team(team_id));
create policy "manager teams visible by scope" on public.manager_teams for select to authenticated using (manager_id=public.current_app_user_id() or public.current_app_role()='administrator');
create policy "cycles visible to active users" on public.score_cycles for select to authenticated using (public.current_user_active());
create policy "rules visible to active users" on public.point_rules for select to authenticated using (public.current_user_active());
create policy "administrators insert rules" on public.point_rules for insert to authenticated with check (public.has_permission('rules.manage'));
create policy "administrators update rules" on public.point_rules for update to authenticated using (public.has_permission('rules.manage')) with check (public.has_permission('rules.manage'));
create policy "requests isolated by owner and managed team" on public.requests for select to authenticated using (analyst_id=public.current_app_user_id() or public.manages_team(team_id));
create policy "draft requests editable by owner" on public.requests for update to authenticated using (analyst_id=public.current_app_user_id() and status in ('draft','correction_requested')) with check (analyst_id=public.current_app_user_id());
create policy "evidence visible by request scope" on public.request_evidences for select to authenticated using (exists(select 1 from public.requests r where r.id=request_id and (r.analyst_id=public.current_app_user_id() or public.manages_team(r.team_id))));
create policy "evidence inserted by owner" on public.request_evidences for insert to authenticated with check (uploaded_by=public.current_app_user_id() and exists(select 1 from public.requests r where r.id=request_id and r.analyst_id=public.current_app_user_id() and r.status in ('draft','correction_requested')));
create policy "public request events by scope" on public.request_events for select to authenticated using (exists(select 1 from public.requests r where r.id=request_id and (r.analyst_id=public.current_app_user_id() or public.manages_team(r.team_id))) and (actor_id=public.current_app_user_id() or private_note is null or public.current_app_role() in ('manager','administrator')));
create policy "decisions by scope" on public.manager_decisions for select to authenticated using (exists(select 1 from public.requests r where r.id=request_id and (r.analyst_id=public.current_app_user_id() or public.manages_team(r.team_id))));
create policy "ledger owner manager admin" on public.point_ledger for select to authenticated using (analyst_id=public.current_app_user_id() or public.current_app_role()='administrator' or exists(select 1 from public.users analyst where analyst.id=analyst_id and public.manages_team(analyst.primary_team_id)));
create policy "own notifications" on public.notifications for select to authenticated using (user_id=public.current_app_user_id());
create policy "mark own notifications read" on public.notifications for update to authenticated using (user_id=public.current_app_user_id()) with check (user_id=public.current_app_user_id());
create policy "audit only administrators" on public.audit_logs for select to authenticated using (public.has_permission('audit.read'));
create policy "snapshots visible to active users" on public.cycle_ranking_snapshots for select to authenticated using (public.current_user_active());

revoke update on public.users from authenticated;
grant update (avatar_url, phone, updated_at) on public.users to authenticated;
revoke insert, update, delete on public.requests from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  if to_regclass('public.rankpro_store') is not null then
    execute 'alter table public.rankpro_store enable row level security';
    begin execute 'create policy "legacy store managed by administrators" on public.rankpro_store for all to authenticated using (public.current_app_role() = ''administrator'') with check (public.current_app_role() = ''administrator'')'; exception when duplicate_object then null; end;
  end if;
  if to_regprocedure('public.set_user_password(text,text)') is not null then
    execute 'revoke all on function public.set_user_password(text,text) from public, anon, authenticated';
  end if;
  if to_regprocedure('public.verify_login(text,text)') is not null then
    execute 'revoke all on function public.verify_login(text,text) from public, anon, authenticated';
  end if;
end $$;

revoke all on function public.audit_event(text,text,uuid,jsonb,jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.import_legacy_profiles() from public, anon, authenticated;
revoke all on function public.link_invited_auth_user(uuid,text,text,text,text) from public, anon, authenticated;
revoke all on function public.get_legacy_performance_store() from public, anon, authenticated;
revoke all on function public.record_login() from public, anon, authenticated;
revoke all on function public.create_request(public.request_type,text,text,timestamptz,text,text,text,text,text,text,text,uuid,text,boolean) from public, anon, authenticated;
revoke all on function public.submit_request(uuid) from public, anon, authenticated;
revoke all on function public.update_draft_request(uuid,jsonb) from public, anon, authenticated;
revoke all on function public.begin_request_review(uuid) from public, anon, authenticated;
revoke all on function public.request_correction(uuid,text,text[]) from public, anon, authenticated;
revoke all on function public.resubmit_request(uuid,jsonb,text) from public, anon, authenticated;
revoke all on function public.approve_request(uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.not_approve_request(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.cancel_approved_request(uuid,text) from public, anon, authenticated;
revoke all on function public.close_score_cycle(uuid) from public, anon, authenticated;
revoke all on function public.admin_update_user(uuid,public.app_user_status,text,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.admin_assign_manager_team(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.admin_create_point_rule(public.request_type,uuid,numeric,text,timestamptz,jsonb,integer,integer) from public, anon, authenticated;
revoke all on function public.admin_create_cycle(text,text,date,date,timestamptz,timestamptz) from public, anon, authenticated;
revoke all on function public.admin_set_cycle_review(uuid) from public, anon, authenticated;
revoke all on function public.admin_adjust_points(uuid,uuid,numeric,text) from public, anon, authenticated;
revoke all on function public.get_confirmed_ranking(uuid) from public, anon, authenticated;
grant execute on function public.record_login() to authenticated;
grant execute on function public.import_legacy_profiles() to authenticated;
grant execute on function public.link_invited_auth_user(uuid,text,text,text,text) to service_role;
grant execute on function public.get_legacy_performance_store() to anon, authenticated;
grant execute on function public.create_request(public.request_type,text,text,timestamptz,text,text,text,text,text,text,text,uuid,text,boolean) to authenticated;
grant execute on function public.submit_request(uuid) to authenticated;
grant execute on function public.update_draft_request(uuid,jsonb) to authenticated;
grant execute on function public.begin_request_review(uuid) to authenticated;
grant execute on function public.request_correction(uuid,text,text[]) to authenticated;
grant execute on function public.resubmit_request(uuid,jsonb,text) to authenticated;
grant execute on function public.approve_request(uuid,numeric,text) to authenticated;
grant execute on function public.not_approve_request(uuid,text,text,text) to authenticated;
grant execute on function public.cancel_approved_request(uuid,text) to authenticated;
grant execute on function public.close_score_cycle(uuid) to authenticated;
grant execute on function public.admin_update_user(uuid,public.app_user_status,text,uuid,uuid,text) to authenticated;
grant execute on function public.admin_assign_manager_team(uuid,uuid,boolean) to authenticated;
grant execute on function public.admin_create_point_rule(public.request_type,uuid,numeric,text,timestamptz,jsonb,integer,integer) to authenticated;
grant execute on function public.admin_create_cycle(text,text,date,date,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_set_cycle_review(uuid) to authenticated;
grant execute on function public.admin_adjust_points(uuid,uuid,numeric,text) to authenticated;
grant execute on function public.get_confirmed_ranking(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('request-evidences','request-evidences',false,10485760,array['image/jpeg','image/png','image/webp','application/pdf','text/plain'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy "request evidence upload" on storage.objects for insert to authenticated with check (bucket_id='request-evidences' and (storage.foldername(name))[1]=public.current_app_user_id()::text);
create policy "request evidence owner read" on storage.objects for select to authenticated using (
  bucket_id='request-evidences' and (
    (storage.foldername(name))[1]=public.current_app_user_id()::text
    or public.current_app_role()='administrator'
    or exists(select 1 from public.users analyst where analyst.id::text=(storage.foldername(name))[1] and public.manages_team(analyst.primary_team_id))
  )
);

commit;
