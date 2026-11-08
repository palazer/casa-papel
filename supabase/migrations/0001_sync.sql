-- Casa Papel cloud sync: one encrypted snapshot per household, members with wrapped keys, invite codes.
-- The server never sees household data: `snapshots.cipher` is AES-GCM ciphertext that only the household key opens.

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.invites (
  code text primary key check (length(code) between 16 and 64),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  used_by uuid references auth.users (id) on delete set null,
  used_at timestamptz
);

create table public.households (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'owner' check (role in ('owner', 'member')),
  -- household key wrapped by the member's password-derived key: { iv, ct } base64
  wrapped_key jsonb not null,
  -- household key wrapped by the recovery-code key, and a verifier the account function compares
  recovery jsonb,
  recovery_verifier text,
  kdf jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
-- one household per login for now
create unique index members_one_household_per_user on public.members (user_id);

create table public.snapshots (
  household_id uuid primary key references public.households (id) on delete cascade,
  version bigint not null,
  schema_version integer not null,
  cipher text not null,
  device_id text not null,
  updated_at timestamptz not null default now()
);

alter table public.admins enable row level security;
alter table public.invites enable row level security;
alter table public.households enable row level security;
alter table public.members enable row level security;
alter table public.snapshots enable row level security;

-- ---------- helpers ----------

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where user_id = auth.uid());
$$;

create or replace function public.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members where household_id = hid and user_id = auth.uid());
$$;

-- ---------- policies ----------

create policy "admins see themselves" on public.admins
  for select to authenticated using (user_id = auth.uid());

create policy "admins read invites" on public.invites
  for select to authenticated using (public.is_admin());
create policy "admins create invites" on public.invites
  for insert to authenticated with check (public.is_admin() and created_by = auth.uid());
create policy "admins revoke invites" on public.invites
  for delete to authenticated using (public.is_admin());

create policy "members read household" on public.households
  for select to authenticated using (public.is_member(id));

create policy "members read own row" on public.members
  for select to authenticated using (user_id = auth.uid());
create policy "members update own keys" on public.members
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "members read snapshot" on public.snapshots
  for select to authenticated using (public.is_member(household_id));

-- ---------- functions the app calls ----------

-- First sign-in of an account: the household row plus the caller's member row, in one transaction.
create or replace function public.create_household(p_wrapped_key jsonb, p_recovery jsonb, p_recovery_verifier text, p_kdf jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  hid uuid;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'already a member of a household';
  end if;
  insert into public.households (owner_id) values (auth.uid()) returning id into hid;
  insert into public.members (household_id, user_id, role, wrapped_key, recovery, recovery_verifier, kdf)
    values (hid, auth.uid(), 'owner', p_wrapped_key, p_recovery, p_recovery_verifier, p_kdf);
  return hid;
end;
$$;

-- Optimistic write: succeeds only when the stored version equals p_expected (0 = no snapshot yet). Returns the new version.
create or replace function public.push_snapshot(p_household uuid, p_expected bigint, p_cipher text, p_schema_version integer, p_device_id text)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  cur record;
begin
  if not public.is_member(p_household) then
    raise exception 'not a member';
  end if;
  select version, schema_version into cur from public.snapshots where household_id = p_household for update;
  if not found then
    if p_expected <> 0 then
      raise exception 'conflict';
    end if;
    insert into public.snapshots (household_id, version, schema_version, cipher, device_id)
      values (p_household, 1, p_schema_version, p_cipher, p_device_id);
    return 1;
  end if;
  if cur.version <> p_expected then
    raise exception 'conflict';
  end if;
  if p_schema_version < cur.schema_version then
    raise exception 'stale_schema';
  end if;
  update public.snapshots
    set version = cur.version + 1, schema_version = p_schema_version, cipher = p_cipher, device_id = p_device_id, updated_at = now()
    where household_id = p_household;
  return cur.version + 1;
end;
$$;

create or replace function public.delete_household(p_household uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.households where id = p_household and owner_id = auth.uid()) then
    raise exception 'only the owner can delete the cloud copy';
  end if;
  delete from public.households where id = p_household;
end;
$$;

-- The join form checks the code before asking for a password. Callable without an account.
create or replace function public.invite_valid(p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invites where code = p_code and used_at is null and expires_at > now());
$$;

-- Used by the account function (service role) to find the account behind a recovery reset.
create or replace function public.user_id_by_email(p_email text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$;

-- Keep-alive target for the scheduled workflow; free projects pause after a week without requests.
create or replace function public.ping()
returns text language sql stable as $$
  select 'pong';
$$;

-- ---------- who may call what ----------

revoke execute on function public.create_household(jsonb, jsonb, text, jsonb) from public, anon;
revoke execute on function public.push_snapshot(uuid, bigint, text, integer, text) from public, anon;
revoke execute on function public.delete_household(uuid) from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_member(uuid) from public, anon;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.invite_valid(text), public.ping() to anon, authenticated;
grant execute on function public.is_admin(), public.is_member(uuid), public.create_household(jsonb, jsonb, text, jsonb),
  public.push_snapshot(uuid, bigint, text, integer, text), public.delete_household(uuid) to authenticated;
grant execute on function public.user_id_by_email(text) to service_role;
