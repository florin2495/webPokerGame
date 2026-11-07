import { autoDeadline, forceAction, type ForceReason, TIMEOUT_GRACE_MS, turnDeadline, turnKey } from "@/lib/poker";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/timeout  { turn } - plays the current turn for a player who did not act:
//  - their own auto-check / auto-blind option, 5 s into the turn (anyone's device may trigger it);
//  - the turn timer ran out: fold (anyone's device may trigger it);
//  - otherwise only the host, to skip a stalled player: check if free, otherwise fold.
// `turn` (see turnKey) makes a late or repeated request a no-op instead of skipping the next player.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/timeout">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "timeout", (game, { isHost, body, now }) => {
    if (body.turn !== turnKey(game)) fail(409, "Tura s-a schimbat deja.");
    const auto = autoDeadline(game);
    const deadline = turnDeadline(game);
    let reason: ForceReason;
    if (auto !== null && now >= auto) reason = "auto";
    else if (deadline !== null && now >= deadline + TIMEOUT_GRACE_MS) reason = "timeout";
    else if (isHost) reason = "host";
    else fail(403, "Doar host-ul poate sări tura înainte de expirarea timpului.");
    return forceAction(game, now, reason);
  });
}
