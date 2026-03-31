# Kolam Ikan

## Development

This project uses one canonical Supabase naming scheme:

- `NEXT_PUBLIC_SUPABASE_URL`: Supabase URL used by the app
- `NEXT_PUBLIC_SUPABASE_PUBLIC_KEY`: browser-safe public key
- `SUPABASE_SECRET_KEY`: server-only secret key
- `DOC_IMPORT_SUPABASE_URL`: optional Docling-only override for Docker/Railway networking

The old duplicate names `SUPABASE_URL`, `SUPABASE_URL_DOCKER`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are no longer part of the project convention.

## Env File Convention

Use `.env.example` as the glossary, then copy one template into `.env.local`:

- `.env.local.example`: local app + local Supabase + local Docling
- `.env.local-cloud.example`: local app + cloud Supabase + local Docling
- `.env.preview.example`: Vercel preview + Railway preview
- `.env.production.example`: production deployment

Example:

```bash
cp .env.local.example .env.local
```

## Local Workflow

Start the app:

```bash
npm run dev
```

Run the universal browser bridge runner:

```bash
npm run bridge:runner
```

The runner can now poll multiple providers through `BRIDGE_RUNNER_PROVIDERS` and can pin provider-specific default models with `BRIDGE_RUNNER_MODEL_CHATGPT`, `BRIDGE_RUNNER_MODEL_GEMINI`, and `BRIDGE_RUNNER_MODEL_CLAUDE`.
If the headed browser window feels too large, set `BRIDGE_RUNNER_BROWSER_WIDTH` and `BRIDGE_RUNNER_BROWSER_HEIGHT` to override the default `1280x820` viewport.
The runner also exposes a lightweight health endpoint on `BRIDGE_RUNNER_HEALTH_PORT` (default `3001`). Use `BRIDGE_RUNNER_HEALTH_URL` for server-side checks, and `NEXT_PUBLIC_BRIDGE_RUNNER_HEALTH_PORT` or `NEXT_PUBLIC_BRIDGE_RUNNER_HEALTH_URL` when the browser should probe the local runner directly. The app's `/api/bridge/status` route is best-effort only and is authoritative only when the Next.js server can reach that health URL.

Start local Supabase:

```bash
supabase start
```

Start the Docling worker:

```bash
docker compose -f docker-compose.docling-worker.yml up --build
```

Useful database commands:

```bash
npm run db:migrate
npm run db:reset
npm run db:types
```
