import { forceAction, TIMEOUT_GRACE_MS, turnDeadline, turnKey } from "@/lib/poker";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/timeout  { turn } - forces the stalled player: check if free, otherwise fold.
// The host may do it any time ("Sari tura"); anyone else only once the turn timer ran out.
// `turn` (see turnKey) makes a late or repeated request a no-op instead of skipping the next player.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/timeout">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "timeout", (game, { isHost, body, now }) => {
    if (body.turn !== turnKey(game)) fail(409, "Tura s-a schimbat deja.");
    const deadline = turnDeadline(game);
    const expired = deadline !== null && now >= deadline + TIMEOUT_GRACE_MS;
    if (!isHost && !expired) fail(403, "Doar host-ul poate sări tura înainte de expirarea timpului.");
    return forceAction(game, now);
  });
}
