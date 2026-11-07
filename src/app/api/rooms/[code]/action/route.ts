import { act, type ActionKind } from "@/lib/poker";
import { fail } from "@/lib/server/http";
import { moveHandler } from "@/lib/server/move";

const KINDS: ActionKind[] = ["fold", "check", "call", "raise", "allin"];

// POST /api/rooms/[code]/action  { kind: fold|check|call|raise|allin, amount? } - amount = "raise to" total.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/action">) {
  const { code } = await ctx.params;
  return moveHandler(req, code, "action", (game, { seat, body, now }) => {
    if (seat < 0) fail(403, "Ești observator: nu joci în acest turneu.");
    const kind = body.kind as ActionKind;
    if (!KINDS.includes(kind)) fail(400, "Acțiune invalidă.");
    const amount = body.amount === undefined ? undefined : Number(body.amount);
    return act(game, seat, kind, amount, now);
  });
}
