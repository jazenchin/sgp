import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parsePdfFile } from "./parse-pdf.js";

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

async function fetchAndStore(stockCode: string, url: string) {
  const resolvedUrl = await resolveDownloadTarget(url);
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
  return {
    noticeUrl: resolvedUrl,
    localPath,
    parseResult: {
      rawTextHash: createHash("sha256").update(html).digest("hex")
    }
  };
}

export async function downloadNoticeFile(stockCode: string, detailUrl: string) {
  const detailHtml = await fetch(detailUrl).then((r) => r.text());
  const $ = cheerio.load(detailHtml);
  const anchors = $("a").toArray();
  const matched = anchors
    .map((a) => ({ href: $(a).attr("href"), text: $(a).text() }))
    .find((a) => /開會通知|電子檔|pdf|公開資訊觀測站/i.test(`${a.text} ${a.href ?? ""}`));

  if (!matched?.href) return { noticeUrl: undefined, localPath: undefined, parseResult: undefined };
  const noticeUrl = new URL(matched.href, detailUrl).toString();
  return fetchAndStore(stockCode, noticeUrl);
}

export async function downloadNoticeByUrl(stockCode: string, noticeUrl: string) {
  return fetchAndStore(stockCode, noticeUrl);
}
