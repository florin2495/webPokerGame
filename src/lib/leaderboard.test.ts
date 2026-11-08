import { expect, it } from "vitest";
import { leaderboardEntries, playerKey } from "./leaderboard";

it("playerKey lower-cases and trims", () => expect(playerKey("  Ana ")).toBe("ana"));
it("everyone gets a game, only the winner a win", () => {
  expect(leaderboardEntries(["Ana", "Bob", "Cip"], 1)).toEqual([
    { playerKey: "ana", displayName: "Ana", win: false },
    { playerKey: "bob", displayName: "Bob", win: true },
    { playerKey: "cip", displayName: "Cip", win: false },
  ]);
  expect(leaderboardEntries(["Ana", "Bob"], null).every((e) => !e.win)).toBe(true);
});
