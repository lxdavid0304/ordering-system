# 訂購系統 (靜態前端 + Supabase)

## 功能
- 會員強制制：必須先註冊（姓名、帳號、密碼、郵箱、真實電話）並登入才可填單
- 匿名不可填單：送單流程必須帶登入 JWT，後端會再用會員資料覆蓋姓名與電話
- 會員中心：可查詢「進行中 / 歷史 / 全部」訂單，並可一鍵再購
- 管理後台：隱藏網址 + 登入保護，可管理訂單狀態與開放時段

## 目錄
- `index.html` 會員註冊/登入與填單頁
- `admin-david0304.html` 管理後台
- `assets/config.js` Supabase 連線設定
- `sql/schema.sql` 建表、RLS、會員資料同步、RPC
- `sql/edge-function.sql` Edge Function 模式需要的額外 SQL

## Supabase 設定步驟
1. 建立 Supabase 專案
2. 到 SQL Editor 執行 `sql/schema.sql`
3. 建立管理員帳號（Authentication > Users）
4. 將管理員加入 `admin_users`（SQL Editor）
   ```sql
   insert into public.admin_users (user_id, note)
   values ('<管理員 user id>', 'admin');
   ```
5. 到 Project Settings > API 取得：
   - Project URL
   - anon public key
6. 修改 `assets/config.js`

```js
window.APP_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-key",
  ADMIN_DEFAULT_EMAIL: "admin@example.com",
};
```

## Edge Function（建議）
此專案預設送單走 Edge Function，由後端強制檢查會員身分。

1. 在 SQL Editor 執行 `sql/edge-function.sql`
2. 安裝並登入 Supabase CLI
3. 部署 Function
   ```bash
   supabase functions deploy create-order
   supabase functions deploy lookup-order
   ```
4. 在 Supabase 後台 > Edge Functions > Secrets 設定：
   - `SUPABASE_SERVICE_ROLE_KEY`

## 本機測試
- 直接開 `index.html` 即可使用
- 若瀏覽器阻擋請求，請用任何靜態伺服器啟動

## 上線建議
- 可直接部署整個資料夾到靜態網站平台（Vercel / Netlify / Cloudflare Pages）
