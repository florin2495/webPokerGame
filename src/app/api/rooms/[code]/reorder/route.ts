import { isPermutation } from "@/lib/order";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listSeatedPlayers, requireHost, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/reorder  { order: [playerId, ...] } - host only, in the lobby (never mid-tournament).
// `order` must be a complete permutation of the players; it becomes the seat order of the next tournament.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/reorder">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    const players = await listSeatedPlayers(room.id);
    const { order } = body;
    if (!isPermutation(order, players.map((p) => p.id))) fail(400, "Ordinea trebuie să conțină toți jucătorii, o singură dată.");

    const results = await Promise.all(order.map((id, seat) => db().from(T.players).update({ seat }).eq("id", id).eq("room_id", room.id)));
    for (const r of results) if (r.error) throw r.error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "order_changed");
    return { ok: true };
  });
}
