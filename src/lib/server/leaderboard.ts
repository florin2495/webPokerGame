import "server-only";
import type { GameState } from "@/lib/poker";
import { leaderboardEntries } from "@/lib/leaderboard";
import { db, isMissingTable } from "./db";

const GAME = "poker";

/**
 * Reports a finished tournament to the hub's shared leaderboard (hub_leaderboard*, owned by the hub).
 * Idempotent: the (game, room, round) row in hub_leaderboard_rounds is claimed first, so a tournament is counted once
 * however many requests see it end. Best effort - never throws, a failure must not break the game.
 */
export async function reportTournament(roomCode: string, round: number, game: GameState): Promise<void> {
  try {
    const claim = await db().from("hub_leaderboard_rounds").insert({ game: GAME, room_code: roomCode, round_no: round });
    if (claim.error) {
      if (claim.error.code !== "23505" && !isMissingTable(claim.error)) console.error("leaderboard claim failed", claim.error);
      return; // already counted, or the hub migration has not run yet
    }
    for (const e of leaderboardEntries(game.names, game.winner)) {
      const { data, error } = await db()
        .from("hub_leaderboard")
        .select("wins, games")
        .eq("game", GAME)
        .eq("player_key", e.playerKey)
        .maybeSingle();
      if (error) throw error;
      const { error: upsertError } = await db()
        .from("hub_leaderboard")
        .upsert(
          {
            game: GAME,
            player_key: e.playerKey,
            display_name: e.displayName.slice(0, 40),
            wins: (data?.wins ?? 0) + (e.win ? 1 : 0),
            games: (data?.games ?? 0) + 1,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "game,player_key" },
        );
      if (upsertError) throw upsertError;
    }
  } catch (err) {
    console.error("leaderboard report failed", err);
  }
}
