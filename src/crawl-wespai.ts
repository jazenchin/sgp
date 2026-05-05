import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { MeetingRecordSchema, type MeetingRecord } from "./schema.js";
import { downloadNoticeByUrl, downloadNoticeFile } from "./download-files.js";
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
  await mkdir("data/raw", { recursive: true });
  const html = await fetch(BASE_URL).then((r) => r.text());
  await writeFile("data/raw/wespai-stock115.html", html, "utf8");

  const $ = cheerio.load(html);
  const rows = $(selectors.tableRows).toArray().slice(0, limit);
  const candidates = rows.map((row) => {
    const cells = $(row).find("td").toArray().map((td) => $(td).text().trim());
    const rowLinks = $(row)
      .find("a")
      .toArray()
      .map((a) => $(a).attr("href"))
      .filter((href): href is string => Boolean(href))
      .map((href) => new URL(href, BASE_URL).toString());
    const detailLink = $(row).find(selectors.detailLinkInCodeCell).attr("href");
    const detailUrl = detailLink ? new URL(detailLink, BASE_URL).toString() : undefined;
    const noticeUrl = rowLinks.find((link) => link.includes("doc.twse.com.tw"));
    return { cells, detailUrl, noticeUrl };
  });
  const records: MeetingRecord[] = [];

  for (const item of candidates) {
    await delay(1000);
    const cells = item.cells;
    const stockCode = cells[0] ?? "";
    const companyName = cells[1] ?? "";
    const detailUrl = item.detailUrl;

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
      if (item.noticeUrl) {
        const { noticeUrl, localPath, parseResult } = await downloadNoticeByUrl(stockCode, item.noticeUrl);
        base.noticeFileUrl = noticeUrl;
        base.noticeFileLocalPath = localPath;
        if (parseResult) Object.assign(base, parseResult);
      } else if (detailUrl) {
        const { noticeUrl, localPath, parseResult } = await downloadNoticeFile(stockCode, detailUrl);
        base.noticeFileUrl = noticeUrl;
        base.noticeFileLocalPath = localPath;
        if (parseResult) Object.assign(base, parseResult);
      }
      base.status = base.noticeFileUrl ? "ok" : "partial";
      base.needsReview = !base.noticeFileUrl || base.needsReview;
    } catch (error) {
      base.status = "failed";
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
