# Kolam Ikan

## Two Setups

This app can run in two real ways:

1. Local stack
   App: `npm run dev`
   Supabase: `supabase start`
   Docling worker: `docker compose -f docker-compose.docling-worker.yml up --build`
   Browser runner: optional, `npm run bridge:runner`

2. Cloud stack
   App: Vercel
   Supabase: supabase.com
   Docling worker: Railway
   Browser runner: optional, can still run locally

Docling is always a separate process. It is not included inside the Next.js app.

## Env Setup

Use the exact env names below. `.env.example` is the guide for both local and cloud setup.

Start here:

```bash
cp .env.example .env.local
```

For local:

- Fill the local stack section in `.env.local`
- Start the app with `npm run dev`
- Start Supabase with `supabase start`
- Start Docling separately with `docker compose -f docker-compose.docling-worker.yml up --build`

For cloud:

- Put the same env names from `.env.example` into Vercel and Railway
- Use Supabase dashboard values as the source of truth for the Supabase URL, publishable key, and secret key

This project uses one canonical Supabase naming scheme:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase URL used by the app
- `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`: browser-safe public key
- `SUPABASE_SECRET_KEY`: server-only secret key
- `DOC_IMPORT_SUPABASE_URL`: optional Docling-only override for Docker/Railway networking

The old duplicate names `SUPABASE_URL`, `SUPABASE_URL_DOCKER`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are no longer part of the project convention.

Important rules:

- `DOCUMENT_IMPORT_CALLBACK_SECRET` is required in both Vercel and Railway, and both values must match exactly.
- `DOCUMENT_IMPORT_SERVICE_URL` in Vercel must use a full `https://` origin.
- `SUPABASE_SECRET_KEY` should use Supabase's new `sb_secret_...` key, not the legacy JWT-style `service_role` key.
- `DOC_IMPORT_SUPABASE_URL` is usually only needed for the local Docker worker.

Supabase dashboard labels map to this app's env names like this:

```bash
Project URL -> NEXT_PUBLIC_SUPABASE_URL
Publishable key -> NEXT_PUBLIC_SUPABASE_PUBLIC_KEY
Secret key -> SUPABASE_SECRET_KEY
```

### Local Stack

Use these env names in `.env.local`:

```bash
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLIC_KEY=sb_publishable_replace_with_local_publishable_key
SUPABASE_SECRET_KEY=sb_secret_replace_with_local_secret_key
DOCUMENT_IMPORT_SERVICE_URL=http://localhost:8090
DOCUMENT_IMPORT_CALLBACK_SECRET=replace-with-one-shared-random-secret
DOC_IMPORT_SUPABASE_URL=http://host.docker.internal:54321
BRIDGE_RUNNER_SECRET=replace-with-one-shared-random-secret
```

`BRIDGE_RUNNER_SECRET` is optional. Keep it only if you use `npm run bridge:runner`.
If your local runner should target a hosted app instead of `http://localhost:3000`, set `BRIDGE_RUNNER_APP_URL=https://your-app.vercel.app`.

### Cloud Stack

Vercel envs:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLIC_KEY=sb_publishable_replace_with_cloud_publishable_key
SUPABASE_SECRET_KEY=sb_secret_replace_with_cloud_secret_key
DOCUMENT_IMPORT_SERVICE_URL=https://your-docling-worker.up.railway.app
DOCUMENT_IMPORT_CALLBACK_SECRET=replace-with-one-shared-random-secret
```

Railway envs:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=sb_secret_replace_with_cloud_secret_key
DOCUMENT_IMPORT_CALLBACK_SECRET=replace-with-one-shared-random-secret
DOC_IMPORT_SUPABASE_URL=
```

Leave `DOC_IMPORT_SUPABASE_URL` empty unless Railway must reach Supabase through a different hostname than the Vercel app.

### Supabase Mapping

Supabase does not need app-specific env storage for this setup. It is the source of truth for:

- Project URL -> `NEXT_PUBLIC_SUPABASE_URL`
- Publishable key -> `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`
- Secret key -> `SUPABASE_SECRET_KEY`

Use the new publishable key for `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY` and the new secret key for `SUPABASE_SECRET_KEY`. Do not use the legacy `anon` or `service_role` JWT keys for this documented production setup.
