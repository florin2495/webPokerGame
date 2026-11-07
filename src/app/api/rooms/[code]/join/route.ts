import { MAX_OBSERVERS, MAX_PLAYERS, NICKNAME_MAX } from "@/lib/poker";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, listPlayers, touchRoom } from "@/lib/server/room";

// POST /api/rooms/[code]/join  { nickname, password?, role? }
// Before the tournament you choose to play or watch. Once it runs, you can only watch.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const room = await getRoomByCode(code);

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const members = await listPlayers(room.id);
    const players = members.filter((m) => m.role === "player").length;
    const observers = members.length - players;
    let role: "player" | "observer" = body.role === "observer" || room.status === "playing" ? "observer" : "player";
    if (role === "player" && players >= MAX_PLAYERS) role = "observer";
    if (role === "observer" && observers >= MAX_OBSERVERS) {
      if (room.status === "playing") fail(409, `Turneul a început și sunt deja ${MAX_OBSERVERS} observatori.`);
      if (players >= MAX_PLAYERS) fail(409, `Camera e plină (${MAX_PLAYERS} jucători și ${MAX_OBSERVERS} observatori).`);
      role = "player";
    }

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(T.players)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), role })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul e deja folosit în cameră.");
    if (error) throw error;

    await touchRoom(room.id);
    await notifyRoom(room.id, "player_joined");
    return { code: room.code, playerId: data.id, token, role };
  });
}
