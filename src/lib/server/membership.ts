import "server-only";
import { removeSeat } from "@/lib/poker";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { getRoomByCode, listPlayers, saveRoom, withRetry } from "./room";

/**
 * Removes a member from a room (used by both "leave" and the host's "kick").
 *  - last member out: the room is deleted
 *  - host removed: host passes to the next member in join order (players before observers)
 *  - a player still in a running tournament is out for good: folds if in a hand, chips forfeited.
 *    If only one player is left with chips, they win.
 */
export async function removePlayer(room: RoomRow, playerId: string, reason: string): Promise<{ roomClosed: boolean }> {
  let reads = 0;
  const result = await withRetry(
    // First attempt uses the room the caller already read; retries read it again.
    async () => (reads++ === 0 ? room : getRoomByCode(room.code)),
    async (fresh) => {
      const players = await listPlayers(fresh.id);
      const remaining = players.filter((p) => p.id !== playerId);

      if (remaining.length === 0) {
        const { error } = await db().from(T.rooms).delete().eq("id", fresh.id);
        if (error) throw error;
        return { roomClosed: true, newHostId: null as string | null, changedHost: false };
      }

      const nextHost = remaining.find((p) => p.role === "player") ?? remaining[0];
      const newHostId = fresh.host_player_id === playerId ? nextHost.id : fresh.host_player_id;
      const update: Partial<RoomRow> = { host_player_id: newHostId };
      const seat = fresh.game ? fresh.game.seats.indexOf(playerId) : -1;
      if (fresh.status === "playing" && fresh.game && seat >= 0) {
        const game = removeSeat(fresh.game, seat, Date.now());
        update.game = game;
        if (game.phase === "over") update.status = "finished";
      }
      // Update the room first so the host never points at a deleted player.
      await saveRoom(fresh, update);
      return { roomClosed: false, newHostId, changedHost: newHostId !== fresh.host_player_id };
    },
  );
  if (result.roomClosed) return { roomClosed: true };

  if (result.changedHost && result.newHostId) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", result.newHostId);
    if (error) throw error;
  }
  const { error: deleteError } = await db().from(T.players).delete().eq("id", playerId);
  if (deleteError) throw deleteError;

  await notifyRoom(room.id, reason);
  return { roomClosed: false };
}
