"use strict";

(function () {
  const MEMO_STORAGE_KEY = "ai-companion.voiceMemos";
  const MAX_CONTEXT_MESSAGES = 10;
  const MAX_MEMOS = 20;
  const AVATARS = {
    child: "assets/image/雅婷.jpg",
    adult: "assets/image/意晴.jpg",
    senior: "assets/image/家豪.jpg"
  };
  const PERSONA_LABELS = {
    child: "活力童年版",
    adult: "溫柔青壯版",
    senior: "智慧長者版"
  };

  const chatElement = document.querySelector("[data-ai-chat]");
  if (!chatElement || !window.aiCompanion) return;

  const logElement = chatElement.querySelector("#chat-log");
  const statusElement = chatElement.querySelector("#chat-status");
  const personaElement = chatElement.querySelector("#chat-persona");
  const personaSelector = chatElement.querySelector("#persona-selector");
  const memoListElement = chatElement.querySelector("#memo-list");
  const clearMemosButton = chatElement.querySelector("#clear-memos");
  const textarea = chatElement.querySelector("#chat-message");
  const sendButton = chatElement.querySelector("#send-text");
  const recordButton = chatElement.querySelector("#record-toggle");
  const recordLabel = recordButton?.querySelector("[data-record-label]");
  const voiceHeader = chatElement.querySelector('.voice-memos-header');
  const chatActions = chatElement.querySelector('.chat-actions');

  // ==== Reminders helpers (text/voice to user_events) ====
  const tzToday = () => {
    try {
      const tz = 'Asia/Taipei';
      const now = new Date();
      return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
    } catch { return new Date().toISOString().slice(0,10) }
  };

  const openReminderDialog = (defaults) => {
    const d = Object.assign({ title:'', category:'', description:'', date: tzToday(), time:'09:00', remind:'' }, defaults || {});
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:16px;max-width:420px;width:92%;padding:18px 16px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;position:relative;';
    panel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">新增備忘錄</h3>
      <button id="rmClose" type="button" aria-label="關閉" style="position:absolute;top:10px;right:10px;border:none;background:transparent;font-size:18px;cursor:pointer;line-height:1">×</button>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">
        <div style="grid-column:1/-1"><label>標題</label><input id="rmTitle" type="text" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>
        <div><label>日期</label><input id="rmDate" type="date" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>
        <div><label>時間</label><input id="rmTime" type="time" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>
        <div><label>提醒時間(可選)</label><input id="rmRemind" type="time" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>
        <div><label>類別</label><select id="rmCat" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"><option value="">未分類</option><option value="medicine">用藥</option><option value="exercise">運動</option><option value="appointment">就醫</option><option value="chat">聊天</option></select></div>
        <div style="grid-column:1/-1"><label>說明(可選)</label><input id="rmDesc" type="text" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="rmCancel" class="btn secondary" type="button">取消</button>
        <button id="rmSave" class="btn" type="button">儲存</button>
      </div>`;
    overlay.appendChild(panel); document.body.appendChild(overlay);
    const $ = (id) => panel.querySelector(id);
    $('#rmTitle').value = d.title; $('#rmCat').value = d.category; $('#rmDesc').value = d.description; $('#rmDate').value = d.date; $('#rmTime').value = d.time; $('#rmRemind').value = d.remind;
    const close = () => { try { document.body.removeChild(overlay) } catch(_){} };
    $('#rmCancel').addEventListener('click', close);
    $('#rmClose').addEventListener('click', close);
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close() });
    const onKey = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey) } };
    window.addEventListener('keydown', onKey);
    $('#rmSave').addEventListener('click', async () => {
      const title = $('#rmTitle').value.trim(); const date = $('#rmDate').value; const time = $('#rmTime').value; const remind = $('#rmRemind').value; const category = $('#rmCat').value || null; const description = $('#rmDesc').value.trim() || null;
      if (!title || !date || !time) { alert('請填寫標題/日期/時間'); return }
      const startIso = `${date}T${time}:00+08:00`; const remindIso = remind ? `${date}T${remind}:00+08:00` : startIso;
      try {
        await window.aiCompanion.fetchJson('/events', {
          method:'POST',
          body: JSON.stringify({ title, category, description, start_time: startIso, end_time: startIso, reminder_time: remindIso })
        });
        close();
        try { createMessage('ai', '已新增備忘錄：' + title) } catch(_) {}
      } catch { alert('新增失敗，稍後再試') }
    });
  };

  if (!logElement || !statusElement || !textarea || !sendButton || !recordButton || !memoListElement) {
    console.warn("[AI Companion] 聊天所需的元素缺失，無法啟動互動功能。");
    return;
  }

  let conversation = [];
  let memos = [];
  let isBusy = false;
  let recorder = null;
  let audioChunks = [];
  let mediaStream = null;
  let recording = false;
  let activePersona = "senior";
  const updateRecordButton = (isRecording) => {
    recordButton.classList.toggle("recording", isRecording);
    recordButton.setAttribute("aria-label", isRecording ? "停止錄音" : "開始錄音");
    if (recordLabel) {
      recordLabel.textContent = isRecording ? "停止錄音" : "開始錄音";
    }
  };

  const loadMemos = () => {
    try {
      const stored = window.localStorage.getItem(MEMO_STORAGE_KEY);
      if (!stored) return [];
      return JSON.parse(stored);
    } catch (error) {
      console.warn("[AI Companion] 無法載入語音備忘錄。", error);
      return [];
    }
  };

  const saveMemos = () => {
    try {
      window.localStorage.setItem(MEMO_STORAGE_KEY, JSON.stringify(memos));
    } catch (error) {
      console.warn("[AI Companion] 無法儲存語音備忘錄。", error);
    }
  };

  const formatTime = (timestamp) => window.aiCompanion.formatTimestamp(timestamp);

  const setStatus = (message, isError = false) => {
    if (!statusElement) return;
    statusElement.textContent = message ?? "";
    statusElement.classList.toggle("error", !!isError);
  };

  const scrollLogToBottom = () => {
    if (!logElement) return;
    requestAnimationFrame(() => {
      logElement.scrollTop = logElement.scrollHeight;
    });
  };

  const getAvatarForRole = (role) => {
    if (role === "ai") {
      return AVATARS[activePersona] ?? AVATARS.senior;
    }
    return null;
  };

  const createMessage = (role, text) => {
    const row = document.createElement("div");
    row.className = `message-row message-row--${role}`;

    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;
    bubble.textContent = text;

    if (role === "ai") {
      const avatarUrl = getAvatarForRole(role);
      if (avatarUrl) {
        const avatar = document.createElement("div");
        avatar.className = "message-avatar";

        const img = document.createElement("img");
        img.src = avatarUrl;
        img.alt = `${PERSONA_LABELS[activePersona] ?? "AI 夥伴"}頭像`;

        avatar.appendChild(img);
        row.appendChild(avatar);
      }
    }

    row.appendChild(bubble);
    logElement.appendChild(row);
    scrollLogToBottom();
    return bubble;
  };

  const renderMemos = () => {
    memoListElement.innerHTML = "";
    if (!memos.length) {
      const empty = document.createElement("li");
      empty.className = "memo-empty helper-text";
      empty.textContent = "目前沒有語音備忘錄，開始錄音新增一筆吧！";
      memoListElement.appendChild(empty);
      return;
    }

    memos.forEach((memo) => {
      const item = document.createElement("li");
      item.dataset.memoId = memo.id;
      if (memo.done) item.classList.add("memo-done");

      const meta = document.createElement("div");
      meta.className = "memo-meta";
      meta.innerHTML = `<span>${memo.source === "voice" ? "🎙️ 語音" : "📝 文字"}</span><span>${formatTime(memo.createdAt)}</span>`;

      const text = document.createElement("div");
      text.className = "memo-text";
      text.textContent = memo.text;

      const actions = document.createElement("div");
      actions.className = "memo-actions";

      const toggleButton = document.createElement("button");
      toggleButton.className = "btn secondary";
      toggleButton.type = "button";
      toggleButton.textContent = memo.done ? "標記未完成" : "標記完成";
      toggleButton.addEventListener("click", () => {
        memo.done = !memo.done;
        saveMemos();
        renderMemos();
      });

      const removeButton = document.createElement("button");
      removeButton.className = "btn secondary";
      removeButton.type = "button";
      removeButton.textContent = "刪除";
      removeButton.addEventListener("click", () => {
        memos = memos.filter((entry) => entry.id !== memo.id);
        saveMemos();
        renderMemos();
      });

      actions.appendChild(toggleButton);
      actions.appendChild(removeButton);

      item.appendChild(meta);
      item.appendChild(text);
      item.appendChild(actions);
      memoListElement.appendChild(item);
    });
  };

  const addMemo = ({ text, source }) => {
    if (!text) return;
    const memo = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      source,
      done: false,
      createdAt: new Date().toISOString()
    };
    memos.unshift(memo);
    memos = memos.slice(0, MAX_MEMOS);
    saveMemos();
    renderMemos();
  };

  const normalizePersona = (key) => (PERSONA_LABELS[key] ? key : "senior");

  const updatePersonaLabel = (personaKey) => {
    const normalized = normalizePersona(personaKey);
    const label = PERSONA_LABELS[normalized];
    if (personaElement) {
      personaElement.textContent = `目前陪聊夥伴：${label}`;
    }
    if (personaSelector && personaSelector.value !== normalized) {
      personaSelector.value = normalized;
    }
    activePersona = normalized;
    return normalized;
  };

  const enableInputs = (enable) => {
    isBusy = !enable;
    textarea.disabled = !enable;
    sendButton.disabled = !enable;
    recordButton.disabled = !enable && !recording;
  };

  // Quick parser for creating a reminder from Chinese text.
  const parseQuickReminder = (rawText) => {
    // 1) 去除常見前綴（我要加入備忘錄、請提醒我、幫我記得...）
    let text = (rawText || '').trim()
      .replace(/^[，。、\s]+/, '')
      .replace(/(我要.*?(加入)?備忘錄|請提醒我|提醒我|可以提醒我|麻煩提醒我|幫我(記得|提醒)|幫我(加|加入|新增).{0,6}?備忘錄)/g, '')
      .replace(/^[，。、\s]+/, '')
      .trim();

    const now = new Date();
    const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t };
    let dateObj = now;
    if (/後天/.test(text)) dateObj = addDays(now, 2);
    else if (/明天/.test(text)) dateObj = addDays(now, 1);
    else if (/今天/.test(text)) dateObj = now;

    // 2) 時間解析
    let hour = 9, minute = 0;
    const pmHint = /下午|晚上|傍晚/.test(text);
    const amHint = /上午|早上|清晨/.test(text);
    if (/中午/.test(text)) { hour = 12; minute = 0; }

    let timeMatch = text.match(/(\d{1,2})[：:](\d{2})/);
    if (timeMatch) {
      hour = parseInt(timeMatch[1], 10); minute = parseInt(timeMatch[2], 10);
    } else {
      timeMatch = text.match(/(\d{1,2})\s*點\s*(半|((\d{1,2})\s*分))?/);
      if (timeMatch) {
        hour = parseInt(timeMatch[1], 10);
        if (timeMatch[2] === '半') minute = 30; else if (timeMatch[4]) minute = parseInt(timeMatch[4], 10);
      }
    }
    if (pmHint && hour < 12) hour += 12; // 下午/晚上轉 24 小時
    if (amHint && hour === 12) hour = 0;  // 口語「上午12點」→ 00:00

    // 3) 組 ISO（固定 +08:00，DB 以 UTC 儲存故會看到減 8 小時）
    const pad = (n) => String(n).padStart(2, '0');
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).format(dateObj);
    const timeStr = `${pad(hour)}:${pad(minute)}`;

    // 4) 類別判斷
    let category = null;
    if (/藥|吃藥|用藥/.test(text)) category = 'medicine';
    else if (/運動|散步|慢跑|走路/.test(text)) category = 'exercise';
    else if (/看醫生|回診|門診|就醫/.test(text)) category = 'appointment';
    else if (/聊天|通話|電話/.test(text)) category = 'chat';

    // 5) 產生精簡標題：{期間}{時刻}{動作}
    const period = (hour >= 12 ? (hour === 12 ? '中午' : '下午') : '上午');
    const dispHour = ((hour % 12) || 12);
    const dispMinute = minute === 0 ? '' : (minute === 30 ? '半' : `${minute}分`);
    const timeLabel = `${period}${dispHour}點${dispMinute}`;

    // 把日期/時間字樣移除，留下動作片語
    const dateWords = /(今天|明天|後天)/g;
    const timeWords = /(下午|上午|晚上|中午|早上|清晨)/g;
    const clockWords = /(\d{1,2}[：:]\d{2}|\d{1,2}\s*點(半|(\d{1,2})\s*分)?)/g;
    let action = text.replace(dateWords, '').replace(timeWords, '').replace(clockWords, '')
      .replace(/^要|需要|想要|請|一下|一下子|一下下/g, '')
      .replace(/^[，。、\s]+/, '')
      .trim();
    // 去掉句尾贅詞/語氣詞與問句尾巴
    action = action
      .replace(/(好|可以|行|ok|OK|對|對不對)嗎[?？]*$/g, '')
      .replace(/(可以)?(嗎|嘛|呢|啊|呀|啦|唷|喔|齁|吼|吧|耶)\s*[?？]*$/g, '')
      .replace(/[，。、；;。！!？?]+$/g, '')
      .trim();
    if (!action) {
      const catLabel = { medicine: '吃藥', exercise: '運動', appointment: '看醫生', chat: '聊天' };
      action = catLabel[category] || '';
    }

    const conciseTitle = `${timeLabel}${action ? action : ''}`.trim().slice(0, 60);
    const startIso = `${dateStr}T${timeStr}:00+08:00`;
    return { title: conciseTitle, category, startIso };
  };

  const blobToBase64 = (blob) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (!result) {
        reject(new Error("音訊資料轉換失敗"));
        return;
      }
      const base64 = String(result).split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("音訊資料讀取失敗"));
    reader.readAsDataURL(blob);
  });

  const playAudioResponse = (audioPayload) => {
    if (!audioPayload) return;
    const {
      audioContent,
      contentType = 'audio/wav'
    } = audioPayload;

    if (!audioContent) return;

    const audio = new Audio(`data:${contentType};base64,${audioContent}`);
    audio.play().catch((error) => {
      console.warn("[AI Companion] 語音播放失敗。", error);
    });
  };

  const trimContext = () => {
    if (conversation.length <= MAX_CONTEXT_MESSAGES) return;
    conversation = conversation.slice(conversation.length - MAX_CONTEXT_MESSAGES);
  };

  const sendToChat = async ({ text, audioBase64, placeholder }) => {
    if (!text && !audioBase64) {
      setStatus("請先輸入文字或錄製語音。", true);
      return;
    }

    const { persona, speechConfig } = window.aiCompanion.settings;
    const payload = {
      persona,
      context: conversation.map(({ role, text: ctxText }) => ({ role, text: ctxText })),
      speechConfig
    };

    if (text) {
      payload.message = text;
    }

    if (audioBase64) {
      payload.audio = {
        content: audioBase64,
        encoding: "WEBM_OPUS"
      };
    }

    try {
      enableInputs(false);
      setStatus("AI 夥伴思考中，請稍候...");

      const response = await window.aiCompanion.fetchJson("/chat", {
        method: "POST",
        body: JSON.stringify(payload)
      });

      const fallbackText = audioBase64 ? "（語音訊息）" : text;
      const userText = response.transcript || fallbackText;
      if (placeholder) {
        placeholder.textContent = userText;
      } else if (userText) {
        createMessage("user", userText);
      }

      if (userText) {
        conversation.push({ role: "user", text: userText });
        trimContext();
        if (audioBase64) {
          addMemo({ text: userText, source: "voice" });
        }
      }

      const replyText = response.responseText ?? "我收到囉！";
      createMessage("ai", replyText);
      conversation.push({ role: "model", text: replyText });
      trimContext();

      playAudioResponse(response.audio);
      setStatus("AI 夥伴已回覆。");
    } catch (error) {
      console.error("[AI Companion] 聊天請求失敗。", error);
      setStatus(error.message, true);
      if (placeholder && audioBase64) {
        placeholder.textContent = "語音轉寫失敗，請重試一次。";
      }
    } finally {
      enableInputs(true);
    }
  };

  const stopRecorder = () => {
    if (!recording) return;

    recording = false;
    updateRecordButton(false);

    if (recorder && recorder.state !== "inactive") {
      recorder.stop();
    }

    if (mediaStream) {
      mediaStream.getTracks().forEach((track) => track.stop());
      mediaStream = null;
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("目前裝置不支援麥克風錄音。", true);
      return;
    }

    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioChunks = [];
      recorder = new MediaRecorder(mediaStream, { mimeType: "audio/webm;codecs=opus" });

      recorder.addEventListener("dataavailable", (event) => {
        if (event.data && event.data.size > 0) {
          audioChunks.push(event.data);
        }
      });

      recorder.addEventListener("stop", async () => {
        if (!audioChunks.length) {
          setStatus("沒有偵測到語音內容，請再試一次。", true);
          return;
        }

        const blob = new Blob(audioChunks, { type: "audio/webm;codecs=opus" });
        audioChunks = [];

        const placeholder = createMessage("user", "語音訊息轉寫中...");
        try {
          const audioBase64 = await blobToBase64(blob);
          await sendToChat({ audioBase64, placeholder });
        } catch (error) {
          console.error("[AI Companion] 語音處理錯誤。", error);
          setStatus(error.message, true);
          placeholder.textContent = "語音轉寫失敗，請重錄一次。";
        }
      });

      recorder.start();
      recording = true;
      updateRecordButton(true);
      setStatus("錄音中，完成後請再次按下停止。");
    } catch (error) {
      console.error("[AI Companion] 無法啟動錄音。", error);
      setStatus("麥克風存取遭拒或無法啟動，請檢查瀏覽器權限。", true);
      if (mediaStream) {
        mediaStream.getTracks().forEach((track) => track.stop());
        mediaStream = null;
      }
    }
  };

  const toggleRecording = () => {
    if (recording) {
      stopRecorder();
    } else {
      startRecording();
    }
  };

  const sendTextMessage = async () => {
    const value = textarea.value.trim();
    if (!value) {
      setStatus("請先輸入想說的話。", true);
      return;
    }

    textarea.value = "";
    const bubble = createMessage("user", value);
    await sendToChat({ text: value, placeholder: bubble });
  };

  const clearMemos = () => {
    memos = [];
    saveMemos();
    renderMemos();
    setStatus("已清除所有語音備忘錄。");
  };

  sendButton.addEventListener("click", () => {
    if (isBusy) return;
    sendTextMessage();
  });

  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (isBusy) return;
      sendTextMessage();
    }
  });

  recordButton.addEventListener("click", () => {
    if (isBusy) return;
    toggleRecording();
  });

  // 在文字/語音區塊加入「加入備忘錄」兩個按鈕
  try {
    const actions = chatElement.querySelector('.chat-actions');
    if (actions) {
      const addTextBtn = document.createElement('button');
      addTextBtn.className = 'btn secondary';
      addTextBtn.type = 'button';
      addTextBtn.id = 'add-reminder-text';
      addTextBtn.textContent = '加入備忘錄（文字）';
      addTextBtn.addEventListener('click', () => {
        const title = (textarea.value || '').trim();
        openReminderDialog({ title, date: tzToday() });
      });

      const addVoiceBtn = document.createElement('button');
      addVoiceBtn.className = 'btn secondary';
      addVoiceBtn.type = 'button';
      addVoiceBtn.id = 'add-reminder-voice';
      addVoiceBtn.style.marginLeft = '8px';
      addVoiceBtn.textContent = '加入備忘錄（最近語音）';
      addVoiceBtn.addEventListener('click', async () => {
        const latest = (memos && memos.length) ? (memos[0].text || '') : '';
        if (!latest) { openReminderDialog({ title: '', date: tzToday() }); return; }
        try {
          const parsed = parseQuickReminder(latest);
          const remindIso = parsed.startIso;

          // Try LLM refinement with short timeout (1500ms). Fallback to local title on error.
          let refinedTitle = parsed.title;
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 1500);
            const result = await fetch(window.aiCompanion.settings.apiBaseUrl.replace(/\/$/, '') + '/chat/refine-title', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ rawText: latest, hints: { timeLabel: parsed.title, category: parsed.category } }),
              signal: controller.signal
            });
            clearTimeout(timer);
            if (result.ok) {
              const data = await result.json();
              if (data && typeof data.title === 'string' && data.title.trim()) {
                refinedTitle = data.title.trim();
              }
            }
          } catch (_) { /* ignore, fallback below */ }

          await window.aiCompanion.fetchJson('/events', {
            method: 'POST',
            body: JSON.stringify({ title: refinedTitle, category: parsed.category, description: null, start_time: parsed.startIso, end_time: parsed.startIso, reminder_time: remindIso })
          });
          try { createMessage('ai', '已從最近語音新增備忘錄：' + refinedTitle) } catch(_){}
        } catch (_) {
          openReminderDialog({ title: latest, date: tzToday() });
        }
      });

      actions.insertBefore(addTextBtn, sendButton);
      actions.insertBefore(addVoiceBtn, sendButton);
    }
  } catch (_) {}

  if (clearMemosButton) {
    clearMemosButton.addEventListener("click", clearMemos);
  }

  if (personaSelector) {
    personaSelector.addEventListener("change", (event) => {
      const selected = normalizePersona(event.target.value);
      window.aiCompanion.setSettings({ persona: selected });
    });
  }

  window.addEventListener("beforeunload", stopRecorder);

  memos = loadMemos();
  renderMemos();
  activePersona = updatePersonaLabel(window.aiCompanion.settings.persona);

  window.aiCompanion.subscribeSettings((settings) => {
    const previousPersona = activePersona;
    const normalized = updatePersonaLabel(settings.persona);
    if (normalized !== previousPersona) {
      conversation = [];
      if (logElement) {
        logElement.innerHTML = "";
      }
      setStatus(`已切換至${PERSONA_LABELS[normalized]}，開始新的對話吧！`);
    }
  });

  setStatus("說聲你好，開始和 AI 夥伴聊聊吧！");
})();
