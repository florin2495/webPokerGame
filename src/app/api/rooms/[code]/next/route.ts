import { NEXT_HAND_DELAY_MS, nextHand } from "@/lib/poker";
import { secureRandom } from "@/lib/server/crypto";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/next  { handNo } - deals the next hand. The host any time after a hand ends,
// anyone else once the result was on screen for NEXT_HAND_DELAY_MS.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/next">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "next_hand", (game, { isHost, body, now }) => {
    if (Number(body.handNo) !== game.handNo) fail(409, "Mâna următoare a fost deja împărțită.");
    if (!isHost && now < game.handEndedAt + NEXT_HAND_DELAY_MS) fail(409, "Mai așteaptă câteva secunde.");
    return nextHand(game, now, secureRandom);
  });
}
