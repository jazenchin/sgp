import { z } from "zod";

export const MeetingRecordSchema = z.object({
  year: z.literal(115),
  stockCode: z.string(),
  companyName: z.string(),
  market: z.enum(["上市", "上櫃", "興櫃", "其他"]).optional(),
  meetingDate: z.string().optional(),
  meetingTime: z.string().optional(),
  meetingPlace: z.string().optional(),
  giftName: z.string().optional(),
  giftDistributionPlace: z.string().optional(),
  proxyAgent: z.string().optional(),
  phone: z.string().optional(),
  agendaItems: z.array(z.string()).default([]),
  conveningReasons: z.array(z.string()).default([]),
  acknowledgements: z.array(z.string()).default([]),
  discussionItems: z.array(z.string()).default([]),
  electionItems: z.array(z.string()).default([]),
  eVoteStart: z.string().optional(),
  eVoteEnd: z.string().optional(),
  hasDirectorElection: z.boolean().optional(),
  needsReview: z.boolean().default(false),
  noticeFileUrl: z.string().optional(),
  noticeFileLocalPath: z.string().optional(),
  sourceWespaiUrl: z.string().optional(),
  sourceMopsUrl: z.string().optional(),
  status: z.enum(["ok", "partial", "failed"]),
  error: z.string().optional(),
  rawTextHash: z.string(),
  fetchedAt: z.string(),
  llmExtraction: z.unknown().optional()
});

export const MeetingRecordsSchema = z.array(MeetingRecordSchema);
export type MeetingRecord = z.infer<typeof MeetingRecordSchema>;
