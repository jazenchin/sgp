import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pdf from "pdf-parse";

const execFileAsync = promisify(execFile);

type ParseMode = "cli" | "api";

const EXTRACTION_PROMPT = `你是一個專門解析台灣上市櫃公司股東會通知書的資訊抽取器。你的任務是從輸入的 PDF 文字、OCR 文字或公告內容中，抽取「股東會紀念品」相關資訊，並輸出固定格式 JSON。 請只輸出 JSON，不要輸出任何解釋、Markdown、註解或多餘文字。 目標資訊： 1. 多少股數可領 2. 電子投票的領取時間 3. 領取地點 4. 領取時需準備的東西 輸出規則： - 必須輸出合法 JSON。 - 不得使用 markdown code block。 - 不確定或文件未提及的欄位請填 null、空陣列 []，或在 extraction.warnings 說明。 - 日期請盡量轉成西元 YYYY-MM-DD。 - 若原文為民國年，請同時保留 original_text。 - 股數請轉成數字，例如「一仟股」輸出 1000。 - 若有「未滿 1,000 股但電子投票或親自出席可領」等例外規則，必須保留。 - 若有「非電子投票者不得領取」、「委託代理出席限制」、「數量不足得以等值商品替代」等限制，也必須保留。 - 不要自行推論文件沒有寫的資訊。 - 若同一欄位有多個可能答案，請全部列出，不要只保留一個。 - evidence_text 請填入支持該欄位的原文片段；若沒有明確原文，填 null。 - confidence 為 0 到 1 之間的小數，代表抽取信心。 請依照以下 JSON schema 輸出： { "company": { "stock_code": null, "company_name": null }, "meeting": { "year_tw": null, "meeting_type": null, "meeting_date": { "date": null, "original_text": null } }, "souvenir": { "item": null, "substitution_allowed": null, "substitution_note": null, "evidence_text": null }, "eligibility": { "minimum_shares_general": null, "shares_unit": "股", "can_under_1000_shares_collect": null, "under_1000_shares_rule": { "eligible": null, "conditions": [], "not_eligible_if": [], "evidence_text": null }, "proxy_collection_rule": { "allowed": null, "minimum_shares": null, "conditions": [], "restrictions": [], "evidence_text": null }, "other_rules": [], "evidence_text": null }, "collection_methods": [ { "method": null, "method_label": null, "eligible": null, "collection_period": { "start_date": null, "end_date": null, "calendar": "gregorian", "original_text": null, "evidence_text": null }, "location": { "name": null, "address": null, "business_hours": null, "phone": null, "evidence_text": null }, "required_documents": [ { "type": null, "description": null, "evidence_text": null } ], "restrictions": [], "notes": [], "evidence_text": null } ], "answer_summary": { "shares_required_to_collect": null, "electronic_voting_collection_time": null, "collection_location": null, "required_items": [] }, "source": { "url": null, "document_type": null, "retrieved_date": null }, "extraction": { "confidence": null, "warnings": [] } } collection_methods.method 請優先使用以下固定值： - "electronic_voting": 電子投票領取 - "onsite_attendance": 股東會現場領取 - "proxy_collection": 委託代理領取 - "shareholder_service_agent": 股務代理機構領取 - "mail_collection": 郵寄領取 - "post_meeting_collection": 會後領取 - "not_available": 不發放或不可領取 - "unknown": 文件有提到但無法判定方式 required_documents.type 請優先使用以下固定值： - "attendance_card": 出席通知書或出席簽到卡 - "signature_or_seal": 簽名或蓋章 - "id_card": 身分證明文件 - "seal": 印章 - "evote_result_page": 電子投票議案表決情形頁面 - "proxy_form": 委託書 - "shareholder_account_number": 股東戶號 - "other": 其他 - "unknown": 無法判定 answer_summary 是給使用者看的精簡答案，請根據抽取結果填入： - shares_required_to_collect：用一句話回答「多少股數可領」 - electronic_voting_collection_time：用一句話回答「電子投票的領取時間」 - collection_location：用一句話回答「領取地點」 - required_items：用陣列列出「領取時需準備的東西」 請開始解析以下內容： {{DOCUMENT_TEXT_OR_OCR_CONTENT}}`;

function buildPrompt(documentText: string): string {
  return EXTRACTION_PROMPT.replace("{{DOCUMENT_TEXT_OR_OCR_CONTENT}}", documentText);
}

async function parseByCli(promptPath: string): Promise<unknown> {
  const outputPath = promptPath.replace(/\.prompt\.txt$/, ".llm.json");
  const cmd = process.env.LLM_CLI_COMMAND ?? "codex";
  const args = (process.env.LLM_CLI_ARGS ?? "exec --json").split(" ").concat([`@${promptPath}`]);
  const { stdout } = await execFileAsync(cmd, args, { maxBuffer: 20 * 1024 * 1024 });
  await writeFile(outputPath, stdout, "utf8");
  return JSON.parse(stdout);
}

async function parseByApi(prompt: string): Promise<unknown> {
  const endpoint = process.env.LLM_API_ENDPOINT;
  const apiKey = process.env.LLM_API_KEY;
  if (!endpoint || !apiKey) throw new Error("LLM API endpoint/key missing");
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ prompt })
  });
  if (!res.ok) throw new Error(`LLM API failed: ${res.status}`);
  const data = await res.json();
  return typeof data === "string" ? JSON.parse(data) : data;
}

export async function parsePdfFile(pdfPath: string, mode: ParseMode = (process.env.PDF_PARSE_MODE as ParseMode) || "cli") {
  try {
    const buf = await readFile(pdfPath);
    const result = await pdf(buf);
    const text = result.text.replace(/\r/g, "");
    const code = pdfPath.match(/(\d{4,6})/)?.[1] ?? "unknown";

    await mkdir("data/raw/text", { recursive: true });
    await mkdir("data/prompts", { recursive: true });

    const textPath = `data/raw/text/${code}.txt`;
    const promptPath = path.join("data/prompts", `${code}.prompt.txt`);
    await writeFile(textPath, text, "utf8");

    const prompt = buildPrompt(text);
    await writeFile(promptPath, prompt, "utf8");

    let llmExtraction: unknown = null;
    try {
      llmExtraction = mode === "api" ? await parseByApi(prompt) : await parseByCli(promptPath);
    } catch (error) {
      llmExtraction = { extraction: { warnings: [`LLM parse failed: ${String(error)}`], confidence: 0 } };
    }

    return {
      llmExtraction,
      rawTextHash: createHash("sha256").update(text).digest("hex"),
      needsReview: true
    };
  } catch {
    return { needsReview: true };
  }
}
