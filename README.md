# 智護生活：AI 伴你

這是一款為高齡者打造的概念網站，示範「AI 奶奶」如何透過語音備忘錄、AI 陪聊、健康排行榜與 GPS 安全守護，協助長者在家安心、外出放心。

## 可用頁面

- `index.html`：首頁，展示服務願景、功能亮點與陪伴情境。
- `login.html` / `registration.html`：長者與家屬可登入或註冊帳號，啟動個人化陪伴。
- `selection.html`：選擇 AI 夥伴的年齡感與語氣風格。
- `setting.html`：一步一步完成提醒、活動與安全圍欄設定。
- `ranking.html`：以排行榜形式檢視步數與服藥準時度，鼓勵家人朋友互相加油。
- `forum.html`：社群公園，分享活動與暖心話題。
- `guide.html`：離線可用的安全指南，提供可朗讀的求助資訊與自救步驟。

## 使用方式

1. 下載或 clone 專案。
2. 使用瀏覽器開啟任一 HTML 檔案即可瀏覽對應頁面。
3. 推薦以行動裝置或平板模擬檢視，體驗高齡友善的大按鈕與高對比介面。

## 設計重點

- 延續紅色系漸層風格，搭配圓角卡片與大字體，提升可讀性。
- 所有頁面皆提供清楚的導覽連結，方便長者與家屬快速跳轉。
- 離線指南頁面內建瀏覽器語音朗讀功能，確保在無網路環境也能獲得協助。

## 後續展望

- 串接語音辨識、穿戴裝置與定位 API，從靜態體驗延伸至可實際操作的原型。
- 製作更多情境導引（例如醫院就診、搭乘交通工具），讓 AI 陪伴更貼近日常。



## 後端服務

專案新增 `server/` 目錄，提供 Node.js/Express 的示範後端，整合語音辨識、Gemini 聊天、語音合成、健康資料排行榜以及 GPS 安全圍欄。

### 啟動方式

```bash
cd server
npm install
cp .env.example .env # 填入 GEMINI_API_KEY 與 Google Cloud 認證
npm run start
```

服務預設於 `http://localhost:3001` 運行，提供下列 API：

- `POST /api/chat`：接收語音（Base64）或文字訊息，串接 Google Speech-to-Text、Gemini 與 Text-to-Speech，回傳聊天回覆與語音。
- `GET /api/ranking`：讀取並排序家族健康資料，支援 `metric` 查詢參數（如 `steps`、`medicationAdherence`）。
- `POST /api/ranking/sync`：更新或新增單一成員的計步、服藥與睡眠資料。
- `POST /api/geofence/check`：檢查使用者當前定位是否超出安全圍欄，並在超界時產生警示通知。
- `GET /api/geofence/notifications/:familyId`：查詢家族收到的警示通知。

健康資料預設儲存在 `server/data/healthMetrics.json`，可依實際情境改接資料庫或穿戴裝置 API。
