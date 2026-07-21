begin;

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  timezone text not null default 'UTC',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('outlook', 'teams', 'odoo_discuss', 'whatsapp')),
  status text not null default 'disconnected' check (status in ('disconnected', 'needs_auth', 'connected', 'degraded', 'paused', 'error')),
  display_name text,
  external_account_id text,
  scopes text[] not null default '{}',
  token_vault jsonb not null default '{}'::jsonb,
  oauth_state_hash text,
  last_sync_cursor text,
  last_sync_at timestamptz,
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider, external_account_id)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  connection_id uuid references public.connections(id) on delete set null,
  source text not null check (source in ('outlook', 'teams', 'odoo_discuss', 'whatsapp', 'mobile_notification')),
  source_type text not null check (source_type in ('email', 'chat', 'channel', 'discuss', 'whatsapp', 'mobile_notification')),
  external_id text not null,
  external_thread_id text,
  parent_external_id text,
  folder_or_channel_id text,
  folder_or_channel_name text,
  sender jsonb not null default '{}'::jsonb,
  recipients jsonb not null default '[]'::jsonb,
  participants jsonb not null default '[]'::jsonb,
  mentions jsonb not null default '[]'::jsonb,
  subject text,
  body_text text not null default '',
  body_html_sanitized text,
  preview text,
  sent_at timestamptz,
  received_at timestamptz,
  external_updated_at timestamptz,
  deleted_at timestamptz,
  is_read boolean not null default false,
  is_flagged boolean not null default false,
  importance text not null default 'normal' check (importance in ('low', 'normal', 'high')),
  has_attachments boolean not null default false,
  attachments jsonb not null default '[]'::jsonb,
  source_permalink text,
  raw_payload jsonb,
  raw_payload_ref text,
  ai_summary text,
  ai_priority_score numeric(6,3),
  ai_reason text,
  topics text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  platform text not null check (platform in ('ios', 'android', 'web', 'desktop', 'unknown')),
  installation_id text,
  label text,
  device_token_hash text not null,
  push_provider text,
  push_token_hash text,
  push_token_vault jsonb not null default '{}'::jsonb,
  capabilities jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, device_token_hash),
  unique (user_id, installation_id)
);

create table if not exists public.pairing_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  code_hash text not null unique,
  label text,
  platform_hint text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  message_id uuid references public.messages(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'cancelled', 'expired')),
  payload jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  actor_type text not null check (actor_type in ('user', 'device', 'connector', 'system')),
  actor_id text,
  event_type text not null,
  connection_id uuid references public.connections(id) on delete set null,
  device_id uuid references public.devices(id) on delete set null,
  message_id uuid references public.messages(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent_hash text,
  created_at timestamptz not null default now()
);

create index if not exists connections_user_provider_idx on public.connections (user_id, provider);
create index if not exists messages_user_received_idx on public.messages (user_id, received_at desc nulls last, created_at desc);
create index if not exists messages_user_priority_idx on public.messages (user_id, ai_priority_score desc nulls last);
create index if not exists messages_connection_idx on public.messages (connection_id);
create index if not exists devices_user_active_idx on public.devices (user_id, is_active);
create index if not exists devices_token_hash_idx on public.devices (device_token_hash);
create index if not exists devices_installation_idx on public.devices (installation_id);
create index if not exists pairing_codes_user_expires_idx on public.pairing_codes (user_id, expires_at);
create index if not exists handoffs_user_status_idx on public.handoffs (user_id, status, created_at desc);
create index if not exists audit_events_user_created_idx on public.audit_events (user_id, created_at desc);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

drop trigger if exists connections_set_updated_at on public.connections;
create trigger connections_set_updated_at
before update on public.connections
for each row execute function public.set_updated_at();

drop trigger if exists messages_set_updated_at on public.messages;
create trigger messages_set_updated_at
before update on public.messages
for each row execute function public.set_updated_at();

drop trigger if exists devices_set_updated_at on public.devices;
create trigger devices_set_updated_at
before update on public.devices
for each row execute function public.set_updated_at();

drop trigger if exists pairing_codes_set_updated_at on public.pairing_codes;
create trigger pairing_codes_set_updated_at
before update on public.pairing_codes
for each row execute function public.set_updated_at();

drop trigger if exists handoffs_set_updated_at on public.handoffs;
create trigger handoffs_set_updated_at
before update on public.handoffs
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.connections enable row level security;
alter table public.messages enable row level security;
alter table public.devices enable row level security;
alter table public.pairing_codes enable row level security;
alter table public.handoffs enable row level security;
alter table public.audit_events enable row level security;

alter table public.profiles force row level security;
alter table public.connections force row level security;
alter table public.messages force row level security;
alter table public.devices force row level security;
alter table public.pairing_codes force row level security;
alter table public.handoffs force row level security;
alter table public.audit_events force row level security;

drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
for select to authenticated
using (auth.uid() = id);

drop policy if exists profiles_insert_own on public.profiles;
create policy profiles_insert_own on public.profiles
for insert to authenticated
with check (auth.uid() = id);

drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
for update to authenticated
using (auth.uid() = id)
with check (auth.uid() = id);

drop policy if exists connections_select_own on public.connections;
create policy connections_select_own on public.connections
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists connections_insert_own on public.connections;
create policy connections_insert_own on public.connections
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists connections_update_own on public.connections;
create policy connections_update_own on public.connections
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists connections_delete_own on public.connections;
create policy connections_delete_own on public.connections
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists messages_update_own on public.messages;
create policy messages_update_own on public.messages
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists devices_select_own on public.devices;
create policy devices_select_own on public.devices
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists devices_insert_own on public.devices;
create policy devices_insert_own on public.devices
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists devices_update_own on public.devices;
create policy devices_update_own on public.devices
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists devices_delete_own on public.devices;
create policy devices_delete_own on public.devices
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists pairing_codes_select_own on public.pairing_codes;
create policy pairing_codes_select_own on public.pairing_codes
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists pairing_codes_insert_own on public.pairing_codes;
create policy pairing_codes_insert_own on public.pairing_codes
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists pairing_codes_update_own on public.pairing_codes;
create policy pairing_codes_update_own on public.pairing_codes
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists pairing_codes_delete_own on public.pairing_codes;
create policy pairing_codes_delete_own on public.pairing_codes
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists handoffs_select_own on public.handoffs;
create policy handoffs_select_own on public.handoffs
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists handoffs_insert_own on public.handoffs;
create policy handoffs_insert_own on public.handoffs
for insert to authenticated
with check (auth.uid() = user_id);

drop policy if exists handoffs_update_own on public.handoffs;
create policy handoffs_update_own on public.handoffs
for update to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists handoffs_delete_own on public.handoffs;
create policy handoffs_delete_own on public.handoffs
for delete to authenticated
using (auth.uid() = user_id);

drop policy if exists audit_events_select_own on public.audit_events;
create policy audit_events_select_own on public.audit_events
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists audit_events_insert_own on public.audit_events;
create policy audit_events_insert_own on public.audit_events
for insert to authenticated
with check (auth.uid() = user_id);

revoke all on public.profiles from anon, authenticated;
revoke all on public.connections from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.devices from anon, authenticated;
revoke all on public.pairing_codes from anon, authenticated;
revoke all on public.handoffs from anon, authenticated;
revoke all on public.audit_events from anon, authenticated;

grant select, insert on public.profiles to authenticated;
grant update (email, display_name, timezone, updated_at) on public.profiles to authenticated;

grant select (
  id, user_id, provider, status, display_name, external_account_id, scopes,
  last_sync_at, last_error_code, last_error_at, created_at, updated_at
) on public.connections to authenticated;

grant select (
  id, user_id, connection_id, source, source_type, external_id, external_thread_id,
  parent_external_id, folder_or_channel_id, folder_or_channel_name, sender,
  recipients, participants, mentions, subject, body_text, body_html_sanitized,
  preview, sent_at, received_at, external_updated_at, deleted_at, is_read,
  is_flagged, importance, has_attachments, attachments, source_permalink,
  raw_payload_ref, ai_summary, ai_priority_score, ai_reason, topics,
  created_at, updated_at
) on public.messages to authenticated;
grant update (is_read, is_flagged, updated_at) on public.messages to authenticated;

grant select (
  id, user_id, platform, installation_id, label, capabilities, is_active, last_seen_at,
  created_at, updated_at
) on public.devices to authenticated;
grant update (label, capabilities, is_active, updated_at) on public.devices to authenticated;

grant select (
  id, user_id, device_id, label, platform_hint, expires_at, used_at,
  created_at, updated_at
) on public.pairing_codes to authenticated;

grant select, insert, update, delete on public.handoffs to authenticated;
grant select on public.audit_events to authenticated;

commit;
