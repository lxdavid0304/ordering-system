# 系統設計規格

## 邊界與角色

系統有三種責任範圍：會員、管理者與伺服器工作者。

| 角色 | 可執行內容 |
| --- | --- |
| 會員 | 管理自己的個人資料、收藏、付款方式、訂單與 LINE 通知偏好 |
| 管理者 | 查看所有訂單、更新訂單狀態、記錄付款、確認實際金額、維護商品與查看報表 |
| Edge Function | 代表伺服器驗證輸入、建立訂單、接收 LINE webhook、投遞與診斷通知 |

RLS 是資料存取的最後防線；前端路由保護只負責體驗，不能取代資料庫權限。

## 響應式介面規格

- `761px` 以上使用桌面工作流：首頁保留三步驟引導、熱門商品與訂單工作區的既有配置。
- `760px` 以下使用手機工作流：熱門商品、小型交貨點選擇器、緊湊商品列與固定訂單摘要依序排列；會員功能收合在側邊選單。
- 手機版樣式必須以 media query 隔離，不得覆寫桌面版的引導步驟、欄位配置或管理介面。

## 前端路由

| 路由 | 權限 | 用途 |
| --- | --- | --- |
| `/order` | 公開頁面，操作下單時要求會員登入 | 商品選購與建立訂單 |
| `/payment`、`/pending-order`、`/history` | 會員 | 付款方式、待處理訂單、歷史訂單 |
| `/favorites`、`/profile`、`/change-password` | 會員 | 個人偏好與帳號設定 |
| `/flash-food` | 會員 | 快閃熱食活動、交貨地點選擇與本次點餐 |
| `/admin` | 管理者 | 訂單工作台與通知診斷 |
| `/admin/products` | 管理者 | 商品與成本設定 |
| `/admin/reports` | 管理者 | 營運報表 |
| `/admin/settings` | 管理者 | 營業設定 |
| `/admin/flash-food` | 管理者 | 快閃熱食開團、採買彙總、依地點交貨通知與歷史紀錄 |

## 資料模型

### 訂單核心

- `orders`：訂單主檔、訂單狀態、交貨地點、總額、運費、利潤、已收訂金、已收尾款、報價與實際總額快照。
- `order_items`：訂購品項、數量、售價、成本、每單位運費與 `line_total`。
- `order_events`：管理操作與狀態轉換的稽核歷程。

取消訂單使用 `admin_delete_order(p_order_id uuid)`，為 `security definer` RPC，先以 `is_admin_user()` 驗證呼叫者。資料庫外鍵的 cascade 會一併刪除該訂單的品項、操作歷程與 LINE 通知工作；前端在送出前必須顯示不可復原的二次確認。

`create_order` 與 `update_order_total` 負責總額一致性。熱門商品的會員售價已含運費，客戶運費為零；自填商品會依數量加上每件 20 元客戶運費。管理者可在採購完成時以 `admin_mark_order_ready_for_pickup` 設定實際總額，若金額改變必須填寫原因。

`delivery_location_notification_batches` 記錄一般代購各地點的一次交貨通知批次；`line_notification_jobs.delivery_notification_batch_id` 將工作與批次關聯，以確保同一會員同一批次只收到一則。`flash_food_pickup_notices` 則保存快閃熱食各活動、各交貨地點的通知時間與管理者。

### 會員與商品

- `member_profiles`、`favorite_items`：會員基本資料與收藏。
- `popular_products`：商品名稱、規格、售價、成本、成本區間、運費、分類、供應連結與啟用狀態。
- `ordering_schedule`：台北時區的營業時段與常時開放設定。
- `admin_users`：管理者白名單。

### LINE 通知

- `member_line_bindings`：會員與 LINE user ID 的一對一綁定、通知開關、封鎖標記。
- `member_line_link_codes`：一次性連結碼。
- `line_notification_jobs`：通知 outbox，記錄狀態、嘗試次數、錯誤、下一次重試時間、處理 claim 與狀態快照。
- `flash_food_notification_jobs`：快閃熱食的開團、取消、點餐異動與依地點取餐通知 outbox。

## 訂單與付款規則

1. `create-order` 驗證登入身分、會員資料、營業時段、商品價格、庫存商品狀態與冪等鍵。
2. 總額大於 300 元時，初始狀態為 `pending_deposit`；否則為 `open`。
3. 管理者儲存訂金且金額符合應收訂金時，狀態轉為 `open`。
4. 管理者確認實際總額後，狀態轉為 `ready_pickup`；若實際金額不同，保留原報價與調整原因。此步驟不發送 LINE。
5. 管理者在交貨地點工作區設定時間後，才對該地點所有 `ready_pickup` 會員建立一次交貨通知。
6. 已收款金額達實際總額時，狀態轉為 `fulfilled`；批次完成只改狀態，個別訂單仍可進入明細調整金額與收款。
7. 訂單狀態的合法順序由資料庫 RPC 驗證，避免前端直接寫入越級狀態。

## LINE 通知設計

```text
訂金／採買進行中狀態更新
  -> PostgreSQL trigger 寫入 line_notification_jobs 快照
  -> 後台呼叫 line-notify 並指定 target_status
  -> 工作者略過過時的 pending/failed/processing job
  -> claim job
  -> 驗證綁定與通知偏好
  -> LINE Messaging API push
  -> sent / failed / skipped，必要時依 backoff 重試
```

`ready_pickup` 不走上述狀態通知。交貨通知改為：管理者選擇地點與時間 → 只挑選該地點 `ready_pickup` 訂單 → 依會員去重 → 建立交貨批次與通知 job → `line-notify` 送出。通知使用 `payload.to_status` 或交貨批次快照，不讀取後續可能已變動的訂單狀態。管理者明確要求最新狀態時，舊的可處理通知會標記為 `skipped`，以避免舊 job 阻擋即時通知。

快閃熱食使用獨立的 `flash_food_notification_jobs` 與 `flash-food-notify`。活動到 `open_at` 後才排入開團通知；截止後管理者先看商品彙總，再按四個交貨地點各自核對訂單、設定時間與選填訊息。每次地點通知以活動、地點與會員去重。

## Edge Function 合約

| Function | 呼叫者 | 責任 |
| --- | --- | --- |
| `create-order` | 會員前端 | 驗證與原子建立訂單，建立初始通知 job |
| `lookup-order` | 會員前端 | 安全查詢目前會員的訂單 |
| `line-webhook` | LINE 平台 | 驗證簽章、處理 follow/unfollow 與連結碼 |
| `line-notify` | 管理者前端或受信任工作者 | 寫入缺漏 job、處理佇列、投遞 LINE push |
| `flash-food-notify` | 管理者前端或排程工作者 | 處理快閃熱食開團、點餐與依地點取餐通知 |
| `notification-diagnostics` | 管理者前端 | 查詢單筆訂單 job、佇列與必要診斷資訊 |

## 資料庫變更策略

`supabase/migrations/` 是雲端資料庫的唯一增量變更來源。每支 migration 必須可安全重跑，並使用 `if exists`、`if not exists` 或明確的替換語意。已部署 migration 不得修改；修正要以新 migration 交付。若因緊急情況在 SQL Editor 手動套用，必須先驗證物件、在同一變更窗口補登 `supabase_migrations.schema_migrations`，並再次比對本機版本。

`sql/schema.sql` 保持與累積 migration 對齊，供全新資料庫或結構審查使用。既有資料庫只能套用未執行的 migration。
