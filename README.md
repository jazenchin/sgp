# stock-meeting-index

股東會紀念品與開會通知彙整資料管線（MVP）。

## 本機執行

```bash
npm ci
npx playwright install --with-deps chromium
npm run crawl -- --limit 10
npm test
npm run build
```

## 產物

- `data/parsed/records.json`
- `public/index.html`
- `public/company/*.html`
- `public/search-index.json`

## 部署

使用 `.github/workflows/update.yml`，可手動觸發或每日台北 07:00 自動執行並部署到 GitHub Pages。

## 調整 schema

編輯 `src/schema.ts` 的 `MeetingRecordSchema`，並同步調整爬蟲與 build 模組欄位映射，最後執行 `npm test`。


## PDF 解析模式

預設 `PDF_PARSE_MODE=cli`，流程會把 prompt 寫到 `data/prompts/*.prompt.txt`，再呼叫本地 CLI（預設 `codex exec --json @prompt.txt`）取得 JSON。

可改為 API 模式：`PDF_PARSE_MODE=api` 並設定 `LLM_API_ENDPOINT`、`LLM_API_KEY`。
