import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { parsePdfFile } from "../src/parse-pdf.js";

describe("parser fallback", () => {
  it("returns needsReview for invalid pdf", async () => {
    await mkdir("tmp", { recursive: true });
    await writeFile("tmp/2330.pdf", "not a real pdf");
    const parsed = await parsePdfFile("tmp/2330.pdf");
    expect(parsed.needsReview).toBe(true);
  });
});
