# 訂購系統 (Ordering System)

一個為校園或社區情境設計的線上訂購平台，提供會員下單、訂單管理、開放時段控制等完整功能。系統採用 React + Supabase 架構，具備自動化業務邏輯處理、權限控制與安全防護。

## 📋 目錄

- [功能特色](#功能特色)
- [技術棧](#技術棧)
- [專案結構](#專案結構)
- [快速開始](#快速開始)
- [配置說明](#配置說明)
- [開發指令](#開發指令)
- [部署指南](#部署指南)
- [資料庫結構](#資料庫結構)
- [主要功能](#主要功能)
- [安全性](#安全性)

## 🚀 功能特色

### 使用者功能
- ✅ **線上訂購**：直覺的商品清單輸入介面，支援多項商品同時訂購
- 📍 **地址選擇**：支援多個運送地點（明德樓、據德樓、蘊德樓、機車停車場）
- 💾 **草稿儲存**：自動儲存未完成的訂單，避免資料遺失
- 🔄 **重複下單**：一鍵重複歷史訂單，常用商品快速下單
- 💰 **自動價格提示**：根據歷史紀錄自動顯示上次的商品價格
- 📜 **訂單歷史**：查看所有歷史訂單與詳細資訊
- 👤 **個人資料管理**：編輯姓名、帳號、Email、手機等資訊

### 管理員功能
- 📊 **訂單管理**：集中化的訂單後台，支援多維度篩選（狀態、地點、年月）
- ✏️ **訂單編輯**：修改訂單狀態、新增管理員備註
- 🔄 **批次操作**：一次處理多筆訂單的狀態變更
- 🕐 **開放時段控制**：彈性設定訂購開放時間，可選擇永遠開放或指定星期與時段
- 💵 **訂金管理**：自動標記需確認訂金的訂單（總額 > 300 元）
- 📈 **分頁顯示**：支援大量訂單的效能優化顯示

### 系統功能
- 🔐 **認證授權**：Supabase Auth 整合，支援帳號/Email 登入與 GitHub OAuth（管理員）
- 🛡️ **權限控制**：Row Level Security (RLS) 確保資料安全，會員只能查看自己的訂單
- 🔁 **冪等性保證**：防止重複送出訂單，確保資料一致性
- ⚡ **自動計算**：資料庫 Trigger 自動計算訂單總額與項目小計
- 📅 **批次分組**：自動按週（ISO week format）分組訂單，方便管理
- ⏰ **時區處理**：正確處理台灣時區（Asia/Taipei）的開放時段判斷

## 🛠️ 技術棧

### 前端
- **框架**：React 18.3.1
- **建構工具**：Vite 5.0.0
- **路由**：React Router DOM 6.x
- **HTTP 客戶端**：@supabase/supabase-js 2.x
- **UI**：原生 CSS
- **狀態管理**：React Context API

### 後端
- **BaaS 平台**：Supabase
  - PostgreSQL 資料庫
  - Supabase Auth (JWT)
  - Edge Functions (Deno)
  - Row Level Security
- **API**：RESTful Edge Functions

### 資料庫
- **PostgreSQL 15+**
- **PL/pgSQL**：Stored Procedures
- **Triggers**：自動化處理
- **RLS**：行級安全控制

## 📁 專案結構

```
訂購系統/
├── react-app/                           # React 前端
│   ├── src/
│   │   ├── components/                  # 可重用元件
│   │   ├── context/                     # Context API
│   │   ├── lib/                         # 核心函式庫
│   │   ├── pages/                       # 頁面元件
│   │   ├── services/                    # API 服務層
│   │   ├── styles/                      # CSS 樣式
│   │   ├── utils/                       # 工具函式
│   │   ├── App.jsx                      # 路由定義
│   │   └── main.jsx                     # 應用入口
│   ├── public/
│   │   ├── config.example.js            # 配置範例
│   │   ├── config.js                    # 執行期配置
│   │   └── _redirects                   # SPA fallback
│   └── package.json
├── supabase/                            # Supabase 配置
│   └── functions/
│       ├── create-order/index.ts        # 訂單建立 API
│       └── lookup-order/index.ts        # 訂單查詢 API
├── sql/
│   ├── schema.sql                       # 完整資料庫結構
│   └── edge-function.sql                # Edge Function SQL
├── DESIGN.md                            # 系統設計文件
├── package.json                         # Workspace 腳本
└── README.md
```

## 🚦 快速開始

### 前置需求

- Node.js 18+
- npm 或 yarn
- Supabase 帳號

### 安裝與設定

**1. Clone 專案**

```bash
git clone <repository-url>
cd 訂購系統
```

**2. 安裝依賴**

```bash
npm run install:react
```

**3. 設定 Supabase 資料庫**

在 Supabase SQL Editor 執行 [`sql/schema.sql`](sql/schema.sql)

**4. 部署 Edge Functions**

```bash
npm install -g supabase
supabase login
supabase link --project-ref <your-project-ref>
supabase functions deploy create-order
supabase functions deploy lookup-order
```

**5. 配置前端**

```bash
cp react-app/public/config.example.js react-app/public/config.js
```

編輯 [`config.js`](react-app/public/config.js)：

```javascript
window.APP_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key",
  ADMIN_DEFAULT_EMAIL: "admin@example.com",
};
```

**6. 啟動開發伺服器**

```bash
npm run dev
```

訪問 http://localhost:5173

### 設定管理員帳號

```sql
-- 在 Supabase SQL Editor 執行
INSERT INTO public.admin_users (user_id)
VALUES ('<user-uuid>');
```

## ⚙️ 配置說明

### 配置項目

| 配置項 | 說明 | 必填 |
|--------|------|------|
| `SUPABASE_URL` | Supabase 專案 URL | ✅ |
| `SUPABASE_ANON_KEY` | Supabase 匿名金鑰 | ✅ |
| `ADMIN_DEFAULT_EMAIL` | 管理員預設 Email | ❌ |

### 執行期配置

系統使用執行期配置而非環境變數，優點：
- ✅ 單一建構產出可用於多個環境
- ✅ 無需重新建構即可切換環境
- ✅ 配置變更立即生效

## 💻 開發指令

| 指令 | 說明 |
|------|------|
| `npm run install:react` | 安裝 React 應用依賴 |
| `npm run dev` | 啟動開發伺服器（HMR） |
| `npm run build` | 建構到 `dist/` |
| `npm run preview` | 預覽建構結果 |

## 🌐 部署指南

### 前端建構

```bash
npm run build
```

產出：`dist/` 目錄

### Netlify 部署

**設定**：
- Build command: `npm run build`
- Publish directory: `dist`

**SPA 路由**：系統已包含 [`_redirects`](react-app/public/_redirects) 檔案

```
/*    /index.html   200
```

### Supabase 部署

```bash
supabase functions deploy create-order
supabase functions deploy lookup-order
```

## 🗄️ 資料庫結構

### 資料表概覽

| 表名 | 說明 | 主要欄位 |
|------|------|----------|
| `orders` | 訂單主表 | id, user_id, total_amount, status, batch_id |
| `order_items` | 訂單項目 | order_id, product_name, unit_price, quantity |
| `member_profiles` | 會員資料 | user_id, full_name, account, email, real_phone |
| `favorite_items` | 常用商品 | user_id, product_name, unit_price |
| `ordering_schedule` | 開放時段 | open_day, open_hour, is_always_open |
| `admin_users` | 管理員列表 | user_id |

### 訂單狀態

| 狀態 | 說明 | 觸發條件 |
|------|------|----------|
| `pending_deposit` | 待確認訂金 | 訂單總額 > 300 元 |
| `open` | 未完成 | 總額 <= 300 或管理員已確認訂金 |
| `fulfilled` | 已完成 | 管理員標記完成 |

### RPC 函式

#### `create_order()` - 建立訂單
- **功能**：原子性建立訂單與項目
- **特性**：冪等性、自動計算總額、自動判斷狀態
- **權限**：僅 service_role 可執行

#### `ordering_open_now()` - 檢查開放時段
- **功能**：檢查當前時間是否可下單
- **時區**：Asia/Taipei
- **權限**：所有人可執行

#### `is_admin_user()` - 檢查管理員
- **功能**：驗證當前使用者是否為管理員
- **用途**：RLS 政策判斷
- **權限**：所有認證使用者可執行

### 資料庫觸發器

| Trigger | 觸發時機 | 功能 |
|---------|----------|------|
| `set_line_total_before_change` | BEFORE INSERT/UPDATE on order_items | 計算 line_total |
| `update_order_total_after_change` | AFTER INSERT/UPDATE/DELETE on order_items | 更新 total_amount |
| `sync_member_profile_from_auth` | AFTER INSERT/UPDATE on auth.users | 同步會員資料 |

## 📱 主要功能

### 會員端

#### 訂購流程
1. **登入系統**（[`/login`](react-app/src/pages/LoginPage.jsx)）
2. **查看開放狀態**（[`/order`](react-app/src/pages/OrderPage.jsx)）
3. **選擇運送地址**
4. **新增商品項目**（系統自動提示價格）
5. **填寫備註**（選填）
6. **送出訂單**（自動產生冪等性鍵）
7. **查看付款資訊**（[`/payment`](react-app/src/pages/PaymentPage.jsx)）

#### 其他功能
- **訂單歷史**（[`/history`](react-app/src/pages/HistoryPage.jsx)）：查看與重複下單
- **待處理訂單**（[`/pending`](react-app/src/pages/PendingOrderPage.jsx)）：追蹤未完成訂單
- **個人資料**（[`/profile`](react-app/src/pages/ProfilePage.jsx)）：編輯會員資料
- **變更密碼**（[`/change-password`](react-app/src/pages/ChangePasswordPage.jsx)）：更新密碼

### 管理員端

#### 訂單管理（[`/admin`](react-app/src/pages/AdminPage.jsx)）

**篩選功能**：
- 狀態：全部/待確認訂金/未完成/已完成
- 地點：全部/明德樓/據德樓/蘊德樓/機車停車場
- 年月：動態產生可選範圍

**操作功能**：
- 單筆編輯：修改狀態與備註
- 批次操作：勾選多筆訂單批次更新狀態
- 分頁顯示：每頁 20 筆（可調整）

#### 開放時段設定

**永遠開放模式**：
- 勾選「永遠開放」即不限制訂購時間

**時段模式**：
- 設定開放時間：星期 + 時刻（如：週一 08:00）
- 設定關閉時間：星期 + 時刻（如：週五 18:00）
- 支援跨週時段（如：週日 20:00 ~ 週一 10:00）

## 🔒 安全性

### 多層驗證機制

**前端驗證**：
- 表單格式檢查（即時回饋）
- 必填欄位驗證
- 資料格式驗證（Email、手機、帳號）

**API 層驗證**：
- JWT token 驗證（[`create-order`](supabase/functions/create-order/index.ts)）
- 會員資料完整性檢查
- 業務規則驗證（開放時段、商品項目格式）

**資料庫層驗證**：
- CHECK 約束（價格 >= 0、數量 > 0）
- UNIQUE 約束（帳號、Email、手機、idempotency_key）
- 外鍵約束（CASCADE 刪除）
- RLS 政策（權限控制）

### Row Level Security (RLS)

**會員權限**：
- 只能讀取自己的訂單與項目
- 只能編輯自己的個人資料
- 只能管理自己的常用商品

**管理員權限**：
- 可讀取所有訂單與會員資料
- 可更新訂單狀態與備註
- 可設定開放時段

**公開權限**：
- 所有人可讀取開放時段（包含未登入使用者）

### 防護機制

| 攻擊類型 | 防護措施 |
|----------|----------|
| **SQL Injection** | 參數化查詢 + RPC |
| **XSS** | React 自動跳脫 |
| **CSRF** | JWT token 驗證 |
| **重放攻擊** | idempotency_key |
| **越權存取** | RLS 政策 |
| **暴力破解** | Supabase Auth 限流 |

### 資料完整性

**自動化處理**：
- 總額自動計算（Trigger）
- 小計自動計算（Trigger）
- 會員資料自動同步（Trigger）

**冪等性保證**：
- 使用 UUID 作為 idempotency_key
- 資料庫 UNIQUE 約束防止重複
- 重複請求返回相同結果

## 🎯 業務邏輯

### 訂單狀態流程

```
[建立訂單]
    ↓
[檢查總額]
    ├─ > 300 元 → [pending_deposit]
    │                  ↓
    │           [管理員確認訂金]
    │                  ↓
    │               [open]
    │                  ↓
    │           [管理員標記完成]
    │                  ↓
    │             [fulfilled]
    │
    └─ <= 300 元 → [open]
                      ↓
                [管理員標記完成]
                      ↓
                  [fulfilled]
```

### 開放時段邏輯

**檢查流程**（[`ordering_open_now()`](sql/schema.sql:169)）：
1. 若 `is_always_open = true` → 返回 true
2. 計算當前時間（Asia/Taipei）的「週內分鐘數」
3. 計算開放與關閉的「週內分鐘數」
4. 判斷當前時間是否在範圍內

**週內分鐘數計算**：
```
分鐘數 = (星期 × 1440) + (時 × 60) + 分
範例：週一 08:30 = (1 × 1440) + (8 × 60) + 30 = 1950
```

### 批次 ID 格式

**ISO Week 格式**：`YYYY-WNN`
- 範例：`2026-W11`（2026 年第 11 週）
- 用於按週統計與管理訂單
- 由後端自動計算與設定

## 🔧 核心模組

### 前端架構

**分層設計**：
```
Pages (頁面層)
  ↓
Services (服務層)
  ↓
Supabase Client (客戶端層)
  ↓
Edge Functions / RPC (後端層)
  ↓
Database (資料層)
```

**關鍵模組**：

- [`AuthContext`](react-app/src/context/AuthContext.jsx)：認證狀態管理，提供 user, session, loading, signOut
- [`authService`](react-app/src/services/authService.js)：認證操作封裝（登入、註冊、管理員登入）
- [`orderService`](react-app/src/services/orderService.js)：訂單操作封裝（建立、查詢）
- [`adminService`](react-app/src/services/adminService.js)：管理員操作封裝（訂單管理、批次更新）
- [`ProtectedRoute`](react-app/src/components/ProtectedRoute.jsx)：路由守衛，保護需登入的頁面

### 後端架構

**Edge Functions**（Deno runtime）：
- [`create-order`](supabase/functions/create-order/index.ts)：處理訂單建立請求
  - JWT 驗證
  - 會員資料檢查
  - 開放時段檢查
  - 呼叫 create_order() RPC
- [`lookup-order`](supabase/functions/lookup-order/index.ts)：處理訂單查詢請求
  - JWT 驗證
  - RLS 確保只返回自己的訂單

**資料庫層**（PostgreSQL）：
- Stored Procedures：封裝複雜業務邏輯
- Triggers：自動化處理（計算、同步）
- RLS Policies：精細的權限控制

## 📊 資料流向

### 下單流程

```
使用者填寫表單 (OrderPage)
  ↓
產生 idempotency_key (UUID)
  ↓
呼叫 orderService.invokeFunction()
  ↓
POST /functions/v1/create-order
  ↓
驗證 JWT token → 取得 user_id
  ↓
查詢 member_profiles → 取得姓名、電話
  ↓
呼叫 ordering_open_now() → 檢查時段
  ↓
呼叫 create_order() RPC
  ↓
INSERT orders + order_items
  ↓
Triggers 自動計算總額與小計
  ↓
根據總額設定初始狀態
  ↓
返回 order_id
  ↓
導向 PaymentPage 顯示結果
```

### 管理員審核流程

```
管理員登入 (AdminPage)
  ↓
呼叫 checkAdminAccess() → 驗證權限
  ↓
呼叫 loadAdminOrders() → 載入訂單列表
  ↓
篩選與分頁（status, location, year, month）
  ↓
編輯訂單 → updateAdminOrder()
  ↓
或批次操作 → bulkUpdateOrders()
  ↓
RLS 確保只有管理員可更新
  ↓
前端即時更新顯示
```

## 📖 API 使用範例

### 建立訂單

```javascript
import { supabase } from './lib/supabase';

const createOrder = async (orderData) => {
  const { data: { session } } = await supabase.auth.getSession();
  
  const response = await supabase.functions.invoke('create-order', {
    body: {
      delivery_location: orderData.location,
      note: orderData.note,
      items: orderData.items,
      device_id: getDeviceId(),
      idempotency_key: crypto.randomUUID(),
    },
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });
  
  return response.data;
};
```

### 查詢訂單

```javascript
const loadMyOrders = async () => {
  const { data, error } = await supabase
    .from('orders')
    .select(`
      *,
      order_items (*)
    `)
    .order('created_at', { ascending: false });
    
  return data;
};
```

### 管理員批次更新

```javascript
const bulkUpdateOrders = async (orderIds, newStatus) => {
  const { error } = await supabase
    .from('orders')
    .update({ status: newStatus })
    .in('id', orderIds);
    
  return !error;
};
```

## 🧪 開發建議

### 程式碼風格

- **元件命名**：PascalCase（`OrderPage.jsx`）
- **函式命名**：camelCase（`loadOrders()`）
- **常數命名**：UPPER_SNAKE_CASE（`DEFAULT_PAGE_SIZE`）
- **檔案組織**：依功能分類，避免巨大檔案

### 最佳實踐

**前端**：
- 使用 React Hooks（useState, useEffect, useContext）
- 避免 prop drilling，適時使用 Context
- 錯誤邊界處理（try-catch + 使用者友善訊息）
- Loading 狀態指示

**後端**：
- Edge Functions 保持輕量，複雜邏輯放 RPC
- 使用 service_role 時特別注意安全性
- 統一錯誤格式：`{ error: "訊息" }`
- 記錄關鍵操作日誌

**資料庫**：
- 善用 RLS 而非程式邏輯控制權限
- 複雜查詢使用索引優化
- 使用 Triggers 自動化重複計算
- RPC 確保交易原子性

## 🐛 常見問題

### Q: 登入後顯示「會員資料未完成」

**原因**：註冊時未正確建立 member_profiles 記錄

**解決**：
1. 檢查 [`sync_member_profile_from_auth`](sql/schema.sql:79) trigger 是否已建立
2. 檢查註冊時是否提供完整的 metadata（full_name, account, email, real_phone）
3. 手動在 member_profiles 新增記錄

### Q: 無法存取管理員後台

**原因**：帳號未加入 admin_users 表

**解決**：
```sql
-- 在 Supabase SQL Editor 執行
INSERT INTO public.admin_users (user_id)
VALUES ('<your-user-uuid>');
```

### Q: 開放時段設定後仍無法下單

**原因**：時區或時間計算問題

**檢查**：
1. 確認 ordering_schedule.timezone = 'Asia/Taipei'
2. 呼叫 `SELECT ordering_open_now();` 測試結果
3. 檢查 open_day/hour 與 close_day/hour 設定

### Q: 訂單總額顯示 0

**原因**：Trigger 未正確執行

**解決**：
1. 檢查 [`update_order_total_after_change`](sql/schema.sql:164) trigger 是否存在
2. 手動更新：`UPDATE orders SET total_amount = (SELECT SUM(line_total) FROM order_items WHERE order_id = orders.id);`

### Q: build 後無法載入 config.js

**原因**：config.js 未被複製到 dist/

**解決**：
- 確保 `react-app/public/config.js` 存在且內容正確
- Vite 會自動複製 public/ 下的檔案到 dist/

## 📚 相關文件

- [`DESIGN.md`](DESIGN.md)：完整的系統設計文件，包含架構設計、模組劃分、協作策略
- [`sql/schema.sql`](sql/schema.sql)：完整的資料庫結構定義
- [`react-app/README.md`](react-app/README.md)：React 應用說明

## 🤝 貢獻指南

### 開發流程

1. **Fork 專案**
2. **建立功能分支**：`git checkout -b feature/your-feature`
3. **開發與測試**
4. **提交變更**：`git commit -m "Add: your feature"`
5. **推送分支**：`git push origin feature/your-feature`
6. **建立 Pull Request**

### 提交訊息規範

- `Add: 新增功能`
- `Fix: 修正錯誤`
- `Update: 更新功能`
- `Refactor: 重構程式碼`
- `Docs: 文件更新`

## 📝 授權

本專案為私人專案，僅供授權使用者使用。

---

## 💡 系統設計理念

本系統採用**分層架構**與**關注點分離**原則：

- **資料層**：PostgreSQL + RLS + Triggers，確保資料安全與一致性
- **API 層**：Edge Functions，處理認證、驗證與業務邏輯
- **服務層**：封裝 API 呼叫，統一錯誤處理與資料轉換
- **UI 層**：React 元件，專注於使用者體驗與互動

**關鍵設計決策**：

1. **執行期配置 vs 環境變數**：選擇執行期配置以支援單一建構多環境部署
2. **Edge Functions vs 直接資料庫存取**：訂單建立使用 Edge Function 以完整控制驗證流程
3. **RLS vs 程式邏輯**：使用 RLS 作為最後一道防線，即使 API 被繞過也能保護資料
4. **Triggers vs 手動計算**：使用 Triggers 確保總額計算的一致性與即時性
5. **冪等性鍵 vs 時間戳**：使用 UUID 作為冪等性鍵，避免時間戳的精度問題

詳細設計理念請參考 [`DESIGN.md`](DESIGN.md)。

---

**專案版本**：v0.1.0  
**最後更新**：2026-03-14  
**維護者**：訂購系統開發團隊
