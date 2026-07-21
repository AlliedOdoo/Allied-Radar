begin;

create table if not exists public.send_confirmations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('Outlook', 'Teams', 'Odoo Discuss', 'WhatsApp')),
  client_request_id uuid not null,
  content_hash text not null,
  destination_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);

create table if not exists public.outbound_deliveries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  client_request_id uuid not null,
  provider text not null check (provider in ('Outlook', 'Teams', 'Odoo Discuss', 'WhatsApp')),
  destination_hash text not null,
  content_hash text not null,
  state text not null check (state in ('authorized', 'accepted', 'sent', 'handoff', 'failed')),
  provider_message_id_hash text,
  last_error_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, client_request_id)
);

create index if not exists send_confirmations_expiry_idx
on public.send_confirmations (expires_at) where consumed_at is null;

create index if not exists outbound_deliveries_user_created_idx
on public.outbound_deliveries (user_id, created_at desc);

drop trigger if exists outbound_deliveries_set_updated_at on public.outbound_deliveries;
create trigger outbound_deliveries_set_updated_at
before update on public.outbound_deliveries
for each row execute function public.set_updated_at();

alter table public.send_confirmations enable row level security;
alter table public.outbound_deliveries enable row level security;
alter table public.send_confirmations force row level security;
alter table public.outbound_deliveries force row level security;

drop policy if exists send_confirmations_select_own on public.send_confirmations;
create policy send_confirmations_select_own on public.send_confirmations
for select to authenticated
using (auth.uid() = user_id);

drop policy if exists outbound_deliveries_select_own on public.outbound_deliveries;
create policy outbound_deliveries_select_own on public.outbound_deliveries
for select to authenticated
using (auth.uid() = user_id);

revoke all on public.send_confirmations from anon, authenticated;
revoke all on public.outbound_deliveries from anon, authenticated;

grant select (
  id, user_id, client_request_id, provider, state, last_error_code,
  completed_at, created_at, updated_at
) on public.outbound_deliveries to authenticated;

commit;
