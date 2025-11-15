"use strict";

(function () {
  const MEMO_STORAGE_KEY = "ai-companion.voiceMemos";
  const CHAT_TIMEZONE = "Asia/Taipei";
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

  (function injectPermissionRow () {
    try {
      const dropdown = document.getElementById('userDropdown');
      const accountItem = document.getElementById('umAccount');
      const logoutItem = document.getElementById('umLogout');
      if (!dropdown || !accountItem || !logoutItem || document.getElementById('permissions-row')) return;

      const row = document.createElement('div');
      row.className = 'menu-item permissions-row';
      row.id = 'permissions-row';

      const label = document.createElement('div');
      label.textContent = '權限';
      label.className = 'permissions-row-title';

      const box = document.createElement('div');
      box.className = 'permissions-row-buttons';
      box.style.display = 'none';

      const notifBtn = document.createElement('button');
      notifBtn.type = 'button';
      notifBtn.className = 'btn secondary';
      notifBtn.textContent = '啟用通知';

      const micBtn = document.createElement('button');
      micBtn.type = 'button';
      micBtn.className = 'btn secondary';
      micBtn.textContent = '啟用麥克風';

      const showToast = (msg) => {
        try {
          if (window.AIToast) {
            window.AIToast.show(msg);
            return;
          }
        } catch (_) {}
        try {
          alert(msg);
        } catch (_) {}
      };

      const checkNotif = async () => {
        if (!('Notification' in window)) {
          notifBtn.disabled = true;
          notifBtn.textContent = '通知不支援';
          return;
        }
        if (Notification.permission === 'granted') {
          notifBtn.disabled = true;
          notifBtn.textContent = '通知已允許';
          return;
        }
        if (Notification.permission === 'denied') {
          notifBtn.disabled = false;
          notifBtn.textContent = '需在瀏覽器設定允許通知';
          return;
        }
        notifBtn.disabled = false;
        notifBtn.textContent = '啟用通知';
      };

      const requestNotif = async () => {
        try {
          if (!('Notification' in window)) {
            showToast('此瀏覽器不支援通知');
            return;
          }
          const r = await Notification.requestPermission();
          if (r === 'granted') {
            try {
              new Notification('通知已開啟', { body: '之後提醒會顯示在這裡。' });
            } catch (_) {}
            notifBtn.disabled = true;
            notifBtn.textContent = '通知已允許';
          } else if (r === 'denied') {
            showToast('通知被拒絕，請到瀏覽器設定頁面允許。');
          }
        } catch (_) {
          showToast('無法請求通知權限');
        }
      };

      const checkMic = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          micBtn.disabled = true;
          micBtn.textContent = '麥克風不支援';
          return;
        }
        if (navigator.permissions && navigator.permissions.query) {
          try {
            const p = await navigator.permissions.query({ name: 'microphone' });
            if (p.state === 'granted') {
              micBtn.disabled = true;
              micBtn.textContent = '麥克風已允許';
              return;
            }
            if (p.state === 'denied') {
              micBtn.disabled = false;
              micBtn.textContent = '需在瀏覽器設定允許麥克風';
              return;
            }
            micBtn.disabled = false;
            micBtn.textContent = '啟用麥克風';
          } catch (_) {
            micBtn.disabled = false;
          }
        } else {
          micBtn.disabled = false;
          micBtn.textContent = '啟用麥克風';
        }
      };

      const requestMic = async () => {
        try {
          const isSecure = location.protocol === 'https:' ||
            location.hostname === 'localhost' ||
            location.hostname === '127.0.0.1';
          if (!isSecure) {
            showToast('瀏覽器可能因非 HTTPS 限制麥克風。請使用 https 或在瀏覽器設定中允許。');
          }
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          try {
            stream.getTracks().forEach(t => t.stop());
          } catch (_) {}
          micBtn.disabled = true;
          micBtn.textContent = '麥克風已允許';
          showToast('麥克風權限已啟用');
        } catch (e) {
          const msg = e && e.name === 'NotAllowedError'
            ? '已被拒絕麥克風權限，請到瀏覽器設定手動允許。'
            : '無法啟用麥克風（可能需要 HTTPS 或瀏覽器設定允許）';
          showToast(msg);
        }
      };

      notifBtn.addEventListener('click', requestNotif);
      micBtn.addEventListener('click', requestMic);

      box.appendChild(notifBtn);
      box.appendChild(micBtn);
      row.appendChild(label);
      row.appendChild(box);

      const openPermissionsDialog = () => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';

        const panel = document.createElement('div');
        panel.style.cssText = 'background:#fff;border-radius:16px;max-width:380px;width:92%;padding:18px 16px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;position:relative;';

        const title = document.createElement('h3');
        title.textContent = '權限設定';
        title.style.margin = '0 0 8px';
        title.style.fontSize = '18px';

        const desc = document.createElement('p');
        desc.textContent = '建議先啟用通知與麥克風，才能收到提醒並使用語音記錄。';
        desc.style.margin = '0 0 14px';
        desc.style.fontSize = '14px';
        desc.style.color = '#555';

        box.style.display = 'flex';
        box.style.gap = '8px';
        box.style.flexWrap = 'wrap';

        notifBtn.style.flex = '1 1 48%';
        notifBtn.style.borderColor = '#ffd6a0';
        notifBtn.style.borderWidth = '2px';
        notifBtn.style.color = '#b41d32';
        notifBtn.style.background = '#fff7f0';

        micBtn.style.flex = '1 1 48%';
        micBtn.style.borderColor = '#ffd6a0';
        micBtn.style.borderWidth = '2px';
        micBtn.style.color = '#b41d32';
        micBtn.style.background = '#fff7f0';

        const footer = document.createElement('div');
        footer.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;margin-top:12px;';

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'btn secondary';
        closeBtn.textContent = '關閉';

        footer.appendChild(closeBtn);

        panel.appendChild(title);
        panel.appendChild(desc);
        panel.appendChild(box);
        panel.appendChild(footer);

        overlay.appendChild(panel);
        document.body.appendChild(overlay);

        const close = () => {
          try {
            overlay.remove();
          } catch (_) {}
          box.style.display = 'none';
          row.appendChild(box);
        };

        closeBtn.addEventListener('click', close);
        overlay.addEventListener('click', (event) => {
          if (event.target === overlay) close();
        });
      };

      dropdown.insertBefore(row, logoutItem);
      row.addEventListener('click', openPermissionsDialog);

      checkNotif();
      checkMic();
    } catch (_) {}
  })();

  // ==== Reminders helpers (text/voice to user_events) ====
  const DAY_MS = 24 * 60 * 60 * 1000;

  const formatTaipeiYmd = (date) => {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: CHAT_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date);
  };

  const tzToday = () => {
    try {
      return formatTaipeiYmd(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  };

  const startOfTaipeiDay = () => {
    const ymd = tzToday();
    return new Date(`${ymd}T00:00:00+08:00`);
  };

  const detectDateFromText = (text = "") => {
    const normalized = text.replace(/\s+/g, "");
    if (!normalized) return "";
    const base = startOfTaipeiDay();

    if (normalized.includes("後天")) {
      return formatTaipeiYmd(new Date(base.getTime() + 2 * DAY_MS));
    }
    if (normalized.includes("明天")) {
      return formatTaipeiYmd(new Date(base.getTime() + DAY_MS));
    }
    if (normalized.includes("今天")) {
      return formatTaipeiYmd(base);
    }
    if (normalized.includes("昨天")) {
      return formatTaipeiYmd(new Date(base.getTime() - DAY_MS));
    }

    const mdMatch = normalized.match(/(\d{1,2})(?:月|\/|\.|-)(\d{1,2})(?:日|號)?/);
    if (mdMatch) {
      const month = Number(mdMatch[1]);
      const day = Number(mdMatch[2]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        let year = base.getFullYear();
        const candidate = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+08:00`);
        if (candidate.getTime() < base.getTime()) {
          year += 1;
        }
        const adjusted = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+08:00`);
        return formatTaipeiYmd(adjusted);
      }
    }
    return "";
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

  // Dialog with required location field
  const openReminderDialog2 = (defaults) => {
    const d = Object.assign({ title:'', category:'', description:'', location:'', date: tzToday(), time:'09:00', remind:'' }, defaults || {});
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:16px;max-width:420px;width:92%;padding:18px 16px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;position:relative;';
    const $el = (tag, attrs, html) => { const el = document.createElement(tag); if (attrs) Object.assign(el, attrs); if (html!=null) el.innerHTML = html; return el };
    const inputCss = 'width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px';
    const grid = $el('div'); grid.style.cssText = 'display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px';
    const row = (labelText, input) => { const wrap = $el('div'); wrap.style.gridColumn = '1 / -1'; wrap.appendChild($el('label', { innerText: labelText })); wrap.appendChild(input); return wrap };
    const title = $el('input'); title.type='text'; title.style.cssText=inputCss; title.value=d.title;
    const date = $el('input'); date.type='date'; date.style.cssText=inputCss; date.value=d.date;
    const time = $el('input'); time.type='time'; time.style.cssText=inputCss; time.value=d.time;
    const remind = $el('input'); remind.type='time'; remind.style.cssText=inputCss; remind.value=d.remind;
    const cat = $el('select'); cat.style.cssText=inputCss; cat.innerHTML = '<option value="">未分類</option><option value="medicine">用藥</option><option value="exercise">運動</option><option value="appointment">就醫</option><option value="chat">聊天</option><option value="other">其他</option>'; cat.value=d.category||'';
    const desc = $el('input'); desc.type='text'; desc.style.cssText=inputCss; desc.value=d.description||'';
    const loc = $el('input'); loc.type='text'; loc.style.cssText=inputCss; loc.value=d.location||''; loc.id='rmLoc2';
    grid.appendChild(row('標題', title));
    const dateWrap = $el('div'); dateWrap.appendChild($el('label', { innerText:'日期' })); dateWrap.appendChild(date);
    const remindWrap = $el('div'); remindWrap.appendChild($el('label', { innerText:'提醒時間(可選)' })); remindWrap.appendChild(remind);
    grid.appendChild(dateWrap); grid.appendChild(remindWrap);
    const timeWrap = $el('div'); timeWrap.appendChild($el('label', { innerText:'時間' })); timeWrap.appendChild(time);
    const catWrap = $el('div'); catWrap.appendChild($el('label', { innerText:'類別' })); catWrap.appendChild(cat);
    grid.appendChild(timeWrap); grid.appendChild(catWrap);
    grid.appendChild(row('說明(可選)', desc));
    grid.appendChild(row('地點', loc));

    const header = $el('h3', { innerText:'新增備忘錄' }); header.style.cssText='margin:0 0 12px;font-size:18px;';
    const closeBtn = $el('button', { type:'button', ariaLabel:'關閉', innerText:'×' }); closeBtn.id='rmClose2'; closeBtn.style.cssText='position:absolute;top:10px;right:10px;border:none;background:transparent;font-size:18px;cursor:pointer;line-height:1';
    const actions = $el('div'); actions.style.cssText='display:flex;gap:8px;justify-content:flex-end';
    const cancel = $el('button', { type:'button', innerText:'取消' }); cancel.className='btn secondary';
    const save = $el('button', { type:'button', innerText:'儲存' }); save.className='btn';
    actions.appendChild(cancel); actions.appendChild(save);

    panel.appendChild(header); panel.appendChild(closeBtn); panel.appendChild(grid); panel.appendChild(actions);
    overlay.appendChild(panel); document.body.appendChild(overlay);
    const close = () => { try { document.body.removeChild(overlay) } catch(_){} };
    cancel.addEventListener('click', close); closeBtn.addEventListener('click', close); overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close() });
    const onKey = (e) => { if (e.key==='Escape') { close(); window.removeEventListener('keydown', onKey) } }; window.addEventListener('keydown', onKey);
    save.addEventListener('click', async () => {
      const titleV = title.value.trim(); const dateV = date.value; const timeV = time.value; const remindV = remind.value; const catV = cat.value || null; const descV = (desc.value||'').trim() || null; const locV = loc.value.trim();
      if (!titleV || !dateV || !timeV || !locV) { alert('請填寫標題/日期/時間/地點'); return }
      const startIso = `${dateV}T${timeV}:00+08:00`; const remindIso = remindV ? `${dateV}T${remindV}:00+08:00` : startIso;
      try {
        await window.aiCompanion.fetchJson('/events', { method:'POST', body: JSON.stringify({ title: titleV, category: catV, description: descV, location: locV, start_time: startIso, end_time: startIso, reminder_time: remindIso }) });
        close();
        try { createMessage('ai', '已新增備忘錄：' + titleV) } catch(_){}
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
  let mediaStream = null;
  let audioContext = null;
  let sourceNode = null;
  let processorNode = null;
  let silentGainNode = null;
  let recordingSampleRate = 16000;
  let recordedBuffers = [];
  let recordedLength = 0;
  let recording = false;
  let activePersona = "senior";
  const TARGET_SAMPLE_RATE = 16000;

  const resetRecordingStorage = () => {
    recordedBuffers = [];
    recordedLength = 0;
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

    for (let i = 0; i < floatBuffer.length; i++, offset += 2) {
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
    if (!recordedBuffers.length || !recordedLength) return null;
    const merged = mergeBuffers(recordedBuffers, recordedLength);
    const resampled = resampleBuffer(merged, recordingSampleRate, TARGET_SAMPLE_RATE);
    const pcmBytes = encodePCM16(resampled);
    return uint8ToBase64(pcmBytes);
  };
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

  const LINK_REGEX = /(https?:\/\/[^\s]+)/g;
  const LABEL_REGEX = /(連結\d+)(：?)(\s*)$/;

  const appendTextNode = (target, text) => {
    if (!text) return;
    target.appendChild(document.createTextNode(text));
  };

  const createLinkElement = (url, label) => {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.target = "_blank";
    anchor.rel = "noopener noreferrer";
    anchor.textContent = label || url;
    return anchor;
  };

  const appendLinkifiedLine = (target, line) => {
    let lastIndex = 0;
    let match;
    while ((match = LINK_REGEX.exec(line)) !== null) {
      const before = line.slice(lastIndex, match.index);
      const labelMatch = LABEL_REGEX.exec(before);

      if (labelMatch) {
        const keepText = before.slice(0, before.length - labelMatch[0].length);
        appendTextNode(target, keepText);
        const anchor = createLinkElement(match[0], labelMatch[1]);
        target.appendChild(anchor);
        if (labelMatch[2]) appendTextNode(target, labelMatch[2]);
        if (labelMatch[3]) appendTextNode(target, labelMatch[3]);
      } else {
        appendTextNode(target, before);
        const anchor = createLinkElement(match[0]);
        target.appendChild(anchor);
      }

      lastIndex = match.index + match[0].length;
    }

    const remaining = line.slice(lastIndex);
    appendTextNode(target, remaining);
  };

  const renderAiMessage = (bubble, text) => {
    const safeText = String(text ?? "");
    const lines = safeText.split(/\n/);
    lines.forEach((line, index) => {
      if (index > 0) {
        bubble.appendChild(document.createElement("br"));
      }
      appendLinkifiedLine(bubble, line);
    });
  };

  const createMessage = (role, text) => {
    const row = document.createElement("div");
    row.className = `message-row message-row--${role}`;

    const bubble = document.createElement("div");
    bubble.className = `message ${role}`;

    if (role === "ai") {
      renderAiMessage(bubble, text);
    } else {
      bubble.textContent = text;
    }

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

  // Helper: strip time words from a title (e.g., 去掉「上午/下午/點/點半/HH:MM」)
  const stripTimeWords = (s) => {
    try {
      return String(s || '')
        .replace(/(今天|明天|後天|上午|早上|清晨|中午|下午|傍晚|晚上)/g, '')
        .replace(/\b\d{1,2}\s*[:：時]\s*\d{2}\b/g, '')
        .replace(/\b\d{1,2}\s*點半\b/g, '')
        .replace(/\b\d{1,2}\s*點(?:\s*[零〇一二兩三四五六七八九十\d]{1,3}(?:\s*分)?)?\b/g, '')
        .replace(/[，、。\s]+$/g, '')
        .trim();
    } catch (_) { return s }
  };

  const ZH_DIGITS = { '零':0,'〇':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9 };
  const zhWordToNumber = (value) => {
    if (typeof value !== 'string') return Number.isFinite(value) ? value : NaN;
    const trimmed = value.trim();
    if (!trimmed) return NaN;
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    let total = 0;
    let buffer = 0;
    let seen = false;
    for (const char of trimmed) {
      if (char === '十') {
        const base = buffer === 0 ? 1 : buffer;
        total += base * 10;
        buffer = 0;
        seen = true;
        continue;
      }
      if (ZH_DIGITS[char] == null) return NaN;
      buffer += ZH_DIGITS[char];
      seen = true;
    }
    total += buffer;
    return seen ? total : NaN;
  };

  const minuteFromToken = (token) => {
    if (token == null) return 0;
    const trimmed = String(token).trim();
    if (!trimmed) return 0;
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    const minute = zhWordToNumber(trimmed);
    return Number.isNaN(minute) ? 0 : minute;
  };

  const parseTimeFromText = (text) => {
    const normalized = String(text || '').replace(/：/g, ':');
    if (!normalized) return null;
    const pmHint = /(下午|晚上|傍晚|晚間|夜裡|夜間|晚餐|晚飯)/.test(normalized);
    const amHint = /(上午|早上|清晨|一早|凌晨)/.test(normalized);
    const noonHint = /(中午|午餐|午休)/.test(normalized);
    const midnightHint = /(凌晨|半夜|午夜)/.test(normalized);
    let hour = null;
    let minute = 0;
    const match24 = normalized.match(/(?:^|\D)(\d{1,2})[:：](\d{2})(?!\d)/);
    const matchDigit = normalized.match(/(\d{1,2})\s*點(?:\s*(半)|\s*([零〇一二兩三四五六七八九十\d]{1,4})(?:\s*分)?)?/);
    const matchZh = normalized.match(/([零〇一二兩三四五六七八九十]{1,3})\s*點(?:\s*(半)|\s*([零〇一二兩三四五六七八九十\d]{1,4})(?:\s*分)?)?/);
    if (match24) {
      hour = parseInt(match24[1], 10);
      minute = parseInt(match24[2], 10);
    } else if (matchDigit) {
      hour = parseInt(matchDigit[1], 10);
      minute = matchDigit[2] === '半' ? 30 : minuteFromToken(matchDigit[3]);
    } else if (matchZh) {
      hour = zhWordToNumber(matchZh[1]);
      minute = matchZh[2] === '半' ? 30 : minuteFromToken(matchZh[3]);
    }
    if (!Number.isFinite(hour)) return null;
    if (!Number.isFinite(minute)) minute = 0;
    if (noonHint) hour = 12;
    if (pmHint && hour < 12) hour += 12;
    if ((amHint || midnightHint) && hour === 12) hour = 0;
    hour = Math.max(0, Math.min(23, hour));
    minute = Math.max(0, Math.min(59, minute));
    const pad2 = (num) => String(num).padStart(2, '0');
    return { hour, minute, time: `${pad2(hour)}:${pad2(minute)}` };
  };

  // Robust time parser for reminders (handles 「點半」/中文數字/AM/PM 詞彙)
  const robustParseQuickReminder = (rawText) => {
    const normalizeText = (s) => String(s || '')
      .replace(/[，。；、]/g, ' ')
      .replace(/：/g, ':')
      .replace(/\s+/g, ' ')
      .replace(/點\s*\?/g, '點半')
      .trim();

    let text = normalizeText(rawText);
    const now = new Date();
    const addDays = (d, n) => { const t = new Date(d); t.setDate(t.getDate() + n); return t };
    let dateObj = now;
    if (/後天/.test(text)) dateObj = addDays(now, 2);
    else if (/明天|翌日|隔天/.test(text)) dateObj = addDays(now, 1);

    let hour = 9;
    let minute = 0;
    const parsedTime = parseTimeFromText(text);
    if (parsedTime) {
      hour = parsedTime.hour;
      minute = parsedTime.minute;
    }
    // If contains 單獨「半」且目前分鐘仍為 0，推為 30（避免前面沒命中「點半」變體時失誤）
    if (/半/.test(text) && minute === 0) minute = 30;

    const pad = (n) => String(Math.max(0, Math.min(59, n))).padStart(2, '0');
    const dateStr = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).format(dateObj);
    const timeStr = `${pad(hour)}:${pad(minute)}`;

    let category = null;
    if (/(吃藥|用藥|藥)/.test(text)) category = 'medicine';
    else if (/(運動|散步|走路)/.test(text)) category = 'exercise';
    else if (/(看診|回診|就醫)/.test(text)) category = 'appointment';
    else if (/(聊天|通話|打電話)/.test(text)) category = 'chat';

    const period = (hour >= 12 ? (hour === 12 ? '中午' : '下午') : '上午');
    const dispHour = ((hour % 12) || 12);
    const dispMinute = minute === 0 ? '' : (minute === 30 ? '半' : `${minute}分`);
    const timeLabel = `${period}${dispHour}${dispMinute}`;
    const action = stripTimeWords(
      text.replace(/^(請|幫我|麻煩|提醒我)\s*/,'')
    );
    const conciseTitle = `${timeLabel}${action ? action : ''}`.trim().slice(0, 60);
    const startIso = `${dateStr}T${timeStr}:00+08:00`;
    return { title: conciseTitle, category, startIso };
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
      try {
        removeButton.style.background = '#FFE6CC';
        removeButton.style.border = '1px solid #FFB980';
        removeButton.style.color = '#A84B00';
      } catch(_) {}
      removeButton.textContent = "刪除";
      removeButton.addEventListener("click", () => {
        memos = memos.filter((entry) => entry.id !== memo.id);
        saveMemos();
        renderMemos();
      });

      // hide the mark-done button by not appending it
      actions.appendChild(removeButton);
      // Append a per‑memo "加入備忘錄" button (green) to the right of delete
      (function(){
        try { removeButton.textContent = '刪除'; } catch(_) {}
        const addBtn = document.createElement('button');
        addBtn.className = 'btn';
        addBtn.type = 'button';
        addBtn.textContent = '加入備忘錄';
        try {
          addBtn.style.background = '#10B981';
          addBtn.style.border = '1px solid #059669';
          addBtn.style.color = '#ffffff';
          addBtn.style.marginLeft = '8px';
        } catch(_) {}
        addBtn.addEventListener('click', () => {
          try {
            const ev = new CustomEvent('add-reminder-from-memo', { detail: { id: memo.id, text: memo.text } });
            document.dispatchEvent(ev);
          } catch(_) {}
        });
        actions.appendChild(addBtn);
      })();

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

    const fbFeed = window.aiCompanion.facebookFeed;
    if (fbFeed?.getPosts) {
      const latestPosts = (fbFeed.getPosts() || []).slice(0, 5);
      if (latestPosts.length) {
        payload.facebookPosts = latestPosts.map((post) => ({
          id: post.id,
          author: post.author,
          text: post.text,
          permalink: post.permalink,
          createdTime: post.createdTime
        }));
      }
    }

    if (text) {
      payload.message = text;
    }

    if (audioBase64) {
      payload.audio = {
        content: audioBase64,
        encoding: "LINEAR16",
        sampleRateHertz: TARGET_SAMPLE_RATE
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

  const stopRecorder = async () => {
    if (!recording) return;

    recording = false;
    updateRecordButton(false);

    await closeAudioResources();
    stopMediaTracks();

    if (!recordedLength) {
      resetRecordingStorage();
      setStatus("沒有偵測到語音內容，請再試一次。", true);
      return;
    }

    const placeholder = createMessage("user", "語音訊息轉寫中...");

    try {
      const audioBase64 = exportRecordingToBase64();
      resetRecordingStorage();
      if (!audioBase64) {
        setStatus("語音資料轉換失敗，請重新錄製。", true);
        placeholder.textContent = "語音轉寫失敗，請重試一次。";
        return;
      }
      await sendToChat({ audioBase64, placeholder });
    } catch (error) {
      console.error("[AI Companion] 語音處理錯誤。", error);
      setStatus(error.message || "語音轉寫失敗，請重錄一次。", true);
      placeholder.textContent = "語音轉寫失敗，請重錄一次。";
      resetRecordingStorage();
    }
  };

  const startRecording = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus("目前裝置不支援麥克風錄音。", true);
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
      const bufferSize = 4096;
      if (!audioContext.createScriptProcessor) {
        throw new Error("瀏覽器不支援即時錄音處理，請更新或改用其他瀏覽器。");
      }
      processorNode = audioContext.createScriptProcessor(bufferSize, 1, 1);
      processorNode.onaudioprocess = (event) => {
        if (!recording) return;
        const channelData = event.inputBuffer.getChannelData(0);
        recordedBuffers.push(new Float32Array(channelData));
        recordedLength += channelData.length;
      };

      silentGainNode = audioContext.createGain();
      silentGainNode.gain.value = 0;

      sourceNode.connect(processorNode);
      processorNode.connect(silentGainNode);
      silentGainNode.connect(audioContext.destination);

      recording = true;
      updateRecordButton(true);
      setStatus("錄音中，完成後請再次按下停止。");
    } catch (error) {
      console.error("[AI Companion] 無法啟動錄音。", error);
      setStatus(error.message || "麥克風存取遭拒或無法啟動，請檢查瀏覽器權限。", true);
      resetRecordingStorage();
      await closeAudioResources();
      stopMediaTracks();
    }
  };

  const toggleRecording = async () => {
    if (recording) {
      await stopRecorder();
    } else {
      await startRecording();
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
        openReminderDialog2({ title, date: tzToday() });
      });

      const addVoiceBtn = document.createElement('button');
      addVoiceBtn.className = 'btn secondary';
      addVoiceBtn.type = 'button';
      addVoiceBtn.id = 'add-reminder-voice';
      addVoiceBtn.style.marginLeft = '8px';
      addVoiceBtn.textContent = '加入備忘錄（最近語音）';
      addVoiceBtn.addEventListener('click', async () => {
        const latest = (memos && memos.length) ? (memos[0].text || '') : '';
        if (!latest) { openReminderDialog2({ title: '', date: tzToday() }); return; }
        try {
          const parsed = (typeof robustParseQuickReminder === 'function') ? robustParseQuickReminder(latest) : parseQuickReminder(latest);
          let startIso = parsed.startIso;
          let remindIso = startIso;
          let refinedTitle = parsed.title;
          let categoryForSave = parsed.category;
          let classifyData = null;

          // Always call Gemini classify (short timeout) to trim title/time/category
          try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 1500);
            const resp = await fetch(window.aiCompanion.settings.apiBaseUrl.replace(/\/$/, '') + '/chat/classify', {
              method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
              body: JSON.stringify({ rawText: latest, tz: 'Asia/Taipei' }), signal: controller.signal
            });
            clearTimeout(timer);
            if (resp.ok) {
              classifyData = await resp.json();
              if (classifyData && typeof classifyData.time === 'string' && classifyData.time.trim()) {
                const ymd = (classifyData.date && typeof classifyData.date === 'string' && classifyData.date.trim()) ? classifyData.date.trim() : (startIso ? startIso.slice(0,10) : detectDateFromText(latest) || tzToday());
                startIso = `${ymd}T${classifyData.time.trim()}:00+08:00`;
                remindIso = startIso;
              }
              if (classifyData && typeof classifyData.title === 'string' && classifyData.title.trim()) refinedTitle = classifyData.title.trim();
              if (classifyData && typeof classifyData.category === 'string' && classifyData.category.trim()) categoryForSave = classifyData.category.trim();
            }
          } catch (_) {}

          // Try LLM refinement with short timeout (1500ms). Fallback to local title on error.
          // 標題精煉將於下方進行；這裡先保留 refinedTitle 變數
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

          const fallbackDate = detectDateFromText(latest);
          if (fallbackDate && (!classifyData || !classifyData.date)) {
            const fallbackTime = (classifyData && classifyData.time && classifyData.time.trim())
              ? classifyData.time.trim()
              : (startIso ? startIso.slice(11,16) : (parsed.time || '09:00'));
            startIso = `${fallbackDate}T${fallbackTime}:00+08:00`;
            remindIso = startIso;
          }

          // Sync parsed with LLM-merged values
          try { parsed.startIso = startIso; parsed.category = categoryForSave; } catch(_){}
          refinedTitle = stripTimeWords(refinedTitle || '');
          refinedTitle = (refinedTitle || '').replace(/(^|[，、\s])半(?=[，、\s]|$)/g, '$1').replace(/^半+/, '');
          // Extract simple location from voice text; if not found, open dialog for user to input location
          const extractLocation = (txt) => { const m = (txt||'').match(/(?:在|到|去)\s*([^，,。！？?\s]{1,20})/); return m ? m[1].trim() : '' };
          const loc = extractLocation(latest);
          if (!loc) {
            const dateStr = startIso.slice(0,10); const timeStr = startIso.slice(11,16);
            openReminderDialog2({ title: refinedTitle, date: dateStr, time: timeStr, category: categoryForSave || '' });
            return;
          }
          await window.aiCompanion.fetchJson('/events', { method: 'POST', body: JSON.stringify({ title: refinedTitle, category: categoryForSave, description: null, location: loc, start_time: startIso, end_time: startIso, reminder_time: remindIso }) });
          try { createMessage('ai', '已從最近語音新增備忘錄：' + refinedTitle) } catch(_){}
        } catch (_) {
          openReminderDialog2({ title: latest, date: tzToday() });
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

  // Expose small helpers for reminder policies UI
  try {
    if (!window.aiCompanion.deleteLatestMemo) {
      window.aiCompanion.deleteLatestMemo = () => {
        try { if (Array.isArray(memos) && memos.length) { memos.shift(); saveMemos(); renderMemos(); } } catch(_){}
      };
    }
    if (!window.aiCompanion.deleteMemoById) {
      window.aiCompanion.deleteMemoById = (id) => {
        try {
          memos = Array.isArray(memos) ? memos.filter(m => m.id !== id) : [];
          saveMemos();
          renderMemos();
        } catch(_){}
      };
    }
    if (!window.aiCompanion.startVoiceRecording) {
      window.aiCompanion.startVoiceRecording = () => { try { if (!recording) toggleRecording(); } catch(_){} };
    }
  } catch(_){}

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
