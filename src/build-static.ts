import { readFile, mkdir, writeFile } from "node:fs/promises";
import MiniSearch from "minisearch";
import { MeetingRecordsSchema, type MeetingRecord } from "./schema.js";

interface AnswerSummary {
  shares_required_to_collect?: string | null;
  electronic_voting_collection_time?: string | null;
  collection_location?: string | null;
  required_items?: string[];
}

interface LlmExtraction {
  answer_summary?: AnswerSummary;
  souvenir?: { item?: string | null };
  extraction?: { confidence?: number | null; warnings?: string[] };
}

function getAnswerSummary(r: MeetingRecord): AnswerSummary | null {
  try {
    const llm = r.llmExtraction as LlmExtraction | null | undefined;
    return llm?.answer_summary ?? null;
  } catch {
    return null;
  }
}

function renderAnswerSummary(summary: AnswerSummary): string {
  const rows: string[] = [];
  if (summary.shares_required_to_collect) {
    rows.push(`<tr><th>所需股數</th><td>${esc(summary.shares_required_to_collect)}</td></tr>`);
  }
  if (summary.electronic_voting_collection_time) {
    rows.push(`<tr><th>電子投票領取時間</th><td>${esc(summary.electronic_voting_collection_time)}</td></tr>`);
  }
  if (summary.collection_location) {
    rows.push(`<tr><th>領取地點</th><td>${esc(summary.collection_location)}</td></tr>`);
  }
  if (summary.required_items?.length) {
    const items = summary.required_items.map((i) => `<li>${esc(i)}</li>`).join("");
    rows.push(`<tr><th>需準備物品</th><td><ul>${items}</ul></td></tr>`);
  }
  if (!rows.length) return "";
  return `<section class="llm-summary"><h2>紀念品領取資訊（LLM 解析）</h2><table>${rows.join("")}</table></section>`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function companyPage(r: MeetingRecord): string {
  const summary = getAnswerSummary(r);
  const summaryHtml = summary ? renderAnswerSummary(summary) : "";
  const noticeLink = r.noticeFileUrl ? `<a href="${esc(r.noticeFileUrl)}" target="_blank">開會通知 PDF</a>` : "（尚無開會通知）";
  return `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>${esc(r.stockCode)} ${esc(r.companyName)} 股東會</title>
<style>
body{font-family:sans-serif;max-width:800px;margin:2rem auto;padding:0 1rem;color:#222}
h1{font-size:1.6rem;border-bottom:2px solid #0066cc;padding-bottom:.4rem}
h2{font-size:1.1rem;color:#0066cc;margin-top:1.5rem}
table{border-collapse:collapse;width:100%}
th{text-align:left;width:180px;padding:6px 12px;background:#f0f4ff;font-weight:600}
td{padding:6px 12px;border-top:1px solid #ddd}
.llm-summary{background:#f9f9f9;border:1px solid #ccc;padding:1rem;border-radius:4px;margin-top:1rem}
.meta{font-size:.85rem;color:#666}
ul{margin:.2rem 0;padding-left:1.2rem}
a{color:#0066cc}
.badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:.8rem}
.ok{background:#d4edda;color:#155724}.partial{background:#fff3cd;color:#856404}.failed{background:#f8d7da;color:#721c24}
</style>
</head>
<body>
<p><a href="../index.html">← 回列表</a></p>
<h1>${esc(r.stockCode)} ${esc(r.companyName)}</h1>
<table>
<tr><th>股東會日期</th><td>${esc(r.meetingDate ?? "")}</td></tr>
<tr><th>開會地點</th><td>${esc(r.meetingPlace ?? "")}</td></tr>
<tr><th>紀念品</th><td>${esc(r.giftName ?? "")}</td></tr>
<tr><th>股務代理</th><td>${esc(r.proxyAgent ?? "")}${r.phone ? "　" + esc(r.phone) : ""}</td></tr>
<tr><th>改選董監</th><td>${r.hasDirectorElection ? "是" : "否"}</td></tr>
<tr><th>開會通知</th><td>${noticeLink}</td></tr>
<tr><th>解析狀態</th><td><span class="badge ${esc(r.status)}">${esc(r.status)}</span>${r.needsReview ? " ⚠ 待審" : ""}</td></tr>
</table>
${summaryHtml}
<p class="meta">資料來源：<a href="${esc(r.sourceWespaiUrl ?? "#")}" target="_blank">撿股讚</a>　抓取時間：${esc(r.fetchedAt)}</p>
</body>
</html>`;
}

function indexRow(r: MeetingRecord): string {
  const summary = getAnswerSummary(r);
  const sharesInfo = summary?.shares_required_to_collect ? esc(summary.shares_required_to_collect) : "";
  return `<tr>
<td><a href="./company/${esc(r.stockCode)}.html">${esc(r.stockCode)}</a></td>
<td>${esc(r.companyName)}</td>
<td>${esc(r.meetingDate ?? "")}</td>
<td>${esc(r.giftName ?? "")}</td>
<td>${esc(r.meetingPlace ?? "")}</td>
<td>${esc(r.proxyAgent ?? "")}</td>
<td>${sharesInfo}</td>
<td><span class="badge ${esc(r.status)}">${esc(r.status)}</span></td>
</tr>`;
}

async function main() {
  const raw = await readFile("data/parsed/records.json", "utf8").catch(() => "[]");
  const records = MeetingRecordsSchema.parse(JSON.parse(raw));
  await mkdir("public/company", { recursive: true });

  const miniSearch = new MiniSearch({
    fields: ["stockCode", "companyName", "giftName", "meetingPlace", "conveningReasons"],
    storeFields: ["stockCode", "companyName", "meetingDate", "giftName", "meetingPlace", "status"]
  });
  miniSearch.addAll(records.map((r, i) => ({ id: i, ...r, conveningReasons: r.conveningReasons.join(" ") })));
  await writeFile("public/search-index.json", JSON.stringify(miniSearch.toJSON()), "utf8");

  const rows = records.map(indexRow).join("\n");
  await writeFile(
    "public/index.html",
    `<!doctype html>
<html lang="zh-TW">
<head>
<meta charset="utf-8">
<title>115年股東會紀念品索引</title>
<style>
body{font-family:sans-serif;max-width:1100px;margin:1rem auto;padding:0 1rem;color:#222}
h1{font-size:1.4rem;color:#0066cc}
#q{width:100%;padding:8px;font-size:1rem;box-sizing:border-box;margin-bottom:1rem;border:1px solid #ccc;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:.9rem}
th{background:#0066cc;color:#fff;padding:6px 10px;text-align:left}
td{padding:5px 10px;border-top:1px solid #eee}
tr:hover td{background:#f5f8ff}
a{color:#0066cc;text-decoration:none}
.badge{display:inline-block;padding:1px 6px;border-radius:3px;font-size:.78rem}
.ok{background:#d4edda;color:#155724}.partial{background:#fff3cd;color:#856404}.failed{background:#f8d7da;color:#721c24}
</style>
</head>
<body>
<h1>115年（2026年）股東會紀念品索引</h1>
<input id="q" placeholder="搜尋代號 / 公司 / 紀念品 / 地點" />
<table id="tbl">
<thead><tr>
<th>代號</th><th>公司</th><th>開會日期</th><th>紀念品</th><th>開會地點</th><th>股務代理</th><th>所需股數</th><th>狀態</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
<script type="module">
import MiniSearch from 'https://cdn.jsdelivr.net/npm/minisearch@7/dist/es/index.js';
const resp = await fetch('./search-index.json');
const idx = MiniSearch.loadJSON(await resp.text(), {
  fields: ['stockCode','companyName','giftName','meetingPlace','conveningReasons'],
  storeFields: ['stockCode','companyName','meetingDate','giftName','meetingPlace','status']
});
const allRows = [...document.querySelectorAll('#tbl tbody tr')];
document.getElementById('q').addEventListener('input', e => {
  const q = e.target.value.trim();
  if (!q) { allRows.forEach(r => r.style.display=''); return; }
  const hits = new Set(idx.search(q, {prefix:true, fuzzy:0.2}).map(r => r.stockCode));
  allRows.forEach(r => {
    const code = r.querySelector('a')?.textContent ?? '';
    r.style.display = hits.has(code) ? '' : 'none';
  });
});
</script>
</body>
</html>`
  );

  for (const r of records) {
    await writeFile(`public/company/${r.stockCode}.html`, companyPage(r), "utf8");
  }

  console.log(`Built index.html and ${records.length} company pages in public/`);
}

main();
