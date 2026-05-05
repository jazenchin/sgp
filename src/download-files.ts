import * as cheerio from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { parsePdfFile } from "./parse-pdf.js";

export async function downloadNoticeFile(stockCode: string, detailUrl: string) {
  const detailHtml = await fetch(detailUrl).then((r) => r.text());
  const $ = cheerio.load(detailHtml);
  const anchors = $("a").toArray();
  const matched = anchors
    .map((a) => ({ href: $(a).attr("href"), text: $(a).text() }))
    .find((a) => /開會通知|電子檔|pdf|公開資訊觀測站/i.test(`${a.text} ${a.href ?? ""}`));

  if (!matched?.href) return { noticeUrl: undefined, localPath: undefined, parseResult: undefined };
  const noticeUrl = new URL(matched.href, detailUrl).toString();
  const response = await fetch(noticeUrl);
  if (!response.ok) throw new Error(`download failed: ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  const ext = contentType.includes("pdf") || noticeUrl.toLowerCase().endsWith(".pdf") ? ".pdf" : ".html";

  await mkdir("data/raw/files", { recursive: true });
  const localPath = path.join("data/raw/files", `${stockCode}${ext}`);

  if (ext === ".pdf") {
    const bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(localPath, bytes);
    const parseResult = await parsePdfFile(localPath);
    return { noticeUrl, localPath, parseResult };
  }

  const html = await response.text();
  await writeFile(localPath, html, "utf8");
  return {
    noticeUrl,
    localPath,
    parseResult: {
      rawTextHash: createHash("sha256").update(html).digest("hex")
    }
  };
}
