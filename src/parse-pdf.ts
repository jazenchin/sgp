import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import pdf from "pdf-parse";

function firstMatch(text: string, regex: RegExp): string | undefined {
  return text.match(regex)?.[1]?.trim();
}

export async function parsePdfFile(pdfPath: string) {
  try {
    const buf = await readFile(pdfPath);
    const result = await pdf(buf);
    const text = result.text.replace(/\r/g, "");
    const code = pdfPath.match(/(\d{4,6})/)?.[1] ?? "unknown";
    await mkdir("data/raw/text", { recursive: true });
    await writeFile(`data/raw/text/${code}.txt`, text, "utf8");

    return {
      meetingDate: firstMatch(text, /開會日期[：:\s]+([^\n]+)/),
      meetingTime: firstMatch(text, /開會時間[：:\s]+([^\n]+)/),
      meetingPlace: firstMatch(text, /開會地點[：:\s]+([^\n]+)/),
      eVoteStart: firstMatch(text, /電子投票[^\n]*自[：:\s]*([^\n]+)/),
      hasDirectorElection: /選舉董事|改選董事|選舉董監/.test(text),
      conveningReasons: text.includes("召集事由") ? ["召集事由已抽取，請人工確認"] : [],
      acknowledgements: text.includes("承認事項") ? ["承認事項已抽取，請人工確認"] : [],
      discussionItems: text.includes("討論事項") ? ["討論事項已抽取，請人工確認"] : [],
      electionItems: /選舉事項|改選/.test(text) ? ["選舉事項已抽取，請人工確認"] : [],
      rawTextHash: createHash("sha256").update(text).digest("hex"),
      needsReview: true
    };
  } catch {
    return { needsReview: true };
  }
}
