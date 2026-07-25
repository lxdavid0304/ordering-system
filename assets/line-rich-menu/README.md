# LINE 圖文選單

這個資料夾提供四動作圖文選單的上傳素材與動作設定。

## 內容

- `default-rich-menu.png`: 上傳至 LINE Official Account Manager 的圖片。
- `default-rich-menu.json`: 使用 LINE Messaging API 建立選單時的設定。右下角「敬請期待」沒有設定觸發區，點擊不會執行動作。
- `../../scripts/create-line-rich-menu.ps1`: 重新產生圖片的腳本。

## 四個區塊

| 位置 | 顯示文字 | 動作 |
| --- | --- | --- |
| 上方 | 我要訂購 | 前往訂購頁 |
| 左下 | 取貨與付款 | 前往訂購流程說明 |
| 中下 | 熱門商品／開團中商品 | 前往訂購頁的熱門商品區 |
| 右下 | 敬請期待 | 預留，暫不設定動作 |

## LINE Official Account Manager 設定

1. 開啟圖文選單，建立「上方一格、下方三格」的四動作版型。
2. 上傳 `default-rich-menu.png`。
3. 依 `default-rich-menu.json` 的三個 `areas` 設定網址動作。
4. 儲存並設為預設圖文選單。

圖文選單圖片與設定可由 LINE Official Account Manager 建立；目前專案不保存 LINE Channel Access Token，因此不會把密鑰放入 Git 或瀏覽器端。
