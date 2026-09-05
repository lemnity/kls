# Local development

1. Copy `.env.example` to `.env` and replace only local values when required.
2. Start Docker Desktop, then run `docker compose up -d` and wait for all healthchecks.
3. Run `npm run validate --workspace @europa/db`, then `npm run migrate:deploy --workspace @europa/db`.
4. Run `npm test && npm run typecheck && npm run build`.

Do not use local example credentials outside the development machine.
