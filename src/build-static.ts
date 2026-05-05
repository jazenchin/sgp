import { readFile, mkdir, writeFile } from "node:fs/promises";
import MiniSearch from "minisearch";
import { MeetingRecordsSchema } from "./schema.js";

async function main() {
  const raw = await readFile("data/parsed/records.json", "utf8").catch(() => "[]");
  const records = MeetingRecordsSchema.parse(JSON.parse(raw));
  await mkdir("public/company", { recursive: true });

  const miniSearch = new MiniSearch({ fields: ["stockCode", "companyName", "giftName", "meetingPlace", "conveningReasons"], storeFields: ["stockCode", "companyName", "meetingDate", "giftName", "meetingPlace", "status"] });
  miniSearch.addAll(records.map((r, i) => ({ id: i, ...r, conveningReasons: r.conveningReasons.join(" ") })));

  await writeFile("public/search-index.json", JSON.stringify(miniSearch.toJSON()), "utf8");

  const rows = records.map((r) => `<tr><td><a href='./company/${r.stockCode}.html'>${r.stockCode}</a></td><td>${r.companyName}</td><td>${r.meetingDate ?? ""}</td><td>${r.giftName ?? ""}</td><td>${r.meetingPlace ?? ""}</td><td>${r.proxyAgent ?? ""}</td><td>${r.status}</td></tr>`).join("\n");

  await writeFile("public/index.html", `<!doctype html><html><head><meta charset='utf-8'><title>股東會索引</title></head><body><h1>股東會索引</h1><input id='q' placeholder='搜尋代號 / 公司 / 紀念品 / 地點 / 召集事由'/><table border='1'><thead><tr><th>代號</th><th>公司</th><th>日期</th><th>紀念品</th><th>地點</th><th>股務代理</th><th>狀態</th></tr></thead><tbody>${rows}</tbody></table></body></html>`);

  for (const r of records) {
    await writeFile(`public/company/${r.stockCode}.html`, `<!doctype html><html><head><meta charset='utf-8'><title>${r.stockCode} ${r.companyName}</title></head><body><h1>${r.stockCode} ${r.companyName}</h1><p>股東會日期: ${r.meetingDate ?? ""}</p><p>時間: ${r.meetingTime ?? ""}</p><p>地點: ${r.meetingPlace ?? ""}</p><p>紀念品: ${r.giftName ?? ""}</p><p>股務代理: ${r.proxyAgent ?? ""}</p><p>來源: <a href='${r.sourceWespaiUrl ?? "#"}'>Wespai</a> <a href='${r.noticeFileUrl ?? "#"}'>Notice</a></p><p>解析狀態: ${r.status} / needsReview=${r.needsReview}</p></body></html>`);
  }
}

main();
