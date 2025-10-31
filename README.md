# 智護生活：AI 伴你

智護生活是一套為長者、家屬與照護者打造的 AI 情感陪伴原型，結合語音備忘錄、情境化陪聊、健康排行榜與 GPS 安全圍欄，示範高齡友善的智慧照護體驗。前端與後端採分離式開發，方便延展成實際服務。

## 專案目錄
- `frontend/`：行動優先的靜態介面，含登入註冊、角色導覽、陪伴設定、排行榜、社群與安全地圖等頁面。
- `backend/`：Node.js + Express 服務，整合 Gemini 聊天、Google Speech-to-Text、語音合成、PostgreSQL 使用者資料與地理圍欄通知。

## 核心體驗
- **語音助理與備忘錄**：首頁聊天卡支援文字 / 語音輸入，串接 Gemini 回覆並自動儲存備忘錄，聊天語系與聲線會依 persona 與語言設定同步更新。
- **個人化陪伴設定**：welcome → register-role → registration → selection → setting 的串接流程，依長者、家屬或社工身分提供不同提示，設定結果保存在 `localStorage`。
- **健康照護儀表**：`ranking.html` 與 `frontend/assets/js/ranking.js` 顯示步數、服藥、睡眠排行，可即時呼叫 `/api/ranking`、`/api/ranking/sync` 更新資料。
- **安全守護**：Leaflet 地圖 (`safety-map.js`) 支援台灣行政區搜尋、地理編碼、圓形安全圍欄與距離計算，可搭配後端 `/api/geofence/check` 發送超界通知。
- **家人社群與離線支援**：`forum.html`、`features.html` 提供情感互動，`guide.html` 內建瀏覽器朗讀，確保離線時仍能取得求助步驟。

## 後端服務
- Express 伺服器集中於 `backend/src/server.js`，啟用 CORS、日誌與錯誤處理。
- `/api/auth` 路由提供註冊、登入、`/me` 查詢、修改密碼；採 JWT（簽發後以 HttpOnly Cookie 儲存）與 PostgreSQL `users` 資料表。
- `/api/chat` 將語音送往 Google STT，再帶入 persona prompt 呼叫 Gemini，最後使用語音合成服務回傳音檔。
- `/api/ranking` 使用 `backend/data/healthMetrics.json` 作為暫存倉，可依需求換成實際穿戴裝置或資料庫。
- `/api/geofence` 結合 `geolib` 判斷是否離開安全範圍，並透過 `notificationService` 暫存不同家族的警示。

### API 端點速覽
- `POST /api/auth/register`：建立使用者並回傳基本資料。
- `POST /api/auth/login`：驗證帳密、簽發 cookie 式 JWT。
- `GET /api/auth/me`：檢查登入狀態，需附帶 cookie。
- `POST /api/chat`：輸入語音或文字取得 Gemini 回應與 TTS 音訊。
- `GET /api/ranking`：依 `metric` 參數（`steps`、`medicationAdherence`、`sleepHours`）排序家族資料。
- `POST /api/geofence/check`：將目前定位與安全圍欄送入後端，若超界會回傳通知記錄。

## 建置與啟動
### 需求
- Node.js 18+（內建 `fetch` 與頂層 await）、pnpm 8+。
- PostgreSQL（本地或雲端，`.env` 需指定 `DATABASE_URL`）。
- Google Cloud Speech-to-Text 與 Gemini API 金鑰、語音合成服務金鑰。

### 安裝步驟
1. `cd backend && pnpm install`
2. `cd ../frontend && pnpm install`（僅供管理命令；靜態資源不需編譯）

### 啟動服務
```bash
# 後端（預設 http://localhost:3001）
cd backend
pnpm run dev

# 另開終端啟動前端（預設 http://localhost:3000）
cd frontend
pnpm run dev 
# 或任何靜態伺服器，例如 python -m http.server 3000
```
前端預設向 `http://localhost:3001/api` 發送請求，如需不同網域請調整 `backend/.env` 的 `CORS_ORIGINS`。

## 環境變數（backend/.env）
- 核心服務：`PORT`（預設 3001）、`CORS_ORIGINS`。
- 身份驗證：`JWT_SECRET`、`TOKEN_TTL_SECONDS`（可選，預設 7 天）。
- Gemini：`GEMINI_API_KEY`、`GEMINI_MODEL`、`GEMINI_MAX_OUTPUT_TOKENS`。
- 語音辨識：`GOOGLE_APPLICATION_CREDENTIALS` 或 `GOOGLE_APPLICATION_CREDENTIALS_JSON`。
- 語音合成：`TTS_API_KEY`、`TTS_VOICE_MODEL`、`TTS_AUDIO_ENCODING`、`TTS_AUDIO_SAMPLE_RATE`。
- 資料庫：`DATABASE_URL`（需指定 TLS 參數或使用雲端服務提供的連線字串）。

## 開發小提醒
- `pnpm run lint`（於 `backend/`）可檢查 Express 專案程式碼品質。
- `frontend/assets/js/*.js` 為模組化腳本，若需調整地圖或聊天邏輯請從對應檔案著手。
- Leaflet 與 Nominatim 採用開源瓦片與 API，若要部署請遵守相關使用政策。
- `backend/data/healthMetrics.json` 為示範資料，部署時可改成真正的資料來源或排程更新。

## 最新更新
- 新增 welcome → register-role → registration 的身分導向式導覽，引導不同使用者完成設定。
- 後端加入 PostgreSQL 使用者資料表、cookie JWT 登入、個人檔案編輯與密碼修改流程。
- 聊天服務改用 Gemini 2.5 Flash，支援 persona 設定、語系與語速同步到語音合成。
- 安全守護流程整合 Leaflet 地圖、台灣行政區搜尋與 `/api/geofence/check` 提醒。
- 健康排行榜與 `/api/ranking/sync` 支援步數、服藥、睡眠三指標的排行與同步。
- README 更新：補齊環境設定、啟動教學與前後端功能說明，方便快速上手。
