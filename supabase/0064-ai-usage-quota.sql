-- Cost-control: per-user daily AI-call counter + subscription tier.
alter table public.profiles add column if not exists tier text not null default 'free';

create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  count int not null default 0,
  last_at timestamptz,
  primary key (user_id, day)
);
alter table public.ai_usage enable row level security;
