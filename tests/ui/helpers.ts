// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
// Poker is random (cards, who wins): the tests read whose turn it is from the screens instead of hard-coding moves.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 15 s. */
export const REALTIME_MS = 5_000;
export const PASSWORD = "pw";

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  const page = await context.newPage();
  // Every window.confirm (all-in, leave) is answered "OK".
  page.on("dialog", (d) => void d.accept());
  return { name, context, page };
}

/** Host creates a password-protected room from the home page (default rules); returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Parolă (opțional)").fill(PASSWORD);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("start-game")).toBeVisible();
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins "La masă" (lands in the lobby, or as an observer once the tournament runs). */
export async function joinRoom(p: Player, code: string): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByLabel("Parolă (dacă are camera)").fill(PASSWORD);
  await p.page.getByTestId("join-player").click();
  await expect(p.page.getByTestId("join-player")).toBeHidden();
  await expect(p.page.getByTestId("leave")).toBeVisible();
}

/** Host (players[0]) starts once every player is seated; every screen shows the table and a turn label. */
export async function startTournament(players: Player[], watchers: Player[] = []): Promise<void> {
  const host = players[0];
  for (const p of players.slice(1)) {
    await expect(host.page.getByTestId("lobby-players")).toContainText(p.name, { timeout: REALTIME_MS });
  }
  await expect(host.page.getByTestId("start-game")).toBeEnabled({ timeout: REALTIME_MS });
  await host.page.getByTestId("start-game").click();
  for (const p of [...players, ...watchers]) {
    await expect(p.page.getByTestId("turn-label")).toBeVisible({ timeout: REALTIME_MS });
  }
  for (const p of players) {
    await expect(p.page.getByTestId("my-hand").locator("span[aria-label]")).toHaveCount(2, { timeout: REALTIME_MS });
  }
}

/** The player whose screen shows the action buttons right now, or null. */
async function onTurn(players: Player[]): Promise<Player | null> {
  for (const p of players) if (await p.page.getByTestId("action-bar").isVisible()) return p;
  return null;
}

/** The actor's screen says "Tura ta"; every other screen says "Tura lui <actor>" (live, no reload). */
export async function expectTurn(actor: Player, others: Player[]): Promise<void> {
  await expect(actor.page.getByTestId("turn-label")).toHaveText("Tura ta");
  for (const o of others) {
    await expect(o.page.getByTestId("turn-label")).toHaveText(`Tura lui ${actor.name}`, { timeout: REALTIME_MS });
  }
}

/** Plays one move on the actor's screen: all-in if a raise is possible, else call / check. Waits for the server. */
export async function shove(actor: Player, code: string): Promise<void> {
  const page = actor.page;
  if (await page.getByTestId("preset-allin").isVisible()) await page.getByTestId("preset-allin").click();
  const button = (await page.getByTestId("act-raise").isVisible()) ? page.getByTestId("act-raise") : page.getByTestId("act-call");
  const [res] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith(`/api/rooms/${code}/action`) && r.request().method() === "POST"),
    button.click(),
  ]);
  expect(res.status(), `action of ${actor.name}`).toBe(200);
}

/**
 * Plays shove-or-call on every turn (heads-up equal stacks: the first hand that is not a split ends it) until the
 * tournament is over. Every turn and every hand result must reach all the other screens (players and `watchers`)
 * live. The host deals the next hand with "Împarte acum". Returns the winner's name.
 */
export async function playToEnd(players: Player[], code: string, watchers: Player[] = []): Promise<string> {
  const host = players[0];
  const everyone = [...players, ...watchers];
  for (let step = 0; step < 400; step++) {
    if (await host.page.getByTestId("standings").isVisible()) break;
    const actor = await onTurn(players);
    if (actor) {
      await expectTurn(
        actor,
        everyone.filter((p) => p !== actor),
      );
      await shove(actor, code);
      continue;
    }
    if (await host.page.getByTestId("next-hand").isVisible()) {
      for (const p of everyone) await expect(p.page.getByTestId("hand-result")).toBeVisible({ timeout: REALTIME_MS });
      // The host's device may deal by itself at the same moment: a 409 there is fine.
      await host.page.getByTestId("next-hand").click({ timeout: 2_000 }).catch(() => undefined);
      continue;
    }
    await host.page.waitForTimeout(250);
  }
  await expect(host.page.getByTestId("standings")).toBeVisible();
  const title = (await host.page.getByTestId("standings").locator("h2").textContent()) ?? "";
  const winner = title.match(/🏆 (.+) a câștigat turneul!/)?.[1];
  expect(winner, `standings title "${title}"`).toBeTruthy();
  for (const p of everyone) {
    await expect(p.page.getByTestId("standings")).toContainText(`${winner} a câștigat turneul!`, { timeout: REALTIME_MS });
  }
  return winner!;
}

/** Leaves through the "Părăsește" button (the confirm is accepted), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/poker_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
