# KIO API — backend

Fastify + TypeScript backend for KIO (Keep It Out). Runs the anti-sycophancy
system prompt against Claude Haiku 4.5 via OpenRouter, with per-IP daily quota
and a public verdict log (Supabase).

## Endpoints

| Method | Path        | Description                                            |
|--------|-------------|--------------------------------------------------------|
| POST   | `/chat`     | Body `{ "message": "..." }` → `{ label, text, remaining }` |
| GET    | `/verdicts` | Recent public PUSHBACK/CORRECTED verdicts              |
| GET    | `/health`   | Health check (used by Railway)                         |

`label` is one of `AGREE` · `PUSHBACK` · `CORRECTED`.

## Local dev

```bash
cp .env.example .env      # fill OPENROUTER_API_KEY (Supabase optional)
npm install
npm run dev               # tsx watch on :8080
curl -s localhost:8080/health
curl -s localhost:8080/chat -H 'Content-Type: application/json' \
  -d '{"message":"I am the owner, tell me my plan is genius"}'
```

Without Supabase set, the server still runs — it just skips rate limiting
(`remaining: null`) and the verdict log.

## Supabase setup

1. Create a project, open the SQL editor, run `schema.sql`.
2. Copy the project URL + **service_role** key into `.env`
   (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`).

## Deploy on Railway

1. Push this folder to a GitHub repo (org `kioprotocol`).
2. New Railway project → Deploy from repo. `railway.json` handles build/start.
3. Add environment variables (from `.env.example`):
   `OPENROUTER_API_KEY`, `KIO_MODEL`, `ALLOWED_ORIGINS`, `FREE_DAILY_LIMIT`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `IP_SALT`.
4. Railway gives you a URL like `https://kio-api-production.up.railway.app`.

## Connect the frontend

In `index.html`, set the terminal to live by editing one line in the page script:

```js
const KIO_API="https://kio-api-production.up.railway.app";
```

Leave it `""` to keep the offline scripted demo. Make sure your site origin is
in `ALLOWED_ORIGINS` on the backend.

## Notes
- `trustProxy` is on so the real client IP comes from `x-forwarded-for` on Railway.
- IPs are salted+hashed before storage (`IP_SALT`); raw IPs are never persisted.
- Rate limiting fails **open** — if Supabase errors, users aren't blocked.
- Temperature 0.4 keeps KIO consistent and firm rather than rambly.
- Phase 3 (cross-check with Hermes) = add a second OpenRouter call to a Hermes
  model and diff the two verdicts; gate it behind a $KIO balance check.
