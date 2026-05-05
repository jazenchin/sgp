import { describe, expect, it } from "vitest";
import { access } from "node:fs/promises";

describe("smoke", () => {
  it("project layout exists", async () => {
    await access("src/crawl-wespai.ts");
    expect(true).toBe(true);
  });
});
