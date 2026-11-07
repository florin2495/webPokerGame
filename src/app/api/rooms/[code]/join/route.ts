import { enforceExpiredKicks } from "@/lib/server/membership";
import { MAX_OBSERVERS, MAX_PLAYERS, NICKNAME_MAX } from "@/lib/poker";
import { seatBusyMessage, seatClaim } from "@/lib/reconnect";
import { notifyRoom } from "@/lib/server/broadcast";
import { hashDeviceId, hashToken, newPlayerToken, verifyPassword } from "@/lib/server/crypto";
import { db, type Role, T } from "@/lib/server/db";
import { cleanText, fail, handle, isUniqueViolation, readJson } from "@/lib/server/http";
import { getRoomByCode, touchRoom } from "@/lib/server/room";

interface MemberRow {
  id: string;
  nickname: string;
  role: Role;
  token_hash: string;
  device_hash: string | null;
  last_seen_at: string;
}

// POST /api/rooms/[code]/join  { nickname, password?, role?, deviceId? }
// Before the tournament you choose to play or watch. Once it runs, you can only watch.
// A nickname that is already a member of the room reclaims that membership (same player id, so the same seat
// and chips, new token) when the request comes from the same device or the member has been disconnected for
// 45 s - also mid-tournament. The member keeps their role; `role` is ignored then.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/join">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const body = await readJson(req);
    const nickname = cleanText(body.nickname, "Nickname-ul", 1, NICKNAME_MAX);
    const deviceHash = hashDeviceId(body.deviceId);
    // Enforce host kicks whose 10 s are over first, so a reclaim cannot undo an expired kick.
    const room = await enforceExpiredKicks(await getRoomByCode(code));

    if (room.password_hash) {
      const password = typeof body.password === "string" ? body.password : "";
      if (!(await verifyPassword(password, room.password_hash))) fail(403, "Parolă greșită.");
    }

    const { data: rows, error: rowsError } = await db()
      .from(T.players)
      .select("id, nickname, role, token_hash, device_hash, last_seen_at")
      .eq("room_id", room.id);
    if (rowsError) throw rowsError;
    const members = (rows ?? []) as MemberRow[];

    const existing = members.find((m) => m.nickname.toLowerCase() === nickname.toLowerCase());
    if (existing) {
      if (seatClaim(existing, deviceHash, Date.now()) === "busy") fail(409, seatBusyMessage(existing.nickname));
      const token = newPlayerToken();
      // Conditional on the old token: two reclaims at once -> only one wins, the other gets a 409.
      const { data, error } = await db()
        .from(T.players)
        .update({
          token_hash: hashToken(token),
          device_hash: deviceHash ?? existing.device_hash,
          kick_requested_at: null,
          last_seen_at: new Date().toISOString(),
        })
        .eq("id", existing.id)
        .eq("token_hash", existing.token_hash)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) fail(409, "Locul tocmai a fost reluat de altcineva. Mai încearcă o dată.");
      await touchRoom(room.id);
      await notifyRoom(room.id, "player_rejoined");
      return { code: room.code, playerId: existing.id, token, role: existing.role };
    }

    const players = members.filter((m) => m.role === "player").length;
    const observers = members.length - players;
    let role: Role = body.role === "observer" || room.status === "playing" ? "observer" : "player";
    if (role === "player" && players >= MAX_PLAYERS) role = "observer";
    if (role === "observer" && observers >= MAX_OBSERVERS) {
      if (room.status === "playing") fail(409, `Turneul a început și sunt deja ${MAX_OBSERVERS} observatori.`);
      if (players >= MAX_PLAYERS) fail(409, `Camera e plină (${MAX_PLAYERS} jucători și ${MAX_OBSERVERS} observatori).`);
      role = "player";
    }

    const token = newPlayerToken();
    const { data, error } = await db()
      .from(T.players)
      .insert({ room_id: room.id, nickname, token_hash: hashToken(token), device_hash: deviceHash, role })
      .select("id")
      .single();
    if (isUniqueViolation(error)) fail(409, "Nickname-ul e deja folosit în cameră.");
    if (error) throw error;

    await touchRoom(room.id);
    await notifyRoom(room.id, "player_joined");
    return { code: room.code, playerId: data.id, token, role };
  });
}
