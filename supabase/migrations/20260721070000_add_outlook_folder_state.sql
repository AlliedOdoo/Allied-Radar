alter table public.messages
  add column if not exists mail_folder text not null default 'inbox',
  add column if not exists provider_state jsonb not null default '{}'::jsonb;

create index if not exists messages_user_mail_folder_idx
  on public.messages (user_id, mail_folder, received_at desc nulls last, sent_at desc nulls last, created_at desc);

create index if not exists messages_user_flagged_idx
  on public.messages (user_id, is_flagged, received_at desc nulls last, created_at desc)
  where is_flagged = true;

grant select (mail_folder, provider_state) on public.messages to authenticated;
grant update (mail_folder, provider_state, is_read, is_flagged, deleted_at, updated_at) on public.messages to authenticated;
