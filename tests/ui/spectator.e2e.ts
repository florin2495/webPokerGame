// Scenario 2: someone opens the invite link of a running tournament. They become an observer (no cards, no action
// buttons), they see every turn live, they queue for the next tournament, see the standings, and the host's
// "Turneu nou" seats them at the table. Desktop Chromium only: it checks game logic and Realtime, the device does
// not matter (scenario 1 already runs on WebKit).
import { expect, test } from "@playwright/test";
import { createRoom, joinRoom, leaveAll, playToEnd, REALTIME_MS, startTournament, withPlayers } from "./helpers";

test("a late joiner watches as an observer and plays the next tournament", async ({ browser }) => {
  test.skip(test.info().project.name !== "desktop-chromium", "game logic, one browser is enough");

  await withPlayers(browser, ["Ana", "Bob", "Cris"], async (players, room) => {
    const [host, guest, observer] = players;

    await test.step("two players start a tournament", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      await startTournament([host, guest]);
    });

    await test.step("a third person joins mid-tournament and becomes an observer", async () => {
      await joinRoom(observer, room.code);
      const op = observer.page;
      await expect(op.getByTestId("observer-panel")).toBeVisible();
      await expect(op.getByTestId("turn-label")).toBeVisible();
      for (const id of ["my-hand", "action-bar", "start-game"]) await expect(op.getByTestId(id)).toHaveCount(0);
    });

    await test.step("the observer queues for the next tournament", async () => {
      await observer.page.getByTestId("queue-toggle").click();
      await expect(observer.page.getByTestId("queue-toggle")).toHaveText("Ieși din coadă");
    });

    await test.step("the tournament is played; the observer sees every turn and the standings live", async () => {
      await playToEnd([host, guest], room.code, [observer]);
    });

    await test.step("new tournament: the queued observer is seated", async () => {
      await host.page.getByTestId("new-tournament").click();
      await expect(host.page.getByTestId("lobby-players")).toContainText("Cris");
      await expect(observer.page.getByTestId("lobby-players")).toContainText("Cris", { timeout: REALTIME_MS });
      await expect(observer.page.getByTestId("role-toggle")).toContainText("Mă ridic de la masă");
      await expect(host.page.getByTestId("start-game")).toContainText("3 jucători");
    });

    await test.step("everyone leaves, the room closes", async () => {
      await leaveAll([observer, guest, host]);
      room.closed = true;
    });
  });
});
