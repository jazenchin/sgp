import { describe, expect, it } from "vitest";
import { MeetingRecordSchema } from "../src/schema.js";

describe("schema", () => {
  it("validates minimal record", () => {
    const rec = MeetingRecordSchema.parse({
      year: 115,
      stockCode: "2330",
      companyName: "台積電",
      agendaItems: [],
      conveningReasons: [],
      acknowledgements: [],
      discussionItems: [],
      electionItems: [],
      status: "ok",
      rawTextHash: "x",
      fetchedAt: new Date().toISOString(),
      needsReview: false
    });
    expect(rec.stockCode).toBe("2330");
  });
});
