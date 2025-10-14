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

## 互動功能亮點

- 首頁的聊天卡片提供「國語 / 台語」語系切換，會同步更新語音合成設定，確保 AI 回覆使用對應語系的聲線與 `languageCode`。
- 每個語系皆提供「雅婷、意晴、家豪」三種預設聲線：國語對應 `zh_en_female_1`、`zh_en_female_2`、`zh_en_male_1`，台語對應 `tai_female_1`、`tai_female_2`、`tai_male_1`（支援 16K 取樣）。
- 使用者選擇會保存於瀏覽器的 `localStorage`，重新整理或改機器仍能延續個人喜好。

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

1. **後端（Node.js/Express）**
   ```bash
   cd server
   pnpm install
   cp .env.example .env  # 填好 GEMINI_API_KEY、Google 語音憑證、TTS_API_KEY 等變數
   pnpm run dev          # 或 pnpm run start
   ```
   - Windows PowerShell 可改用 `Copy-Item .env.example .env`，傳統命令列使用 `copy .env.example .env`。
   - 語音辨識使用 Google Cloud Speech-to-Text，請準備服務帳號憑證（`GOOGLE_APPLICATION_CREDENTIALS` 或 `GOOGLE_APPLICATION_CREDENTIALS_JSON`）。
   - 語音合成透過 [Yating 雲端語音合成 API](https://tts.api.yating.tw)，請於 `.env` 設定 `TTS_API_KEY`，並視需求調整 `TTS_VOICE_MODEL`、`TTS_AUDIO_ENCODING`、`TTS_AUDIO_SAMPLE_RATE`；目前內建支援國語 `zh_en_*` 與台語 `tai_*` 聲線（台語模型建議使用 16K 取樣）。
   - 預設僅允許 `http://localhost:3000` 前端來源，若需要額外網域請在 `.env` 的 `CORS_ORIGINS` 以逗號加入。

2. **前端（靜態頁面）**
   ```bash
   pnpm dlx serve -l 3000   # 或任何靜態伺服器，例如 python -m http.server 3000
   # 於專案根目錄執行，瀏覽器開 http://localhost:3000
   ```
   - 前端會向 `http://localhost:3001/api/...` 發送請求，必要時請在後端設定 CORS。

服務預設於 `http://localhost:3001` 運行，提供下列 API：

- `POST /api/chat`：接收語音（Base64）或文字訊息，透過 Google Speech-to-Text（STT）、Gemini（聊天）與 Yating 語音合成（TTS），回傳聊天回覆與語音。
- `GET /api/ranking`：讀取並排序家族健康資料，支援 `metric` 查詢參數（如 `steps`、`medicationAdherence`）。
- `POST /api/ranking/sync`：更新或新增單一成員的計步、服藥與睡眠資料。
- `POST /api/geofence/check`：檢查使用者當前定位是否超出安全圍欄，並在超界時產生警示通知。
- `GET /api/geofence/notifications/:familyId`：查詢家族收到的警示通知。

健康資料預設儲存在 `server/data/healthMetrics.json`，可依實際情境改接資料庫或穿戴裝置 API。
