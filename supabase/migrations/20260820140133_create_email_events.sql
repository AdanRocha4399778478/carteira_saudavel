create table public.email_events (
  id uuid primary key default gen_random_uuid(),

  provider_email_id text not null unique,

  from_address text not null,
  recipient text not null,
  subject text not null,

  status text not null default 'sent'
    check (
      status in (
        'sent',
        'delivered',
        'bounced',
        'failed'
      )
    ),

  sent_at timestamptz,
  delivered_at timestamptz,
  bounced_at timestamptz,
  failed_at timestamptz,

  last_event_type text,
  last_event_at timestamptz,

  error_message text,

  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index email_events_status_idx
  on public.email_events(status);

create index email_events_recipient_idx
  on public.email_events(recipient);

create index email_events_created_at_idx
  on public.email_events(created_at desc);

alter table public.email_events enable row level security;