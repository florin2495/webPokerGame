import "server-only";
import { type GameState, RuleError } from "@/lib/poker";
import { reportTournament } from "./leaderboard";
import { notifyRoom } from "./broadcast";
import type { PlayerRow, RoomRow } from "./db";
import { fail, handle, readJson } from "./http";
import { buildState, requireMember, requireStatus, saveRoom, withRetry } from "./room";

export interface MoveContext {
  room: RoomRow;
  player: PlayerRow;
  /** Caller's seat in the tournament, -1 for observers. */
  seat: number;
  isHost: boolean;
  body: Record<string, unknown>;
  now: number;
}

/**
 * Shared body of every in-game write (action, timeout, next hand): authenticates the caller,
 * applies the pure rule `apply` to the stored state and saves it with the optimistic lock
 * (retrying on a concurrent write). A finished tournament flips the room to "finished".
 */
export function moveHandler(
  req: Request,
  code: string,
  kind: string,
  apply: (game: GameState, ctx: MoveContext) => GameState,
): Promise<Response> {
  return handle(async () => {
    const body = req.headers.get("content-type")?.includes("json") ? await readJson(req) : {};
    const roomId = await withRetry(
      () => requireMember(req, code),
      async ({ room, player }) => {
        requireStatus(room, "playing");
        const game = room.game;
        if (!game) fail(409, "Turneul nu a început încă.");
        const ctx: MoveContext = {
          room,
          player,
          seat: game.seats.indexOf(player.id),
          isHost: room.host_player_id === player.id,
          body,
          now: Date.now(),
        };
        let next: GameState;
        try {
          next = apply(game, ctx);
        } catch (err) {
          if (err instanceof RuleError) fail(409, err.message);
          throw err;
        }
        const status = next.phase === "over" ? ("finished" as const) : room.status;
        await saveRoom(room, { game: next, status });
        // What the room looks like right after this write, for the caller's own screen.
        const after: RoomRow = { ...room, game: next, status, version: room.version + 1 };
        return { roomId: room.id, code: room.code, name: room.name, round: room.round, over: next.phase === "over" ? next : null, after, player };
      },
    );
    if (roomId.over) await reportTournament({ code: roomId.code, name: roomId.name, round: roomId.round }, roomId.over);
    // The caller gets the new state back: no /state round trip after its own move.
    const [state] = await Promise.all([buildState(roomId.after, roomId.player), notifyRoom(roomId.roomId, kind)]);
    return { ok: true, state };
  });
}
