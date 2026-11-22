-- Daily vibe photo quota (docs/superpowers/specs/2026-11-22-vibe-photo-input-design.md).
-- Runs against the local stack after `supabase db reset`.
begin;

select plan(19);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'photo-quota-a@example.com', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'photo-quota-b@example.com', 'authenticated', 'authenticated');

select has_table('public', 'vibe_photo_usage', 'vibe_photo_usage exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.vibe_photo_usage'::regclass),
  'RLS is enabled on vibe_photo_usage');

-- User A: five uses, then capped.
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000a1", "role": "authenticated"}';

select is(public.vibe_photo_uses_remaining(5), 5, 'A starts with 5 remaining');
select is(public.record_vibe_photo_use(5), 4, 'A use 1 leaves 4');
select is(public.record_vibe_photo_use(5), 3, 'A use 2 leaves 3');
select is(public.record_vibe_photo_use(5), 2, 'A use 3 leaves 2');
select is(public.record_vibe_photo_use(5), 1, 'A use 4 leaves 1');
select is(public.record_vibe_photo_use(5), 0, 'A use 5 leaves 0');
select is(public.record_vibe_photo_use(5), -1, 'A use 6 is refused');
select is(public.vibe_photo_uses_remaining(5), 0, 'A has 0 remaining at the cap');

-- User B: no leakage, no direct access.
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}';

select is(public.vibe_photo_uses_remaining(5), 5, 'B is unaffected by A''s uses');
select is((select count(*)::int from public.vibe_photo_usage), 0, 'B cannot read usage rows directly');

with u as (update public.vibe_photo_usage set count = 0 returning 1)
select is((select count(*)::int from u), 0, 'B cannot update usage rows');
with d as (delete from public.vibe_photo_usage returning 1)
select is((select count(*)::int from d), 0, 'B cannot delete usage rows');

-- Yesterday does not count.
reset role;
insert into public.vibe_photo_usage (user_id, day, count)
values ('00000000-0000-0000-0000-0000000000b1', public.vibe_photo_day() - 1, 5);
set local role authenticated;
set local request.jwt.claims = '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}';
select is(public.vibe_photo_uses_remaining(5), 5, 'yesterday''s uses do not count today');

-- No decrement path.
select hasnt_function('public', 'release_vibe_photo_use', 'there is no way to release a use');

-- A zero limit refuses and writes nothing.
select is(public.record_vibe_photo_use(0), -1, 'a zero limit returns -1');
reset role;
select is(
  (select count(*)::int from public.vibe_photo_usage
   where user_id = '00000000-0000-0000-0000-0000000000b1' and day = public.vibe_photo_day()),
  0,
  'a zero limit writes no row');

-- anon cannot call it.
set local role anon;
select throws_ok($$select public.record_vibe_photo_use(5)$$, '42501', null, 'anon cannot record a use');
reset role;

select * from finish();
rollback;
