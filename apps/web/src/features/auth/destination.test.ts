import { expect, it } from "vitest";
import { safeDestination } from "./client";
it("allows strict profile sharing returns including historical dotted usernames", () => {
  expect(safeDestination("/profiles/user.name")).toBe("/profiles/user.name");
  expect(safeDestination("/profiles/.historic")).toBe("/profiles/.historic");
  expect(safeDestination("/profiles/cinema_123")).toBe("/profiles/cinema_123");
  for (const value of [
    "//evil.test/profiles/a",
    "/profiles/../settings",
    "/profiles/a/extra",
    "/profiles/a?next=evil",
    "/profiles/%2f%2fevil.test",
    "/profiles/.",
    "/profiles/..",
  ]) {
    expect(safeDestination(value)).toBe("/settings");
  }
});
