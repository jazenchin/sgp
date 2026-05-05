import { MeetingRecordsSchema, type MeetingRecord } from "./schema.js";

export function normalizeRecords(records: MeetingRecord[]) {
  const dedup = new Map(records.map((r) => [r.stockCode, r]));
  return MeetingRecordsSchema.parse([...dedup.values()]);
}
