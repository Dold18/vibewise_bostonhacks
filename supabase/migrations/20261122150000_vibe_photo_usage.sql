-- Daily photo-read quota for vibe photo input.
-- Spec: docs/superpowers/specs/2026-11-22-vibe-photo-input-design.md
create table public.vibe_photo_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  count   int  not null default 0 check (count >= 0),
  primary key (user_id, day)
);
alter table public.vibe_photo_usage enable row level security;
-- No policies: only the security-definer functions below read or write it.

create function public.vibe_photo_day() returns date
language sql stable set search_path = ''
as $$ select (now() at time zone 'America/New_York')::date $$;

create function public.vibe_photo_uses_remaining(daily_limit int) returns int
language plpgsql stable security definer set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  return greatest(daily_limit - coalesce(
    (select u.count from public.vibe_photo_usage u where u.user_id = auth.uid() and u.day = public.vibe_photo_day()), 0), 0);
end $$;

-- Increment-only by design: a decrement callable with the user's own token would let them reset their count.
create function public.record_vibe_photo_use(daily_limit int) returns int
language plpgsql volatile security definer set search_path = ''
as $$
declare used int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if daily_limit < 1 then return -1; end if;
  insert into public.vibe_photo_usage as u (user_id, day, count)
  values (auth.uid(), public.vibe_photo_day(), 1)
  on conflict (user_id, day) do update set count = u.count + 1 where u.count < daily_limit
  returning u.count into used;
  if used is null then return -1; end if;
  return daily_limit - used;
end $$;

revoke all on function public.vibe_photo_uses_remaining(int), public.record_vibe_photo_use(int) from public, anon;
grant execute on function public.vibe_photo_uses_remaining(int), public.record_vibe_photo_use(int) to authenticated;
