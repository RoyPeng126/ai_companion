# 智護生活：AI 伴你

智護生活是一套為長者、家屬與照護者打造的 AI 情感陪伴原型，整合語音聊天、備忘錄排程、健康指標與安全圍欄示範高齡友善的智慧照護體驗。前端採行動優先的靜態站點，後端以 Node.js/Express 暴露 REST API 與語音服務整合，方便延伸為真實服務。

## 專案目錄
- `frontend/`：靜態網頁與模組化腳本，含導覽、陪聊、排行榜、安全地圖、社群與離線指引。
- `backend/`：Express 伺服器、Gemini 聊天、雅婷語音轉文字與語音合成串接、PostgreSQL 存取與地理圍欄通知。

## 前端體驗
- AI 陪聊與語音備忘錄（`index.html`、`assets/js/chat.js`）：支援文字 / 語音輸入、語音轉文字、Gemini 回覆與 TTS 播放，並在 `localStorage` 儲存最多 20 筆語音備忘錄。
- 備忘錄快速排程（`assets/js/chat.js`、`assets/js/reminders.js`）：一鍵將文字或最近語音內容轉成 `/api/events` 事件，包含本地時間解析與標題精煉。
- 身分化導覽流程（`welcome.html` → `register-role.html` → `registration.html` → `selection.html` → `setting.html`）：依長者 / 家屬 / 社工提供不同提示並落地到設定頁。
- 語音與語者設定（`setting.html`、`assets/js/settings.js`）：調整語系與雅婷 TTS 聲線，會同步更新聊天 persona 與語音參數。
- 健康排行榜（`ranking.html`、`assets/js/ranking.js`）：使用示範資料呈現步數 / 服藥 / 聊天指標，可依需求改接 `/api/ranking`。
- 安全守護與家族資源（`index.html`、`setting.html`、`assets/js/safety-map.js`、`guide.html`、`forum.html`）：Leaflet 地圖搭配 Nominatim 住址搜尋、離線求助指引與簡易社群。

## 後端服務
- 伺服器核心（`src/server.js`）：啟用 CORS、JSON 解析、日誌與 `/health` 健康檢查，統一掛載 API。
- 身份驗證（`routes/auth.js`）：註冊、登入、登出、`/me` 查詢與 `change-password`，採 HttpOnly Cookie JWT 與 `users` 資料表。
- 使用者資料（`routes/users.js`）：`GET/PATCH /api/users/me` 更新暱稱、聯絡資訊與年齡，具名額度限制保護。
- 聊天與語音（`routes/chat.js`、`services/*`）：語音先透過雅婷即時 WebSocket STT，再交給 Gemini 產生回覆，最後以雅婷短語音合成回傳音訊；`/chat/refine-title` 供備忘錄標題精煉。
- 提醒事件（`routes/events.js`）：`GET/POST/PATCH/DELETE /api/events` 操作 `user_events`，僅允許本人或 owner 操作。
- 健康與安全（`routes/ranking.js`、`routes/geofence.js`）：排行榜改寫 `data/healthMetrics.json` 示範倉；地理圍欄計算距離並用記憶體通知中心暫存告警。

### API 端點速覽
```text
GET  /health                                      # 服務健康檢查
POST /api/auth/register                           # 建立使用者
POST /api/auth/login                              # 帳號登入（HttpOnly Cookie）
POST /api/auth/logout                             # 清除登入狀態
GET  /api/auth/me                                 # 取得目前使用者
POST /api/auth/change-password                    # 變更密碼
GET  /api/users/me                                # 讀取個人檔案
PATCH /api/users/me                               # 更新個人檔案
POST /api/chat                                    # 語音/文字對話並回傳 TTS
POST /api/chat/refine-title                       # 將口語文字精煉成備忘錄標題
GET  /api/events                                  # 依時間範圍列出事件
POST /api/events                                  # 新增事件（owner 預設為自己）
PATCH /api/events/:id                             # 更新事件，僅限相關人
DELETE /api/events/:id                            # 刪除事件
GET  /api/ranking                                 # 讀取健康指標排行
GET  /api/ranking/:userId                         # 取得單一使用者指標
POST /api/ranking/sync                            # 匯入/更新指標資料
POST /api/geofence/check                          # 檢查位置是否超出安全範圍
GET  /api/geofence/notifications/:familyId        # 讀取特定家族通知
```

## 建置與啟動
### 需求
- Node.js 18+（原生 `fetch` 與頂層 await）。
- pnpm 8+。
- PostgreSQL（需建立 `users` 與 `user_events` 表）。
- 雅婷 STT/TTS 服務與 Gemini API 金鑰。

### 安裝與啟動
1. 安裝依賴：`cd backend && pnpm install`，接著 `cd ../frontend && pnpm install`（僅提供啟動靜態伺服器）。
2. 啟動後端：`cd backend && pnpm run dev`（預設 `http://localhost:3001`）。
3. 啟動前端：`cd frontend && pnpm run dev` 以 `serve` 開啟 `http://localhost:3000`。
4. 預設前端會向 `http://localhost:3001/api` 發送請求，可於 `frontend/assets/js/app.js` 調整 `apiBaseUrl`。

### 環境變數
| 類別 | 變數 | 預設值 | 說明 |
| --- | --- | --- | --- |
| 核心 | `PORT` | `3001` | 後端監聽埠號 |
|  | `CORS_ORIGINS` | `http://localhost:3000` | 允許的前端來源（逗號分隔） |
|  | `JWT_SECRET` | `dev_secret_change_me` | 簽發登入 Token 的密鑰 |
| 資料庫 | `DATABASE_URL` | – | PostgreSQL 連線字串，建議開啟 TLS |
| Gemini | `GEMINI_API_KEY` | – | Gemini 金鑰（必要） |
|  | `GEMINI_MODEL` | `gemini-1.5-flash-latest` | 使用的模型名稱 |
|  | `GEMINI_API_VERSION` | – | 選填，指定 Gemini API 版本 |
|  | `GEMINI_MAX_OUTPUT_TOKENS` | `512` 起 | 最低輸出字數限制，低於 512 會自動調整 |
| STT | `YATING_STT_API_KEY` | – | 雅婷語音轉文字金鑰 |
|  | `YATING_STT_PIPELINE` | 根據語系自動推論 | 可自行指定 Pipeline |
|  | `YATING_STT_CUSTOM_MODEL` | – | 選填，自訂模型 |
|  | `YATING_STT_TOKEN_URL` | 官方預設 | 佈建自有 Gateway 時覆寫 |
|  | `YATING_STT_WS_URL` | 官方預設 | 語音串流 WebSocket 位址 |
|  | `YATING_STT_TIMEOUT_MS` | `45000` | 語音串流逾時毫秒數 |
|  | `YATING_STT_SAMPLE_RATE` | `16000` | 目前僅支援 16 kHz PCM |
|  | `YATING_STT_CHUNK_SIZE` | `2000` | WebSocket 傳輸分片大小（位元組） |
| TTS | `TTS_API_KEY` | – | 雅婷語音合成金鑰 |
|  | `TTS_API_HOST` | `https://tts.api.yating.tw` | 可改為專案代理位址 |
|  | `TTS_VOICE_MODEL` | `zh_en_female_1` | 預設語音模型 |
|  | `TTS_AUDIO_ENCODING` | `LINEAR16` | 音訊編碼（`LINEAR16` 或 `MP3`） |
|  | `TTS_AUDIO_SAMPLE_RATE` | `22K` | 音檔採樣率 |

### 資料庫結構
以下為最小化的 PostgreSQL 建議結構，可依情境擴充欄位或外鍵：

```sql
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  owner_user_id INTEGER,
  relation TEXT,
  full_name TEXT,
  age INTEGER,
  phone TEXT,
  address TEXT,
  charactor TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE user_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  owner_user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  reminder_time TIMESTAMPTZ,
  location TEXT,
  is_all_day BOOLEAN DEFAULT false,
  recurrence_rule TEXT,
  recurrence_end_date TIMESTAMPTZ,
  category TEXT,
  status BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

## 開發小提醒
- 後端可使用 `pnpm run lint` 檢查程式碼風格；nodemon 會自動重啟開發伺服器。
- `window.aiCompanion` 集中管理前端設定與 API 包裝，調整 `apiBaseUrl` 或語音參數時請從 `assets/js/app.js` 下手。
- 語音錄製流程使用 Web Audio API 轉成 16 kHz PCM，若目標裝置不支援請額外處理取樣率。
- 備忘錄會儲存在 `localStorage`（鍵值 `ai-companion.voiceMemos`）；部署前可視需求改為後端儲存。
- 安全地圖呼叫 Nominatim 公共 API，部署時請遵循服務使用政策並考慮快取。

## 最新更新
- 引入 `/api/events` 系列端點，支援長者語音備忘錄轉成排程提醒。
- 聊天流程整合雅婷 WebSocket STT、Gemini 回覆與雅婷短語音合成。
- 前端聊天模組新增語音備忘錄清單、快速新增備忘錄與 persona 同步。
- 語音設定頁支援國語 / 台語語者切換並同步調整聊天語氣。
- 安全地圖重構為可搜尋、儲存住址與檢查半徑的 Leaflet 介面。
- README 重新整理現有功能與環境需求，便於開發與部署。
