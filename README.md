# Polling Station

Elections and referendums for the **United States of Free Cliffs** and any other organisation that wants its own polling station: a public notice board, a polling booth you vote in by hand, sealed and verifiable counts, and an election office behind the hall.

Built with Next.js 16, TypeScript, Prisma and SQLite. One process, one database file, no external services required. It is a sibling of [USFC Parliament](../voting-system) (same stack and conventions).

## Quick start

Needs Node 24.

```bash
npm install
```

```bash
npm run init
```

```bash
npx prisma migrate deploy
```

```bash
npm run dev
```

Open <http://localhost:3220>. With an empty database you land on **/setup**, which asks for the `SETUP_TOKEN` from `.env`, makes you the platform administrator and founds the first organisation.

### Demo data

```bash
npm run seed:demo
```

Seeds the United States of Free Cliffs: parties, the twelve Cliffs as districts, a register of citizens, staff (`escribez@usfc.test` owner and platform admin, `rootman@usfc.test` officer, `norton@usfc.test` observer; password `free-cliffs-demo`), and two open elections: **Federal Polling Day** (the design study's three papers) and the **National Gathering** (party lists in every Cliff, 50 seats each). It only runs on an empty database. Demo e-mail, including voting codes, is written to `data/mailbox/` instead of being sent. Never seed a real installation.

`/demo` (development only) plays the booth with static data; `?hall=envelope` or `?hall=board` shows the other endings, `?more=1` adds ranked and score papers.

## The voter's way through

1. **The notice board** (`/o/{org}`): every open, coming and decided election, pinned to cork.
2. **The door**: a brass plate on a curtain. Tap it.
3. **The desk**: the clerk's register and one form card. Public voters ring the bell for a six-digit code by e-mail (and, in a non-secret election, write the name to publish; in a constituency election they pick their district). Invitees come in with their one-time link, a code card, their account, or Discord. Their line in the register is written and crossed.
4. **The booth**: one tinted paper per question. Draw your cross with the pencil, or tap the box and the pencil draws it; number boxes for ranked papers; score circles. Fold the paper by its corner.
5. **The hall**: drag the folded papers into the slot of the sealed box, or tap them. A held visit goes into the returning officer's envelope instead; a show of hands is pinned to the board.
6. **The receipt**: a code that proves later that the ballot is in the count (`/o/{org}/e/{election}/verify`).

Every gesture has a tap and a keyboard path; motion is reduced when the system asks for it; sound is synthesised in the browser (switch in the corner).

## The office

`/office/{org}`: **Elections** (setup, papers with a live preview of the real paper, roll, polling day, held envelopes, results), **Register**, **Parties**, **Districts**, **Settings** (owners: colours and crest, mail, Discord, staff, API keys, webhooks, UCTV), **Journal**. `/platform` is for the platform administrator: organisations, platform mail, IP lists, shared sign-in, health.

| Role | Can |
| --- | --- |
| Platform admin | Everything, in every organisation; founds organisations; platform settings. |
| Owner | Settings and staff of their organisation, plus everything an officer can. |
| Officer | Draw up, open, close, count and certify elections; the roll; the tray of held envelopes; register, parties, districts. |
| Observer | Read everything, change nothing. |

### An election, from draft to certificate

- **Setup**: who may vote (the public with a verified e-mail, or only the roll), the ways in, what is public (secret / who voted / show of hands, live or after the close), results sealed or live, re-voting, constituencies, the fraud policy, notices, second rounds, nominations.
- **Papers**: single choice, several choices (mark up to N), yes/no, ranked (instant runoff, or STV for several seats), score, party lists (D'Hondt, Sainte-Laguë or Hare with a threshold); one paper for everyone or its own options in each district.
- **Nominations** (optional): candidates file themselves, prove their e-mail, collect supporters' signatures; officers approve.
- **Roll** (invite only): from the register, a pasted or uploaded list, printable QR code cards, or a Discord role. Publishing sends each voter their own link.
- **Polling day**: open by hand or by the clock, watch turnout, close. Closing counts.
- **The count**: secret ballots are shuffled, chained and the result sealed; anyone can download the ballots and recount; the office recounts with one button; certify. A paper without the majority it needs draws up its second round.

## Security model

- **One voter, one ballot.** Every way in passes the same desk. A public voter is a verified inbox: `+tags` and Gmail dots are folded away, throwaway domains and dead domains can be refused. A booth pass (30 minutes, single use, spent in the same transaction as the ballots) carries exactly one sitting.
- **Repeat voting signs**, each set per election to *refuse*, *hold* or *ignore*: VPN, Tor, datacenter (local lists, refreshed daily: Tor exit list and the X4BNet VPN/datacenter ranges), residential proxy (optional lookup service: proxycheck.io or IPQualityScore), the same device (a random id kept in the browser) or a similar one (a fingerprint), several voters on one address, a throwaway or dead e-mail domain, a sitting cast too fast. *Held* visits go into a provisional envelope: officers see who came and why, never what they marked, and count or set aside the envelope.
- **Secret ballots** are stored without voter, time or chain position. While polls are open and re-voting is allowed, a keyed tag ties a voter's ballots together so a re-vote can replace them; it is wiped at the close. Held ballots are tied to their envelope until an officer decides. At the close the urn is shuffled and chained.
- **The count** is sealed: the result is hashed with the head of the ballot chain and signed with an HMAC. Recounting recomputes the chain and the result from the ballots and checks the seal. Show-of-hands ballots are chained as they are cast.
- **Receipts** prove a ballot is in the count without saying what it is.
- **The journal**: every act is appended to a hash-chained log; choices of secret ballots never appear in it.
- **At rest**: passwords scrypt; session tokens, links, codes and receipts stored only as hashes; e-mail addresses on the roll encrypted; IP addresses, device ids and fingerprints kept only as keyed hashes (the raw IP encrypted, for the officer's tray) and wiped 30 days after certification; SMTP, Discord, API and shared sign-in secrets encrypted with `APP_SECRET`.
- **The pages**: strict Content-Security-Policy, no third-party scripts or fonts, rate limits on sign-in, codes, cards, nominations and the API.

**Limits to be aware of.** Whoever controls the server, its `.env` and its database can ultimately forge anything; the chains and seals make tampering evident, not impossible. While polls are open, someone reading the database and holding `APP_SECRET` could link re-votable or held ballots to their voter. Device and address checks raise the cost of voting twice; they cannot make it impossible (a second device on a second connection with a second inbox gets through). One-time links are as safe as the voter's mailbox.

## Integrations

- **E-mail**: per organisation, or the platform's; SMTP with STARTTLS or TLS, or the development mailbox. Failed messages are retried (1, 5, 15, 60 minutes) and listed under Platform → Health.
- **Discord**: announcements through a webhook (one-time links are never posted), and a server role as the roll (OAuth2 with `identify` and `guilds.members.read`; redirect address `/api/discord/callback`).
- **API**: `/api/v1/orgs/{org}/elections/...` (see `/api/docs`), with read and manage keys.
- **Webhooks**: `election.opened`, `election.closed`, `election.counted`, `election.certified`, `envelope.held`, signed with `X-PS-Signature: sha256=…`.
- **UCTV Elections**: counted results are sent to a UCTV election (its id on the polling-day page) so election night runs on true numbers.
- **USFC Parliament**: members sign in with their Parliament account (Platform → Settings → Shared sign-in; Parliament must have the same client id and secret).

## Configuration

`.env` (see [.env.example](.env.example)):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | SQLite file, relative to `prisma/`. |
| `APP_SECRET` | Master secret, 32+ random characters. Changing it invalidates stored credentials, hashes and seals. |
| `SETUP_TOKEN` | Required once, on `/setup`. |
| `BASE_URL` | Public address, for links in e-mail and Discord. |
| `UPLOAD_DIR` | Where crests and photos are stored. |
| `IPLIST_DIR` | Where the Tor, VPN and datacenter lists are kept. |
| `TRUST_PROXY` | How many reverse proxies stand in front of the app: `0` none, `1` Coolify's Traefik alone, `2` another proxy (such as Nginx Proxy Manager) in front of Traefik. Sets secure cookies and tells the app which forwarded address is the voter's; too high a number lets voters choose their own address. |

Everything else is set in the app.

## Deploying

### Coolify

1. Add the repository as a resource with the **Docker Compose** build pack (`/docker-compose.yml`).
2. Give the `polling-station` service its domain (port 3220).
3. Set `APP_SECRET`, `SETUP_TOKEN` and `BASE_URL`. `TRUST_PROXY` defaults to `1` (Traefik only); set `2` when another proxy terminates TLS in front of Coolify.
4. Deploy. Migrations run when the container starts; the health check is `/api/health`.
5. Open the site: it lands on **/setup**.

The database, uploads and IP lists live in the `polling-station-data` volume (`/data` in the container): back it up. Run a single instance: the clock and the write lock assume one process. Never change `APP_SECRET` on a live installation.

### Elsewhere

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

Without Docker: `npm ci`, `npm run build`, `npm start`.

## Development

```bash
npm test
```

```bash
npm run typecheck
```

- [src/lib/desk.ts](src/lib/desk.ts): the desk, the single door of every way in.
- [src/lib/fraud.ts](src/lib/fraud.ts), [src/lib/ipintel.ts](src/lib/ipintel.ts), [src/lib/cidr.ts](src/lib/cidr.ts), [src/lib/email.ts](src/lib/email.ts): the signs of a repeat visit.
- [src/lib/ballot.ts](src/lib/ballot.ts): casting, closing, counting, sealing, verifying.
- [src/lib/tally.ts](src/lib/tally.ts): counting rules, pure and unit-tested.
- [src/components/station/](src/components/station): the booth. [src/app/station.css](src/app/station.css) is its look.
- [docs/PLAN.md](docs/PLAN.md): the build plan and its deviations.

Tests run against a throwaway database (`data/test.db`), never the development one.
