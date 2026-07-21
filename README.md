# 代購營運台

校園代購訂購與營運管理系統。會員可建立訂單、管理個人資料與 LINE 通知設定；管理者可處理付款、採購、實際金額、交貨與營運報表。

本文件是目前版本的操作與部署規格。架構細節請見 [DESIGN.md](DESIGN.md)，已處理問題與預防措施請見 [docs/PROBLEM_LOG.md](docs/PROBLEM_LOG.md)。

## 功能範圍

- 會員註冊、登入、個人資料、密碼重設與收藏商品。
- 商品下單、訂單草稿、付款方式選擇、待處理訂單與歷史訂單。
- 管理後台訂單篩選、批次狀態更新、訂金與尾款紀錄、實際採購總額、內部備註與操作歷程。
- 熱門商品管理：售價、成本、規格、分類、供應連結、啟用狀態與成本區間。
- 營運報表：今日、週、月、全期間的訂單、收款、利潤與趨勢。
- LINE 官方帳號綁定、通知開關、訂單狀態推播、佇列診斷與失敗重試。

## 訂單狀態

```text
pending_deposit  待確認訂金
       |
       | 管理者確認訂金，或低於門檻的訂單直接開啟
       v
open             採買進行中
       |
       | 管理者確認商品與實際總額
       v
ready_pickup     待取貨
       |
       | 尾款付清
       v
fulfilled        已完成
       |
       v
archived         歷史紀錄
```

狀態更新會建立 LINE 通知工作。通知內容使用狀態異動當下的訂單快照，包含交貨地點、總額、已付訂金、尾款與價格異動資訊。

## 技術架構

| 層級 | 技術與責任 |
| --- | --- |
| 前端 | React 18、Vite、React Router、Supabase JS、Lucide |
| 身分與資料 | Supabase Auth、PostgreSQL、RLS、RPC、Trigger |
| 後端工作 | Supabase Edge Functions（Deno） |
| 通知 | LINE Messaging API push message 與資料庫通知佇列 |

主要目錄：

```text
react-app/                         React 前端
supabase/functions/create-order/   安全建立訂單
supabase/functions/lookup-order/   訂單查詢
supabase/functions/line-webhook/   LINE follow/message webhook
supabase/functions/line-notify/    LINE 通知佇列工作者
supabase/functions/notification-diagnostics/
                                   管理者通知診斷
supabase/migrations/               依時間排序的資料庫變更
sql/schema.sql                     完整 schema 參考與新環境初始化來源
docs/PROBLEM_LOG.md                已處理問題與預防措施
```

## 本機啟動

前置需求：Node.js 18+、npm、Supabase CLI。Edge Function 的本機執行另需 Docker Desktop 的 Linux engine。

```powershell
npm --prefix react-app install
npm --prefix react-app run dev
```

前端預設網址為 `http://127.0.0.1:5173`。

在 `react-app/public/config.js` 設定公開連線資訊。可從 `config.example.js` 複製：

```javascript
window.APP_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-or-publishable-key",
  ADMIN_DEFAULT_EMAIL: "admin@example.com",
};
```

不要把 service role key、LINE channel secret、LINE access token 或資料庫密碼放進前端設定或提交到 Git。

## 資料庫與函式部署

### 新專案

以 migration 建立資料庫，避免同時重複執行完整 schema 與所有 migration：

```powershell
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

若 CLI 提示缺少資料庫密碼，先設定 `SUPABASE_DB_PASSWORD`，或在 Supabase Dashboard 的 SQL Editor 依序套用尚未執行的 migration。`sql/schema.sql` 是完整參考與初始化來源，不是既有雲端資料庫的重複套用腳本。

### Edge Function

```powershell
supabase functions deploy create-order
supabase functions deploy lookup-order
supabase functions deploy line-webhook
supabase functions deploy line-notify
supabase functions deploy notification-diagnostics
```

在 Supabase Edge Function secrets 設定下列伺服器端值：

```text
LINE_CHANNEL_ACCESS_TOKEN
LINE_CHANNEL_SECRET
LINE_NOTIFICATION_WORKER_TOKEN
SUPABASE_DB_URL
```

`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY` 由 Supabase 執行環境提供；不得傳給瀏覽器。LINE webhook 必須設定為 `line-webhook` 的公開 URL，並在 LINE Developers Console 啟用 webhook。

### 管理者設定

登入後，將使用者 UUID 加入 `public.admin_users`：

```sql
insert into public.admin_users (user_id)
values ('<admin-user-uuid>');
```

## 驗證

```powershell
npm --prefix react-app run build
```

受控的遠端下單 E2E 測試必須明確設定測試環境變數，詳見 [react-app/scripts/e2e/README.md](react-app/scripts/e2e/README.md)。不要對正式會員或正式 LINE 帳號直接執行測試。

LINE 狀態通知的手動驗收流程：

1. 建立一筆測試訂單並確認已綁定 LINE。
2. 管理後台確認訂金，驗證「採買進行中」。
3. 設定實際總額並標記商品買齊，驗證「待取貨」及價格異動資訊。
4. 儲存尾款，驗證「已完成」。
5. 在訂單明細的「LINE 通知」區塊確認 job 為 `sent`；若失敗，查看診斷資訊與錯誤訊息。

## Git 交付規則

- `dist/`、`react-app/dist/` 是可重建的忽略建置產物，不提交。
- 任何 schema 改動均新增一支遞增時間戳的 migration；不得重寫已部署 migration。
- Edge Function、前端服務與 migration 要在同一個提交中交付，並同步更新本 README、設計文件與問題紀錄。
- 提交前至少執行 `npm --prefix react-app run build` 與 `git diff --check`。
