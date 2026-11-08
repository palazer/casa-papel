# Setting up cloud sync (Supabase)

Casa Papel works without any of this. Sync is optional: it keeps an encrypted copy of a household on a
Supabase project you own and lets the same household be used on several devices. Only your password
opens the copy; the project owner cannot read it. Nobody can create an account without an invite link.

About fifteen minutes, once.

## 1. Create the project

1. Sign in at supabase.com and create a **New project** in your free organisation.
2. Name `casa-papel`, an **EU region** (Ireland or Frankfurt), and a strong database password. Keep that
   password somewhere safe; only the CLI asks for it.

## 2. Auth settings

Dashboard → **Authentication → Sign In / Providers → Email**:

- **Allow new users to sign up: off.** Accounts are created by the `account` function from invite codes.
- **Confirm email: off.** No emails are sent at all; Supabase's built-in mailer only reaches members of
  your own organisation anyway.

## 3. Your own user

Dashboard → **Authentication → Users → Add user → Create new user**: your email and any temporary
password, with **Auto Confirm User** ticked. The app replaces the password on your first sign-in.
Copy the user's **UID** for step 4.

## 4. Schema, function and admin rights

From the repository, once the Supabase CLI is logged in (`npx supabase login` opens the browser):

```sh
npx supabase link --project-ref <your project ref>       # the id in the project URL
npx supabase db push                                       # applies supabase/migrations/0001_sync.sql
npx supabase functions deploy account --no-verify-jwt      # supabase/functions/account
```

Then in **SQL Editor**, make yourself the admin who may create invites:

```sql
insert into public.admins (user_id) values ('<your UID>');
```

## 5. Keys for the build

Dashboard → **Project Settings → API**: copy the **Project URL** and the **anon public** key.

- GitHub → repository → **Settings → Secrets and variables → Actions → Variables**: add
  `SUPABASE_URL` and `SUPABASE_ANON_KEY`. The deploy workflow reads them; the keep-alive workflow too.
- Locally, create `.env.local` (gitignored) with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  for the dev server.

The anon key is meant to be public. Row-level security decides what it can read: nothing, unless signed in.

## 6. First sign-in

On the device that holds the real household: **Data → Sign in** with your email and the temporary
password. The app asks you to set the household password, shows the recovery code once (store it
somewhere safe, it is the only way back in without the password), creates the household on the
server and uploads the encrypted copy. From then on **Data → Invite someone** gives you links to send.

## Limits worth knowing

- Free tier: 500 MB database, 5 GB traffic a month, projects pause after seven idle days. The
  `keepalive` workflow pings the project every three days; if it pauses anyway, **Restore** it from the
  dashboard.
- Forgetting the password *and* losing the recovery code *and* every signed-in device loses the cloud
  copy. Export files from the Data screen still restore everything.
- To add email-based password resets later, configure a custom SMTP sender under Authentication →
  Emails and turn the email flows back on.
