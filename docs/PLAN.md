# Election platform ("Polling Station") — implementation plan

## Progress

Tick a phase only when its "Done when" list passes and its commit exists. Note any deviation from the plan under the phase it belongs to.

- [x] Phase 0 — Bootstrap
- [x] Phase 1 — Foundations: data, accounts, organisations, i18n
- [x] Phase 2 — The Booth as a component library
- [x] Phase 3 — The office: elections, ballots, register
- [x] Phase 4 — Voting core
- [x] Phase 5 — Fraud layer
- [x] Phase 6 — Counting, results, the remaining ballot types
- [x] Phase 7 — Constituencies end to end
- [x] Phase 8 — Notifications (SMTP + Discord)
- [x] Phase 9 — Nominations
- [x] Phase 10 — Discord role roll
- [x] Phase 11 — Public API, webhooks, UCTV feed
- [x] Phase 12 — Hardening and delivery
- [x] Phase 13 — Shared sign-in: Parliament vouches

## Deviations

- Phase 2: the registration desk (Desk.tsx) is built in Phase 4 together with its real check-in flow; PollingStation already has the desk slot. RankBox and ScoreRow were built in Phase 2 (they share the paper code). The booth casts when the last slip is dropped, not when the last paper is folded.
- Phase 2: station.css and office.css are scoped (CSS nesting under .station / .office) so the two looks never collide during client-side navigation.

- Phase 4: the fraud module (signals, evaluate, IP lists, e-mail checks, device evidence) was written now because the desk needs it; Phase 5 adds the review tray, the privacy clock and its tests. One-time links and code cards land on the station page (?v= / ?code=) so the voter still passes the door and the desk. Public pages use a "hallway" look (src/app/hallway.css).

- Phase 8: a real SMTP send and a real Discord post were not tested (no credentials in development); the test buttons exist in Settings and the development mailbox (file transport) was used throughout.

- Phase 10: endpoints checked against docs.discord.com (Nov 2026). A live sign-in against a real Discord application was not tested (no test application available); the pure parts (roles, account age, snowflakes) and the desk admission are unit-tested. The device cookie is read on the callback; the browser fingerprint is not collected on this route.

- Phase 11: the API docs page is drawn in the office look instead of Swagger UI (the CSP forbids third-party scripts). The UCTV conversion is unit-tested, but sending to a running UCTV instance was not tested (it would write into that project's data). Sending keeps UCTV's existing counties and map, and asks UCTV to draw a map only for an empty UCTV election.
- Phase 12: the Docker image was not built or run (Docker Desktop's engine was not running on this machine); `npm run build` (the same build the Dockerfile runs) passes. The security pass found and fixed one gap: the polling-day actions did not check that the election belonged to the office's organisation. Each station scene now announces itself through an `aria-live` line.
- Phase 13: Parliament's `requireAuth` gained an optional return path so the authorize page can send a member through sign-in and back. An account with two-step sign-in still asks for its authenticator code after Parliament vouches. Tickets may live at most 120 seconds and be at most 30 seconds ahead of our clock. Tested end to end with both apps running locally (demo member signed in without a password; replayed, reused, expired, forged and cookie-less tickets refused). Parliament's change is on its branch `sso-for-elections`, not merged.

## Context

The repo `C:\OtherProjects\election-system` holds only design studies (`design/previews/`). The user picked **A1 · The Booth** (`design/previews/a1-booth.html` + `shared.js`) as the voter experience and wants the full platform built from it: an immersive, tactile, low-text election platform for the United States of Free Cliffs (USFC) that also hosts other organisations, with strong protection against repeat voting in public elections.

This plan is written to be executed phase by phase by a smaller model. Every phase is shippable on its own, ends with checks, and ends with one local git commit.

### Decisions already made by the user (do not re-ask)

| Area | Decision |
|---|---|
| Voter look | The Booth: green curtain, wooden booth, pencil on a string, tinted papers, fold, sealed steel box, receipt stub. Real gestures **with** a tap and keyboard path for every step. |
| Organiser look | "The office behind the hall": same world, calmer. Wood, paper forms, brass labels, ledger tables, a tray of provisional envelopes. Text and tables allowed, light animation. |
| Devices | Desktop and phone get equal weight (two composed layouts). |
| Public identity | Verified e-mail + device fingerprint + IP checks only. |
| Fraud policy | Per election, per signal: BLOCK / HOLD / IGNORE. HOLD = provisional envelope an officer accepts or rejects before the count. |
| VPN data | Local lists always; optional third-party API key. |
| Invite routes | One-time e-mail link, voter accounts, Discord role, printable code/QR cards (each election enables any of them). |
| Counting | Single choice, yes/no, pick-up-to-N, two-round runoff, party-list proportional, ranked choice (IRV + STV), score/points. |
| Constituencies | Full (per-district ballots and counts), optional per election. |
| Results | Per election: sealed until close (with a count ceremony) or live. |
| Re-voting | Per election. |
| Transparency | SECRET, WHO_VOTED (names public, choices secret), SHOW_OF_HANDS (names + choices; live or after close, per election). |
| Public names | In non-secret public elections the voter types the name to publish; officers can strike it. |
| Tenancy | Several organisations in one install. |
| Language | Translatable from day one, English only at first. |
| Candidates | Organiser-entered, or an optional nomination phase, per election. |
| Integrations | SMTP + Discord notifications; UCTV Elections feed; public API + webhooks; shared sign-in where **Parliament vouches** (last phase, edits the Parliament repo). |
| Git | `git init`, commit the studies, one local commit per finished phase. **Never push.** |

## Ground rules for the executor

1. Work one phase at a time, in order. Do not start a phase until the previous one passes its "Done when" list.
2. **Reuse before writing.** USFC Parliament lives at `C:\OtherProjects\voting-system` (same stack). Where this plan says "copy from Parliament", read that file first and adapt it; do not reinvent it. Read-only: never edit that repo before Phase 13.
3. Mirror Parliament for Next.js 16 syntax (async `params`, `await cookies()`, `await headers()`, server actions with the helpers in `src/lib/action.ts`).
4. No third-party scripts, fonts or images at run time (strict CSP, copied from Parliament's `next.config.ts`). All outbound calls (Discord, IP lists, UCTV, SSO) happen on the server.
5. Voter-facing screens use **minimal text**: icons, crest, symbols, at most a title and one short instruction per screen. All wording goes through the i18n dictionary, never hard-coded.
6. Every gesture needs a one-tap path and a keyboard path (Enter/Space), visible focus, and must respect `prefers-reduced-motion`.
7. Never write a secret-ballot choice to the audit log, to console logs, or next to a voter id.
8. Do not run `prisma migrate reset` or delete `data/`. Add migrations with `npx prisma migrate dev --name <what>`.
9. After each phase: `npm run typecheck`, `npm test`, the phase's manual check in the browser pane (desktop and 375×812), then commit: `git add -A && git commit -m "Phase N: <title>"`.
10. If something in this plan contradicts what a library or an external API actually does, check the library's docs, follow reality, and note the deviation in `docs/PLAN.md` under that phase.

## Stack (same versions as Parliament)

Next.js 16.4.6 (App Router) · React 19.3.1 · TypeScript ~5.9 · Prisma 6.19.3 + SQLite · zod ^4 · nodemailer ^7 · qrcode ^1.5.4 · vitest ^4 · tsx ^4.19 · Node 24. One process, one SQLite file, one container on Coolify. Dev port **3220**. Fonts through `next/font/google` (self-hosted at build): Libre Caslon Text, IBM Plex Sans Condensed, IBM Plex Mono.

## Repository layout

```
docs/PLAN.md                 this plan, with a checkbox per phase (keep it updated)
CLAUDE.md                    conventions for future sessions (rules 1-10 above, commands, layout)
design/                      the studies (keep; a1-booth.html is the visual reference)
prisma/schema.prisma, migrations/, seed.ts
scripts/init.mjs             creates .env + data folders (copy from Parliament)
src/app/
  layout.tsx, globals.css    fonts, base tokens
  station.css                The Booth (ported from a1-booth.html)
  office.css                 the office behind the hall
  page.tsx                   platform landing (list of organisations, or redirect when only one)
  setup/                     first-run: create platform admin + first organisation
  (hall)/login, forgot, reset, invite/[token]      staff + voter-account sign-in (copy from Parliament)
  o/[org]/page.tsx                                  the notice board: open, upcoming, past elections
  o/[org]/e/[election]/page.tsx                     the polling station (door → desk → booth → hall → receipt)
  o/[org]/e/[election]/results, register, verify, nominate
  v/[token]/                 one-time voting link
  c/[[...code]]/             code card entry (typed or QR)
  office/[org]/...           organiser area (see Phase 3)
  platform/                  platform admin: organisations, IP lists, SSO, health
  api/health, api/live/[election] (SSE), api/files/[id], api/discord/callback,
  api/sso/parliament/callback, api/v1/...
src/components/station/      voter-side components (Phase 2)
src/components/office/       organiser-side components
src/i18n/en.ts, index.ts
src/lib/                     see "Library modules"
src/data/disposable-domains.txt
tests/                       vitest
```

## Data model (prisma/schema.prisma)

SQLite has no enums: use strings and list allowed values in a comment and in `src/lib/types.ts`. Copy `User`, `Session`, `Token`, `Outbox`, `Setting`, `AuditLog`, `RateBucket` from Parliament's schema, then apply the changes below.

```prisma
model Organisation {
  id String @id @default(cuid())
  slug String @unique            // "usfc"
  name String                    // "United States of Free Cliffs"
  shortName String               // "USFC"
  locale String @default("en")
  timezone String @default("Europe/Prague")
  brand String @default("{}")    // JSON: see "Brand pack"
  smtp String @default("{}")     // JSON, password encrypted (copy Settings.smtp shape from Parliament)
  discord String @default("{}")  // JSON: webhookUrl(enc), botName, roleId, oauthClientId, oauthClientSecret(enc), guildId
  uctv String @default("{}")     // JSON: baseUrl, apiKey(enc)
  createdAt DateTime @default(now())
}
model User { /* as Parliament; rename isTechAdmin -> isPlatformAdmin; add ssoSource String? */ }
model OrgMember { id; orgId; userId; role /* OWNER | OFFICER | OBSERVER */; @@unique([orgId, userId]) }

model Party { id; orgId; name; abbr; color; symbol String @default("") /* built-in key or upload id */; position Int }
model DistrictSet { id; orgId; name /* "Cliffs", "Senate districts" */ }
model District { id; setId; name; code; seats Int @default(1); position Int }

// The organisation's standing register of voters (invite-only elections draw from it).
model RegisterEntry {
  id; orgId; displayName; email String? /* normalised */; emailKey String? /* alias-folded */
  userId String?; discordUserId String?; status /* ACTIVE | STRUCK */; note String @default("")
  @@unique([orgId, emailKey])
}
model RegisterDistrict { id; entryId; setId; districtId; @@unique([entryId, setId]) }

model Election {
  id; orgId; slug; title; summary String @default("")
  status       // DRAFT | NOMINATIONS | READY | OPEN | CLOSED | COUNTED | CERTIFIED | CANCELLED
  access       // PUBLIC | INVITE
  routes String    // JSON array of enabled entry routes: EMAIL_CODE (public only) | LINK | ACCOUNT | DISCORD | CODE
  transparency // SECRET | WHO_VOTED | SHOW_OF_HANDS
  handsLive Boolean @default(false)
  resultsMode  // SEALED | LIVE
  turnoutLive Boolean @default(true)
  allowRevote Boolean @default(false)
  districtSetId String?
  districtAssign // NONE | REGISTER | SELF   (SELF = public voter picks a district at the desk)
  fraud String     // JSON FraudPolicy, see Phase 5
  heldDefault  // WAIT | ACCEPT | REJECT  (what happens to undecided envelopes at count time)
  discordRoleIds String @default("[]")
  discordMinAgeDays Int @default(0)
  nominationsOpenAt DateTime?; nominationsCloseAt DateTime?
  opensAt DateTime?; closesAt DateTime?; openedAt DateTime?; closedAt DateTime?
  round Int @default(1); parentId String?        // runoff rounds
  runoffAfterHours Int?; runoffLastsHours Int?
  eligibleCount Int @default(0)
  result String?; resultHash String?; seal String?; chainHead String?
  countedAt DateTime?; certifiedAt DateTime?; certifiedById String?
  uctvElectionId String?
  reminderSentAt DateTime?; createdById String?; createdAt DateTime @default(now())
  @@unique([orgId, slug]); @@index([status, opensAt]); @@index([status, closesAt])
}

// One ballot paper. An election has 1..n contests ("points voted on in one sitting").
model Contest {
  id; electionId; position Int; title; instruction String @default("")
  method   // SINGLE | MULTI | YESNO | RANKED | SCORE | PARTY_LIST
  maxChoices Int @default(1)      // MULTI
  seats Int @default(1)           // RANKED (1 = IRV, >1 = STV), PARTY_LIST, MULTI (winners)
  scope    // NATIONAL | PER_DISTRICT
  rule String @default("{}")      // JSON ContestRule: { win: "PLURALITY"|"MAJORITY_RUNOFF", majorityPct: 50,
                                  //   pr: "DHONDT"|"SAINTE_LAGUE"|"HARE", prThresholdPct: 0, scoreMax: 5, allowBlank: true,
                                  //   supportersRequired: 0 }
}
model ContestDistrict { id; contestId; districtId; seats Int; @@unique([contestId, districtId]) } // seat overrides
model Option {
  id; contestId; districtId String?  // set when the contest is PER_DISTRICT
  name; subtitle String @default(""); partyId String?; color String @default("#23201c")
  symbol String @default(""); photoId String?; statement String @default("")
  kind     // CHOICE | YES | NO
  status   // APPROVED | PENDING | REJECTED | WITHDRAWN
  nominatedByEmail String?; position Int
}
model ListCandidate { id; optionId; position Int; name }          // closed party lists: who takes the seats
model NominationSupport { id; optionId; emailKey; displayName; createdAt; @@unique([optionId, emailKey]) }

// One line in the election's register per person admitted (or invited).
model RollEntry {
  id; electionId
  identityKey String   // "email:<hmac>" | "user:<id>" | "reg:<registerEntryId>" | "discord:<id>" | "code:<accessCodeId>"
  route    // EMAIL_CODE | LINK | ACCOUNT | DISCORD | CODE
  registerEntryId String?; userId String?; email String? /* enc, for notices */
  displayName String @default(""); nameStruck Boolean @default(false)
  districtId String?
  status   // INVITED | CHECKED_IN | VOTED | HELD | REJECTED | BLOCKED
  votedAt DateTime?        // only stored when transparency = SHOW_OF_HANDS
  ipHash String @default(""); ipEnc String @default(""); deviceId String @default(""); deviceFp String @default("")
  uaHash String @default(""); signals String @default("[]") // JSON array of Signal
  @@unique([electionId, identityKey]); @@index([electionId, ipHash]); @@index([electionId, deviceId]); @@index([electionId, deviceFp])
}
model AccessCode { id; electionId; codeHash String @unique; batch String; label String @default(""); districtId String?; usedAt DateTime? }
model BoothPass  { id String @id /* sha256 of cookie token */; electionId; rollEntryId; hold Boolean; reasons String @default("[]"); issuedAt DateTime @default(now()); expiresAt DateTime; usedAt DateTime? }

model Envelope {   // a provisional envelope: ballots held for review
  id; electionId; rollEntryId; reasons String; status /* HELD | ACCEPTED | REJECTED */
  decidedById String?; decidedAt DateTime?; note String @default(""); createdAt DateTime @default(now())
}
model Ballot {
  id String @id            // random, never time-ordered (randomId())
  electionId; contestId; districtId String?
  data String              // canonical JSON mark, see "Ballot marks"
  status   // COUNTED | HELD | REJECTED | SUPERSEDED
  rollEntryId String?      // only for SHOW_OF_HANDS
  envelopeId String?       // only while HELD
  revoteTag String?        // hmac, only while polls are open and allowRevote; wiped at close
  receiptHash String       // sha256(electionId:contestId:normalisedReceipt)
  seq Int?; prevHash String?; hash String?
  createdAt DateTime?      // only for SHOW_OF_HANDS
  @@unique([contestId, receiptHash]); @@unique([electionId, seq]); @@unique([electionId, prevHash]); @@index([electionId, status])
}

model IpVerdict { ip String @id; verdict String; source String; fetchedAt DateTime }
model Upload { id; orgId; storedName; mime; size Int; sha256; createdAt }
model ApiKey { id; orgId; name; keyHash String @unique; scope /* READ | MANAGE */; lastUsedAt DateTime?; createdAt }
model Webhook { id; orgId; url; secretEnc; events String; active Boolean @default(true) }
// Outbox: add orgId String? and channel WEBHOOK. AuditLog: add orgId String?.
// Token purposes: INVITE | RESET | SIGNIN | VOTE (one-time link; add electionId, rollEntryId) | EMAIL_CODE | SSO_NONCE | OAUTH_STATE
```

### Ballot marks (`Ballot.data`, canonical JSON, keys and arrays in a fixed order)

- SINGLE, YESNO, MULTI, PARTY_LIST: `{"x":["<optionId>", ...]}` (ids sorted; `[]` = blank, allowed when `rule.allowBlank`)
- RANKED: `{"r":["<1st>","<2nd>", ...]}` (order is the preference; partial rankings allowed)
- SCORE: `{"s":{"<optionId>":3, ...}}` (keys sorted; integers 0..scoreMax)

## Library modules (`src/lib/`)

| File | Source | Notes |
|---|---|---|
| `db.ts`, `problem.ts`, `ratelimit.ts`, `action.ts`, `format.ts`, `markdown.ts`, `uploads.ts`, `mailer.ts`, `discord.ts` | **copy from Parliament** `src/lib/` | Rename globals `__usfc*` → `__ps*`. `uploads.ts`: images only (png, jpg, webp, svg sanitised or rejected), 2 MB. |
| `crypto.ts` | copy | scrypt passwords, `sha256`, `hmac(purpose, value)`, `encrypt/decrypt` (AES-256-GCM with `APP_SECRET`), `randomToken`, `randomId`, `randomReceipt`, `normaliseReceipt`, `canonical`, `safeEqual`, TOTP. |
| `audit.ts` | copy | Hash-chained journal; add `orgId`. |
| `auth.ts` | copy, simplify | Sessions, `requestMeta()` (client IP via `TRUST_PROXY`), login with rate limit, optional TOTP. Replace chamber roles with `requireOffice(orgSlug, minRole)` and `requirePlatformAdmin()`. |
| `settings.ts` | copy, split | Platform settings (base URL, session hours, IP-list URLs, SSO) in `Setting`; per-organisation settings in `Organisation` JSON columns via `getOrg(slug)` / `saveOrg()`. Secrets encrypted. |
| `notify.ts`, `scheduler.ts`, `live.ts` | copy, adapt | Outbox with retry; 15 s clock started from `src/instrumentation.ts`; in-process event bus keyed by election id. |
| `types.ts` | new | String unions for every status/enum above, zod schemas for `FraudPolicy`, `ContestRule`, `Brand`, ballot marks. |
| `i18n` (`src/i18n/`) | new | `en.ts` flat dictionary (`"desk.email": "Your e-mail"`), `t(dict, key, vars)`, per-organisation overrides from `brand.words`. Server components call `getDict(org)`; client components get it through a context provider. |
| `elections.ts` | new | Lifecycle: create, edit (only in DRAFT/NOMINATIONS/READY), publish roll, open, close, cancel, certify. |
| `roll.ts` | new | Build the roll from the register / CSV / pasted e-mails, issue one-time links and code cards. |
| `desk.ts` | new | `admit()`: the single door every entry route goes through (Phase 4/5). |
| `ballot.ts` | new, modelled on Parliament `voting.ts` | `castSitting()`, chain, receipts, `closeAndCount()`, `verifyElection()`, `lookupReceipt()`. |
| `tally.ts` | new, pure | All counting methods (Phase 6). No DB access. |
| `fraud.ts`, `ipintel.ts`, `email.ts`, `fingerprint.ts` | new | Phase 5. |
| `runoff.ts`, `nominations.ts`, `discord-oauth.ts`, `webhooks.ts`, `uctv.ts`, `sso.ts` | new | Phases 6, 9, 10, 11, 13. |

## Brand pack (`Organisation.brand` JSON)

```
{ crestUploadId, colors: { curtain, curtainLight, wood, shelf, brass, ink, wax, box },
  tints: ["#f6f1e4", "#f3e7b5", "#dbe6ee", ...],   // ballot paper tints, cycled per contest
  words: { "station.plate": "Polling station", "certify.by": "the President", ... } }  // i18n overrides
```
Emitted as CSS custom properties on the `<main>` of every station/office page. Defaults = the prototype's values. The default crest is the SVG from `design/previews/shared.js` (`crest()`); an uploaded crest replaces it everywhere.

---

## Phase 0 — Bootstrap

1. `git init`; add `.gitignore` (node_modules, .next, data, .env, *.tsbuildinfo); commit the existing `design/` and `.claude/launch.json` as "Design studies".
2. Copy this plan to `docs/PLAN.md` with a `- [ ]` checkbox per phase. Write `CLAUDE.md` (ground rules, commands, layout, "Parliament is at ../voting-system, read-only").
3. Scaffold by copying from Parliament and renaming: `package.json` (name `polling-station`, port 3220, same scripts and versions), `tsconfig.json`, `next.config.ts` (CSP unchanged), `scripts/init.mjs`, `.env.example` (`DATABASE_URL="file:../data/elections.db"`, `APP_SECRET`, `SETUP_TOKEN`, `BASE_URL="http://localhost:3220"`, `UPLOAD_DIR`, `TRUST_PROXY`), `Dockerfile`, `docker-compose.yml`, `docker-compose.local.yml` (service `polling-station`, volume `polling-station-data`, db `/data/elections.db`), `vitest` setup.
4. Add a second entry to `.claude/launch.json`: name `app`, `npm run dev`, port 3220 (keep `design-studies`).
5. `src/app/layout.tsx` with the three fonts as CSS variables, an empty `page.tsx`, `/api/health`.

**Done when:** `npm install`, `npm run init`, `npm run dev` serve a blank page on 3220; `npm run typecheck` and `npm test` (one trivial test) pass; two commits exist.

## Phase 1 — Foundations: data, accounts, organisations, i18n

1. Write the full `schema.prisma` above; first migration `init`.
2. Copy the library modules marked "copy" and make them compile.
3. `/setup` (needs `SETUP_TOKEN`, only while no user exists): creates the platform admin and the first organisation (name, short name, slug).
4. Sign-in pages copied from Parliament's `(hall)` group: login, two-step code, forgot, reset, invite acceptance.
5. `/platform`: list/create organisations, platform settings form, scheduler status.
6. `/office/[org]/settings`: brand pack editor (crest upload, colour pickers with live preview swatch, tints), SMTP form with "send test", Discord webhook with "post test", staff list (invite OWNER/OFFICER/OBSERVER by e-mail).
7. i18n dictionary + provider; every string added from now on goes in `en.ts`.
8. `prisma/seed.ts` (`npm run seed:demo`, empty DB only): organisation `usfc` with the parties UPSF, CUP, CA, KKKK, PLUS Movement, Wall of Wisdom; district set "Cliffs" with Reliberated, Eternal Sand, Snowbelle, Dead End, Normalcy, Bolivar's, Revolutionary, Crimson Heights, Holy Crusade, Outer Fields, Former Union, Azure Blue; staff demo accounts; mail transport `file` (writes to `data/mailbox/`).

**Done when:** setup → sign in → create a second organisation → edit its brand → the journal (`AuditLog`) verifies; tests cover `crypto` (encrypt round-trip, receipt normalising) and `audit` chain verification.

## Phase 2 — The Booth as a component library

Port `design/previews/a1-booth.html` + `shared.js` to React **without changing how it looks or moves**. Keep the class names so the CSS ports one-to-one into `src/app/station.css`; replace hard-coded colours with the brand variables.

| Prototype piece | Component (`src/components/station/`) |
|---|---|
| `EP.sfx` | `sound.ts` (same synth functions; `SoundToggle` remembers per browser; silent until first gesture) |
| `EP.ink`, `EP.drag`, `EP.cloneDrawn`, `EP.over`, `EP.centre` | `ink.ts`, `drag.ts` (framework-free helpers used from `useEffect`) |
| `crest()`, `sym()` | `Crest.tsx` (upload or default), `Symbol.tsx` (the ten built-ins plus ~14 more: anchor, tree, key, wheel, book, flame, crown, bell, fish, hammer, wave, eye, hand, moon) |
| `.curtain`, `.rail`, `.plate` | `Curtain.tsx`, `DoorPlate.tsx` |
| `.booth`, `.notice`, `.shelf`, `.pile`, `.tray`, motes | `Booth.tsx` |
| `.pencil`, `#string` | `Pencil.tsx` |
| `.sheet`, `.paper`, `.box`, `.fold`, `.flap` | `BallotPaper.tsx` with mark widgets `CrossBox` (now), `RankBox`, `ScoreRow` (Phase 6) |
| `.hall`, `.urn`, `.slot`, `.chute`, `.hslip` | `Hall.tsx`, `BallotBox.tsx`, `Slips.tsx` |
| `.receipt`, `.stamp` | `ReceiptStub.tsx` |
| the page script's flow | `PollingStation.tsx`: a client state machine `door → desk → booth → hall → receipt`, plus terminal states `closed`, `notYet`, `alreadyVoted`, `blocked` |

New pieces not in the prototype (same visual language, minimal text):
- **`Desk.tsx`** — the registration desk between the door and the booth: an open register book on a table, a brass bell, one paper form. It hosts the identity step (Phase 4). The clerk "crosses your line" (pencil-stroke animation) when you are admitted, then hands over the papers (they slide onto the pile).
- **Long ballots**: when a paper is taller than the shelf, the shelf scrolls vertically and the fold corner stays reachable (sticky).
- **Variants of the last scene**: `ProvisionalEnvelope` (slips go into a brown envelope the clerk keeps, instead of the box) and `NoticeBoard` (show of hands: the unfolded paper with the voter's name is pinned up; no curtain is drawn in that mode).
- **Terminal cards** as hanging brass/enamel signs: closed (padlocked door), not open yet (clock), already voted (your register line already crossed), blocked (rope across the door).

Build `/demo` (dev only) that plays the prototype sitting from static data.

**Done when:** `/demo` is indistinguishable from `design/previews/a1-booth.html` side by side on desktop and at 375×812 (curtain, hand-drawn and tapped crosses, single-choice rub-out, pick-two refusal shake, 3D fold, slips to tray, drag or tap into the slot, receipt stamp), keyboard-only completion works, reduced motion works, no console errors.

## Phase 3 — The office: elections, ballots, register

Organiser area under `/office/[org]/`, guarded by `requireOffice`. Look: `office.css` (desk wood background, content on paper sheets, brass tab strip, ledger tables with ruled lines, stamps for status). Components in `src/components/office/`: `Sheet`, `BrassTabs`, `Ledger`, `Field` (form line, not a box), `StatusStamp`, `Tray`.

Pages:
- `elections` — ledger of elections with status stamps; "New election".
- `elections/[id]/setup` — title, slug, access (PUBLIC/INVITE), entry routes, transparency, results mode, re-voting, schedule, district set + assignment, held-default.
- `elections/[id]/ballot` — contests in order (add, reorder, method, max choices, seats, scope, rule); per contest its options (name, subtitle/party, colour, symbol picker, photo, statement; per-district when scoped); list candidates for PARTY_LIST. **Live preview**: the actual `BallotPaper` rendered beside the form.
- `elections/[id]/roll` — (INVITE) add from register (all / by district), paste or upload CSV (`email,name,district`), generate code cards (count, optional district) with a printable sheet of cards (QR via `qrcode`, each card: crest, election title, code, URL `/c/<code>`); "Publish roll" creates `RollEntry` rows (INVITED) and fixes `eligibleCount`.
- `elections/[id]/run` — the day itself: open/close buttons (or by the clock), live turnout, links to held ballots and audit.
- `register`, `districts`, `parties` — CRUD ledgers.

Rules in `elections.ts`: editing the ballot or rules is only possible before OPEN; opening requires ≥1 contest, each with ≥2 approved options (YESNO auto-creates Yes/No), valid dates, and for INVITE a published roll or a dynamic route (DISCORD/CODE).

**Done when:** an officer can create the demo election (Prime Minister SINGLE, referendum YESNO, JK Days host MULTI max 2) entirely in the office, see correct paper previews, publish a roll of five e-mails, and print code cards; everything is journalled; observers get read-only pages.

## Phase 4 — Voting core

### Admission (`src/lib/desk.ts`)
`admit({ election, route, identity, displayName?, districtId?, meta: { ip, userAgent, deviceId, deviceFp } })` → `{ outcome: "ADMIT" | "HOLD" | "BLOCK" | "ALREADY", pass?, reasons }`. Inside one write-locked transaction: resolve `identityKey`; find or create the `RollEntry`; if it has status VOTED → `ALREADY` (or allow when `allowRevote`); run the fraud policy (Phase 5; until then always ADMIT); set status CHECKED_IN; create a `BoothPass` (30 min) and set it as an httpOnly cookie scoped to the election path.

Entry routes (each ends in `admit`):
- **EMAIL_CODE** (public): form on the desk = e-mail (+ name when transparency ≠ SECRET, with a one-line "your name will be published" notice; + district tiles when `districtAssign = SELF`). Server sends a 6-digit code (Token `EMAIL_CODE`, 10 min, 5 attempts, rate-limited per e-mail, per IP and per device). Code entry is six paper squares. `identityKey = "email:" + hmac("email", emailKey)`.
- **LINK**: `/v/[token]` validates Token `VOTE` → admits the linked `RollEntry` → redirects to the station at the desk-passed state. The token is consumed when the sitting is cast (as Parliament does), not when opened.
- **ACCOUNT**: signed-in user whose e-mail matches a `RollEntry`/`RegisterEntry` on the roll.
- **CODE**: `/c` (six-character code input or QR deep link) → `AccessCode` → `identityKey = "code:<id>"`.
- **DISCORD**: Phase 10.

### Casting (`src/lib/ballot.ts`, modelled on Parliament's `castBallot`)
`castSitting({ passToken, marks: [{ contestId, data }] , meta })` inside `withWriteLock` + one transaction:
1. Load pass → roll entry → election; require OPEN and not past `closesAt`; pass unused and unexpired.
2. Require exactly one mark per contest the voter is entitled to (contests for their district); validate each with `validateMark(contest, options, data)`.
3. If the entry already voted and `allowRevote`: mark old ballots SUPERSEDED (by `rollEntryId` for SHOW_OF_HANDS, by `revoteTag` otherwise).
4. One receipt code for the sitting (`randomReceipt()`); per ballot `receiptHash = sha256(electionId:contestId:normalised)`.
5. SHOW_OF_HANDS: store `rollEntryId`, `createdAt`, and chain immediately (seq, prevHash, hash). SECRET / WHO_VOTED: store no voter, no time, no chain position.
6. If the pass says `hold`: create an `Envelope`, ballots get status HELD + `envelopeId`, roll entry status HELD. Otherwise COUNTED and roll entry VOTED.
7. Mark pass used, consume the one-time token if any, journal `ballot.cast` (no choices unless SHOW_OF_HANDS), `bump(electionId)`.
Returns `{ receipt, held }`.

Ballot hash link: `sha256(canonical({ prev, electionId, contestId, districtId, seq, data, voter: rollEntryId | null, receiptHash }))`; genesis `sha256("polling-station:" + electionId)`.

### Station wiring
`o/[org]/e/[election]/page.tsx` loads the election, the voter's state (pass cookie) and renders `PollingStation` with: brand, dictionary, contests + options for the voter's district, enabled routes, transparency. Server actions in `actions.ts`: `presentEmail`, `confirmCode`, `enterWithCode`, `enterWithAccount`, `cast`. The hall scene picks `BallotBox` / `ProvisionalEnvelope` / `NoticeBoard` from the cast result and transparency. The receipt stub shows the code, a "keep this" line, and (held case) "kept in an envelope for the returning officer".

Also: `o/[org]/page.tsx` notice board (enamel signs per election: opens/closes, status), `register` page for WHO_VOTED/SHOW_OF_HANDS (the open register book: names with crossed lines; struck names hidden), `verify` page (receipt → "in the box" / "held" / "rejected" / "replaced").

**Done when (browser, desktop + phone):** public demo election: e-mail → code from `data/mailbox` → booth → box → receipt; second attempt with the same e-mail (and with a `+tag` / Gmail-dots variant) shows "already voted"; invite election works by link, by account and by code card; a show-of-hands election pins named papers to the board; integration tests (temp SQLite file) cover cast, duplicate refusal, re-vote superseding, held path.

## Phase 5 — Fraud layer

### Signals (`src/lib/fraud.ts`)
`type Signal = "VPN" | "TOR" | "DATACENTER" | "PROXY_API" | "DEVICE_REPEAT" | "DEVICE_SIMILAR" | "IP_SHARED" | "DISPOSABLE_EMAIL" | "NO_MX" | "TOO_FAST" | "LOOKUP_FAILED"`.
`FraudPolicy` = `{ [signal]: "BLOCK" | "HOLD" | "IGNORE", ipSharedThreshold: number }`. Defaults for PUBLIC: VPN/TOR/PROXY_API/DISPOSABLE_EMAIL/NO_MX/DEVICE_REPEAT = BLOCK; DATACENTER/DEVICE_SIMILAR/IP_SHARED (threshold 3)/TOO_FAST = HOLD; LOOKUP_FAILED = IGNORE. Defaults for INVITE: everything IGNORE except DEVICE_REPEAT = HOLD. `evaluate(signals, policy)` → strongest action + reasons (pure, unit-tested). The policy editor in `elections/[id]/setup` is a small ledger: one row per signal, three brass toggle positions.

### Evidence
- **E-mail (`email.ts`)**: `normalise()` lowercases/trims; `emailKey()` strips `+tag` for all domains and dots for gmail.com/googlemail.com (then maps googlemail→gmail); disposable check against `src/data/disposable-domains.txt` (download once from the `disposable-email-domains` project and commit it); `dns.resolveMx` with 3 s timeout.
- **Device (`src/components/station/fingerprint.ts`, client)**: `deviceId` = random id kept in `localStorage` **and** a 2-year cookie (restore one from the other); `deviceFp` = SHA-256 (SubtleCrypto) of canvas render, WebGL vendor/renderer, screen size + pixel ratio, timezone, languages, platform, hardware concurrency, device memory. Sent with the desk form. Server stores `hmac("device", value)`. DEVICE_REPEAT = another roll entry in this election with the same `deviceId`; DEVICE_SIMILAR = same `deviceFp` but different/missing id.
- **IP (`ipintel.ts`)**: `ipHash = hmac("ip", ip)` (IPv6: first 64 bits); raw IP also stored encrypted for the officer. IP_SHARED when ≥ threshold other roll entries in this election share the hash. Local lists: text files of CIDRs/IPs under `data/iplists/`, parsed into sorted numeric ranges (IPv4 as numbers, IPv6 as BigInt), matched by binary search; refreshed daily by the scheduler, keeping the last good copy. Default sources (platform settings; **verify each URL when implementing**): Tor exits `https://check.torproject.org/torbulkexitlist`; VPN ranges and datacenter ranges from the `X4BNet/lists_vpn` GitHub repository (`output/vpn/ipv4.txt`, `output/datacenter/ipv4.txt`). Optional API adapters behind one interface `lookup(ip) → { vpn, proxy, tor, hosting, asn?, country? }`: proxycheck.io and IPQualityScore (read their current docs for the exact request shape); 2.5 s timeout, results cached 24 h in `IpVerdict`; failure → LOOKUP_FAILED.
- **Speed**: cast less than 4 s after the pass was issued → TOO_FAST (applied at cast time: turns the sitting into a held one).
- Rate limits with `hit()`: code requests per e-mail (3 / 10 min), per IP (10 / 10 min), per device (5 / 10 min); code attempts 5 per challenge.

### Review (`/office/[org]/elections/[id]/held`)
The tray: one brown envelope per `Envelope` (HELD). Opening one shows the register line (name, route, masked e-mail), the reasons as stamped tags, IP (decrypted) with country/ASN when known, how many others share the IP/device, time. **Never the ballot contents.** Accept → ballots COUNTED, `envelopeId` cleared, roll entry VOTED; Reject → ballots REJECTED, roll entry REJECTED; both journalled, both optionally e-mail the voter. Bulk accept/reject by reason. Counting is refused while envelopes are HELD and `heldDefault = WAIT`.

Privacy clock: the scheduler wipes `ipEnc`, `deviceId`, `deviceFp`, `uaHash` from roll entries 30 days after certification.

**Done when:** unit tests for `evaluate`, `emailKey`, CIDR matching (v4 + v6); in the browser a second vote from the same browser with a different e-mail is refused/held per policy; a held sitting ends in the provisional envelope scene, appears in the tray, and accept/reject changes the count; a listed test IP (inject via a dev-only header override guarded by `NODE_ENV !== "production"`) triggers VPN handling.

## Phase 6 — Counting, results, the remaining ballot types

### `src/lib/tally.ts` (pure functions, exhaustive unit tests)
- `countChoices(marks, optionIds)` → votes per option, blanks. Used by SINGLE, YESNO, MULTI, PARTY_LIST.
- `decideSingle(totals, rule)` → `{ outcome: "ELECTED" | "RUNOFF" | "TIED", winners, finalists }`. PLURALITY: most votes (tie → TIED). MAJORITY_RUNOFF: winner needs share of non-blank votes > `majorityPct`; otherwise finalists = top two (everyone tied for second is included).
- `decideMulti(totals, seats)` → top `seats` (ties at the cut → TIED with the tied set reported).
- `allocateSeats(totals, seats, method, thresholdPct)` → seats per list. D'Hondt divisors 1,2,3…; Sainte-Laguë 1,3,5…; Hare = quota `total/seats`, whole quotas then largest remainders. Lists under the threshold are removed first. Ties for the last seat → higher total votes, then report `tie: true`.
- `irv(rankings, optionIds)` → rounds; eliminate the lowest each round (tie for lowest → eliminate the one with fewer first-round votes, then report `tie`), stop at > 50 % of continuing ballots.
- `stv(rankings, optionIds, seats)` → Droop quota `floor(valid/(seats+1)) + 1`; surpluses transferred with the weighted inclusive Gregory method (every ballot of the elected candidate moves on at `weight × surplus/total`); when nobody reaches quota eliminate the lowest; when continuing candidates = remaining seats, elect them. Use rational-safe arithmetic (integers scaled by 1e6) and report every round.
- `scoreTotals(marks, optionIds)` → sum and mean per option; highest sum wins (tie → higher mean → TIED).

Test vectors to include verbatim:
- Seats: votes A 100000, B 80000, C 30000, D 20000, 8 seats → D'Hondt A4 B3 C1 D0; Sainte-Laguë A3 B3 C1 D1; Hare A3 B3 C1 D1.
- IRV: 4×[A,B], 3×[B,A], 2×[C,B] → round 1 A4 B3 C2, C eliminated, B wins 5–4.
- STV, 3 seats, 20 ballots: 4×[Oranges], 2×[Pears, Oranges], 8×[Chocolate, Strawberries], 4×[Chocolate, Sweets], 1×[Strawberries], 1×[Sweets] → quota 6; Chocolate elected (12, surplus 6, transfer value 0.5 → Strawberries 5, Sweets 3); Pears eliminated → Oranges 6 elected; Sweets eliminated; Strawberries takes the last seat.
- Runoff: 45/40/15 with MAJORITY_RUNOFF → RUNOFF between the first two.

### Closing (`closeAndCount` in `ballot.ts`, modelled on Parliament's `closeVote`)
1. Status CLOSED. Apply `heldDefault` (ACCEPT/REJECT) to undecided envelopes, or stop here when WAIT and some remain.
2. For SECRET/WHO_VOTED: wipe `revoteTag`, then **shuffle the urn** exactly as Parliament does (delete and re-insert the ballots ordered by `receiptHash`, then assign `seq` and chain) so storage order no longer reflects casting order. SUPERSEDED/REJECTED ballots stay out of the chain.
3. Tally every contest, per district when scoped, plus a national roll-up (PARTY_LIST: sum of district seats; candidates seated from `ListCandidate` order).
4. Store `result` (JSON snapshot: turnout, per contest → per district → totals, rounds, winners, seats, ties), `resultHash`, `chainHead`, `seal = hmac("result-seal", resultHash)`; status COUNTED; journal; notify; webhooks.
5. `verifyElection(id)` recomputes chain + tallies and lists problems (public "Recount" button).
6. `certify(id, officer)` → CERTIFIED (wording of who certifies from `brand.words`).
7. **Runoff** (`runoff.ts`): when a contest ends in RUNOFF, create a child election (round 2, same settings, only the finalists, same roll for INVITE) as DRAFT; if `runoffAfterHours` is set, schedule it automatically to open that many hours after the count for `runoffLastsHours`.

### Booth widgets for the new marks
- `RankBox`: tapping/drawing in a box writes the next number (pencil digits drawn stroke by stroke); tapping a numbered box rubs out that number and all higher ones.
- `ScoreRow`: a row of `scoreMax + 1` small circles (0…max) per option; filling one rubs out the previous one in that row.
- PARTY_LIST: one cross per paper; each list shows its symbol, name and first three list names in small type.

### Results (`o/[org]/e/[election]/results`)
"The count": the box on the table with its seal broken, ballots dealt into piles; each option's bar is a stack of paper growing to its height, winners get a rosette, runoffs a "second round" tag, ranked contests a round-by-round strip, PR a row of seats (small chairs) per list. District picker = a brass index tab strip. Sealed elections show a padlocked box and turnout only until COUNTED; live elections update over SSE (`/api/live/[election]`, tally cached 5 s). Certified results show the certification stamp and a printable official record (print stylesheet). Links: register (if public), verify, download ballots (JSON of chained ballots, after close).

**Done when:** all tally tests pass; in the browser one election of each method can be voted, closed, counted, recounted and certified; a tampered ballot row (edit `data` in the DB by hand in dev) makes "Recount" report the broken link; a majority-runoff election spawns round two.

## Phase 7 — Constituencies end to end

- Roll building assigns `RollEntry.districtId` from the register (`districtAssign = REGISTER`); CSV import accepts a `district` code; code-card batches can be tied to a district; public voters pick their district at the desk (`SELF`) from crest tiles.
- The station serves only the options of the voter's district for PER_DISTRICT contests; NATIONAL contests are the same for everyone but results are broken down by district.
- `ContestDistrict` seat overrides in the ballot editor (e.g. 50 seats in every Cliff).
- Results: per-district view + national roll-up; turnout per district.
- Seed: a second demo election "National Gathering" (PARTY_LIST, PER_DISTRICT, 50 seats per Cliff, D'Hondt).

**Done when:** two voters in different Cliffs see different ballots, counts are separate, the roll-up is right (integration test with fixed ballots).

## Phase 8 — Notifications (SMTP + Discord)

Through the Outbox (retry with back-off, copied from Parliament). E-mail template: copy `renderEmail` from Parliament's `mailer.ts`, restyled to the Booth (cream paper, crest, brass rule). Per organisation SMTP and Discord webhook.

| Event | E-mail | Discord webhook |
|---|---|---|
| Election announced / scheduled | — | embed with dates and link, optional role mention |
| Roll published | invitation to each invitee with their one-time link (LINK route) or sign-in link | — |
| Public e-mail code | the 6-digit code | — |
| Polls opened | invitees (if not already sent) | embed |
| Closing soon (setting: minutes before close) | invitees who have not voted | embed with turnout |
| Polls closed / counted / certified | invitees (optional) | embed with result summary (only when results are public) |
| Envelope accepted / rejected | the voter, when an e-mail is known | — |
| Held ballots waiting | officers (digest, at most hourly) | — |
| Nomination filed / approved / rejected | nominee, officers | — |

One-time links are never posted to Discord. Per-election switches for each row in `elections/[id]/setup`.

**Done when:** with the `file` transport every event writes the right message; a real SMTP test send and a Discord test post work from settings; failures retry and show in `/platform`.

## Phase 9 — Nominations

Optional per election (status NOMINATIONS between the dates). Public page `o/[org]/e/[election]/nominate` in the office style (a nomination form on paper): choose contest (+ district), name, party, symbol, photo, statement, e-mail (verified by code). Creates an `Option` with status PENDING. If `rule.supportersRequired > 0`, the nominee gets a share link where supporters sign (verified e-mail, one signature per `emailKey`). Officers approve/reject/reorder in `elections/[id]/ballot` (PENDING options appear in a "nominations tray"). Closing nominations moves the election to READY.

**Done when:** a nomination goes from form → e-mail verification → signatures → approval → appears on the paper preview.

## Phase 10 — Discord role roll

`discord-oauth.ts`. Per-organisation Discord application (client id + secret in org settings, guild id). Desk button "Discord" → `https://discord.com/oauth2/authorize` with scopes `identify guilds.members.read`, state in a Token (`OAUTH_STATE`) → `/api/discord/callback` exchanges the code, reads the user and their member object for the guild, requires one of `Election.discordRoleIds`, checks account age from the snowflake against `discordMinAgeDays`, then `admit()` with `identityKey = "discord:<id>"` and the guild nickname as display name. Tokens are not stored. **Read Discord's current OAuth2 documentation before implementing** and adjust endpoint details to it.

**Done when:** with a test application, a member with the role is admitted, one without is turned away with the "not on the roll" sign, and a second attempt shows "already voted".

## Phase 11 — Public API, webhooks, UCTV feed

- **API** (`/api/v1`, JSON, CORS open for GET): `orgs/{org}/elections`, `…/elections/{slug}`, `…/turnout`, `…/results` (404 until visible), `…/ballots` (after close), `…/stream` (SSE). `ApiKey` (Bearer `ps_…`, stored hashed) with scope MANAGE additionally allows `POST …/open` and `…/close`. Hand-written `openapi.json` + a docs page in the office style. Keys are managed in org settings.
- **Webhooks** (`webhooks.ts`): events `election.opened`, `election.closed`, `election.counted`, `election.certified`, `envelope.held`; body JSON, header `X-PS-Signature: sha256=<hmac of body with the webhook secret>`; delivered through the Outbox (channel WEBHOOK) with retries.
- **UCTV feed** (`uctv.ts`): **first read** `C:\OtherProjects\uctv-elections\packages\shared\src\index.ts` (the `Scenario` schema) and `apps/api/src/index.ts` (admin routes, API-key auth). Org settings hold the UCTV base URL and a control API key; an election holds the UCTV election id. "Send to UCTV" (button, and automatically on COUNTED when enabled): fetch the UCTV election, keep its `map` and `settings` but set `settings.voteMultiplier = 1` and `rule` to match, replace `parties` (from `Party`) and `races` (one race per SINGLE/PARTY_LIST contest and district: candidates with `rawVotes` = real votes and `partyId`; `counties` = the districts, or one "National" county), `PUT …/scenario`, then ask UCTV to regenerate its map. Known limit, state it in the UI: UCTV spreads a race's votes over its counties itself, so only race totals are exact. RANKED and SCORE contests are not sent.

**Done when:** `curl` examples from the docs page work; a webhook receiver (a tiny local script) gets signed events; with UCTV running locally (`npm run dev:api` there), a counted demo election appears in UCTV with the true totals.

## Phase 12 — Hardening and delivery

- Accessibility pass on the station: keyboard-only run, screen-reader labels (`aria-live` status for each scene), focus order, colour-independent marks, reduced motion, sound off by default if `prefers-reduced-motion`.
- Phone pass at 375×812 and 360×640 for every station scene and the three hall variants; long-ballot scrolling.
- Security pass: every server action re-checks org role; rate limits on sign-in, codes, links, nominations; uploads sanitised; CSP intact; cookies `httpOnly`/`secure`/`sameSite=lax`; no secret-ballot data in logs (grep for `console.log`).
- `README.md` modelled on Parliament's: quick start, roles, how an election runs, security model **with its limits** (server owner can forge; chains make tampering evident; while polls are open, someone reading the database and holding `APP_SECRET` could correlate; device and IP checks raise the cost of repeat voting but cannot make it impossible), configuration, Coolify deployment, backup of `/data`.
- Docker build runs; `/api/health` used by the healthcheck.

**Done when:** `docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build` serves the app and a full demo election can be run in it.

## Phase 13 — Shared sign-in: Parliament vouches (touches `C:\OtherProjects\voting-system`)

Only now is the Parliament repo edited; commit there separately on a branch `sso-for-elections`, do not push.

Protocol (signed short-lived ticket, no back channel):
1. Election platform `GET /sso/parliament/start?next=…` → stores a random `state` (Token `OAUTH_STATE`, httpOnly cookie) → redirects to `{parliamentUrl}/sso/authorize?client=<clientId>&redirect=<callback>&state=<state>`.
2. **Parliament (new)**: page `src/app/sso/authorize/page.tsx` using its `requireAuth` (signs the user in first if needed); checks `client` and `redirect` against a new settings group `sso` (`clientId`, `redirectUrl`, `sharedSecret` encrypted; new section under Tech admin with a "generate secret" button); builds `payload = base64url(JSON{ sub, email, name, aud: clientId, iat, exp: iat+60, nonce })`, `sig = HMAC-SHA256(sharedSecret, payload)`; redirects to `redirect?ticket=<payload>.<sig>&state=<state>`; journals `sso.issued`.
3. Election platform `GET /api/sso/parliament/callback`: checks the state cookie, verifies the signature with `safeEqual`, `aud`, `exp`, and that the `nonce` was not seen (store its hash as Token `SSO_NONCE` until `exp`); finds or creates the `User` by e-mail (`ssoSource = "parliament"`), `createSession`, redirects to `next` (validated with `safePath`).
4. Platform settings: Parliament URL, client id, shared secret (encrypted), on/off. The login page and the desk's ACCOUNT route show "Continue with USFC Parliament" when on.

**Done when:** with both apps running locally, a Parliament member lands signed in on the election platform without a password; a replayed or expired ticket is refused; both repos have their commit.

---

## Verification (whole project)

- `npm run typecheck` and `npm test` green (tally vectors, fraud policy, e-mail folding, CIDR matcher, chain + seal, cast/close/held integration tests on a temp SQLite file).
- Start with `preview_start` name `app` (port 3220). Seed with `npm run seed:demo`. Demo mail lands in `data/mailbox/`.
- Scripted walk in the browser pane, desktop then 375×812:
  1. Public sealed election: door → desk (e-mail + code) → three papers → box → receipt → verify the receipt.
  2. Repeat from the same browser with another e-mail → refused or provisional envelope per policy; accept it in the office tray.
  3. Invite election by one-time link, by code card (QR URL), by account.
  4. Show-of-hands election: named paper pinned to the board, register page lists names.
  5. Close, count, recount, certify; results page for each counting method; runoff round created.
  6. Constituency election: two Cliffs, different ballots, correct roll-up.
- Side-by-side with `design/previews/a1-booth.html` (launch config `design-studies`, port 4310): the station must still look and move like the study.
- No console errors, no requests to third-party hosts from the browser (check the network panel).

## Out of scope for this plan

Seating election winners into Parliament automatically; custom hostnames per organisation; SMS verification; a citizen register for public elections; languages other than English (the dictionary is ready for them); the eight other design studies as alternative themes.
