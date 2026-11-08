-- Members may change only their own key material. Which household they belong to, and as what, stays as the server set it.
revoke update on table public.members from anon, authenticated;
grant update (wrapped_key, recovery, recovery_verifier, kdf, updated_at) on table public.members to authenticated;
