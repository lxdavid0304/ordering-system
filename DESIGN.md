# 訂購系統完整設計文件

## 1. 系統概述

### 1.1 系統目標與解決的問題

本訂購系統是一個針對校園或社區情境設計的線上訂購平台，目標是簡化傳統紙本或口頭訂購流程，提供：

- **使用者端**：方便快速的線上下單介面，支援多項商品訂購、地址選擇、歷史訂單查詢與重複下單
- **管理員端**：集中化的訂單管理後台，支援訂單狀態追蹤、批次處理、訂金確認與開放時段控制
- **系統端**：自動化的業務邏輯處理，包含排程時段檢查、訂金門檻判斷、冪等性保證、資料安全與權限控制

### 1.2 實際使用情境

#### 情境一：使用者下單流程
1. 會員登入系統（支援帳號/Email + 密碼登入）
2. 確認目前是否在開放時段內（系統即時顯示）
3. 選擇運送地址（明德樓、據德樓、蘊德樓、機車停車場）
4. 新增商品項目（商品名稱、單價、數量），系統會自動提示上次下單的價格
5. 填寫備註（可選）
6. 送出訂單，系統自動判斷是否需要確認訂金（總額 > 300 元）
7. 導向付款頁面，顯示訂單摘要與付款狀態
8. 從歷史記錄頁面查看過往訂單，可快速重新下單

#### 情境二：管理員管理流程
1. 管理員使用專屬帳號登入後台（支援 Email + 密碼或 GitHub OAuth）
2. 系統驗證管理員權限（檢查 `admin_users` 表）
3. 查看訂單清單，可依狀態、地點、年月篩選
4. 處理待確認訂金的訂單（狀態：`pending_deposit`）
5. 確認訂金後，訂單狀態變更為 `open`（未完成）
6. 訂單完成後，變更為 `fulfilled`（已完成）
7. 使用批次操作功能，一次處理多筆訂單的狀態
8. 設定系統開放時段（可選擇永遠開放或指定星期與時間）

#### 情境三：系統自動化處理
1. 使用者送出訂單時，Edge Function 驗證登入狀態與會員資料
2. 檢查目前是否在開放時段內（呼叫 `ordering_open_now()` RPC）
3. 使用冪等性鍵 (idempotency_key) 防止重複送出
4. 計算訂單總額，自動判斷初始狀態（>300 元為 `pending_deposit`，否則為 `open`）
5. 建立訂單主記錄與項目記錄，透過資料庫 trigger 自動計算總額
6. 設定本週批次 ID（ISO week format: 2026-W11），方便管理員按週管理訂單
7. RLS 政策確保使用者只能看到自己的訂單，管理員可看到所有訂單

### 1.3 為何建立這個系統

傳統的訂購方式（紙本表單、即時通訊群組、電話訂購）存在以下問題：

- **資料分散**：訂單資訊散落各處，難以統計與管理
- **錯誤率高**：手動抄寫或口頭傳達容易出錯
- **效率低落**：管理員需要手動整理、計算總額、追蹤狀態
- **缺乏記錄**：無法追溯歷史訂單，使用者需要重複輸入相同資訊
- **時段控制困難**：無法即時控制開放或關閉訂購

本系統透過 Web 應用程式化，提供集中的資料管理、即時狀態追蹤、權限分離、歷史記錄與彈性的時段控制。

---

## 2. 功能模組劃分

### 2.1 前端 UI 模組

#### 2.1.1 使用者介面層
- **OrderPage**（訂單建立頁面）
  - 責任：商品清單輸入、運送地址選擇、備註填寫
  - 功能：自動載入上次價格提示、草稿自動儲存、重複下單整合
  - 邊界：不處理訂單建立邏輯（委派給 Edge Function）

- **PaymentPage**（支付確認頁面）
  - 責任：顯示訂單摘要、訂金狀態、付款資訊
  - 邊界：只負責顯示，不處理訂單狀態變更

- **HistoryPage**（歷史訂單頁面）
  - 責任：顯示使用者的所有歷史訂單
  - 功能：訂單列表、詳細資訊展開、快速重複下單

- **PendingOrderPage**（待處理訂單頁面）
  - 責任：顯示待確認訂金或未完成的訂單

- **ProfilePage**（個人資料頁面）
  - 責任：顯示與編輯會員基本資料
  - 功能：姓名、帳號、Email、手機編輯與驗證

- **ChangePasswordPage**（密碼變更頁面）
  - 責任：提供密碼變更功能

- **LoginPage**（登入/註冊頁面）
  - 責任：會員登入與註冊
  - 功能：支援帳號或 Email 登入、新會員註冊

#### 2.1.2 管理員介面層
- **AdminPage**（管理員後台）
  - 責任：訂單管理、開放時段設定
  - 功能：訂單列表與篩選、分頁顯示、訂單編輯、批次操作、時段設定、管理員登入
  - 邊界：需通過權限驗證（`admin_users` 表）

#### 2.1.3 共用元件層
- MemberLayout、OrderItemRow、AdminOrderCard、StatusBadge、FormMessage、ProtectedRoute

### 2.2 後端 API 模組

#### 2.2.1 Edge Functions
- **create-order**（訂單建立 API）
  - 責任：驗證、處理訂單建立請求
  - 流程：驗證 JWT → 查詢會員資料 → 檢查開放時段 → 驗證商品項目 → 呼叫 RPC 建立訂單
  - 邊界：使用 service_role 權限，繞過 RLS，由程式邏輯控制安全性

- **lookup-order**（訂單查詢 API）
  - 責任：單筆訂單查詢
  - 邊界：只返回當前使用者自己的訂單

### 2.3 資料庫層

#### 2.3.1 資料表
- **orders**：訂單主表（id, created_at, customer_name, phone, delivery_location, note, total_amount, user_id, idempotency_key, status, batch_id, admin_note）
- **order_items**：訂單項目表（id, order_id, product_name, unit_price, quantity, line_total）
- **member_profiles**：會員資料表（user_id, full_name, account, email, real_phone）
- **favorite_items**：常用商品表（id, user_id, product_name, unit_price）
- **ordering_schedule**：開放時段表（單例設計，id=1）
- **admin_users**：管理員列表（user_id）

#### 2.3.2 資料庫函式
- **create_order()**：原子性建立訂單與項目，處理冪等性
- **ordering_open_now()**：檢查當前時間是否在開放時段內
- **is_admin_user()**：檢查當前使用者是否為管理員

#### 2.3.3 資料庫觸發器
- **set_line_total_before_change**：自動計算項目小計（line_total = unit_price × quantity）
- **update_order_total_after_change**：自動更新訂單總額
- **sync_member_profile_from_auth**：同步會員資料

#### 2.3.4 安全層（RLS Policies）
- 會員只能讀取自己的訂單
- 管理員可讀取與更新所有訂單
- 所有人可讀取開放時段，只有管理員可更新

### 2.4 認證授權模組

#### 2.4.1 認證層
- **AuthContext**：React Context，管理 session, user, loading, signOut
- **authService**：封裝 Supabase Auth 操作（loginMember, registerMember, signInAdmin, signInAdminWithGitHub）

#### 2.4.2 授權層
- **RLS**：資料庫層級權限控制
- **ProtectedRoute**：前端路由守衛

### 2.5 業務邏輯層（Services）

- **orderService**：訂單相關操作（invokeFunction, loadMemberOrders, loadOrderById）
- **adminService**：管理員操作（loadAdminOrders, updateAdminOrder, bulkUpdateOrders, checkAdminAccess）
- **profileService**：個人資料操作（loadMemberProfile, saveMemberProfile）
- **scheduleService**：開放時段操作（loadOrderingSchedule, saveOrderingSchedule）

### 2.6 工具層（Utils）

- **auth.js**：認證相關工具
- **format.js**：格式化工具
- **orders.js**：訂單相關工具
- **schedule.js**：排程相關工具
- **storage.js**：本地儲存工具

---

## 3. Orchestration 角色設計

### 3.1 Planner（規劃者）

**職責**：需求分析、功能拆解、架構設計、開發順序規劃

**任務範例**：
- 分析使用者故事，拆解為可執行的功能需求
- 設計資料表結構與關聯
- 規劃 API 端點與輸入輸出格式
- 定義前後端互動協定

**產出物**：功能需求文件、資料模型設計、API 規格定義、開發任務清單

**與其他角色互動**：
- 向 Database Designer 提供資料需求
- 向 Backend Developer 提供 API 規格
- 向 Frontend Developer 提供 UI/UX 需求
- 與 Reviewer 確認設計合理性

### 3.2 Database Designer（資料庫設計角色）

**職責**：設計資料表結構、定義 RLS 政策、建立 Stored Procedures 與 Triggers

**任務範例**：
- 設計 orders, order_items, member_profiles 等表結構
- 實作 create_order() RPC 確保原子性
- 實作 ordering_open_now() RPC 處理時區邏輯
- 設計 RLS 政策確保資料安全
- 建立 triggers 自動計算訂單總額

**產出物**：sql/schema.sql（完整的 DDL 與 RLS 定義）、資料庫遷移腳本、索引優化計畫

**與其他角色互動**：
- 接收 Planner 的資料需求
- 向 Backend Developer 提供可用的 RPC 與查詢介面
- 與 Reviewer 討論安全性與效能

### 3.3 Backend Developer（後端開發角色）

**職責**：實作 Edge Functions、設計服務層、處理認證授權、實作業務邏輯

**任務範例**：
- 實作 create-order Edge Function（JWT 驗證、會員資料檢查、開放時段檢查、資料清理）
- 實作 lookup-order Edge Function
- 實作 adminService, orderService, authService
- 處理錯誤與例外情況
- 實作冪等性機制

**產出物**：supabase/functions/\*/index.ts、react-app/src/services/\*.js

**與其他角色互動**：
- 接收 Planner 的 API 規格
- 使用 Database Designer 提供的 RPC 與表結構
- 向 Frontend Developer 提供 API 使用文件
- 與 Reviewer 討論安全性與錯誤處理

### 3.4 Frontend Developer（前端開發角色）

**職責**：實作 React 頁面元件、設計使用者互動流程、實作狀態管理

**任務範例**：
- 實作 OrderPage（商品清單動態新增/刪除、自動載入價格提示、草稿儲存、表單驗證、冪等性鍵管理）
- 實作 AdminPage（訂單列表與分頁、多維度篩選、批次操作、即時狀態更新）
- 實作 HistoryPage、PaymentPage 等其他頁面
- 實作共用元件與佈局

**產出物**：react-app/src/pages/\*.jsx、react-app/src/components/\*.jsx、react-app/src/context/AuthContext.jsx

**與其他角色互動**：
- 接收 Planner 的 UI/UX 需求
- 使用 Backend Developer 提供的 API
- 與 Reviewer 討論使用者體驗與錯誤處理
- 與 Integrator 協作進行端對端測試

### 3.5 Reviewer（審查者）

**職責**：審查程式碼品質、檢查安全性漏洞、驗證業務邏輯正確性

**任務範例**：
- 審查 Edge Function 的安全性（JWT 驗證、輸入清理、錯誤處理）
- 審查 RLS 政策是否防止越權存取
- 審查前端表單驗證是否充分
- 審查 SQL 查詢效能與索引使用
- 審查冪等性機制是否正確

**產出物**：Code Review 評論、安全性檢查報告、效能優化建議

**與其他角色互動**：
- 審查所有角色的產出
- 向 Planner 回饋設計問題
- 向各開發角色提供改進建議
- 與 Integrator 確認修正結果

### 3.6 Integrator（整合者）

**職責**：整合各模組、進行端對端測試、處理模組間介面問題、協調部署流程

**任務範例**：
- 測試完整訂單流程（會員註冊 → 登入 → 下單 → 查看歷史 → 重複下單）
- 測試管理員流程（登入 → 查看訂單 → 篩選 → 批次操作 → 設定開放時段）
- 測試邊界情況（開放時段外下單、冪等性重複送出、RLS 權限測試、並發訂單測試）
- 整合前後端（確認 API 格式一致、處理跨域問題、確認錯誤訊息正確顯示）
- 協調部署（資料庫遷移、Edge Functions 部署、前端打包與部署）

**產出物**：整合測試報告、部署檢查清單、問題追蹤與修正記錄

**與其他角色互動**：
- 整合所有角色的成果
- 向各開發角色回報整合問題
- 與 Reviewer 協作進行品質把關
- 向 Planner 回饋開發進度

---

## 4. 資料流與控制流

### 4.1 使用者下單流程資料流

**步驟一：前端表單送出**
- 使用者在 OrderPage 填寫表單（商品、地址、備註）
- 前端驗證：地址、商品項目格式
- 產生 UUID 作為 idempotency_key（防止重複送出）
- 取得 device_id (localStorage) 和 access_token (AuthContext)

**步驟二：呼叫 create-order API**
- 透過 orderService.invokeFunction() 傳送請求
- Payload: delivery_location, note, items, device_id, idempotency_key, access_token

**步驟三：Edge Function 驗證與處理**
- 解析 JWT token，取得 user_id
- 查詢 member_profiles 確認會員資料存在（取得 customer_name, phone）
- 呼叫 ordering_open_now() RPC 檢查開放時段
- 清理與驗證每個商品項目（product_name, unit_price, quantity > 0）
- 計算本週 batch_id（ISO week format: 2026-W11）

**步驟四：資料庫層處理**
- 呼叫 create_order() RPC
- 檢查 idempotency_key 是否重複（若重複則直接返回已存在的 order_id）
- INSERT INTO orders（customer_name, phone 從 member_profiles 取得）
- 對每個項目 INSERT INTO order_items
- Trigger set_line_total_before_change 自動計算 line_total
- Trigger update_order_total_after_change 自動更新 orders.total_amount
- 根據 total_amount 設定初始狀態（>300 為 pending_deposit，否則為 open）
- 返回 order_id

**步驟五：前端後續處理**
- 清除草稿 (clearOrderDraft)
- 儲存支付預覽資料 (savePaymentPreview)
- 導向 PaymentPage 顯示訂單摘要與付款狀態

### 4.2 管理員審核流程控制流

**步驟一：登入與權限驗證**
- 管理員登入（Email + 密碼或 GitHub OAuth）
- 呼叫 checkAdminAccess() 查詢 admin_users 表
- 驗證通過才顯示後台內容

**步驟二：載入訂單列表**
- 呼叫 loadAdminOrders(filters: status, location, year, month; page, pageSize)
- 使用分頁（rangeFrom, rangeTo）
- RLS 政策確保只有管理員能看到所有訂單

**步驟三：訂單狀態更新**
- 管理員編輯訂單狀態或備註
- 呼叫 updateAdminOrder(orderId, { status, admin_note })
- 前端即時更新顯示並重新載入訂單列表

**步驟四：批次操作**
- 使用者勾選多筆訂單、選擇目標狀態
- 呼叫 bulkUpdateOrders(ids, status)
- 資料庫批次更新（UPDATE WHERE id IN ...）
- 前端顯示更新結果

**步驟五：開放時段設定**
- 管理員編輯開放時段表單
- 呼叫 saveOrderingSchedule(schedule)
- 更新 ordering_schedule 表（singleton，id=1）
- 前端即時顯示新設定

### 4.3 前後端互動方式

**API 呼叫流程**：
```
React Component → Service Layer → Supabase Client → Edge Function/RPC → PostgreSQL → 返回結果 → 更新 UI
```

**錯誤處理機制**：
- 前端驗證：表單輸入格式檢查，即時回饋
- API 層驗證：Edge Function 清理與驗證資料
- 資料庫層驗證：CHECK 約束、UNIQUE 約束、RLS 政策
- 錯誤回傳：統一 JSON 格式 `{ error: "錯誤訊息" }`
- 使用者友善訊息：前端轉換技術錯誤為可理解文字

**認證流程**：
- 會員認證：signInWithPassword() → 返回 JWT token 與 session → 儲存於 AuthContext → 自動附加於後續請求
- 管理員認證：同會員流程 + 額外呼叫 checkAdminAccess() 驗證身份

### 4.4 資料庫存取模式

**讀取模式**：
- 直接查詢：前端透過 Supabase Client 直接查詢（受 RLS 保護），減少 API 層級，效能較佳
- RPC 呼叫：呼叫 Stored Procedure 處理複雜邏輯、跨表查詢

**寫入模式**：
- Edge Function + RPC：訂單建立等複雜操作，完整控制、驗證、業務邏輯
- 直接寫入：簡單的 CRUD 操作（如更新會員資料），RLS 政策確保權限正確

**交易保證**：
- RPC 原子性：create_order() 確保訂單與項目同時建立或全部失敗
- 觸發器自動化：總額計算由 trigger 自動處理，避免不一致
- 冪等性設計：idempotency_key unique 約束防止重複訂單

---

## 5. Roo Code 協作策略

### 5.1 任務拆解方法

**階段一：資料層建立**
- 目標：建立穩固的資料基礎
- 子任務：設計資料表結構 → 定義關聯與約束 → 建立索引 → 實作 RPCs → 實作 Triggers → 定義 RLS 政策 → 撰寫測試 SQL
- 檢查點：所有表可正常建立、RPC 可獨立呼叫、RLS 政策阻擋非法存取、Triggers 正確觸發

**階段二：後端 API 建立**
- 目標：提供安全可靠的 API 介面
- 子任務：實作 create-order Edge Function → 實作 lookup-order Edge Function → 實作 Service Layer → 撰寫測試 → 文件化 API 規格
- 檢查點：Edge Functions 可正常部署、JWT 驗證阻擋非法請求、錯誤統一返回、Service Layer 正確封裝

**階段三：前端 UI 實作**
- 目標：建立使用者友善的介面
- 子任務（會員端）：實作 AuthContext → OrderPage → PaymentPage → HistoryPage → PendingOrderPage → ProfilePage → ChangePasswordPage → 共用元件
- 子任務（管理員端）：實作 AdminPage 登入 → 訂單列表與篩選 → 訂單編輯 → 批次操作 → 開放時段設定 → AdminOrderCard 元件
- 檢查點：頁面路由正確、表單驗證阻擋無效輸入、API 錯誤正確顯示、響應式設計適配

**階段四：整合與測試**
- 目標：確保各模組協作無誤
- 子任務：端對端測試完整流程 → 測試邊界情況 → 測試 RLS 權限 → 效能測試與優化 → 跨瀏覽器相容性測試
- 檢查點：所有主要流程可正常完成、邊界情況正確處理、無安全性漏洞、效能符合預期

### 5.2 執行順序建議

**開發順序**：需求分析 → 資料層 → RPC & Triggers → RLS 政策 → Edge Functions → Service Layer → AuthContext → 會員頁面/管理員頁面（平行） → 整合測試 → 修正優化 → 部署

**關鍵原則**：
1. **由下而上**：先建立資料層，再建立 API 層，最後建立 UI 層
2. **模組獨立**：每個模組可獨立測試，降低依賴
3. **漸進式整合**：從核心功能開始，逐步加入進階功能
4. **頻繁檢查點**：每完成一個階段就測試，避免問題累積

### 5.3 跨角色協作流程

**範例：新增「常用商品」功能**

1. **Planner** 分析需求 → 輸出功能需求文件、資料表設計草稿
2. **Database Designer** 設計 favorite_items 表、定義 RLS 政策、建立索引 → **Reviewer** 審查 → 輸出 SQL DDL
3. **Backend Developer** 實作 favoriteService → **Reviewer** 審查 → 輸出 favoriteService.js
4. **Frontend Developer** 在 OrderPage 新增「常用商品」區塊、ProfilePage 新增管理功能 → **Reviewer** 審查 UI/UX → 輸出更新的頁面元件
5. **Integrator** 測試完整流程、RLS 權限測試 → 輸出測試報告 → **Planner** 確認功能符合需求

### 5.4 中間檢查點與修正機制

**檢查點設計**：
- 資料層檢查點：✓ 表結構正確 ✓ RPC 返回正確結果 ✓ RLS 正確阻擋
- API 層檢查點：✓ Edge Functions 可部署 ✓ 錯誤處理正確 ✓ Service Layer 正確呼叫
- UI 層檢查點：✓ 頁面正常顯示 ✓ 表單驗證正確 ✓ API 呼叫成功

**修正機制**：
1. 問題回報：Integrator 或 Reviewer 發現問題 → 記錄問題描述、重現步驟、預期行為
2. 問題分類：資料層 → Database Designer 修正、API 層 → Backend Developer 修正、UI 層 → Frontend Developer 修正、設計問題 → Planner 重新評估
3. 修正與驗證：開發者修正 → Reviewer 審查 → Integrator 重新測試
4. 經驗記錄：記錄問題原因與解決方法 → 更新檢查清單

### 5.5 跨模組依賴處理

**處理策略**：
- **Mock 與 Stub**：後端未完成時，前端使用 Mock 資料開發
- **約定介面**：Planner 定義清楚的 API 規格，前後端依據規格各自開發
- **漸進式整合**：優先完成核心依賴（資料層 → API 層 → UI 層）
- **版本管理**：使用 Git 分支管理不同模組的開發，Feature branch 完成後才合併

---

## 6. 為何需要 Orchestration

### 6.1 系統複雜度分析

**多層架構複雜度**

本訂購系統包含多個技術層次：
- 前端層：React Router, Context API, Vite build system
- API 層：Supabase Edge Functions (Deno runtime)
- 資料層：PostgreSQL, RLS, Triggers, Stored Procedures
- 認證層：Supabase Auth, JWT token
- 部署層：Netlify (前端), Supabase (後端)

**問題**：單一開發者難以同時掌握所有技術細節，容易忽略安全性（RLS 政策不完整）、遺漏邊界情況（冪等性、並發）、架構不一致（前後端格式不統一）。

**功能模組複雜度**

系統包含多個獨立功能模組：
- 會員系統（註冊、登入、個人資料、密碼變更）
- 訂單系統（建立、查詢、歷史、重複下單）
- 管理員系統（訂單管理、批次操作、開放時段設定）
- 權限系統（會員、管理員分離）

**問題**：模組間有複雜的互動與依賴，訂單建立需要驗證會員資料、管理員功能需要額外的權限檢查、開放時段影響訂單是否可建立。

**業務邏輯複雜度**

系統包含多個業務規則：
- 總額 > 300 元需確認訂金
- 開放時段外無法下單
- 重複送出訂單需冪等性保證
- 訂單批次按週分組
- 自動計算訂單總額

**問題**：業務邏輯散布於多個層次（資料庫 Triggers/RPCs、API 層 Edge Functions、前端表單驗證），需要確保一致性。

### 6.2 為何不能用單一步驟完成

**限制一：輸出長度限制**
- 完整系統包含數十個檔案（20+ React 元件、2 個 Edge Functions、1 個完整 schema.sql、多個 service 檔案）
- 單一 prompt 無法輸出所有檔案內容
- 容易遺漏細節或產生不完整的程式碼

**限制二：缺乏檢查機制**
- 一次產生所有程式碼，無法在過程中驗證
- 錯誤會累積，最後難以修正
- 無法根據中間結果調整後續開發

**限制三：無法處理依賴**
- 前端需要等待後端 API 完成
- 後端需要等待資料庫 Schema 完成
- 一次性產生會忽略這些依賴關係

**限制四：缺乏專業深度**
- 單一 prompt 難以涵蓋所有技術細節
- RLS 政策、SQL 優化、React 效能優化需要專門知識
- 容易產生「能跑但不優」的程式碼

**實際範例：訂單建立功能**

**如果用單一步驟**：
1. 產生所有程式碼（資料表、RPC、Edge Function、前端）
2. 部署後發現問題：RLS 政策有漏洞、冪等性機制不完整、前端錯誤訊息不友善、並發下單時總額計算錯誤
3. 修正需要全面重寫

**使用 Orchestration**：
1. Database Designer 設計資料表與 RLS → Reviewer 審查安全性 → 修正後確認
2. Database Designer 實作 create_order RPC → 測試冪等性機制 → Reviewer 審查交易原子性
3. Backend Developer 實作 Edge Function → 測試錯誤處理 → Reviewer 審查輸入驗證
4. Frontend Developer 實作 OrderPage → 測試使用者體驗 → Reviewer 審查表單驗證
5. Integrator 端對端測試 → 發現並修正問題 → 確認所有情境正常

**結果**：每個階段都有檢查點，問題及早發現與修正。

### 6.3 多角色協作的必要性

**專業分工的優勢**

- **Database Designer 的專業**：熟悉 PostgreSQL 進階功能（RLS, Triggers, Stored Procedures）、了解資料庫效能優化、掌握資料安全最佳實踐
- **Backend Developer 的專業**：熟悉 Edge Functions 的限制與最佳實踐、了解 JWT 驗證與授權機制、掌握錯誤處理與日誌記錄
- **Frontend Developer 的專業**：熟悉 React Hooks 與狀態管理、了解使用者體驗與響應式設計、掌握前端效能優化
- **Reviewer 的專業**：從安全性角度審查程式碼、發現邊界情況與潛在 bug、確保程式碼品質與可維護性
- **Integrator 的專業**：端對端測試經驗、了解模組間的介面問題、掌握部署流程與環境設定

**協作產生的品質保證**

- **雙重檢查機制**：開發者實作 → Reviewer 審查 → Integrator 測試，每個環節都有人把關
- **知識互補**：Database Designer 可能忽略前端體驗、Frontend Developer 可能忽略資料庫效能，多角色協作確保各方面都被考慮
- **責任明確**：每個角色有明確的職責與產出，問題發生時容易追溯與修正

### 6.4 分階段開發的優勢

**優勢一：降低風險**
- 早期驗證：資料層完成後立即測試，確保基礎穩固
- 漸進式除錯：每個階段都測試，問題不會累積
- 易於回溯：出問題時只需回到上一個檢查點

**優勢二：彈性調整**
- 需求變更：前端未開始前，修改 API 規格成本低
- 技術選型：發現某技術不適合，可及早更換
- 優先級調整：核心功能先完成，進階功能後續再加

**優勢三：平行開發**
- 資料層完成後：Backend 與 Frontend 可平行開發
- API 規格確定後：前端使用 Mock 資料先行開發
- 縮短開發週期：多個模組同時進行

**優勢四：知識累積**
- 文件化：每個階段都有文件，後續維護有依據
- 經驗傳承：檢查清單記錄常見問題，新成員可快速上手
- 持續改進：每個專案累積經驗，下一個專案更順利

### 6.5 如何降低錯誤率與提升品質

**機制一：多層驗證**
- 前端驗證：表單格式檢查，即時回饋
- API 驗證：Edge Function 清理與驗證輸入
- 資料庫驗證：CHECK 約束、UNIQUE 約束、RLS 政策
- **結果**：即使前端被繞過，後端仍有多層防護

**機制二：程式碼審查**
- Reviewer 角色專門審查程式碼品質與安全性
- 審查重點：安全性漏洞（SQL injection, XSS, CSRF）、效能問題（N+1 查詢、缺少索引）、邊界情況（null 值、空陣列、並發）、可讀性與可維護性
- **結果**：問題在上線前被發現

**機制三：自動化測試**
- 單元測試：測試個別函式的正確性
- 整合測試：測試模組間的互動
- 端對端測試：測試完整使用者流程
- **結果**：重構時可確保功能不被破壞

**機制四：檢查清單**
- 每個階段的檢查清單確保不會遺漏重要項目
- 資料層：□ 表結構正確 □ RLS 政策生效 □ RPC 可呼叫
- API 層：□ JWT 驗證 □ 輸入清理 □ 錯誤處理
- UI 層：□ 表單驗證 □ 錯誤顯示 □ 響應式設計
- **結果**：重要項目不會被遺漏

**機制五：漸進式部署**
- 開發環境：本機開發與測試
- 測試環境：模擬正式環境的完整測試
- 正式環境：確認無誤後才上線
- **結果**：問題在正式環境前被發現

---

## 總結

本訂購系統透過完整的模組劃分、清楚的角色設計、結構化的協作流程，展示了 Orchestration 開發模式的價值。系統的複雜度（多層架構、多個模組、複雜業務邏輯）使得單一步驟或單一 prompt 無法高品質地完成開發。

透過 **Planner**、**Database Designer**、**Backend Developer**、**Frontend Developer**、**Reviewer**、**Integrator** 六個角色的專業分工與協作，可以：

1. **降低開發風險**：分階段驗證，問題及早發現
2. **提升程式碼品質**：多層審查，專業把關
3. **縮短開發週期**：平行開發，提高效率
4. **確保系統安全**：RLS、JWT、輸入驗證多層防護
5. **提升可維護性**：清楚的模組邊界，完整的文件

**使用 Roo Code 進行 Orchestration 開發時的建議流程**：

```
規劃階段（Planner）
    ↓
資料層建立（Database Designer + Reviewer）
    ↓
API 層建立（Backend Developer + Reviewer）
    ↓
UI 層建立（Frontend Developer + Reviewer）
    ↓
整合測試（Integrator + Reviewer）
    ↓
部署上線（Integrator）
```

在每個階段設置檢查點，及早發現並修正問題。這種結構化、多角色協作的開發模式，特別適合像訂購系統這樣具有一定複雜度的專案。透過 orchestration，可以確保：

- **資料層穩固**：完整的 RLS 政策、正確的 RPC、自動化的 Triggers
- **API 層安全**：JWT 驗證、輸入清理、錯誤處理、冪等性保證
- **UI 層友善**：表單驗證、錯誤提示、響應式設計、草稿儲存
- **整合完整**：端對端測試、邊界情況驗證、效能優化

最終產出一個安全、穩定、易用、可維護的訂購系統。