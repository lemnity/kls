# Local development

1. Copy `.env.example` to `.env` and replace only local values when required.
2. Start Docker Desktop, then run `docker compose up -d` and wait for all healthchecks.
3. Run `npm run validate --workspace @kulisa/db`, then `npm run migrate:deploy --workspace @kulisa/db`.
4. Run `npm test && npm run typecheck && npm run build`.

## Running web and API together

`apps/web` (Next.js) and `apps/api` (NestJS) each default to port 3000. To run both locally:

1. Start the API with `PORT=3001 npm run start:dev --workspace @kulisa/api`.
2. Start the web app with `API_URL=http://localhost:3001 npm run dev --workspace @kulisa/web` (also set in `.env`/`.env.local`).

`apps/web` uses `API_URL` server-side only (Route Handlers and Server Components) to call the API — it is never exposed to the browser.

Do not use local example credentials outside the development machine.
