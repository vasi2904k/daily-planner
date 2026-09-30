import { expect, it } from "vitest";
import { GET } from "./route";

it("filters the requested week instead of returning every example task", async () => {
  const response = await GET(new Request("http://localhost/api/schedule?view=week&date=2030-01-01"));
  expect((await response.json()).tasks).toEqual([]);
});
it("rejects invalid dates", async () => {
  expect((await GET(new Request("http://localhost/api/schedule?date=2026-02-30"))).status).toBe(400);
});
