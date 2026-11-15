// Scenario 1: two real browsers play a live tournament on the deployed site: create (password), join by link, start,
// "Tura ta" / "Tura lui <name>" on both screens for every turn, all-in / call until someone has every chip, the
// standings on both screens, a new tournament followed live, leave. Every change must reach the other screen through
// Realtime (well under the 60 s polling fallback). Runs on every project.
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playToEnd, REALTIME_MS, startTournament, withPlayers } from "./helpers";

test("two players play a live tournament to the end", async ({ browser }) => {
  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;

    await test.step("host creates a room with a password, the guest joins by link", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await expect(guest.page.getByTestId("lobby-players")).toContainText("Ana");
      await expect(host.page.getByTestId("lobby-players")).toContainText("Bob", { timeout: REALTIME_MS });
    });

    await test.step("host starts: both see the table, own 2 cards and whose turn it is", () => startTournament(players));

    await test.step("play all-in / call until the tournament ends, every turn live", async () => {
      const winner = await playToEnd(players, room.code);
      expect(["Ana", "Bob"]).toContain(winner);
    });

    await test.step("host starts a new tournament, the guest follows live into the lobby", async () => {
      await host.page.getByTestId("new-tournament").click();
      await expect(host.page.getByTestId("start-game")).toBeVisible();
      await expect(guest.page.getByTestId("lobby-players")).toContainText("Ana", { timeout: REALTIME_MS });
      await expect(guest.page.getByTestId("standings")).toHaveCount(0);
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
