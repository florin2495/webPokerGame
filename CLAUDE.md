@AGENTS.md

# webPokerGame - project notes for Claude

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webPokerGame`, private). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project is connected by hand by the user; production domain: https://poker.hailatat.icu
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

Rules for schema changes:
- Every object of this game is prefixed `poker_` (tables, constraints, indexes). Table names live in `T`
  in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change
  folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

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
- Realtime: Broadcast topic `poker:room:<uuid>` carries no data, clients re-fetch `/state`; 15 s polling fallback.

## Testing
- `npm test` (Vitest, `src/lib/poker.test.ts` incl. random full tournaments with 2-16 players), `npx tsc --noEmit`,
  `npx eslint src`, `npx next build`.
- End-to-end: drive the real API with 3+ players and an observer (create, join, role, settings, start, action through
  a whole hand incl. all-in and side pot, timeout, next, leave mid-hand, kick, new-round) against `npm run dev`.
  Delete the test rooms afterwards.
