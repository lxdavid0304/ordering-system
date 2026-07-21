# 系統設計規格

## 邊界與角色

系統有三種責任範圍：會員、管理者與伺服器工作者。

| 角色 | 可執行內容 |
| --- | --- |
| 會員 | 管理自己的個人資料、收藏、付款方式、訂單與 LINE 通知偏好 |
| 管理者 | 查看所有訂單、更新訂單狀態、記錄付款、確認實際金額、維護商品與查看報表 |
| Edge Function | 代表伺服器驗證輸入、建立訂單、接收 LINE webhook、投遞與診斷通知 |

RLS 是資料存取的最後防線；前端路由保護只負責體驗，不能取代資料庫權限。

## 前端路由

| 路由 | 權限 | 用途 |
| --- | --- | --- |
| `/order` | 公開頁面，操作下單時要求會員登入 | 商品選購與建立訂單 |
| `/payment`、`/pending-order`、`/history` | 會員 | 付款方式、待處理訂單、歷史訂單 |
| `/favorites`、`/profile`、`/change-password` | 會員 | 個人偏好與帳號設定 |
| `/admin` | 管理者 | 訂單工作台與通知診斷 |
| `/admin/products` | 管理者 | 商品與成本設定 |
| `/admin/reports` | 管理者 | 營運報表 |
| `/admin/settings` | 管理者 | 營業設定 |

## 資料模型

### 訂單核心

- `orders`：訂單主檔、訂單狀態、交貨地點、總額、運費、利潤、已收訂金、已收尾款、報價與實際總額快照。
- `order_items`：訂購品項、數量、售價、成本、每單位運費與 `line_total`。
- `order_events`：管理操作與狀態轉換的稽核歷程。

`create_order` 與 `update_order_total` 負責總額一致性。商品庫商品的客戶運費為零；自填商品會依數量加上客戶運費。管理者可在採購完成時以 `admin_mark_order_ready_for_pickup` 設定實際總額，若金額改變必須填寫原因。

### 會員與商品

- `member_profiles`、`favorite_items`：會員基本資料與收藏。
- `popular_products`：商品名稱、規格、售價、成本、成本區間、運費、分類、供應連結與啟用狀態。
- `ordering_schedule`：台北時區的營業時段與常時開放設定。
- `admin_users`：管理者白名單。

### LINE 通知

- `member_line_bindings`：會員與 LINE user ID 的一對一綁定、通知開關、封鎖標記。
- `member_line_link_codes`：一次性連結碼。
- `line_notification_jobs`：通知 outbox，記錄狀態、嘗試次數、錯誤、下一次重試時間、處理 claim 與狀態快照。

## 訂單與付款規則

1. `create-order` 驗證登入身分、會員資料、營業時段、商品價格、庫存商品狀態與冪等鍵。
2. 總額大於 300 元時，初始狀態為 `pending_deposit`；否則為 `open`。
3. 管理者儲存訂金且金額符合應收訂金時，狀態轉為 `open`。
4. 管理者確認實際總額後，狀態轉為 `ready_pickup`；若實際金額不同，保留原報價與調整原因。
5. 已收款金額達實際總額時，狀態轉為 `fulfilled`。
6. 訂單狀態的合法順序由資料庫 RPC 驗證，避免前端直接寫入越級狀態。

## LINE 通知設計

```text
訂單狀態更新
  -> PostgreSQL trigger 寫入 line_notification_jobs 快照
  -> 後台呼叫 line-notify 並指定 target_status
  -> 工作者略過過時的 pending/failed/processing job
  -> claim job
  -> 驗證綁定與通知偏好
  -> LINE Messaging API push
  -> sent / failed / skipped，必要時依 backoff 重試
```

通知使用 `payload.to_status` 與金額快照產生內容，不讀取後續可能已變動的訂單狀態。管理者明確要求最新狀態時，舊的可處理通知會標記為 `skipped`，以避免舊 job 阻擋即時通知。

## Edge Function 合約

| Function | 呼叫者 | 責任 |
| --- | --- | --- |
| `create-order` | 會員前端 | 驗證與原子建立訂單，建立初始通知 job |
| `lookup-order` | 會員前端 | 安全查詢目前會員的訂單 |
| `line-webhook` | LINE 平台 | 驗證簽章、處理 follow/unfollow 與連結碼 |
| `line-notify` | 管理者前端或受信任工作者 | 寫入缺漏 job、處理佇列、投遞 LINE push |
| `notification-diagnostics` | 管理者前端 | 查詢單筆訂單 job、佇列與必要診斷資訊 |

## 資料庫變更策略

`supabase/migrations/` 是雲端資料庫的唯一增量變更來源。每支 migration 必須可安全重跑，並使用 `if exists`、`if not exists` 或明確的替換語意。已部署 migration 不得修改；修正要以新 migration 交付。

`sql/schema.sql` 保持與累積 migration 對齊，供全新資料庫或結構審查使用。既有資料庫只能套用未執行的 migration。
