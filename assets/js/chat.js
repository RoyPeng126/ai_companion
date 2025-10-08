"use strict";

(function () {
  const MEMO_STORAGE_KEY = "ai-companion.voiceMemos";
  const MAX_CONTEXT_MESSAGES = 10;
  const MAX_MEMOS = 20;
  const ICONS = {
    user: "👵",
    ai: "🤖"
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

  const createMessage = (role, text) => {
    const wrapper = document.createElement("div");
    wrapper.className = `message ${role}`;

    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICONS[role] ?? "";

    const bubble = document.createElement("div");
    bubble.textContent = text;

    wrapper.appendChild(icon);
    wrapper.appendChild(bubble);
    logElement.appendChild(wrapper);
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
    return normalized;
  };

  const enableInputs = (enable) => {
    isBusy = !enable;
    textarea.disabled = !enable;
    sendButton.disabled = !enable;
    recordButton.disabled = !enable && !recording;
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
    recordButton.classList.remove("recording");
    recordButton.textContent = "🎙️ 開始錄音";

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
      recordButton.classList.add("recording");
      recordButton.textContent = "■ 停止錄音";
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
  let activePersona = updatePersonaLabel(window.aiCompanion.settings.persona);

  window.aiCompanion.subscribeSettings((settings) => {
    const normalized = updatePersonaLabel(settings.persona);
    if (normalized !== activePersona) {
      activePersona = normalized;
      conversation = [];
      if (logElement) {
        logElement.innerHTML = "";
      }
      setStatus(`已切換至${PERSONA_LABELS[normalized]}，開始新的對話吧！`);
    }
  });

  setStatus("說聲你好，開始和 AI 夥伴聊聊吧！");
})();
