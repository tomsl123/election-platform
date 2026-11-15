# Polling Station

Election platform for the United States of Free Cliffs (USFC) and other organisations. The voter side is "The Booth" (`design/previews/a1-booth.html` is the visual reference); the organiser side is "the office behind the hall".

The build plan is [docs/PLAN.md](docs/PLAN.md). Work phase by phase, tick the phase there when its "Done when" list passes, and note deviations under the phase.

## Commands

- `npm run init`: create `.env` with fresh secrets and the `data/` folders
- `npm run dev`: dev server on http://localhost:3220 (launch config `app`)
- `npm run typecheck`, `npm test`
- `npx prisma migrate dev --name <what>`: add a migration (never `migrate reset`, never delete `data/`)
- `npm run seed:demo`: demo data, empty database only. Demo e-mail is written to `data/mailbox/`.
- `node design/serve.mjs`: the design studies on port 4310 (launch config `design-studies`)

## Rules

1. Reuse before writing. USFC Parliament is at `../voting-system` (same stack). Read the matching file there and adapt it. That repo is read-only except in Phase 13.
2. Next.js 16 syntax as in Parliament: async `params`, `await cookies()`, `await headers()`, server actions with the helpers in `src/lib/action.ts`.
3. No third-party scripts, fonts or images at run time (strict CSP in `next.config.ts`). Outbound calls happen on the server.
4. Voter screens use minimal text: symbols, crest, a title and one short instruction at most. All wording goes through `src/i18n/en.ts`.
5. Every gesture has a one-tap path and a keyboard path (Enter/Space), visible focus, and respects `prefers-reduced-motion`.
6. Never write a secret-ballot choice to the audit log, to console logs, or next to a voter id.
7. After each phase: typecheck, tests, check in the browser (desktop and 375×812), then one local commit `Phase N: <title>`. Never push.

## Layout

- `src/app/o/[org]/...`: public pages of an organisation (notice board, polling station, results, register, verify)
- `src/app/office/[org]/...`: organiser area; `src/app/platform/`: platform admin
- `src/components/station/`: the booth; `src/components/office/`: the office
- `src/lib/`: server logic (`desk.ts` admission, `ballot.ts` casting and counting, `tally.ts` pure counting, `fraud.ts` signals)
