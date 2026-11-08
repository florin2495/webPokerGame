import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle } from "@/lib/server/http";
import { requireMember, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/queue - an observer toggles "Intră la runda următoare". At the next new-round the queued
// observers become players, in queue order, while seats are free. In the lobby you can sit down directly (/role).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/queue">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    if (player.role !== "observer") fail(409, "Doar observatorii se pot pune la coadă.");
    const queued = player.queued_at === null;
    const { error } = await db()
      .from(T.players)
      .update({ queued_at: queued ? new Date().toISOString() : null })
      .eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "queue_changed");
    return { ok: true, queued };
  });
}
