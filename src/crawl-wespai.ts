import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { MeetingRecordSchema, type MeetingRecord } from "./schema.js";
import { downloadTwseNotice } from "./download-files.js";

const BASE_URL = "https://stock.wespai.com/stock115";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return fallback;
}

interface Candidate {
  stockCode: string;
  companyName: string;
  giftName: string;
  meetingDate: string;
  meetingPlace: string;
  proxyAgent: string;
  phone: string;
  hasDirectorElection: boolean;
  twseUrl: string | undefined;
}

/**
 * Column layout of the Wespai stock115 table (0-indexed td):
 *  0: 序號  1: 代號(TWSE link)  2: 公司(Yahoo link)  3: 股價
 *  4: 紀念品  5: 台股3萬點  6: 開會日期  7: 開會地點(Google Maps link)
 *  8: 最後買進日  9: 股代  10: 股代電話  11: 台灣經濟史上最好
 *  12: 零股寄單  13: 是否改選(董/監/無)  14: 圖
 */
function extractMeetingPlace($: cheerio.CheerioAPI, row: Element): string {
  const mapHref = $(row).find("td:nth-child(8) a").attr("href") ?? "";
  const qMatch = mapHref.match(/[?&]q=([^&"]+)/);
  if (qMatch) {
    try {
      return decodeURIComponent(qMatch[1]);
    } catch {
      return qMatch[1];
    }
  }
  return $(row).find("td").eq(7).text().trim();
}

function parseCandidates(html: string, limit: number): Candidate[] {
  const $ = cheerio.load(html);
  const rows = $("table tbody tr").toArray().slice(0, limit);

  return rows.map((row) => {
    const tds = $(row).find("td");
    const cell = (i: number) => tds.eq(i).text().trim();

    const stockCode = cell(1);
    const companyName = cell(2);
    const giftName = cell(4);
    const meetingDate = cell(6);
    const meetingPlace = extractMeetingPlace($, row);
    const proxyAgent = cell(9);
    const phone = cell(10);
    const directionCell = cell(13);
    const hasDirectorElection = directionCell !== "無" && directionCell !== "";

    // TWSE URL is the href on the stock code cell (td[1])
    const twseHref = tds.eq(1).find("a").attr("href");
    const twseUrl = twseHref ? new URL(twseHref, BASE_URL).toString() : undefined;

    return { stockCode, companyName, giftName, meetingDate, meetingPlace, proxyAgent, phone, hasDirectorElection, twseUrl };
  });
}

async function main() {
  const limit = getArg("limit", 999);
  await mkdir("data/parsed", { recursive: true });
  await mkdir("data/raw", { recursive: true });

  console.log("Fetching Wespai stock115 table…");
  const html = await fetch(BASE_URL).then((r) => r.text());
  await writeFile("data/raw/wespai-stock115.html", html, "utf8");

  // Phase 1: collect all candidates from the table
  const candidates = parseCandidates(html, limit);
  console.log(`Found ${candidates.length} candidates (gift-bearing companies)`);

  // Phase 2: for each candidate, download the TWSE notice and run LLM
  const records: MeetingRecord[] = [];

  for (const item of candidates) {
    await delay(1200);

    const base: MeetingRecord = {
      year: 115,
      stockCode: item.stockCode,
      companyName: item.companyName,
      meetingDate: item.meetingDate,
      meetingPlace: item.meetingPlace,
      giftName: item.giftName,
      proxyAgent: item.proxyAgent,
      phone: item.phone,
      hasDirectorElection: item.hasDirectorElection,
      sourceWespaiUrl: BASE_URL,
      status: "partial",
      agendaItems: [],
      conveningReasons: [],
      acknowledgements: [],
      discussionItems: [],
      electionItems: [],
      rawTextHash: createHash("sha256").update(`${item.stockCode}:${item.companyName}`).digest("hex"),
      fetchedAt: new Date().toISOString(),
      needsReview: true
    };

    if (!item.twseUrl) {
      console.log(`[${item.stockCode}] No TWSE URL – skipping download`);
      records.push(MeetingRecordSchema.parse(base));
      continue;
    }

    try {
      console.log(`[${item.stockCode}] Downloading notice from TWSE…`);
      const { noticeUrl, localPath, parseResult } = await downloadTwseNotice(item.stockCode, item.twseUrl);
      base.noticeFileUrl = noticeUrl;
      base.noticeFileLocalPath = localPath;
      if (parseResult) Object.assign(base, parseResult);
      base.status = noticeUrl ? "ok" : "partial";
      base.needsReview = !noticeUrl;
      console.log(`[${item.stockCode}] Done – status=${base.status}`);
    } catch (error) {
      base.status = "failed";
      base.error = error instanceof Error ? error.message : String(error);
      console.error(`[${item.stockCode}] Error: ${base.error}`);
    }

    records.push(MeetingRecordSchema.parse(base));
  }

  await writeFile("data/parsed/records.json", JSON.stringify(records, null, 2), "utf8");
  console.log(`\nWrote ${records.length} records to data/parsed/records.json`);

  const ok = records.filter((r) => r.status === "ok").length;
  const partial = records.filter((r) => r.status === "partial").length;
  const failed = records.filter((r) => r.status === "failed").length;
  console.log(`  ok=${ok}  partial=${partial}  failed=${failed}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
