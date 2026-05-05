import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { MeetingRecordSchema, type MeetingRecord } from "./schema.js";
import { downloadNoticeFile } from "./download-files.js";
import { parsePdfFile } from "./parse-pdf.js";
import { selectors } from "./selectors.js";

const BASE_URL = "https://stock.wespai.com/stock115";
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function getArg(name: string, fallback: number): number {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return Number(process.argv[idx + 1]);
  return fallback;
}

async function main() {
  const limit = getArg("limit", 10);
  await mkdir("data/parsed", { recursive: true });
  const html = await fetch(BASE_URL).then((r) => r.text());
  await writeFile("data/raw/wespai-stock115.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = $(selectors.tableRows).toArray().slice(0, limit);
  const records: MeetingRecord[] = [];

  for (const row of rows) {
    await delay(1000);
    const cells = $(row).find("td").toArray().map((td) => $(td).text().trim());
    const link = $(row).find(selectors.detailLinkInCodeCell).attr("href");
    const stockCode = cells[0] ?? "";
    const companyName = cells[1] ?? "";
    const detailUrl = link ? new URL(link, BASE_URL).toString() : undefined;

    const base: MeetingRecord = {
      year: 115,
      stockCode,
      companyName,
      meetingDate: cells[2],
      giftName: cells[3],
      giftDistributionPlace: cells[4],
      proxyAgent: cells[5],
      phone: cells[6],
      sourceWespaiUrl: detailUrl ?? BASE_URL,
      status: "partial",
      agendaItems: [],
      conveningReasons: [],
      acknowledgements: [],
      discussionItems: [],
      electionItems: [],
      rawTextHash: createHash("sha256").update(`${stockCode}:${companyName}`).digest("hex"),
      fetchedAt: new Date().toISOString(),
      needsReview: true
    };

    try {
      if (detailUrl) {
        const { noticeUrl, localPath, parseResult } = await downloadNoticeFile(stockCode, detailUrl);
        base.noticeFileUrl = noticeUrl;
        base.noticeFileLocalPath = localPath;
        if (parseResult) Object.assign(base, parseResult);
      }
      base.status = "ok";
      base.needsReview = false;
    } catch (error) {
      base.status = "partial";
      base.error = error instanceof Error ? error.message : String(error);
      if (base.noticeFileLocalPath?.endsWith(".pdf")) {
        const parsed = await parsePdfFile(base.noticeFileLocalPath);
        Object.assign(base, parsed);
      }
    }

    records.push(MeetingRecordSchema.parse(base));
  }

  await writeFile("data/parsed/records.json", JSON.stringify(records, null, 2), "utf8");
  console.log(`Wrote ${records.length} records to data/parsed/records.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
