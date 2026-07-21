# React 前端

本目錄包含會員端與管理端的 Vite React 應用程式。

## 指令

```powershell
npm install
npm run dev
npm run build
npm run preview
```

## 執行期設定

`public/config.js` 在瀏覽器載入時提供公開 Supabase 連線資訊；請以 `public/config.example.js` 為範本。

```javascript
window.APP_CONFIG = {
  SUPABASE_URL: "https://your-project.supabase.co",
  SUPABASE_ANON_KEY: "your-anon-or-publishable-key",
  ADMIN_DEFAULT_EMAIL: "admin@example.com",
};
```

這些值可放入前端：Supabase URL、anon/publishable key、預設管理者 email。以下值絕不可放入前端：service role key、資料庫密碼、LINE channel secret、LINE channel access token、通知工作者 token。

## 頁面與服務對應

- `src/pages/`：會員下單、付款、待處理、歷史、收藏、個人資料與管理後台頁面。
- `src/components/`：路由保護、訂單明細抽屜、版面與共用元件。
- `src/services/orderService.js`：會員訂單與付款方式。
- `src/services/adminService.js`：管理者訂單、付款、報表、通知觸發與診斷。
- `src/services/lineService.js`：LINE 綁定與通知偏好。
- `src/lib/supabase.js`：共用 Supabase client。

完整產品與部署規格在根目錄 [README.md](../README.md)。遠端 E2E 測試要求見 [scripts/e2e/README.md](scripts/e2e/README.md)。
