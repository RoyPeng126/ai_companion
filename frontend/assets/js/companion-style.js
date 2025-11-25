"use strict";

(function () {
  const card = document.getElementById("interest-card");
  if (!card || !window.aiCompanion) return;

  const textInput = card.querySelector("#interestText");
  const statusEl = card.querySelector("#interestStatus");
  const listEl = card.querySelector("#interestList");
  const saveBtn = card.querySelector("#interest-save-btn");
  const recordBtn = card.querySelector("#interest-record-btn");
  const elderNameEl = card.querySelector("#interest-elder-name");
  const chatListEl = card.querySelector("#interestChatHistory");
  const historyToggleBtn = card.querySelector("#interestHistoryToggle");

  const api = window.aiCompanion;

  const TARGET_SAMPLE_RATE = 16000;
  let mediaStream = null;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let silentGainNode = null;
  let recording = false;
  let recordingBuffers = [];
  let recordingLength = 0;
  let recordingSampleRate = TARGET_SAMPLE_RATE;

  let context = {
    elderId: null,
    elderName: ""
  };
  let interestItems = [];
  let chatHistoryItems = [];
  let isSaving = false;
  let isHistoryOpen = false;

  const setStatus = (message, variant = "info") => {
    if (!statusEl) return;
    statusEl.textContent = message;
    if (variant === "error") {
      statusEl.style.color = "#b91c1c";
    } else {
      statusEl.style.color = "";
    }
  };

  const renderList = () => {
    if (!listEl) return;
    if (!interestItems.length) {
      listEl.innerHTML = '<li class="placeholder">尚未收藏興趣，歡迎透過語音或文字新增。</li>';
      return;
    }
    listEl.innerHTML = "";
    interestItems.forEach((item) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${new Date(item.created_at).toLocaleString("zh-TW", { hour12: false })}</strong>
        <span>${item.interest}</span>`;
      listEl.appendChild(li);
    });
  };

  const renderChatHistory = () => {
    if (!chatListEl) return;
    if (!chatHistoryItems.length) {
      chatListEl.innerHTML = '<li class="placeholder">尚無歷史聊天記錄。</li>';
      return;
    }
    chatListEl.innerHTML = "";
    chatHistoryItems.forEach((item) => {
      const li = document.createElement("li");
      const roleLabel = item.role === "ai" ? "AI 夥伴" : "我";
      li.innerHTML = `<strong>${roleLabel}</strong>
        <span>${item.message}</span>
        <time>${new Date(item.created_at).toLocaleString("zh-TW", { hour12: false })}</time>`;
      chatListEl.appendChild(li);
    });
  };

  const syncHistoryVisibility = () => {
    if (!chatListEl || !historyToggleBtn) return;
    chatListEl.hidden = !isHistoryOpen;
    historyToggleBtn.setAttribute("aria-expanded", isHistoryOpen ? "true" : "false");
    historyToggleBtn.textContent = isHistoryOpen ? "收合" : "展開";
  };

  const resetRecordingStorage = () => {
    recordingBuffers = [];
    recordingLength = 0;
  };

  const stopMediaTracks = () => {
    if (!mediaStream) return;
    try {
      mediaStream.getTracks().forEach((track) => track.stop());
    } catch (_) {}
    mediaStream = null;
  };

  const closeAudioResources = async () => {
    if (processorNode) {
      try {
        processorNode.disconnect();
      } catch (_) {}
      processorNode.onaudioprocess = null;
      processorNode = null;
    }
    if (sourceNode) {
      try {
        sourceNode.disconnect();
      } catch (_) {}
      sourceNode = null;
    }
    if (silentGainNode) {
      try {
        silentGainNode.disconnect();
      } catch (_) {}
      silentGainNode = null;
    }
    if (audioContext) {
      try {
        await audioContext.close();
      } catch (_) {}
      audioContext = null;
    }
  };

  const mergeBuffers = (buffers, totalLength) => {
    const result = new Float32Array(totalLength);
    let offset = 0;
    buffers.forEach((buffer) => {
      result.set(buffer, offset);
      offset += buffer.length;
    });
    return result;
  };

  const resampleBuffer = (buffer, fromRate, toRate) => {
    if (!buffer || !buffer.length) return new Float32Array(0);
    if (!Number.isFinite(fromRate) || fromRate <= 0) return buffer;
    if (!Number.isFinite(toRate) || toRate <= 0) return buffer;
    if (fromRate === toRate) return buffer;

    if (fromRate < toRate) {
      const ratio = fromRate / toRate;
      const newLength = Math.ceil(buffer.length / ratio);
      const result = new Float32Array(newLength);
      for (let i = 0; i < newLength; i++) {
        const index = i * ratio;
        const lowerIndex = Math.floor(index);
        const upperIndex = Math.min(Math.ceil(index), buffer.length - 1);
        const interpolation = index - lowerIndex;
        const lowerValue = buffer[lowerIndex] ?? 0;
        const upperValue = buffer[upperIndex] ?? lowerValue;
        result[i] = lowerValue + (upperValue - lowerValue) * interpolation;
      }
      return result;
    }

    const ratio = fromRate / toRate;
    const newLength = Math.floor(buffer.length / ratio);
    const result = new Float32Array(newLength);
    let offsetResult = 0;
    let offsetBuffer = 0;

    while (offsetResult < newLength) {
      const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
      let accum = 0;
      let count = 0;

      for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i++) {
        accum += buffer[i];
        count++;
      }

      result[offsetResult] = count ? (accum / count) : 0;
      offsetResult++;
      offsetBuffer = nextOffsetBuffer;
    }

    return result;
  };

  const encodePCM16 = (floatBuffer) => {
    if (!floatBuffer || !floatBuffer.length) return new Uint8Array(0);
    const output = new DataView(new ArrayBuffer(floatBuffer.length * 2));
    let offset = 0;

    for (let i = 0; i < floatBuffer.length; i += 1, offset += 2) {
      let sample = Math.max(-1, Math.min(1, floatBuffer[i]));
      sample = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      output.setInt16(offset, sample, true);
    }

    return new Uint8Array(output.buffer);
  };

  const uint8ToBase64 = (bytes) => {
    if (!bytes || !bytes.length) return "";
    let binary = "";
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
      const chunk = bytes.subarray(i, i + chunkSize);
      binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
  };

  const exportRecordingToBase64 = () => {
    if (!recordingBuffers.length || !recordingLength) return null;
    const merged = mergeBuffers(recordingBuffers, recordingLength);
    const resampled = resampleBuffer(merged, recordingSampleRate, TARGET_SAMPLE_RATE);
    const pcmBytes = encodePCM16(resampled);
    return uint8ToBase64(pcmBytes);
  };

  const loadContext = async () => {
    try {
      setStatus("載入長者資訊中...");
      const response = await api.fetchJson("/companion-styles");
      const elder = response?.elder;
      context.elderId = elder?.user_id ?? null;
      context.elderName = elder?.full_name || (context.elderId ? `長者 #${context.elderId}` : "未設定");
      if (elderNameEl) elderNameEl.textContent = context.elderName;
      interestItems = Array.isArray(response?.interests) ? response.interests : [];
      chatHistoryItems = Array.isArray(response?.chatHistory) ? response.chatHistory : [];
      renderList();
      renderChatHistory();
      syncHistoryVisibility();
      if (!interestItems.length) {
        setStatus("請透過語音或文字新增第一個興趣。");
      } else {
        setStatus("可繼續新增其他興趣。");
      }
    } catch (error) {
      console.warn("[interest] load failed", error);
      if (elderNameEl) elderNameEl.textContent = "無法取得";
      listEl.innerHTML = '<li class="placeholder">無法載入興趣資料，請稍後再試。</li>';
      setStatus("無法取得長者資料，請確認是否已綁定長者。", "error");
    }
  };

  const appendInterest = (item) => {
    interestItems = [item, ...interestItems].slice(0, 20);
    renderList();
  };

  // 將輸入文字拆成多個興趣：
  // - 中文頓號、全形/半形逗號、分號
  // - 連接詞「和/跟/與/及」前後可有空白
  // - 連續空白也會拆（方便「吃烤肉 踏青」這種）
  const splitInterests = (text) => {
    if (!text) return [];
    const normalized = String(text)
      .replace(/[\r\n]+/g, " ")
      .trim();
    if (!normalized) return [];
    const parts = normalized
      .split(/(?:[、，,;；]|(?:\s*(?:和|跟|與|及)\s*)|\s{2,})/)
      .map((part) => part.trim())
      .filter(Boolean);
    // 去除重複（以大小寫不敏感比對）
    const seen = new Set();
    const uniques = [];
    for (const p of parts) {
      const key = p.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      uniques.push(p);
    }
    return uniques;
  };

  const saveInterests = async (interests) => {
    if (!Array.isArray(interests) || !interests.length || isSaving) return;
    isSaving = true;
    setStatus("儲存興趣中...");
    try {
      // 逐筆送出，避免後端 schema 大改；若需要可改成批次 API
      for (const interest of interests) {
        const payload = { interest };
        if (context.elderId) payload.elder_user_id = context.elderId;
        const response = await api.fetchJson("/companion-styles", {
          method: "POST",
          body: JSON.stringify(payload)
        });
        if (response?.interest) {
          appendInterest(response.interest);
        }
      }
      setStatus("已儲存興趣話題。");
      if (textInput) textInput.value = "";
    } catch (error) {
      console.warn("[interest] save failed", error);
      setStatus("儲存失敗，請稍後再試。", "error");
    } finally {
      isSaving = false;
    }
  };

  const handleManualSave = async () => {
    const value = (textInput?.value || "").trim();
    const items = splitInterests(value);
    if (!items.length) {
      setStatus("請先輸入興趣內容。", "error");
      return;
    }
    await saveInterests(items);
  };

  const handleVoiceResult = async (audioBase64) => {
    if (!audioBase64) {
      setStatus("語音資料轉換失敗，請重新錄製。", "error");
      return;
    }
    setStatus("語音轉文字中...");
    try {
      const payload = {
        audio: {
          content: audioBase64,
          encoding: "LINEAR16",
          sampleRateHertz: TARGET_SAMPLE_RATE,
          languageCode: window.aiCompanion?.settings?.speechConfig?.languageCode || "zh-TW"
        }
      };
      if (context.elderId) payload.elder_user_id = context.elderId;
      const response = await api.fetchJson("/companion-styles/voice", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      if (response?.transcript) {
        if (textInput) textInput.value = response.transcript;
      }
      if (response?.interest) {
        appendInterest(response.interest);
        setStatus("語音已轉成文字並儲存。");
        if (textInput) textInput.value = "";
      } else {
        setStatus("語音轉文字完成但未儲存，請再試一次。", "error");
      }
    } catch (error) {
      console.warn("[interest] voice save failed", error);
      const message = error?.message || "語音轉文字失敗，請稍後再試。";
      setStatus(message, "error");
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("目前裝置不支援麥克風錄音。", "error");
      return;
    }
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        throw new Error("瀏覽器不支援錄音功能，請更新或改用其他瀏覽器。");
      }
      audioContext = new AudioContextClass({ sampleRate: TARGET_SAMPLE_RATE });
      await audioContext.resume();
      recordingSampleRate = audioContext.sampleRate;
      resetRecordingStorage();

      sourceNode = audioContext.createMediaStreamSource(mediaStream);
      processorNode = audioContext.createScriptProcessor(4096, 1, 1);
      processorNode.onaudioprocess = (event) => {
        if (!recording) return;
        const channelData = event.inputBuffer.getChannelData(0);
        recordingBuffers.push(new Float32Array(channelData));
        recordingLength += channelData.length;
      };

      silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0;

      sourceNode.connect(processorNode);
      processorNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);

      recording = true;
      if (recordBtn) {
        recordBtn.classList.add("recording");
        recordBtn.textContent = "停止錄音";
      }
      setStatus("錄音中，完成後請再次按下停止。");
    } catch (error) {
      console.warn("[interest] start recording failed", error);
      setStatus(error.message || "麥克風存取失敗，請檢查瀏覽器權限。", "error");
      resetRecordingStorage();
      await closeAudioResources();
      stopMediaTracks();
    }
  };

  const stopRecording = async () => {
    recording = false;
    if (recordBtn) {
      recordBtn.classList.remove("recording");
      recordBtn.textContent = "語音輸入";
    }
    await closeAudioResources();
    stopMediaTracks();

    if (!recordingLength) {
      setStatus("沒有偵測到語音內容，請再試一次。", "error");
      return;
    }

    const audioBase64 = exportRecordingToBase64();
    resetRecordingStorage();
    await handleVoiceResult(audioBase64);
  };

  const toggleRecording = async () => {
    if (recording) {
      await stopRecording();
    } else {
      await startRecording();
    }
  };

  if (saveBtn) {
    saveBtn.addEventListener("click", () => {
      if (isSaving || recording) return;
      handleManualSave();
    });
  }

  if (recordBtn) {
    recordBtn.addEventListener("click", () => {
      if (isSaving) return;
      toggleRecording();
    });
  }

  historyToggleBtn?.addEventListener("click", () => {
    isHistoryOpen = !isHistoryOpen;
    if (chatHistoryItems.length === 0 && isHistoryOpen) {
      setStatus("尚無歷史聊天記錄，聊聊看吧！");
    }
    syncHistoryVisibility();
  });

  loadContext();
})();
