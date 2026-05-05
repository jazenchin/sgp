import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parsePdfFile } from "./parse-pdf.js";

const TWSE_BASE = "https://doc.twse.com.tw";

/**
 * Fetches the TWSE document list page (BIG5 encoded) and returns the decoded HTML.
 */
async function fetchTwseListPage(twseUrl: string): Promise<string> {
  const response = await fetch(twseUrl, {
    headers: { "User-Agent": "Mozilla/5.0" }
  });
  if (!response.ok) throw new Error(`TWSE list fetch failed: ${response.status}`);
  const buf = await response.arrayBuffer();
  return new TextDecoder("big5").decode(buf);
}

/**
 * Parses the TWSE document list HTML and extracts the 開會通知 (non-English) file info.
 * Returns { kind, coId, filename } or null if not found.
 */
function parseTwseFileEntry(html: string): { kind: string; coId: string; filename: string } | null {
  const rows = html.split("<tr>");
  for (const row of rows) {
    // Must contain 開會通知 but not 英文
    if (!row.includes("開會通知") || row.includes("英文")) continue;
    const m = row.match(/readfile2\("([^"]+)","([^"]+)","([^"]+)"\)/);
    if (m) return { kind: m[1], coId: m[2], filename: m[3] };
  }
  return null;
}

/**
 * POSTs to TWSE to get a temporary PDF download link and returns it.
 */
async function fetchTwseTempPdfUrl(kind: string, coId: string, filename: string): Promise<string> {
  const body = new URLSearchParams({ colorchg: "1", step: "9", kind, co_id: coId, filename });
  const response = await fetch(`${TWSE_BASE}/server-java/t57sb01`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0"
    },
    body: body.toString()
  });
  if (!response.ok) throw new Error(`TWSE POST failed: ${response.status}`);
  const buf = await response.arrayBuffer();
  const html = new TextDecoder("big5").decode(buf);
  const match = html.match(/href='([^']+\.pdf)'/i);
  if (!match) throw new Error("TWSE POST response contained no PDF link");
  const pdfPath = match[1];
  return pdfPath.startsWith("http") ? pdfPath : `${TWSE_BASE}${pdfPath}`;
}

/**
 * Downloads a PDF from url, saves to data/raw/files/{stockCode}.pdf, parses it.
 */
async function downloadAndParsePdf(stockCode: string, pdfUrl: string) {
  const response = await fetch(pdfUrl, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!response.ok) throw new Error(`PDF download failed: ${response.status} ${pdfUrl}`);

  await mkdir("data/raw/files", { recursive: true });
  const localPath = path.join("data/raw/files", `${stockCode}.pdf`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(localPath, bytes);

  const parseResult = await parsePdfFile(localPath);
  return { noticeUrl: pdfUrl, localPath, parseResult };
}

/**
 * Full TWSE download: GET list (BIG5) → find 開會通知 entry → POST for temp URL → download PDF.
 */
export async function downloadTwseNotice(stockCode: string, twseUrl: string) {
  const listHtml = await fetchTwseListPage(twseUrl);
  const entry = parseTwseFileEntry(listHtml);
  if (!entry) {
    return { noticeUrl: undefined, localPath: undefined, parseResult: undefined };
  }
  const pdfUrl = await fetchTwseTempPdfUrl(entry.kind, entry.coId, entry.filename);
  return downloadAndParsePdf(stockCode, pdfUrl);
}

/**
 * Legacy: resolve a URL through meta-refresh / anchor hops and download.
 * Kept for non-TWSE sources.
 */
function extractRedirectUrl(html: string, baseUrl: string): string | undefined {
  const $ = cheerio.load(html);
  const metaRefresh = $('meta[http-equiv="refresh"]').attr("content");
  const metaMatch = metaRefresh?.match(/url\s*=\s*([^;]+)/i)?.[1]?.trim();
  if (metaMatch) return new URL(metaMatch, baseUrl).toString();

  const anchors = $("a").toArray().map((a) => new URL($(a).attr("href") ?? "", baseUrl).toString());
  const pdfAnchor = anchors.find((href) => href.toLowerCase().includes(".pdf"));
  if (pdfAnchor) return pdfAnchor;
  const downloadAnchor = anchors.find((href) => /download|viewer|doc\.twse\.com\.tw/i.test(href));
  if (downloadAnchor) return downloadAnchor;

  const locationMatch = html.match(/(?:window\.location(?:\.href)?|location\.href)\s*=\s*["']([^"']+)["']/i)?.[1];
  if (locationMatch) return new URL(locationMatch, baseUrl).toString();
  return undefined;
}

async function resolveDownloadTarget(startUrl: string, maxHops = 5): Promise<string> {
  let current = startUrl;
  for (let i = 0; i < maxHops; i += 1) {
    const response = await fetch(current, { redirect: "follow" });
    if (!response.ok) throw new Error(`resolve failed: ${response.status}`);
    const finalUrl = response.url || current;
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("pdf") || finalUrl.toLowerCase().endsWith(".pdf")) return finalUrl;
    if (!contentType.includes("html")) return finalUrl;
    const html = await response.text();
    const nextUrl = extractRedirectUrl(html, finalUrl);
    if (!nextUrl || nextUrl === current) return finalUrl;
    current = nextUrl;
  }
  return current;
}

export async function downloadNoticeFile(stockCode: string, detailUrl: string) {
  const detailHtml = await fetch(detailUrl).then((r) => r.text());
  const $ = cheerio.load(detailHtml);
  const matched = $("a")
    .toArray()
    .map((a) => ({ href: $(a).attr("href"), text: $(a).text() }))
    .find((a) => /開會通知|電子檔|pdf|公開資訊觀測站/i.test(`${a.text} ${a.href ?? ""}`));

  if (!matched?.href) return { noticeUrl: undefined, localPath: undefined, parseResult: undefined };
  const noticeUrl = new URL(matched.href, detailUrl).toString();

  const resolvedUrl = await resolveDownloadTarget(noticeUrl);
  const response = await fetch(resolvedUrl);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const ext = contentType.includes("pdf") || resolvedUrl.toLowerCase().endsWith(".pdf") ? ".pdf" : ".html";

  await mkdir("data/raw/files", { recursive: true });
  const localPath = path.join("data/raw/files", `${stockCode}${ext}`);

  if (ext === ".pdf") {
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, bytes);
    const parseResult = await parsePdfFile(localPath);
    return { noticeUrl: resolvedUrl, localPath, parseResult };
  }

  const html = await response.text();
  await writeFile(localPath, html, "utf8");
  return { noticeUrl: resolvedUrl, localPath, parseResult: { rawTextHash: createHash("sha256").update(html).digest("hex") } };
}
