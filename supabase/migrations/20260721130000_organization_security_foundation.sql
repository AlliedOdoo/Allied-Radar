begin;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  allowed_domains text[] not null default '{}',
  ai_mode text not null default 'disabled' check (ai_mode in ('disabled', 'private_provider', 'approved_external')),
  message_retention_days integer not null default 30 check (message_retention_days between 1 and 3650),
  admin_can_read_user_content boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

insert into public.organizations (slug, name, allowed_domains, ai_mode)
values ('allied-fibreglass', 'Allied Fibreglass', array['alliedfibreglass.co.za'], 'disabled')
on conflict (slug) do nothing;

insert into public.organization_members (organization_id, user_id, role, status)
select organization_id, user_id, 'member', 'active'
from (
  select (select id from public.organizations where slug = 'allied-fibreglass') as organization_id, id as user_id from auth.users
  union
  select (select id from public.organizations where slug = 'allied-fibreglass') as organization_id, user_id from public.connections
  union
  select (select id from public.organizations where slug = 'allied-fibreglass') as organization_id, user_id from public.messages
  union
  select (select id from public.organizations where slug = 'allied-fibreglass') as organization_id, user_id from public.thread_drafts
  union
  select (select id from public.organizations where slug = 'allied-fibreglass') as organization_id, user_id from public.audit_events where user_id is not null
) existing_users
where user_id is not null
on conflict (organization_id, user_id) do nothing;

create or replace function public.is_org_member(candidate_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = candidate_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
  );
$$;

create or replace function public.is_org_admin(candidate_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members om
    where om.organization_id = candidate_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and om.role in ('owner', 'admin')
  );
$$;

drop trigger if exists organizations_set_updated_at on public.organizations;
create trigger organizations_set_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

drop trigger if exists organization_members_set_updated_at on public.organization_members;
create trigger organization_members_set_updated_at
before update on public.organization_members
for each row execute function public.set_updated_at();

alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organizations force row level security;
alter table public.organization_members force row level security;

drop policy if exists organizations_select_member on public.organizations;
create policy organizations_select_member on public.organizations
for select to authenticated
using (public.is_org_member(id));

drop policy if exists organizations_update_admin on public.organizations;
create policy organizations_update_admin on public.organizations
for update to authenticated
using (public.is_org_admin(id))
with check (public.is_org_admin(id));

drop policy if exists organization_members_select_self_or_admin on public.organization_members;
create policy organization_members_select_self_or_admin on public.organization_members
for select to authenticated
using (auth.uid() = user_id or public.is_org_admin(organization_id));

drop policy if exists organization_members_admin_write on public.organization_members;
create policy organization_members_admin_write on public.organization_members
for all to authenticated
using (public.is_org_admin(organization_id))
with check (public.is_org_admin(organization_id));

do $$
declare
  bootstrap_org_id uuid;
  target_table text;
begin
  select id into bootstrap_org_id from public.organizations where slug = 'allied-fibreglass';

  foreach target_table in array array[
    'connections',
    'messages',
    'devices',
    'pairing_codes',
    'handoffs',
    'audit_events',
    'send_confirmations',
    'outbound_deliveries',
    'connector_runs',
    'thread_drafts',
    'error_events',
    'ai_trace_events'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('alter table public.%I add column if not exists organization_id uuid references public.organizations(id) on delete cascade', target_table);
      execute format('update public.%I set organization_id = $1 where organization_id is null', target_table) using bootstrap_org_id;
      execute format('create index if not exists %I on public.%I (organization_id)', target_table || '_organization_idx', target_table);
    end if;
  end loop;
end $$;

create index if not exists organization_members_user_idx
on public.organization_members (user_id, status);

create index if not exists organization_members_org_role_idx
on public.organization_members (organization_id, role, status);

revoke all on public.organizations from anon, authenticated;
revoke all on public.organization_members from anon, authenticated;

grant select (
  id, slug, name, allowed_domains, ai_mode, message_retention_days,
  admin_can_read_user_content, created_at, updated_at
) on public.organizations to authenticated;

grant update (
  allowed_domains, ai_mode, message_retention_days,
  admin_can_read_user_content, updated_at
) on public.organizations to authenticated;

grant select (
  organization_id, user_id, role, status, created_at, updated_at
) on public.organization_members to authenticated;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'connections',
    'messages',
    'devices',
    'pairing_codes',
    'handoffs',
    'audit_events',
    'send_confirmations',
    'outbound_deliveries',
    'connector_runs',
    'thread_drafts',
    'error_events',
    'ai_trace_events'
  ]
  loop
    if to_regclass(format('public.%I', target_table)) is not null then
      execute format('grant select (organization_id) on public.%I to authenticated', target_table);
    end if;
  end loop;
end $$;

commit;
