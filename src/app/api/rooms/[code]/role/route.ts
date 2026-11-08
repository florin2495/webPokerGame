import { MAX_OBSERVERS, MAX_PLAYERS } from "@/lib/poker";
import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { listPlayers, requireMember, requireStatus, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/role  { role: "player" | "observer" } - sit down or stand up, between tournaments.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/role">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireStatus(room, "lobby", "finished");
    const body = await readJson(req);
    const role = body.role;
    if (role !== "player" && role !== "observer") fail(400, "Rol invalid.");
    if (role === player.role) return { ok: true };

    const members = await listPlayers(room.id);
    const count = members.filter((m) => m.role === role).length;
    if (role === "player" && count >= MAX_PLAYERS) fail(409, `Masa e plină (${MAX_PLAYERS} jucători).`);
    if (role === "observer" && count >= MAX_OBSERVERS) fail(409, `Sunt deja ${MAX_OBSERVERS} observatori.`);

    const { error } = await db().from(T.players).update({ role, seat: null, queued_at: null }).eq("id", player.id);
    if (error) throw error;
    await touchRoom(room.id);
    await notifyRoom(room.id, "role_changed");
    return { ok: true };
  });
}
