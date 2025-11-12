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
- 親友最新動態（`index.html`、`assets/js/facebook-feed.js`）：將授權的 Facebook 親友貼文整理在首頁卡片，可一鍵刷新並提供聊天模組引用。
- 好友社群活動（`index.html`、`assets/js/friend-forum.js`、`setting.html`、`assets/js/elder-link.js`）：長者以手機註冊後取得 User ID，家屬可在設定頁綁定長者，長輩之間可透過手機加好友並在首頁論壇發起好友限定活動。
- 家族暖心語音（`assets/js/chat.js`）：長者只要說出指定口令（例如「我要加好友，電話是……」），就能透過後端自動呼叫 `/friends`、`/friend-events`、`/events` 等 API 完成好友、活動、提醒等操作。

### 長者專屬語音口令（家族暖心回饋）
- 「**我要加好友，電話是...**」：解析語音中的數字並送出好友邀請（每位長者最多 10 位好友）。
- 「**我要看好友邀請**」＋「我要接受／拒絕好友邀請一」：逐筆朗讀邀請並可語音確認或婉拒。
- 「**我要發起活動...**」：自動建立好友圈活動（含時間、地點），可同步寫入「今日重點提醒」。
- 「**我要看活動邀請**」＋「我要參加／取消活動一」：查看並語音回覆好友發起的活動。
- 「**幫我記語音備忘錄 / 提醒我...**」：將自然語句轉成 `user_events` 提醒，不需觸碰按鈕。
- 「**今天有什麼事要做**」「今天有沒有達成」「我完成提醒一」：朗讀今日提醒、追問活動是否完成並支援語音回報。
- 系統會在每次聊天結尾主動提醒「尚有幾筆好友／活動邀請」與「多少提醒未確認」，避免長者漏掉任何暖心回饋。這些語音功能僅在長者身分登入時啟用，家屬與社工仍可透過設定頁面協助管理。

## 後端服務
- 伺服器核心（`src/server.js`）：啟用 CORS、JSON 解析、日誌與 `/health` 健康檢查，統一掛載 API。
- 身份驗證（`routes/auth.js`）：註冊、登入、登出、`/me` 查詢與 `change-password`，採 HttpOnly Cookie JWT 與 `users` 資料表。
- 使用者資料（`routes/users.js`）：`GET/PATCH /api/users/me` 更新暱稱、聯絡資訊與年齡，具名額度限制保護。
- 聊天與語音（`routes/chat.js`、`services/*`）：語音先透過雅婷即時 WebSocket STT，再交給 Gemini 產生回覆，最後以雅婷短語音合成回傳音訊；`/chat/refine-title` 供備忘錄標題精煉。
- 提醒事件（`routes/events.js`）：`GET/POST/PATCH/DELETE /api/events` 操作 `user_events`，僅允許本人或 owner 操作。
- 健康與安全（`routes/ranking.js`、`routes/geofence.js`）：排行榜改寫 `data/healthMetrics.json` 示範倉；地理圍欄計算距離並用記憶體通知中心暫存告警。
- Facebook 親友貼文（`routes/facebook.js`、`routes/familyFeed.js`、`services/facebookService.js`）：使用 Graph API 取得授權家人（user_posts）及粉絲專頁貼文，並支援手動分享資料，提供前端卡片與聊天背景知識使用，內建快取避免頻繁呼叫。
- 長者綁定與好友圈（`routes/users.js`、`routes/friends.js`、`routes/friendEvents.js`）：`POST /api/users/link-elder` 以長者 User ID + 手機完成家屬指向（可同時綁 3 位長者）、`/api/friends` 系列管理好友邀請/接受、`/api/friend-events` 發起好友限定活動並追蹤參加狀態。

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
GET  /api/facebook/posts                          # 取得與呼叫者同家庭的 Facebook 授權貼文摘要
GET  /api/facebook/auth/url                       # 取得 Facebook OAuth 登入網址（需登入家屬）
GET  /api/facebook/auth/callback                  # Facebook OAuth callback（供 Facebook 呼叫）
GET  /api/family-feed/for-elder/:elderId          # 聚合指定長者的授權貼文＋手動分享
GET  /api/users/linked-elder                      # 查詢目前使用者綁定的長者
POST /api/users/link-elder                        # 以長者 User ID + 手機完成 owner 連結（最多 3 位）
GET  /api/friends                                  # 列出已接受的好友
GET  /api/friends/requests                         # 列出收到/送出的好友邀請
POST /api/friends/requests                         # 以手機送出好友邀請（限長者）
PATCH /api/friends/requests/:id                    # 接受、婉拒或取消邀請
GET  /api/friend-events                            # 讀取好友圈活動
POST /api/friend-events                            # 長者發起好友活動
POST /api/friend-events/:id/rsvp                   # 好友回覆是否參加活動
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
| Facebook | `FACEBOOK_ACCESS_TOKEN` | – | 具 `user_posts`/`read_stream` 授權的使用者長期存取權杖 |
|  | `FACEBOOK_GRAPH_API_URL` | `https://graph.facebook.com/v19.0` | 選填，覆寫 Graph API 版本或代理 |
|  | `FACEBOOK_CACHE_TTL_MS` | `180000` | 後端快取臉書貼文的毫秒數 |
|  | `FACEBOOK_PAGE_SOURCES` | – | 逗號分隔 `pageId\|token\|顯示名稱`，用於同步授權的粉絲專頁貼文 |
|  | `FACEBOOK_TOKEN_TABLE` | `oauth_facebook_tokens` | 儲存家人 Facebook OAuth 長效權杖的資料表名稱 |
|  | `FAMILY_FEED_SHARE_TABLE` | `family_feed_shares` | 手動分享（URL／摘要）儲存資料表名稱 |
|  | `FACEBOOK_TOKEN_SECRET` | – | 以 AES-256-GCM 加密/解密 `access_token_enc` 的密鑰，`encrypt:fb-token` 指令與服務端解密皆須設定 |
|  | `FACEBOOK_POST_LOOKBACK_DAYS` | `3650` | 從授權者 Facebook 抓貼文時的最遠回溯天數（預設 10 年） |
|  | `FACEBOOK_APP_ID` | – | Facebook for Developers App ID，用於 OAuth |
|  | `FACEBOOK_APP_SECRET` | – | Facebook App Secret，用於交換 access token |
|  | `FACEBOOK_OAUTH_REDIRECT_URI` | `http://localhost:3001/api/facebook/auth/callback` | Facebook OAuth callback URL，需與後台設定一致 |
|  | `FACEBOOK_OAUTH_SUCCESS_URL` | `http://localhost:3000/setting.html?facebook=success` | 成功授權後導回的前端頁面 |
|  | `FACEBOOK_OAUTH_FAILURE_URL` | `http://localhost:3000/setting.html?facebook=failed` | 授權失敗導回頁面 |

### Facebook 親友貼文整合
1. 為每位子女／親友提供「連結 Facebook」按鈕（repo 中在 `setting.html`），按下後會呼叫 `/api/facebook/auth/url` 並帶使用者前往 Facebook OAuth，scope 至少含 `public_profile,email,user_posts`。
2. Facebook 完成授權後會回傳到 `/api/facebook/auth/callback`。後端會：
   - 以 `FACEBOOK_APP_ID`/`FACEBOOK_APP_SECRET` 換取短期 token，再自動交換長期 token；
   - 以 `FACEBOOK_TOKEN_SECRET` 加密並寫入 `oauth_facebook_tokens`；
   - 依 `FACEBOOK_OAUTH_SUCCESS_URL` 或 `FACEBOOK_OAUTH_FAILURE_URL` 導回前端顯示結果。
3. 若要人工匯入 token，可用 `pnpm encrypt:fb-token -- "<raw_user_access_token>"` 產出 `iv:cipher:tag` 後執行：

   ```sql
   INSERT INTO oauth_facebook_tokens (user_id, fb_user_id, access_token_enc, expires_at)
   VALUES (:user_id, :facebook_uid, :encrypted_output, :expires_at)
   ON CONFLICT (user_id) DO UPDATE SET
     fb_user_id = EXCLUDED.fb_user_id,
     access_token_enc = EXCLUDED.access_token_enc,
     expires_at = EXCLUDED.expires_at,
     updated_at = now();
   ```

4. 若家人改用粉絲專頁分享，於 `FACEBOOK_PAGE_SOURCES` 設定 `pageId|pageAccessToken|顯示名稱`，即可同步 `/{$pageId}/posts` 的公開內容。
5. 想分享非 Facebook 文章時，可在 App 內建立「同步到長者」表單並寫入 `family_feed_shares`（可用 `FAMILY_FEED_SHARE_TABLE` 覆寫）。
6. `/api/family-feed/for-elder/:elderId` 會彙整同一家族已授權的成員、粉絲專頁及手動分享；`/api/facebook/posts` 則保持相容，專門給首頁卡片與聊天模組取用 Facebook 摘要。
7. 若沒有任何授權來源，系統會回傳 `disabled=true`，前端卡片會顯示提醒，聊天模組也不會引用 Facebook 內容。`FACEBOOK_ACCESS_TOKEN` 仍可作為單一測試用 fallback，但正式環境請以人體驗授權為主。

### 資料庫結構
以下為最小化的 PostgreSQL 建議結構，可依情境擴充欄位或外鍵：

```sql
CREATE TABLE users (
  user_id SERIAL PRIMARY KEY,
  email TEXT UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT NOT NULL,
  owner_user_ids INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[],
  relation TEXT,
  full_name TEXT,
  age INTEGER,
  phone TEXT UNIQUE,
  address TEXT,
  charactor TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT users_owner_ids_len CHECK (array_length(owner_user_ids, 1) <= 3)
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

CREATE TABLE oauth_facebook_tokens (
  user_id INTEGER PRIMARY KEY REFERENCES users(user_id),
  access_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  scopes TEXT[],
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE family_feed_shares (
  id SERIAL PRIMARY KEY,
  elder_id INTEGER NOT NULL REFERENCES users(user_id),
  speaker_name TEXT,
  summary TEXT,
  link_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE elder_friendships (
  friendship_id SERIAL PRIMARY KEY,
  requester_id INTEGER NOT NULL REFERENCES users(user_id),
  addressee_id INTEGER NOT NULL REFERENCES users(user_id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','declined','cancelled')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  responded_at TIMESTAMPTZ,
  CONSTRAINT elder_friendships_unique UNIQUE (requester_id, addressee_id)
);

CREATE TABLE elder_friend_events (
  event_id SERIAL PRIMARY KEY,
  host_user_id INTEGER NOT NULL REFERENCES users(user_id),
  title TEXT NOT NULL,
  description TEXT,
  start_time TIMESTAMPTZ NOT NULL,
  location TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE elder_friend_event_participants (
  id SERIAL PRIMARY KEY,
  event_id INTEGER NOT NULL REFERENCES elder_friend_events(event_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','going','declined')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  CONSTRAINT elder_friend_event_participants_unique UNIQUE (event_id, user_id)
);

> 每位長者最多可擁有 10 位好友，`elder_friendships.status` 控管邀請/接受流程，而 `elder_friend_event_participants` 追蹤好友活動的參加或婉拒回覆。
```

### owner_user_ids 變更 SQL
將既有 `owner_user_id` 欄位改為可儲存最多三位長者的 `owner_user_ids` 陣列，可依序執行：

```sql
BEGIN;

ALTER TABLE public.users
  ADD COLUMN owner_user_ids INTEGER[] NOT NULL DEFAULT '{}'::INTEGER[];

UPDATE public.users
  SET owner_user_ids = ARRAY[owner_user_id]
  WHERE owner_user_id IS NOT NULL;

ALTER TABLE public.users
  ADD CONSTRAINT users_owner_ids_len CHECK (array_length(owner_user_ids, 1) <= 3);

ALTER TABLE public.users
  DROP COLUMN owner_user_id;

CREATE INDEX IF NOT EXISTS users_owner_user_ids_gin
  ON public.users USING gin (owner_user_ids);

COMMIT;
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
- Facebook 親友貼文改為授權家人／粉絲專頁／手動分享的聚合流程，新增 `/api/family-feed/for-elder/:elderId` 並強化 `/api/facebook/posts` 的權限檢查。
- 新增 `pnpm encrypt:fb-token` 指令以 AES-256-GCM 產生可寫入 `oauth_facebook_tokens` 的加密值。
- README 重新整理現有功能與環境需求，便於開發與部署。
