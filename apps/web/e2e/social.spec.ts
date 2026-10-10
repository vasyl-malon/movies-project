import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, sql, state } from "./fixtures";

type Account = { email: string; username: string; password: string };
const createdUserIds: string[] = [];
function newAccount(): Account {
  const id = randomUUID().replaceAll("-", "");
  return {
    email: `${id}@example.test`,
    username: `social_${id.slice(0, 16)}`,
    password: "Cinema-password-1234",
  };
}
async function login(
  page: Page,
  account: Account,
  mailLink: (email: string, subject: string) => Promise<string>,
  name: string,
) {
  const response = await page.request.post("/api/auth/sign-up/email", {
    headers: { Origin: state.frontendOrigin },
    data: {
      ...account,
      name,
      callbackURL: `${state.frontendOrigin}/verify-email?verified=1`,
    },
  });
  expect(response.status()).toBe(200);
  await page.goto(await mailLink(account.email, "Verify"));
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/settings/);
  const id = (await (await page.request.get("/api/me")).json()).id as string;
  expect(id).toMatch(/^[0-9a-f-]{36}$/);
  createdUserIds.push(id);
  return id;
}
async function find(page: Page, username: string) {
  await page.goto("/friends");
  await page.getByLabel("Exact username").fill(username);
  await page.getByRole("button", { name: "Find profile" }).click();
  await page.getByRole("link", { name: /View profile/ }).click();
  await expect(page).toHaveURL(
    new RegExp(`/profiles/${username.toLowerCase()}$`),
  );
}
async function connect(a: Page, b: Page, usernameA: string, usernameB: string) {
  await find(a, usernameB);
  await a.getByRole("button", { name: "Send friend request" }).click();
  await expect(a.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await find(b, usernameA);
  await b.getByRole("button", { name: "Accept request" }).click();
  await expect(b.getByRole("button", { name: "Remove friend" })).toBeVisible();
}
async function save(page: Page, title: string, review: string) {
  const media = await (
    await page.request.get(`/api/media/imdb/${title}`)
  ).json();
  const response = await page.request.post("/api/entries", {
    headers: { Origin: state.frontendOrigin },
    data: {
      target: { mediaId: media.id },
      status: "WATCHED",
      rating: 9,
      review,
      localToday: "2024-02-29",
      completedOn: "2024-02-29",
    },
  });
  expect(response.status()).toBe(201);
  return response.json();
}
async function posterFixtures(page: Page) {
  await page.route("https://posters.example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#354636"/><circle cx="200" cy="220" r="90" fill="#b4c682"/></svg>',
    }),
  );
}
test.beforeEach(async ({ page }) => {
  sql('DELETE FROM "RateLimit"');
  await posterFixtures(page);
});
test.afterEach(() => {
  const owned = createdUserIds.splice(0);
  if (owned.length) {
    sql(
      `DELETE FROM "User" WHERE id IN (${owned.map((id) => `'${id}'`).join(",")})`,
    );
  }
});

test("multi-user discovery, private profiles, acceptance, feed and revocation", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}, info) => {
  const contextB = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await contextB.newPage();
  await posterFixtures(b);
  const accountB = newAccount();
  const errors: string[] = [];
  let revoked = false;
  let privatePaths: string[] = [];
  for (const page of [a, b]) {
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (message.type() !== "error") return;
      const location = message.location().url;
      if (
        revoked &&
        message.text().includes("status of 403") &&
        privatePaths.some((path) =>
          location.startsWith(`${state.frontendOrigin}${path}`),
        )
      )
        return;
      errors.push(`${message.text()} (${location})`);
    });
  }
  const idA = await login(a, accountA, mailLink, "Ada Frames");
  const idB = await login(b, accountB, mailLink, "Bela Cinema");
  privatePaths = [`/api/users/${idA}/entries`, `/api/users/${idB}/entries`];
  await save(a, "tt9000001", "Ada private review");
  const entryB = await save(b, "tt9000001", "<b>Bela private review</b>");
  await find(a, accountB.username.toUpperCase());
  await expect(a.getByRole("heading", { name: "Bela Cinema" })).toBeVisible();
  await a.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await a.getByRole("button", { name: "Copy profile link" }).click();
  await expect(a.getByText("Profile link copied.")).toBeVisible();
  expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(
    `${state.frontendOrigin}/profiles/${accountB.username}`,
  );
  await expect(
    a.getByText("<b>Bela private review</b>", { exact: true }),
  ).toHaveCount(0);
  expect((await a.request.get(`/api/users/${idB}/entries`)).status()).toBe(403);
  await a.getByRole("button", { name: "Send friend request" }).click();
  await expect(a.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await b.goto("/friends");
  await expect(
    b.getByRole("heading", { name: "Pending requests" }),
  ).toBeVisible();
  await b.getByRole("button", { name: "Accept request" }).click();
  await expect(
    b.getByRole("link", { name: /Ada Frames/ }).first(),
  ).toBeVisible();
  await a.goto(`/profiles/${accountB.username}`);
  await expect(
    a.getByText("<b>Bela private review</b>", { exact: true }),
  ).toBeVisible();
  await expect(a.getByRole("button", { name: "Save entry" })).toHaveCount(0);
  await a.getByLabel("Minimum rating").fill("9");
  await a.getByLabel("Genre", { exact: true }).fill("Drama");
  await a.getByLabel("Completed from").fill("2024-02-29");
  await a.getByLabel("Completed to").fill("2024-02-29");
  await a.getByRole("button", { name: "Apply filters" }).click();
  await expect(
    a.getByText("<b>Bela private review</b>", { exact: true }),
  ).toBeVisible();
  await a.getByLabel("Minimum rating").fill("10");
  await a.getByRole("button", { name: "Apply filters" }).click();
  await expect(a.getByText("No entries match your filters.")).toBeVisible();
  await a.getByRole("button", { name: "Reset filters" }).click();
  await expect(
    a.getByText("<b>Bela private review</b>", { exact: true }),
  ).toBeVisible();
  await a.screenshot({
    path: info.outputPath("profile-desktop-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await a.getByRole("button", { name: "Use light theme" }).click();
  await a.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      a
        .getByLabel("Genre", { exact: true })
        .evaluate((input) => getComputedStyle(input).backgroundColor),
    )
    .toBe("rgb(255, 254, 250)");
  await a.screenshot({
    path: info.outputPath("profile-mobile-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await a.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await a.setViewportSize({ width: 1440, height: 1000 });
  await a.goto("/feed");
  await expect(
    a.getByText("<b>Bela private review</b>", { exact: true }).first(),
  ).toBeVisible();
  await expect(a.getByText("Ada private review", { exact: true })).toHaveCount(
    0,
  );
  expect(
    (
      await b.request.patch(`/api/entries/${entryB.id}`, {
        headers: { Origin: state.frontendOrigin },
        data: { review: "Current Bela review" },
      })
    ).status(),
  ).toBe(200);
  await a.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(
    a.getByText("Current Bela review", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    a.getByText("<b>Bela private review</b>", { exact: true }),
  ).toHaveCount(0);
  await a.screenshot({
    path: info.outputPath("feed-desktop-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  await a.getByRole("button", { name: "Use dark theme" }).click();
  await a.setViewportSize({ width: 390, height: 844 });
  await a.screenshot({
    path: info.outputPath("feed-mobile-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await b.goto(`/profiles/${accountA.username}`);
  await expect(
    b.getByText("Ada private review", { exact: true }),
  ).toBeVisible();
  await a.goto(`/profiles/${accountB.username}`);
  expect(errors).toEqual([]);
  revoked = true;
  await a.getByRole("button", { name: "Remove friend" }).click();
  await expect(
    a.getByRole("button", { name: "Send friend request" }),
  ).toBeVisible();
  await expect(a.getByText("Current Bela review", { exact: true })).toHaveCount(
    0,
  );
  expect((await b.request.get(`/api/users/${idA}/entries`)).status()).toBe(403);
  await b.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(b.getByText("Ada private review", { exact: true })).toHaveCount(
    0,
  );
  await a.goto("/feed");
  await expect(a.getByText("Current Bela review", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    a.getByText("Your friends’ next chapter starts here."),
  ).toBeVisible();
  expect(errors).toEqual([]);
  await contextB.close();
});

test("cancel, decline, pending locks and lost-response reconciliation preserve discovery input", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}) => {
  const context = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await context.newPage();
  await posterFixtures(b);
  const accountB = newAccount();
  await login(a, accountA, mailLink, "Ada Frames");
  await login(b, accountB, mailLink, "Bela Cinema");
  await find(a, accountB.username);
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let writes = 0;
  await a.route("**/api/friend-requests", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    writes++;
    const response = await route.fetch();
    ready();
    await held;
    await route.fulfill({ response });
  });
  await a.getByRole("button", { name: "Send friend request" }).click();
  await started;
  await expect(
    a.getByRole("button", { name: "Send friend request" }),
  ).toBeDisabled();
  await a
    .getByRole("button", { name: "Send friend request" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  expect(writes).toBe(1);
  release();
  await expect(a.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await a.unroute("**/api/friend-requests");
  await a.getByRole("button", { name: "Cancel request" }).click();
  await expect(
    a.getByRole("button", { name: "Send friend request" }),
  ).toBeVisible();
  await a.getByRole("button", { name: "Send friend request" }).click();
  await expect(a.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await find(b, accountA.username);
  await b.getByRole("button", { name: "Decline request" }).click();
  await expect(
    b.getByRole("button", { name: "Send friend request" }),
  ).toBeVisible();
  await find(a, accountB.username);
  await a.route("**/api/friend-requests", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    expect((await route.fetch()).status()).toBe(201);
    await route.abort("failed");
  });
  await a.getByRole("button", { name: "Send friend request" }).click();
  await expect(a.locator(".page-content [role=alert]")).toContainText(
    "couldn’t complete",
  );
  await expect(a.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await a.unroute("**/api/friend-requests");
  await a.goto("/friends");
  await a.getByLabel("Exact username").fill(accountB.username);
  await a.route("**/api/profiles/*", async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await a.getByRole("button", { name: "Find profile" }).click();
  await expect(a.locator(".page-content [role=alert]")).toContainText(
    "couldn’t find",
  );
  await expect(a.getByLabel("Exact username")).toHaveValue(accountB.username);
  await a.unroute("**/api/profiles/*");
  await a.getByRole("button", { name: "Find profile" }).click();
  await expect(a.getByRole("link", { name: /View profile/ })).toBeVisible();
  await context.close();
});

test("removal cancels a held old private response, including an ambiguous successful removal", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}) => {
  const context = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await context.newPage();
  await posterFixtures(b);
  const accountB = newAccount();
  await login(a, accountA, mailLink, "Ada Frames");
  const idB = await login(b, accountB, mailLink, "Bela Cinema");
  await save(b, "tt9000001", "Held private secret");
  await connect(a, b, accountA.username, accountB.username);
  await a.goto(`/profiles/${accountB.username}`);
  await expect(
    a.getByText("Held private secret", { exact: true }),
  ).toBeVisible();
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  await a.route("**/api/users/*/entries?*", async (route) => {
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    ready();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* Revocation aborts the read. */
    }
  });
  await a.getByLabel("Genre", { exact: true }).fill("Drama");
  await a.getByRole("button", { name: "Apply filters" }).click();
  await started;
  await a.route("**/api/friends/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await a.getByRole("button", { name: "Remove friend" }).click();
  await expect(
    a.getByRole("button", { name: "Send friend request" }),
  ).toBeVisible();
  await expect(a.locator(".page-content [role=alert]")).toContainText(
    "couldn’t complete",
  );
  release();
  await a.unroute("**/api/users/*/entries?*");
  await expect(a.getByText("Held private secret", { exact: true })).toHaveCount(
    0,
  );
  expect((await a.request.get(`/api/users/${idB}/entries`)).status()).toBe(403);
  await a.getByRole("link", { name: "Feed", exact: true }).first().click();
  await expect(a.getByText("Held private secret", { exact: true })).toHaveCount(
    0,
  );
  await a.goBack();
  await expect(a.getByText("Held private secret", { exact: true })).toHaveCount(
    0,
  );
  await context.close();
});

test("removal reconciles after navigation and rejects a held pre-commit feed response", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}) => {
  const context = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await context.newPage();
  const accountB = newAccount();
  await login(a, accountA, mailLink, "Ada Frames");
  const idB = await login(b, accountB, mailLink, "Bela Cinema");
  await save(b, "tt9000001", "Navigation revocation secret");
  await connect(a, b, accountA.username, accountB.username);
  await a.goto(`/profiles/${accountB.username}`);
  await expect(
    a.getByText("Navigation revocation secret", { exact: true }),
  ).toBeVisible();
  let commit!: () => void;
  let started!: () => void;
  let committed!: () => void;
  const beforeCommit = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const deleteStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const deleteCommitted = new Promise<void>((resolve) => {
    committed = resolve;
  });
  await a.route("**/api/friends/*", async (route) => {
    if (route.request().method() !== "DELETE") return route.continue();
    started();
    await beforeCommit;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    committed();
    try {
      await route.fulfill({ response });
    } catch {
      /* Old implementation aborts on navigation. */
    }
  });
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const feedReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  let heldOnce = false;
  await a.route("**/api/feed*", async (route) => {
    if (heldOnce) return route.continue();
    heldOnce = true;
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    expect(JSON.stringify(await response.json())).toContain(
      "Navigation revocation secret",
    );
    ready();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* Settlement cancels the old read. */
    }
  });
  await a.getByRole("button", { name: "Remove friend" }).click();
  await deleteStarted;
  await a.getByRole("link", { name: "Feed", exact: true }).first().click();
  await expect(a).toHaveURL(/\/feed$/);
  await feedReady;
  commit();
  await deleteCommitted;
  expect((await a.request.get(`/api/users/${idB}/entries`)).status()).toBe(403);
  release();
  await expect(
    a.getByRole("heading", { name: "Your friends’ next chapter starts here." }),
  ).toBeVisible();
  await expect(
    a.getByText("Navigation revocation secret", { exact: true }),
  ).toHaveCount(0);
  await a.getByRole("link", { name: "Friends", exact: true }).first().click();
  await a.getByRole("link", { name: "Feed", exact: true }).first().click();
  await expect(
    a.getByText("Navigation revocation secret", { exact: true }),
  ).toHaveCount(0);
  await context.close();
});

test("signed-out shared profiles retain only the strict safe destination", async ({
  page,
  account,
  mailLink,
}) => {
  await page.goto("/profiles/historical.name");
  await expect(page).toHaveURL(/sign-in\?next=%2Fprofiles%2Fhistorical.name/);
  await login(page, account, mailLink, "Shared Profile");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto(
    `/sign-in?next=${encodeURIComponent(`/profiles/${account.username}`)}`,
  );
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/profiles/${account.username}$`));
  await expect(
    page.getByRole("link", { name: "Open your collection" }),
  ).toBeVisible();
});

test("cursor pages use real friends, requests, private lists and newest activity; failed reads retry", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}, info) => {
  const context = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await context.newPage();
  await posterFixtures(b);
  const accountB = newAccount();
  const idA = await login(a, accountA, mailLink, "Ada Frames");
  const idB = await login(b, accountB, mailLink, "Bela Cinema");
  await connect(a, b, accountA.username, accountB.username);
  const entry = await save(b, "tt9000001", "Initial review");
  for (let i = 0; i < 21; i++) {
    const response = await b.request.patch(`/api/entries/${entry.id}`, {
      headers: { Origin: state.frontendOrigin },
      data: { review: `Current review ${i}` },
    });
    expect(response.status()).toBe(200);
  }
  await a.goto("/feed");
  await expect(a.locator(".activity-card")).toHaveCount(20);
  await expect(a.getByText("Current review 20", { exact: true })).toHaveCount(
    20,
  );
  const initial = await a
    .locator(".activity-card time")
    .evaluateAll((times) =>
      times.map((time) => time.getAttribute("datetime")!),
    );
  expect(initial).toEqual([...initial].sort().reverse());
  await a.getByRole("button", { name: "More activity" }).click();
  await expect(a.locator(".activity-card")).toHaveCount(22);
  await expect(a.getByRole("button", { name: "More activity" })).toHaveCount(0);
  await a.route("**/api/feed**", async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await a.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(a.locator(".page-content [role=alert]")).toContainText(
    "couldn’t load current activity",
  );
  await expect(a.getByText("Current review 20", { exact: true })).toHaveCount(
    0,
  );
  await a.unroute("**/api/feed**");
  await a.getByRole("button", { name: "Retry feed" }).click();
  await expect(
    a.getByText("Current review 20", { exact: true }).first(),
  ).toBeVisible();
  // Fixture writes run only through fixtures.sql's loopback database identity guard.
  const imdbBase =
    100_000_000 + parseInt(randomUUID().replaceAll("-", "").slice(0, 7), 16);
  for (let i = 0; i < 22; i++) {
    const friend = randomUUID();
    const requester = randomUUID();
    createdUserIds.push(friend, requester);
    const media = randomUUID();
    const [low, high] = [idA, friend].sort();
    const [requestLow, requestHigh] = [idA, requester].sort();
    sql(
      `INSERT INTO "User" (id,email,name,username,"updatedAt") VALUES ('${friend}','${friend}@example.test','Paged Friend ${i}','paged_${friend.replaceAll("-", "").slice(0, 16)}',now()), ('${requester}','${requester}@example.test','Paged Request ${i}','request_${requester.replaceAll("-", "").slice(0, 16)}',now()); INSERT INTO "Friendship" (id,"userLowId","userHighId","requesterId",status,"updatedAt") VALUES ('${randomUUID()}','${low}','${high}','${idA}','ACCEPTED',now()), ('${randomUUID()}','${requestLow}','${requestHigh}','${requester}','PENDING',now()); INSERT INTO "Media" (id,"imdbId",type,title,genres,"updatedAt") VALUES ('${media}','tt${imdbBase + i}','MOVIE','Paged Title ${i}',ARRAY['Drama'],now()); INSERT INTO "WatchEntry" (id,"userId","mediaId",status,rating,review,"updatedAt") VALUES ('${randomUUID()}','${idB}','${media}','WATCHED',9,'Paged private review ${i}',now())`,
    );
  }
  await a.goto("/friends");
  await expect(
    a.locator("section[aria-labelledby=friends-heading] .social-row"),
  ).toHaveCount(20);
  await expect(
    a.locator("section[aria-labelledby=requests-heading] .social-row"),
  ).toHaveCount(20);
  await a.getByRole("button", { name: "More friends" }).click();
  await a.getByRole("button", { name: "More requests" }).click();
  await expect(
    a.locator("section[aria-labelledby=friends-heading] .social-row"),
  ).toHaveCount(23);
  await expect(
    a.locator("section[aria-labelledby=requests-heading] .social-row"),
  ).toHaveCount(22);
  await a.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await a.screenshot({
    path: info.outputPath("friends-desktop-dark.png"),
    fullPage: true,
    animations: "disabled",
  });
  await a.setViewportSize({ width: 390, height: 844 });
  await a.getByRole("button", { name: "Use light theme" }).click();
  await a.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 0);
  });
  await a.screenshot({
    path: info.outputPath("friends-mobile-light.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    await a.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await a.goto(`/profiles/${accountB.username}`);
  await expect(a.locator(".list-grid .poster-card")).toHaveCount(20);
  await a.getByRole("button", { name: "Next page" }).click();
  await expect(a.locator(".list-grid .poster-card")).toHaveCount(3);
  await a.getByRole("button", { name: "Previous page" }).click();
  await expect(a.locator(".list-grid .poster-card")).toHaveCount(20);
  expect(
    (
      await b.request.delete(`/api/friends/${idA}`, {
        headers: { Origin: state.frontendOrigin },
      })
    ).status(),
  ).toBe(200);
  await a.getByLabel("Genre", { exact: true }).fill("Drama");
  const denied = a.waitForResponse(
    (response) =>
      response.url().includes(`/api/users/${idB}/entries`) &&
      response.status() === 403,
  );
  await a.getByRole("button", { name: "Apply filters" }).click();
  await denied;
  await expect(a.locator(".list-grid .poster-card")).toHaveCount(0);
  await a.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(
    a.getByRole("button", { name: "Send friend request" }),
  ).toBeVisible();
  await expect(a.locator(".list-grid .poster-card")).toHaveCount(0);
  await context.close();
});

test("accept/remove pending locks and a real rejected removal preserve filters for retry", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}) => {
  const context = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await context.newPage();
  await posterFixtures(b);
  const accountB = newAccount();
  await login(a, accountA, mailLink, "Ada Frames");
  await login(b, accountB, mailLink, "Bela Cinema");
  await save(b, "tt9000001", "Survives rejected removal");
  await find(a, accountB.username);
  await a.getByRole("button", { name: "Send friend request" }).click();
  await expect(a.getByRole("button", { name: "Cancel request" })).toBeVisible();
  await find(b, accountA.username);
  let releaseAccept!: () => void;
  let acceptReady!: () => void;
  let accepts = 0;
  const heldAccept = new Promise<void>((resolve) => {
    releaseAccept = resolve;
  });
  const startedAccept = new Promise<void>((resolve) => {
    acceptReady = resolve;
  });
  await b.route("**/api/friend-requests/*/accept", async (route) => {
    accepts++;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    acceptReady();
    await heldAccept;
    await route.fulfill({ response });
  });
  await b.getByRole("button", { name: "Accept request" }).click();
  await startedAccept;
  await expect(
    b.getByRole("button", { name: "Accept request" }),
  ).toBeDisabled();
  await b
    .getByRole("button", { name: "Accept request" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  expect(accepts).toBe(1);
  releaseAccept();
  await expect(b.getByRole("button", { name: "Remove friend" })).toBeVisible();
  await a.goto(`/profiles/${accountB.username}`);
  await expect(
    a.getByText("Survives rejected removal", { exact: true }),
  ).toBeVisible();
  await a.getByLabel("Genre", { exact: true }).fill("Drama");
  sql(
    `CREATE OR REPLACE FUNCTION task11_fail_removal() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'isolated removal failure'; END $$; CREATE TRIGGER task11_removal_failure BEFORE DELETE ON "Friendship" FOR EACH ROW EXECUTE FUNCTION task11_fail_removal()`,
  );
  try {
    let releaseRemove!: () => void;
    let removeReady!: () => void;
    let removes = 0;
    const heldRemove = new Promise<void>((resolve) => {
      releaseRemove = resolve;
    });
    const startedRemove = new Promise<void>((resolve) => {
      removeReady = resolve;
    });
    await a.route("**/api/friends/*", async (route) => {
      if (route.request().method() !== "DELETE") return route.continue();
      removes++;
      const response = await route.fetch();
      expect(response.status()).toBe(500);
      removeReady();
      await heldRemove;
      await route.fulfill({ response });
    });
    await a.getByRole("button", { name: "Remove friend" }).click();
    await startedRemove;
    await expect(
      a.getByRole("button", { name: "Remove friend" }),
    ).toBeDisabled();
    await expect(
      a.getByText("Survives rejected removal", { exact: true }),
    ).not.toBeVisible();
    await a
      .getByRole("button", { name: "Remove friend" })
      .evaluate((button) => (button as HTMLButtonElement).click());
    expect(removes).toBe(1);
    releaseRemove();
    await expect(a.locator(".page-content [role=alert]")).toContainText(
      "couldn’t complete",
    );
    await expect(
      a.getByRole("button", { name: "Remove friend" }),
    ).toBeEnabled();
    await expect(a.getByLabel("Genre", { exact: true })).toHaveValue("Drama");
    await expect(
      a.getByText("Survives rejected removal", { exact: true }),
    ).toBeVisible();
    await a.unroute("**/api/friends/*");
  } finally {
    sql(
      'DROP TRIGGER task11_removal_failure ON "Friendship"; DROP FUNCTION task11_fail_removal()',
    );
  }
  await a.getByRole("button", { name: "Remove friend" }).click();
  await expect(
    a.getByRole("button", { name: "Send friend request" }),
  ).toBeVisible();
  await context.close();
});

test("failed relationship and private collection refreshes hide old content and preserve drafts for retry", async ({
  page: a,
  browser,
  account: accountA,
  mailLink,
}) => {
  const context = await browser.newContext({ baseURL: state.frontendOrigin });
  const b = await context.newPage();
  await posterFixtures(b);
  const accountB = newAccount();
  await login(a, accountA, mailLink, "Ada Frames");
  await login(b, accountB, mailLink, "Bela Cinema");
  await save(b, "tt9000001", "Only freshly authorized content");
  await connect(a, b, accountA.username, accountB.username);
  await a.goto(`/profiles/${accountB.username}`);
  await expect(
    a.getByText("Only freshly authorized content", { exact: true }),
  ).toBeVisible();
  await a.getByLabel("Genre", { exact: true }).fill("Drama");
  await a.route("**/api/friends/*/relationship", async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await a.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));
  await expect(a.locator(".page-content [role=alert]")).toContainText(
    "couldn’t check this relationship",
  );
  await expect(
    a.getByText("Only freshly authorized content", { exact: true }),
  ).not.toBeVisible();
  await a.unroute("**/api/friends/*/relationship");
  await a.getByRole("button", { name: "Retry relationship" }).click();
  await expect(a.getByLabel("Genre", { exact: true })).toHaveValue("Drama");
  await expect(
    a.getByText("Only freshly authorized content", { exact: true }),
  ).toBeVisible();
  await a.route("**/api/users/*/entries?*", async (route) => {
    expect((await route.fetch()).status()).toBe(200);
    await route.abort("failed");
  });
  await a.getByRole("button", { name: "Apply filters" }).click();
  await expect(a.locator(".page-content [role=alert]")).toContainText(
    "couldn’t load your collection",
  );
  await expect(a.getByLabel("Genre", { exact: true })).toHaveValue("Drama");
  await expect(
    a.getByText("Only freshly authorized content", { exact: true }),
  ).toHaveCount(0);
  await a.unroute("**/api/users/*/entries?*");
  await a.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    a.getByText("Only freshly authorized content", { exact: true }),
  ).toBeVisible();
  await context.close();
});
