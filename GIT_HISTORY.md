# Git 交付紀錄

## 維護原則

- `main` 是目前可部署的整合分支。
- 每次功能交付需包含程式、必要 migration、規格文件與驗證結果。
- 不提交 `dist/`、前端執行期 `config.js` 的私密值、Supabase service role key、LINE token 或資料庫連線字串。
- 已部署 migration 只能新增，不能改寫歷史檔案。

## 目前版本內容

Release date：2026-07-21。實際 commit hash 以 `git log -1 --oneline` 為準。

本次交付整合會員下單、付款與訂單歷程、管理後台工作台、熱門商品與營運報表、成本與實際採購總額、LINE 綁定及可靠通知佇列。

LINE 通知的狀態阻塞問題已在本版修正；完整成因、解法與驗收步驟見 [docs/PROBLEM_LOG.md](docs/PROBLEM_LOG.md)。

## 提交前檢查

```powershell
git diff --check
npm --prefix react-app run build
git status --short
```

如有 Edge Function 或 migration 變更，還需確認對應 Supabase 部署已完成，並記錄於提交訊息或變更說明。
