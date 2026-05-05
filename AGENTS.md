## 專案目標
本專案將股東會紀念品與開會通知電子檔整理成可搜尋的靜態 HTML。

## 執行規則
- 使用 TypeScript。
- 優先使用 fetch + cheerio；只有需要點擊、新分頁或 JavaScript rendering 時才使用 Playwright。
- 不要過度請求來源網站。預設 concurrency <= 2，每次請求間隔至少 1 秒。
- 每筆資料必須保留 source URL、fetchedAt、parse status。
- PDF 解析失敗時，不可中斷整批任務，應標記 needs_review。
- 所有欄位必須通過 zod schema。
- 修改 parser 後必須執行 npm test。
- 修改 build/static UI 後必須執行 npm run build。
- 不要提交 data/raw/files 裡的大型 PDF。
