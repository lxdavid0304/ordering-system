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
  LINE_LOGIN_ENABLED: false,
  LINE_AUTH_PROVIDER: "custom:line",
};
```

這些值可放入前端：Supabase URL、anon/publishable key、預設管理者 email。以下值絕不可放入前端：service role key、資料庫密碼、LINE channel secret、LINE channel access token、通知工作者 token。

### 會員 Email 驗證信

網站會在註冊成功後提示使用者到信箱按下驗證按鈕，並將驗證連結的回跳位置設為目前網站的 `/order`。請在 Supabase **Authentication > Emails > Confirm signup** 套用下列設定，讓使用者看得懂這是一封會員驗證信：

**Subject**

```text
【Costco 代購填單】請完成 Email 驗證
```

**Message body**

```html
<div style="max-width:560px;margin:0 auto;padding:32px 24px;font-family:Arial,'Noto Sans TC',sans-serif;color:#172b3a;line-height:1.7">
  <h2 style="margin:0 0 16px;color:#0f4c81">完成會員 Email 驗證</h2>
  <p>感謝你註冊 Costco 代購填單。</p>
  <p>請按下方按鈕驗證此 Email。驗證完成後，系統會自動帶你回到訂購網站。</p>
  <p style="margin:28px 0">
    <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#d71920;color:#fff;text-decoration:none;font-weight:700">驗證 Email 並返回訂購網站</a>
  </p>
  <p style="font-size:13px;color:#5f6f7d">若不是你本人註冊，請忽略此信件。</p>
</div>
```

再到 **Authentication > URL Configuration** 設定：

1. `Site URL`：`https://stalwart-axolotl-945b6e.netlify.app`
2. `Redirect URLs`：`https://stalwart-axolotl-945b6e.netlify.app/order`
3. 本機測試另加入：`http://localhost:5173/order`

請保留範本中的 `{{ .ConfirmationURL }}`。它會帶入 Supabase 的安全驗證連結與程式傳入的回跳網址。

### LINE 登入設定

網站已支援透過 Supabase Custom OIDC Provider 使用 LINE Login。啟用前請完成：

1. 在 LINE Developers 建立 LINE Login channel，將 Supabase Custom Provider 顯示的 Callback URL 加入 LINE 的 Callback URL。
2. 在 Supabase **Authentication > Sign In / Providers > New Provider** 建立 OIDC 提供者，識別碼為 `custom:line`、Issuer URL 為 `https://access.line.me`，並填入 LINE Channel ID 與 Channel secret。請啟用 `email_optional`，因為 LINE 使用者不一定授權 Email。
3. 在 Supabase **Authentication > URL Configuration** 加入本機與正式網站的 `/profile` Redirect URL。
4. 將 `public/config.js` 的 `LINE_LOGIN_ENABLED` 改為 `true`。LINE Channel secret 僅填入 Supabase Dashboard，絕不可放進 `config.js` 或 Git。

## 頁面與服務對應

- `src/pages/`：會員下單、付款、待處理、歷史、收藏、個人資料與管理後台頁面。
- `src/components/`：路由保護、訂單明細抽屜、版面與共用元件。
- `src/services/orderService.js`：會員訂單與付款方式。
- `src/services/adminService.js`：管理者訂單、付款、報表、通知觸發與診斷。
- `src/services/lineService.js`：LINE 綁定與通知偏好。
- `src/lib/supabase.js`：共用 Supabase client。

## 本版介面與後台規格

- 手機版以 `max-width: 760px` 的樣式覆蓋層重排訂購頁、熱門商品、交貨點與會員選單；桌面版版型與三步驟引導不應被手機規則影響。
- `OrderPage.jsx` 的桌面與手機主視覺可使用不同文字結構，但文案需保持一致。
- `AdminOrderDrawer.jsx` 的刪除按鈕會呼叫 `adminService.deleteAdminOrder`。此操作不可復原，僅在取消訂單且不需保留紀錄時使用。
- 刪除功能相依 `supabase/migrations/20260726000000_admin_delete_order.sql`；前端與 migration 必須一起部署。

完整產品與部署規格在根目錄 [README.md](../README.md)。遠端 E2E 測試要求見 [scripts/e2e/README.md](scripts/e2e/README.md)。
