// Scenario 3 (phone only): no screen may scroll sideways (home, lobby, table), the action buttons must be big enough
// to tap (WCAG 2.2 minimum target 24 x 24 CSS px), and a real touch tap must play a move that the other phone sees
// live. Scenario 1 already plays a full tournament on the emulated iPhone; this one checks the layout.
import { expect, test } from "@playwright/test";
import {
  createRoom,
  expectNoHorizontalScroll,
  expectTurn,
  joinRoom,
  leaveAll,
  startTournament,
  withPlayers,
  type Player,
} from "./helpers";

const MIN_TAP_PX = 24;

test("lobby and table fit a phone screen and are tappable", async ({ browser }) => {
  test.skip(!test.info().project.use.isMobile, "phone layout only");

  await withPlayers(browser, ["Ana", "Bob"], async (players, room) => {
    const [host, guest] = players;
    const onTurn = async (): Promise<Player | null> =>
      (await host.page.getByTestId("action-bar").isVisible())
        ? host
        : (await guest.page.getByTestId("action-bar").isVisible())
          ? guest
          : null;

    await test.step("home page fits the screen", async () => {
      await host.page.goto("./");
      await expect(host.page.getByTestId("home-submit")).toBeVisible();
      await expectNoHorizontalScroll(host.page);
    });

    await test.step("lobby fits the screen", async () => {
      room.code = await createRoom(host);
      await joinRoom(guest, room.code);
      for (const p of players) await expectNoHorizontalScroll(p.page);
    });

    let actor: Player = host;
    await test.step("table fits, the action buttons are big enough to tap", async () => {
      await startTournament(players);
      for (const p of players) await expectNoHorizontalScroll(p.page);
      await expect.poll(async () => (await onTurn()) !== null).toBe(true);
      actor = (await onTurn())!;
      const sizes = await actor.page
        .getByTestId("action-bar")
        .getByRole("button")
        .evaluateAll((els) => els.map((e) => Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height)));
      expect(sizes.length).toBeGreaterThanOrEqual(2);
      expect(Math.min(...sizes), `smallest action button on ${actor.name}'s screen`).toBeGreaterThanOrEqual(MIN_TAP_PX);
    });

    await test.step("a tap on Call plays it, the other phone gets the turn live", async () => {
      const other = actor === host ? guest : host;
      await expectTurn(actor, [other]);
      const [res] = await Promise.all([
        actor.page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${room.code}/action`) && r.request().method() === "POST"),
        actor.page.getByTestId("act-call").tap(), // a touch tap, not a mouse click
      ]);
      expect(res.status()).toBe(200);
      // Heads-up pre-flop: the small blind calls, the big blind has the option.
      await expectTurn(other, [actor]);
      await expectNoHorizontalScroll(other.page);
    });

    await test.step("both leave, the room closes", async () => {
      await leaveAll([guest, host]);
      room.closed = true;
    });
  });
});
