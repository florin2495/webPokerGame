@AGENTS.md

# webPokerGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webPokerGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user; production URL: https://games.hailatat.icu/poker
  (basePath `/poker`; the hub proxies `/poker/*` to this project)
- Functions run in `fra1` (Frankfurt, `vercel.json`), next to the Supabase DB.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `poker`).
- Ask the user before pushing (= deploying), unless they explicitly say to deploy.
- **Before every push, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project, same as the other hub games)
Migrations are run by hand in the Supabase SQL editor - nothing records them in the DB,
so this list is the source of truth. **Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | no | `poker_rooms`, `poker_players` (with `role`: player / observer) |
| `supabase/migrations/001_pending_kick.sql` | yes (2026-11-07, verified) | `poker_players.kick_requested_at timestamptz` (host kick during a game = 10 s pending kick, "Ignoră"). Code needs it: do not push before it ran |
| `supabase/migrations/002_reconnect.sql` | yes (2026-11-07, verified: service role 200, anon 401) | `poker_players.last_seen_at`, `device_hash` + index (rejoin the same seat). Code needs it: do not push before it ran |
| `supabase/migrations/003_seat_queue.sql` | yes (2026-11-08, verified: `seat`, `queued_at` readable with the service key) | `poker_players.seat` (host reorder = seat order), `queued_at` (observer queue "Intră la runda următoare"). Code needs it |

Rules for schema changes:
- Every object of this game is prefixed `poker_` (tables, constraints, indexes). Table names live in `T`
  in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change
  folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (120 s)
- `GET /api/rooms` (the room list behind "Intră în cameră") first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`):
  every room in ANY status (also `playing`) whose `last_activity_at` is older than `ROOM_ABANDONED_MS` (120 s, `poker.ts`)
  and with no member (player or observer) `last_seen_at` within 120 s is deleted (members cascade). Open room pages keep
  both fresh (`/state` polls every 15 s), so only rooms nobody has open disappear. The 10/60-minute idle expiry stays too.

## Design
- Pure rules in `src/lib/poker.ts`: hand evaluation, No-Limit betting (min raise, short all-in does not reopen),
  side pots, uncalled-bet refund, blind levels (`hands` / `orbit` / `minutes`), eliminations and places.
- The whole tournament state (deck and hole cards included) is one jsonb column `poker_rooms.game`, written with an
  optimistic lock on `poker_rooms.version` (`saveRoom`, retried by `withRetry`). `/state` returns only the caller's
  own hole cards (`publicGame` in `src/lib/server/room.ts`); everyone's at showdown.
- Members: `poker_players.role` = `player` (max 16) or `observer` (max 16). Seats are fixed at start (host first,
  then join order). Joining mid-tournament = observer.
- Turn timer 10-60 s (room setting); on expiry the player folds. Per-player auto options live in the game state
  (`autoCheck`, `autoBlind`, set via `/auto`): 5 s into the turn, `autoAction` plays check/fold or calls the big blind.
- No cron: the turn timeout (`/timeout`) and the next hand (`/next`) are triggered lazily by clients (host first,
  seated players +3 s, observers +6 s); the server checks the deadlines and `turnKey` / `handNo` so duplicates are no-ops.
- Rejoin the same seat (`src/lib/reconnect.ts`): every member request stamps `last_seen_at` (≤ every 10 s);
  re-joining with an existing nickname reclaims that membership (same player id = same seat and chips, same role,
  new token, pending kick cleared) from the same device (`device_hash`) or once it has been unseen for 45 s, also
  mid-tournament. A disconnected seat keeps being folded by the turn timer as before. `/state` exposes only `connected`.
- Reorder (`/reorder`, host, lobby only) saves `seat`; `/start` uses it (never arranged = host first). Observers toggle `/queue`; `/new-round` promotes queued observers in queue order while < 16 players.
- Leaderboard: at tournament end `src/lib/server/leaderboard.ts` upserts the hub's `hub_leaderboard*` (game `poker`, idempotent per room+round, best effort).
- Realtime: Broadcast topic `poker:room:<uuid>` carries no data, clients re-fetch `/state`; 15 s polling fallback.

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, standard `ubuntu-latest` runners only, never billed
runners), never locally (user's rule, see `D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch` only (no automatic
trigger, the user's choice): nothing gates a push, and Vercel deploys `main` regardless.
Start one with `gh workflow run <file> --ref main`, then `gh run watch` (or the Actions tab, "Run workflow").
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit` (typegen first, so route types in `.next/types` are checked), `npx eslint src`, `npx next build`. Every step runs even if an earlier one failed |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/poker.test.ts` incl. random full tournaments with 2-16 players, `kick`, `reconnect`, `order`, `leaderboard` tests; pure logic, no DB) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (input, default production `https://games.hailatat.icu/poker`); one run at a time |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `npx playwright test` (`playwright.config.ts`, tests in `tests/ui/*.e2e.ts`) against `base_url` (`E2E_BASE_URL`, default production), on desktop Chromium and an emulated iPhone 13 (WebKit). Same concurrency group as "E2E". On failure the report (traces, screenshots, videos) is uploaded as the `playwright-report` artifact |

- E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (only for the cleanup safety net;
  locally the script falls back to `.env.local`). It checks that the deployed client JS contains the `package.json`
  version of the checked-out ref, so run it on `main` after the Vercel deploy of that version has finished.
- What E2E does: checks page / `_next` assets / version / manifest / icons / `room/XXXXXX` over HTTP and that
  `010web-poker-game.vercel.app/poker` serves the same build, then drives the real API (production DB) with 5 players and
  an observer: create (password), wrong / missing password, join, nickname taken (409), public room list, rejoin (same
  device, old token dead), settings validation, observer sits down / stands up, start, private hole cards (observer
  sees none, no deck in the state), wrong turn / observer / bad token / unknown kind / illegal check / raise below min,
  above stack or fractional, double click, host skip, a hand to showdown with chips conserved and pot shares, next hand,
  auto options, mid-game joiner = observer, leave mid-hand, kick with "Ignoră" then enforced, observer kick, play to the
  end (unique places, winner has every chip), new round. Rooms are named `e2e-test-…` and deleted at the end; it never
  writes feedback (only an empty one, rejected with 400).
- What E2E UI does (`tests/ui/`, shared steps in `helpers.ts`; every change must reach the other screens within 5 s
  without a reload, polling is 15 s, so this checks Realtime). Cards are random: the tests read whose turn it is from the
  screens (the action bar) and play all-in (or call / check), so heads-up the first hand that is not a split ends it.
  - `game.e2e.ts` (both projects): two browser contexts (= two devices): create with a password, join by link, start,
    own 2 cards, every turn shows "Tura ta" on the actor's screen and "Tura lui <name>" on the other, hand results,
    "Împarte acum", standings on both, "Turneu nou" followed live into the lobby, leave.
  - `spectator.e2e.ts` (desktop Chromium only): a third person joins mid-tournament = observer (no hand, no action bar),
    sees every turn live, queues ("Intră la runda următoare"), sees the standings, and "Turneu nou" seats them.
  - `mobile.e2e.ts` (iPhone only): no horizontal scroll on home / lobby / table, action buttons >= 24 px, a touch tap on
    Call plays it and the other phone gets the turn live.
  Rooms are `e2e-test-ui-…`; a leftover is deleted with the service key from the same repo secrets.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- The UI tests find elements by `data-testid`: `home-submit` (Home), `join-player`, `join-observer`, `leave`, `room-code`
  (RoomClient), `lobby-players`, `lobby-observers`, `role-toggle`, `start-game` (Lobby), `turn-label`, `pot`,
  `player-strip`, `my-hand`, `action-bar`, `act-fold`, `act-call`, `act-raise`, `preset-allin`, `hand-result`,
  `next-hand`, `standings`, `new-tournament`, `observer-panel`, `queue-toggle` (Game), and form fields by their labels
  ("Numele camerei", "Nickname-ul tău", "Parolă (opțional)", "Parolă (dacă are camera)"). Renaming or removing one
  breaks `tests/ui`.
