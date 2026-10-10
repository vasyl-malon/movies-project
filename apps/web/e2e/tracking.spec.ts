import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { test, expect, sql, state } from "./fixtures";

async function login(
  page: Page,
  account: { email: string; username: string; password: string },
  mailLink: (email: string, subject: string) => Promise<string>,
) {
  await page.goto("/sign-up");
  await page.getByLabel("Display name").fill("Orbit Keeper");
  await page.getByLabel("Username", { exact: true }).fill(account.username);
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/verify-email/);
  await page.goto(await mailLink(account.email, "Verify"));
  await page.goto("/sign-in");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/settings/);
}
const form = (page: Page) => page.getByRole("form", { name: "Your entry" });
test.beforeEach(async ({ page }) => {
  sql(
    'DELETE FROM "RateLimit"; DELETE FROM "MediaCache" WHERE key LIKE \'omdb:v1:search:%\'',
  );
  await page.route("https://posters.example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#354636"/><circle cx="200" cy="220" r="90" fill="#b4c682"/></svg>',
    }),
  );
});

test("movie discovery, logging, confirmation, edit/delete, filters and responsive views", async ({
  page,
  account,
  mailLink,
}, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.route("https://posters.example.test/**", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#354636"/><circle cx="200" cy="220" r="90" fill="#b4c682"/><path d="M0 550L400 300V600H0" fill="#64734c"/></svg>',
    }),
  );
  await login(page, account, mailLink);
  await page.goto("/search");
  await page.getByLabel("Search titles").fill("cinema");
  await page.getByRole("link", { name: /The Quiet Orbit/ }).click();
  await expect(
    page.getByRole("heading", { name: "The Quiet Orbit", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("IMDb rating", { exact: true })).toBeVisible();
  await expect(page.getByText("Needs 3 rated Watched entries")).toBeVisible();
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("WATCHED");
  const today = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  await expect(form(page).getByLabel("Completion date")).toHaveValue(today);
  await form(page).getByLabel("Your rating").fill("9");
  await form(page).getByLabel("Review").fill("<b>Quiet and beautiful</b>");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("PLAN_TO_WATCH");
  await expect(page.getByRole("dialog")).toContainText("clear");
  await page.getByRole("button", { name: "Keep current status" }).click();
  await expect(form(page).getByLabel("Status", { exact: true })).toHaveValue(
    "WATCHED",
  );
  await expect(form(page).getByLabel("Your rating")).toHaveValue("9");
  await expect(form(page).getByLabel("Completion date")).toHaveValue(today);
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("PLAN_TO_WATCH");
  await page
    .getByRole("button", { name: "Change status", exact: true })
    .click();
  await expect(form(page).getByLabel("Your rating")).toBeDisabled();
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("WATCHED");
  await form(page).getByLabel("Your rating").fill("8");
  await form(page).getByLabel("Completion date").fill("2024-02-29");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement)?.blur();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: `${info.outputDir}/title-desktop-dark.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: `${info.outputDir}/title-mobile-dark.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Use light theme" }).click();
  await page.reload();
  await expect(form(page).getByLabel("Your rating")).toBeVisible();
  await expect(form(page).getByLabel("Your rating")).toHaveCSS(
    "background-color",
    "rgb(255, 254, 250)",
  );
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    (document.activeElement as HTMLElement)?.blur();
  });
  await page.screenshot({
    path: `${info.outputDir}/title-mobile-light.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: `${info.outputDir}/title-desktop-light.png`,
    fullPage: true,
  });
  await page.goto("/my-list");
  await expect(
    page.getByRole("link", { name: /The Quiet Orbit/ }),
  ).toBeVisible();
  await page.getByLabel("Genre").fill("Comedy");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await expect(page.getByText("No entries match your filters.")).toBeVisible();
  await page.getByLabel("Genre").fill("Drama");
  await page.getByLabel("Minimum rating").fill("8");
  await page.getByLabel("Maximum rating").fill("8");
  await page.getByLabel("Completed from").fill("2024-02-29");
  await page.getByLabel("Completed to").fill("2024-02-29");
  await page.getByRole("button", { name: "Apply filters" }).click();
  await page.getByRole("link", { name: /The Quiet Orbit/ }).click();
  await expect(form(page).getByLabel("Review")).toHaveValue(
    "<b>Quiet and beautiful</b>",
  );
  await form(page).getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Keep entry" }).click();
  await expect(form(page).getByLabel("Your rating")).toHaveValue("8");
  await form(page).getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(form(page).getByRole("status")).toContainText("Entry deleted");
  await page.goto("/my-list");
  await expect(page.getByText("No entries match your filters.")).toBeVisible();
  expect(errors).toEqual([]);
});

test("series and optional seasons are independent entries", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  sql(
    `DELETE FROM "WatchEntry" WHERE "seasonId" IN (SELECT s.id FROM "Season" s JOIN "Media" m ON m.id = s."mediaId" WHERE m."imdbId" = 'tt9000002')`,
  );
  await page.goto("/titles/tt9000002");
  await expect(
    page.getByRole("heading", { name: "Harbor Lights", exact: true }),
  ).toBeVisible();
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("WATCHING");
  await form(page).getByLabel("Your rating").fill("7");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await page.getByRole("button", { name: "Show seasons" }).click();
  await page.getByRole("button", { name: "Season 1", exact: true }).click();
  const season = page.getByRole("form", { name: "Season 1 entry" });
  const seasonRatings = page.getByRole("region", { name: "Season 1 ratings" });
  await expect(
    seasonRatings.getByText("Needs 3 rated Watched entries"),
  ).toBeVisible();
  await expect(
    seasonRatings.getByText("IMDb rating", { exact: true }),
  ).toHaveCount(0);
  const metadata = await (
    await page.request.get("/api/media/imdb/tt9000002")
  ).json();
  const seasonData = await (
    await page.request.get(`/api/media/${metadata.id}/seasons`)
  ).json();
  const seasonId = seasonData.items[0].id;
  for (const rating of [6, 9]) {
    const id = randomUUID();
    sql(
      `INSERT INTO "User" (id, name, email, "emailVerified", username, "updatedAt") VALUES ('${id}', 'Season Contributor', '${id}@example.test', true, '${id}', NOW()); INSERT INTO "WatchEntry" (id, "userId", "seasonId", status, rating) VALUES ('${randomUUID()}', '${id}', '${seasonId}', 'WATCHED', ${rating})`,
    );
  }
  await season.getByLabel("Status", { exact: true }).selectOption("WATCHED");
  await season.getByLabel("Your rating").fill("9");
  await season.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(season.getByRole("status")).toContainText("Entry saved");
  await expect(
    seasonRatings.getByText("3 rated Watched entries", { exact: true }),
  ).toBeVisible();
  await expect(seasonRatings.locator("strong").last()).toContainText("8.0");
  await expect(form(page).getByLabel("Status", { exact: true })).toHaveValue(
    "WATCHING",
  );
  await expect(form(page).getByLabel("Your rating")).toHaveValue("7");
  await page.goto("/my-list");
  await expect(page.getByRole("link", { name: /Harbor Lights/ })).toHaveCount(
    2,
  );
});

test("search debounce, obsolete response suppression, pagination, poster fallback and quota recovery", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  await page.route("https://posters.example.test/**", (route) =>
    route.fulfill({ status: 404, body: "" }),
  );
  await page.goto("/search");
  const input = page.getByLabel("Search titles");
  await input.fill("ci");
  await expect(
    page.getByText("Type at least 3 characters to begin."),
  ).toBeVisible();
  let count = 0;
  page.on("request", (req) => {
    if (req.url().includes("/api/media/search")) count++;
  });
  const cancelled = page.waitForEvent("requestfailed", {
    predicate: (req) => req.url().includes("q=slow"),
  });
  const initialRequest = page.waitForRequest(
    (req) =>
      req.url().includes("/api/media/search") && req.url().includes("q=slow"),
  );
  await input.fill("slow");
  await initialRequest;
  await input.fill("paper");
  expect((await cancelled).failure()?.errorText).toContain("ERR_ABORTED");
  await expect(
    page.getByRole("link", { name: /Paper Moonrise/ }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: /The Quiet Orbit/ })).toHaveCount(
    0,
  );
  await expect(page.getByText("Poster unavailable")).toBeVisible();
  await page.waitForTimeout(2600);
  await expect(page.getByRole("link", { name: /The Quiet Orbit/ })).toHaveCount(
    0,
  );
  await input.fill("");
  await input.fill("paper");
  await expect(page.getByRole("status")).toContainText(
    "Looking for your next story",
  );
  await expect(page.getByRole("link", { name: /Paper Moonrise/ })).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("link", { name: /Paper Moonrise/ }),
  ).toBeVisible();
  await input.fill("pages");
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Page 2", { exact: true }).first()).toBeVisible();
  await input.fill("quota");
  await expect(page.locator("p[role=alert]")).toContainText("quota");
  await expect(input).toHaveValue("quota");
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await input.fill("orbit");
  await expect(
    page.getByRole("link", { name: /The Quiet Orbit/ }),
  ).toBeVisible();
  expect(count).toBeGreaterThanOrEqual(5);
});

test("pending lock, errors preserve drafts and duplicate conflicts require an explicit save", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  await page.goto("/titles/tt9000001");
  await expect(form(page).getByLabel("Review")).toBeVisible();
  const metadata = await (
    await page.request.get("/api/media/imdb/tt9000001")
  ).json();
  const existing = await page.request.post("/api/entries", {
    data: {
      target: { mediaId: metadata.id },
      status: "WATCHING",
      rating: 4,
      review: "Stored elsewhere",
    },
    headers: { Origin: state.frontendOrigin },
  });
  expect(existing.status()).toBe(201);
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("WATCHING");
  await form(page).getByLabel("Your rating").fill("8");
  await form(page).getByLabel("Review").fill("My unsaved draft");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("alert")).toContainText("already exists");
  await expect(form(page).getByLabel("Review")).toHaveValue("My unsaved draft");
  const stored = await existing.json();
  expect(
    (await (await page.request.get(`/api/entries/${stored.id}`)).json()).review,
  ).toBe("Stored elsewhere");
  await form(page)
    .getByRole("button", { name: "Save my draft over existing entry" })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  let release!: () => void;
  let ready!: () => void;
  let writes = 0;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    ready = r;
  });
  await page.route("**/api/entries/*", async (route) => {
    if (route.request().method() !== "PATCH") {
      await route.continue();
      return;
    }
    writes++;
    const response = await route.fetch();
    ready();
    await held;
    await route.fulfill({ response });
  });
  await form(page).getByLabel("Review").fill("Pending draft");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await started;
  await expect(form(page).getByLabel("Review")).toBeDisabled();
  await form(page).evaluate((el) => (el as HTMLFormElement).requestSubmit());
  await page.waitForTimeout(200);
  expect(writes).toBe(1);
  release();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await page.unroute("**/api/entries/*");
  sql(
    `CREATE OR REPLACE FUNCTION task10_fail_activity() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test failure'; END $$; CREATE TRIGGER task10_activity_failure BEFORE INSERT ON "Activity" FOR EACH ROW EXECUTE FUNCTION task10_fail_activity()`,
  );
  try {
    await form(page).getByLabel("Review").fill("Preserved after API error");
    await form(page)
      .getByRole("button", { name: "Save entry", exact: true })
      .click();
    await expect(form(page).getByRole("alert")).toContainText("couldn’t save");
    await expect(form(page).getByLabel("Review")).toHaveValue(
      "Preserved after API error",
    );
  } finally {
    sql(
      'DROP TRIGGER task10_activity_failure ON "Activity"; DROP FUNCTION task10_fail_activity()',
    );
  }
});

for (const timezoneId of ["Pacific/Kiritimati", "America/Los_Angeles"]) {
  test(`literal selected calendar date survives ${timezoneId}`, async ({
    browser,
    account,
    mailLink,
  }) => {
    const context = await browser.newContext({
      baseURL: state.frontendOrigin,
      timezoneId,
    });
    const page = await context.newPage();
    await login(page, account, mailLink);
    await page.goto("/titles/tt9000003");
    await form(page)
      .getByLabel("Status", { exact: true })
      .selectOption("WATCHED");
    await form(page).getByLabel("Completion date").fill("2024-02-29");
    await form(page)
      .getByRole("button", { name: "Save entry", exact: true })
      .click();
    await expect(form(page).getByRole("status")).toContainText("Entry saved");
    await page.reload();
    await expect(form(page).getByLabel("Completion date")).toHaveValue(
      "2024-02-29",
    );
    await context.close();
  });
}

test("completion-date removal asks before touching an unsaved draft", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  await page.goto("/titles/tt9000003");
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("WATCHED");
  await form(page).getByLabel("Completion date").fill("2024-02-29");
  await form(page).getByLabel("Review").fill("Keep this draft");
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("DROPPED");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Keep current status" }).click();
  await expect(form(page).getByLabel("Completion date")).toHaveValue(
    "2024-02-29",
  );
  await expect(form(page).getByLabel("Review")).toHaveValue("Keep this draft");
  await form(page)
    .getByLabel("Status", { exact: true })
    .selectOption("DROPPED");
  await page
    .getByRole("button", { name: "Change status", exact: true })
    .click();
  await expect(form(page).getByLabel("Completion date")).toHaveCount(0);
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await page.reload();
  await expect(form(page).getByLabel("Status", { exact: true })).toHaveValue(
    "DROPPED",
  );
  await expect(form(page).getByLabel("Review")).toHaveValue("Keep this draft");
});

test("metadata failure leaves saved lists usable and delete retry handles a lost successful response", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  await page.goto("/titles/tt9000001");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await expect(form(page).getByRole("status")).toContainText("Entry saved");
  await page.goto("/titles/tt9999999");
  await expect(
    page.getByRole("heading", { name: "Metadata unavailable" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Retry", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "Your saved list is still here" })
    .click();
  await page.getByRole("link", { name: /The Quiet Orbit/ }).click();
  await expect(
    form(page).getByRole("button", { name: "Delete entry" }),
  ).toBeVisible();
  await page.route("**/api/entries/*", async (route) => {
    if (route.request().method() !== "DELETE") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    expect(response.status()).toBe(200);
    await route.abort("failed");
  });
  await form(page).getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(form(page).getByRole("alert")).toContainText("couldn’t delete");
  await page.unroute("**/api/entries/*");
  await form(page).getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(form(page).getByRole("status")).toContainText("Entry deleted");
});

test("late entry saves after sign out cannot reopen private tracking content", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  await page.goto("/titles/tt9000001");
  let release!: () => void;
  let ready!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const committed = new Promise<void>((r) => {
    ready = r;
  });
  await page.route("**/api/entries", async (route) => {
    const response = await route.fetch();
    ready();
    await held;
    try {
      await route.fulfill({ response });
    } catch {
      /* The form aborts its request on logout. */
    }
  });
  await form(page).getByLabel("Review").fill("Late private entry");
  await form(page)
    .getByRole("button", { name: "Save entry", exact: true })
    .click();
  await committed;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/sign-in/);
  release();
  await expect(form(page)).toHaveCount(0);
  await page.goBack();
  await expect(form(page)).toHaveCount(0);
  await expect(page).toHaveURL(/sign-in/);
});

test("signed-out title routes retain only a strict safe return destination", async ({
  page,
  account,
  mailLink,
}) => {
  await page.goto("/titles/tt9000001");
  await expect(page).toHaveURL(/sign-in\?next=%2Ftitles%2Ftt9000001/);
  await login(page, account, mailLink);
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.goto("/sign-in?next=%2Ftitles%2Ftt9000001");
  await page.getByLabel("Email", { exact: true }).fill(account.email);
  await page.getByLabel("Password", { exact: true }).fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/titles\/tt9000001$/);
  await expect(form(page)).toBeVisible();
});

test("failed background entry refresh preserves a mounted unsaved draft", async ({
  page,
  account,
  mailLink,
}) => {
  await login(page, account, mailLink);
  await page.goto("/titles/tt9000001");
  await form(page).getByLabel("Review").fill("Unsaved during refresh");
  await page.route("**/api/users/*/entries?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"message":"Temporarily unavailable"}',
    }),
  );
  const failed = page.waitForResponse(
    (response) =>
      response.url().includes("/entries?") && response.status() === 503,
  );
  await page.evaluate(() =>
    window.dispatchEvent(new Event("visibilitychange")),
  );
  await failed;
  await expect(form(page).getByLabel("Review")).toHaveValue(
    "Unsaved during refresh",
  );
  await page.unroute("**/api/users/*/entries?*");
});

for (const parentQuery of ["title metadata", "season list"] as const) {
  test(`failed background ${parentQuery} refresh preserves title and season drafts`, async ({
    page,
    account,
    mailLink,
  }) => {
    await login(page, account, mailLink);
    await page.goto("/titles/tt9000002");
    await form(page)
      .getByLabel("Status", { exact: true })
      .selectOption("WATCHED");
    await form(page).getByLabel("Your rating").fill("7");
    await form(page).getByLabel("Completion date").fill("2024-02-29");
    await form(page).getByLabel("Review").fill("Unsaved whole-series review");
    await page.getByRole("button", { name: "Show seasons" }).click();
    await page.getByRole("button", { name: "Season 1", exact: true }).click();
    const season = page.getByRole("form", { name: "Season 1 entry" });
    await season.getByLabel("Status", { exact: true }).selectOption("WATCHING");
    await season.getByLabel("Your rating").fill("9");
    await season.getByLabel("Review").fill("Unsaved season review");
    const pattern =
      parentQuery === "title metadata"
        ? "**/api/media/imdb/tt9000002"
        : "**/api/media/*/seasons";
    const matches = (url: string) =>
      parentQuery === "title metadata"
        ? new URL(url).pathname === "/api/media/imdb/tt9000002"
        : /\/api\/media\/[^/]+\/seasons$/.test(new URL(url).pathname);
    await page.route(pattern, async (route) => {
      // The product endpoint and real database are still exercised. Discard its
      // successful response to simulate a failed metadata transport refresh.
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await route.abort("failed");
    });
    const failed = page.waitForEvent("requestfailed", {
      predicate: (request) => matches(request.url()),
    });
    await page.evaluate(() =>
      window.dispatchEvent(new Event("visibilitychange")),
    );
    await failed;
    await expect(page.locator(".page-content p[role=alert]")).toBeVisible();
    await expect(form(page).getByLabel("Review")).toHaveValue(
      "Unsaved whole-series review",
    );
    await expect(form(page).getByLabel("Your rating")).toHaveValue("7");
    await expect(form(page).getByLabel("Completion date")).toHaveValue(
      "2024-02-29",
    );
    await expect(season.getByLabel("Review")).toHaveValue(
      "Unsaved season review",
    );
    await expect(season.getByLabel("Your rating")).toHaveValue("9");
    await expect(season.getByLabel("Status", { exact: true })).toHaveValue(
      "WATCHING",
    );
    await page.unroute(pattern);
    await page
      .getByRole("button", {
        name:
          parentQuery === "title metadata"
            ? "Retry title metadata"
            : "Retry seasons",
        exact: true,
      })
      .click();
    await expect(page.locator(".page-content p[role=alert]")).toHaveCount(0);
    await expect(form(page).getByLabel("Review")).toHaveValue(
      "Unsaved whole-series review",
    );
    await expect(form(page).getByLabel("Completion date")).toHaveValue(
      "2024-02-29",
    );
    await expect(season.getByLabel("Review")).toHaveValue(
      "Unsaved season review",
    );
    await expect(season.getByLabel("Your rating")).toHaveValue("9");
  });
}
