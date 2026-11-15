import { expect, it } from "vitest";
import { isTestRoom, leaderboardEntries, playerKey } from "./leaderboard";

it("playerKey lower-cases and trims", () => expect(playerKey("  Ana ")).toBe("ana"));
it("everyone gets a game, only the winner a win", () => {
  expect(leaderboardEntries(["Ana", "Bob", "Cip"], 1)).toEqual([
    { playerKey: "ana", displayName: "Ana", win: false },
    { playerKey: "bob", displayName: "Bob", win: true },
    { playerKey: "cip", displayName: "Cip", win: false },
  ]);
  expect(leaderboardEntries(["Ana", "Bob"], null).every((e) => !e.win)).toBe(true);
});
it("isTestRoom matches only e2e-test- room names", () => {
  expect(isTestRoom("e2e-test-123")).toBe(true);
  expect(isTestRoom("e2e-test-ui-abc")).toBe(true);
  expect(isTestRoom("Masa lui Ana")).toBe(false);
  expect(isTestRoom("my e2e-test-room")).toBe(false);
  expect(isTestRoom("E2E-TEST-1")).toBe(false);
});
