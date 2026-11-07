import { setAuto } from "@/lib/poker";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

// POST /api/rooms/[code]/auto  { autoCheck?, autoBlind? } - a seated player turns their own auto options on/off.
//  - autoCheck: 5 s into my turn, check if free, otherwise fold
//  - autoBlind: 5 s into my turn, pre-flop with no raise yet, pay the big blind
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/auto">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "auto_changed", (game, { seat, body }) => {
    if (seat < 0) fail(403, "Ești observator: nu joci în acest turneu.");
    const flag = (v: unknown) => {
      if (v === undefined) return undefined;
      if (typeof v !== "boolean") fail(400, "Valoare invalidă.");
      return v;
    };
    return setAuto(game, seat, { autoCheck: flag(body.autoCheck), autoBlind: flag(body.autoBlind) });
  });
}
