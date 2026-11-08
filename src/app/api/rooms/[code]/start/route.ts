import { MAX_PLAYERS, MIN_PLAYERS, newGame, seatOrder } from "@/lib/poker";
import { notifyRoom } from "@/lib/server/broadcast";
import { clearKicks } from "@/lib/server/membership";
import { secureRandom } from "@/lib/server/crypto";
import { fail, handle } from "@/lib/server/http";
import { listSeatedPlayers, requireHost, requireMember, requireStatus, saveRoom, withDefaults } from "@/lib/server/room";

// POST /api/rooms/[code]/start - host only, 2-16 players. Seats the players (host first) and deals hand 1.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/start">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");

    const players = await listSeatedPlayers(room.id);
    if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
      fail(409, `Ai nevoie de ${MIN_PLAYERS}-${MAX_PLAYERS} jucători la masă. Acum sunt ${players.length}.`);
    }
    // The host's arrangement (reorder) is the seat order; never arranged = host first, then join order.
    const ids = players.map((p) => p.id);
    const seats = players.some((p) => p.seat !== null) ? ids : seatOrder(ids, room.host_player_id);
    const names = seats.map((id) => players.find((p) => p.id === id)!.nickname);
    const game = newGame(seats, names, withDefaults(room.settings), Date.now(), secureRandom);
    await saveRoom(room, { status: "playing", game });
    await clearKicks(room.id);

    await notifyRoom(room.id, "game_started");
    return { ok: true };
  });
}
