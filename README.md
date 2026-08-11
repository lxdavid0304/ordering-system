# 代購營運台

校園代購訂購與營運管理系統。會員可建立訂單、管理個人資料與 LINE 通知設定；管理者可處理付款、採購、實際金額、交貨與營運報表。

本文件是目前版本的操作與部署規格。架構細節請見 [DESIGN.md](DESIGN.md)，已處理問題與預防措施請見 [docs/PROBLEM_LOG.md](docs/PROBLEM_LOG.md)。

## 功能範圍

- 會員註冊、登入、個人資料、密碼重設與收藏商品。
- 商品下單、訂單草稿、付款方式選擇、待處理訂單與歷史訂單。
- 管理後台訂單篩選、批次狀態更新、訂金與尾款紀錄、實際採購總額、內部備註與操作歷程。
- 管理者可在訂單明細中刪除已取消的訂單；操作需二次確認，且僅由資料庫的管理者 RPC 執行。
- 熱門商品管理：售價、成本、規格、分類、供應連結、啟用狀態與成本區間。
- 營運報表：今日、週、月、全期間的訂單、收款、利潤與趨勢。
- LINE 官方帳號綁定、通知開關、下單完成／訂金／金額更正／交貨推播、佇列診斷與失敗重試。
- 一般代購可依四個交貨地點整理待取貨訂單；商品買齊時不立即通知，管理者設定各地點交貨時間後才群發一次。
- 快閃熱食可在截止後彙總採買清單，並依四個交貨地點分別核對訂單、設定交貨時間與補充訊息後通知會員。

## 2026-08-11 現行營運規格

- 手機版訂購頁改為單欄、緊湊的採買流程：交貨點、商品卡、購物清單與會員選單皆針對窄螢幕重排；桌面版維持原有的雙欄工作流與三步驟引導。
- 首屏文案統一為「把想要的商品放進清單，採買的事交給我們。」「不必出門，也能把日常補貨安排得剛剛好。」
- 後台訂單明細新增硬刪除操作。刪除會連帶移除 `order_items`、`order_events` 與 LINE 通知 job；只適用於確定取消且不需保留訂單紀錄的情況。
- 熱門商品的會員售價已含運費；只有自填商品按數量每件加收 20 元。快閃熱食品項則以「現場價加每件 20 元」形成會員看到的含運價，訂單總額只顯示一次。
- 快閃熱食手機後台採收合式工作台：採買清單預設摘要、交貨地點為 2×2 小卡，選定地點後才展開名單或通知設定；桌面版保留原本完整工作流。每個地點獨立設定交貨時間，同會員在同一地點本次只會收到一則通知。

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

LINE 通知不再綁定一般狀態異動；只有建立訂單時會立即送出一次「代購訂單狀態更新」快照。總額超過 300 元顯示「待確認訂金」，300 元以下直接顯示「採買進行中」，內容包含商品、交貨地點與訂單金額。確認訂金後再送一則「訂單總額／訂金金額」通知；`ready_pickup` 是內部「已加入待交貨清單」的里程碑，不立即發送。若採購完成時實際總額有異動，管理者可在手機版訂單明細補傳一則「原訂單總額／更正後總額／訂金」通知。管理者在訂單管理選定交貨地點與交貨時間後，才對該地點 `ready_pickup` 會員群發一次交貨通知；有價格異動時，通知依序帶入調整後訂單總額、訂金與尾款快照。

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
supabase/functions/flash-food-notify/
                                    快閃熱食通知佇列工作者
supabase/functions/notification-diagnostics/
                                   管理者通知診斷
supabase/migrations/               唯一的、依時間排序的資料庫變更與初始化來源
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

若 CLI 提示缺少資料庫密碼，先設定 `SUPABASE_DB_PASSWORD`。只有在先確認現有物件與資料相容時，才能透過 Supabase Dashboard 的 SQL Editor 手動套用 migration；手動成功後也必須立即補齊 `supabase_migrations.schema_migrations` 履歷，不能只讓功能物件存在。不要以可變的 schema 快照建立或修正資料庫，必須從完整 migration 序列初始化。

截至 2026-08-12，遠端 migration 履歷已同步到 `20260812010000_order_created_line_notifications.sql`，且 `create-order`、`line-notify` 已部署。一般代購下單會建立一次性的 `order_created` 通知快照：總額超過 300 元顯示「待確認訂金」，其餘顯示「採買進行中」；通知內容包含商品、交貨地點與訂單金額，不會重啟舊的狀態自動通知。

### Edge Function

```powershell
supabase functions deploy create-order
supabase functions deploy lookup-order
supabase functions deploy line-webhook
supabase functions deploy line-notify
supabase functions deploy flash-food-notify
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

LINE 會員通知的手動驗收流程：

1. 建立一筆已綁定 LINE 的測試訂單：總額超過 300 元時，驗證立即收到「待確認訂金」的下單完成通知；300 元以下時，驗證立即收到「採買進行中」通知，兩者都要包含商品、交貨地點與訂單金額。
2. 管理後台確認訂金，驗證會員只收到一則含訂單總額與訂金金額的通知。
3. 設定相同實際總額並按「商品已買齊，加入待交貨清單」，驗證狀態成為 `ready_pickup` 且沒有新的通知。
4. 另測試調整實際總額：加入待交貨清單後，以手機版訂單明細按「補傳金額更正通知」，確認只收到一則含原總額、更正後總額與訂金的通知。
5. 在訂單管理選擇交貨地點、設定交貨時間，確認只通知該地點 `ready_pickup` 的會員；有價格異動時，通知須依序含調整後總額、訂金與尾款，同會員多筆訂單只收到一則。
6. 儲存尾款或批次確認尾款後，驗證訂單成為「已完成」，且不會建立完成狀態通知。
7. 快閃熱食截止後，核對商品彙總、依地點名單與交貨通知；確認可選填的群發訊息會帶入該地點 LINE 通知。

## Git 交付規則

- `dist/`、`react-app/dist/` 是可重建的忽略建置產物，不提交。
- 任何 schema 改動均新增一支遞增時間戳的 migration；不得重寫已部署 migration。
- Edge Function、前端服務與 migration 要在同一個提交中交付，並同步更新本 README、設計文件與問題紀錄。
- 提交前至少執行 `npm --prefix react-app run build` 與 `git diff --check`。
