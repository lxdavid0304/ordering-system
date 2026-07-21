# 遠端下單 E2E 測試

這些腳本會呼叫遠端 `create-order` Edge Function，僅可用於獨立的測試 Supabase 專案與測試會員。腳本不應對正式資料庫、正式會員或正式 LINE 綁定執行。

## 必要環境變數

```powershell
$env:E2E_SUPABASE_URL = "https://your-test-project.supabase.co"
$env:E2E_SUPABASE_ANON_KEY = "..."
$env:E2E_SUPABASE_SERVICE_ROLE_KEY = "..."
$env:E2E_ALLOW_REMOTE = "true"
```

`E2E_ALLOW_REMOTE=true` 是刻意的安全開關。未設定時，腳本應拒絕連到遠端。

## 執行

```powershell
npm run test:e2e:under-300
npm run test:e2e:over-300
```

兩個案例分別驗證低於或等於 300 元的直接採買狀態，以及高於 300 元的待確認訂金狀態。完成後請檢查訂單資料、初始 LINE job 快照與通知狀態；不要將任何測試用密鑰寫入 Git。
