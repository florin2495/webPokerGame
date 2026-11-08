import { MAX_PLAYERS } from "@/lib/poker";
import { bySeat, promotable } from "@/lib/order";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { handle } from "@/lib/server/http";
import { clearKicks } from "@/lib/server/membership";
import { listPlayers, requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/new-round - host only, after a tournament: back to the lobby for a new one.
// Observers who queued ("Intră la runda următoare") become players, in queue order, while seats are free.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/new-round">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "finished");
    await saveRoom(room, { status: "lobby", game: null, round: room.round + 1 });
    await clearKicks(room.id);

    const members = await listPlayers(room.id);
    const seated = bySeat(members.filter((m) => m.role === "player"));
    const joining = promotable(members, MAX_PLAYERS - seated.length);
    // Keep the host's arrangement, queued observers go after it in queue order.
    const order = [...seated, ...joining].map((m) => m.id);
    const results = await Promise.all([
      ...joining.map((m) => db().from(T.players).update({ role: "player" }).eq("id", m.id)),
      ...order.map((id, seat) => db().from(T.players).update({ seat, queued_at: null }).eq("id", id)),
    ]);
    for (const r of results) if (r.error) throw r.error;
    await notifyRoom(room.id, "new_round");
    return { ok: true };
  });
}
