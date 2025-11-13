"use strict";

(function(){
  if (!window.aiCompanion) return;

  const tzToday = () => {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()); }
    catch { return new Date().toISOString().slice(0,10) }
  };

  // Helper to get yyy-mm-dd in Asia/Taipei with optional day offset
  const getDateYMD = (n = 0) => {
    try {
      const d = new Date();
      d.setDate(d.getDate() + Number(n || 0));
      return new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit' }).format(d);
    } catch {
      const d = new Date();
      d.setDate(d.getDate() + Number(n || 0));
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth()+1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    }
  };

  // 最終標題清理：去掉時間字詞、前導/末尾標點，並在半小時情境移除開頭孤立的「半」
  function sanitizeTitleAfterTime(raw, opts = {}){
    const src = String(raw || '');
    let s = src
      .replace(/^(請|可以)?\s*(提醒我|幫我提醒|幫我|請提醒)\s*/, '')
      .replace(/(今天|明天|後天|上午|早上|中午|下午|晚上|傍晚)/g, '')
      // 8點30、八點三十分
      .replace(/([零〇一二兩三四五六七八九十\d]{1,3})\s*點\s*([零〇一二兩三四五六七八九十\d]{1,2})\s*分/g, '')
      // 8:30 / 08:30
      .replace(/\b(\d{1,2})[:：]\s*\d{2}\b/g, '')
      // 8點
      .replace(/([零〇一二兩三四五六七八九十\d]{1,3})\s*點\b/g, '')
      // 8點半
      .replace(/([零〇一二兩三四五六七八九十\d]{1,3})\s*點半/g, '')
      .replace(/^[，、。,. \t]+/, '')
      .replace(/[，、。,. \t]+$/, '');
    if (opts && (opts.isHalf || /點半/.test(src))) {
      s = s.replace(/^[，、。,. \t]*半(?=\S)/, '');
    }
    s = s.replace(/[，、。,.]{2,}/g, '，').replace(/^[，、。,.]+/, '');
    return s.trim();
  }

  const ZH_DIGITS = { '零':0, '〇':0, '一':1, '二':2, '兩':2, '三':3, '四':4, '五':5, '六':6, '七':7, '八':8, '九':9 };
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
      if (ZH_DIGITS[char] == null) {
        return NaN;
      }
      buffer += ZH_DIGITS[char];
      seen = true;
    }
    total += buffer;
    return seen ? total : NaN;
  };

  const pad2 = (num) => String(num).padStart(2, '0');

  const minuteFromToken = (token) => {
    if (token == null) return 0;
    const trimmed = String(token).trim();
    if (!trimmed) return 0;
    if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);
    const minute = zhWordToNumber(trimmed);
    return Number.isNaN(minute) ? 0 : minute;
  };

  const extractTimeComponents = (text) => {
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
    return { hour, minute, time: `${pad2(hour)}:${pad2(minute)}` };
  };

  const extractLocationFromText = (text) => {
    if (!text) return '';
    const normalized = String(text);
    const patterns = [
      /(?:到|去|在|帶我去|陪我去|帶我到|帶.*?去)\s*([^，。、!?？\s]{2,20})/,
      /(?:去|到)\s*([^，。、!?？\s]{2,20})\s*(?:玩|看|辦|買)/,
      /(?:地點|地方|位置)\s*[:：]\s*([^，。、!?？\s]{2,20})/
    ];
    for (const re of patterns) {
      const match = normalized.match(re);
      if (match && match[1]) {
        return match[1]
          .replace(/(那裡|那邊|這裡|這邊|附近|一下|一下子)$/g, '')
          .trim();
      }
    }
    return '';
  };

  const inferCategoryFromText = (text) => {
    if (!text) return null;
    if (/(藥|吃藥|用藥|血壓|糖尿)/.test(text)) return 'medicine';
    if (/(運動|散步|走路|慢跑|體操|瑜伽|練習)/.test(text)) return 'exercise';
    if (/(看醫生|回診|門診|掛號|治療|檢查|牙醫|醫院)/.test(text)) return 'appointment';
    if (/(聊天|通話|打電話|視訊|LINE|Line|孫子|女兒|家人)/.test(text)) return 'chat';
    return null;
  };

  const stripTemporalHints = (text) => {
    if (!text) return '';
    return String(text)
      .replace(/^(請|可以)?\s*(提醒我|幫我提醒|幫我|請提醒)/, '')
      .replace(/(今天|明天|後天|大後天|這週|下週|本週|明年|今年)/g, '')
      .replace(/(上午|早上|清晨|中午|下午|晚上|傍晚|凌晨)/g, '')
      .replace(/(\d{1,2}[：:]\d{1,2})/g, '')
      .replace(/([零〇一二兩三四五六七八九十\d]{1,3})\s*點(?:\s*([零〇一二兩三四五六七八九十\d]{1,3})(?:\s*分)?)?|([零〇一二兩三四五六七八九十\d]{1,3})\s*點半/g, '')
      .replace(/[，。、。,.!?？!]+$/g, '')
      .trim();
  };

  const deriveReminderFallback = (text, dayOffset = 0) => {
    const normalized = (text || '').trim();
    if (!normalized) return {};
    const date = getDateYMD(dayOffset);
    const result = { date };
    const timeInfo = extractTimeComponents(normalized);
    if (timeInfo?.time) {
      result.time = timeInfo.time;
      result.startIso = `${date}T${timeInfo.time}:00+08:00`;
    }
    const location = extractLocationFromText(normalized);
    if (location) result.location = location;
    const category = inferCategoryFromText(normalized);
    if (category) result.category = category;
    const title = stripTemporalHints(normalized);
    if (title) result.title = title;
    return result;
  };

  const getSettings = () => {
    const s = window.aiCompanion?.settings?.reminder || {};
    const required = Object.assign({ title:true, date:true, time:true, category:false, description:false, location:false }, s.required || {});
    const lead = Object.assign({ mode:'30m', minutes:30 }, s.lead || {});
    const confirm = typeof s.confirm === 'boolean' ? s.confirm : true;
    return { required, lead, confirm };
  };

  const computeLead = (startIso, leadCfg) => {
    const start = new Date(startIso);
    const mode = String(leadCfg.mode||'30m');
    let minutes = 0;
    if (mode==='5m') minutes=5; else if (mode==='10m') minutes=10; else if (mode==='30m') minutes=30; else if (mode==='60m') minutes=60; else if (mode==='custom') minutes=Number(leadCfg.minutes)||0; else minutes=0;
    const when = minutes>0 ? new Date(start.getTime()-minutes*60000) : start;
    return when.toISOString().replace(/\.\d{3}Z$/,'+00:00');
  };

  const speakTextIfAvailable = (text) => { try { if ('speechSynthesis' in window) { const u = new SpeechSynthesisUtterance(String(text||'')); window.speechSynthesis.cancel(); window.speechSynthesis.speak(u); } } catch(_){} };
  // Use Yating TTS through backend chat route
  window.speakViaYating = async (text) => {
    try {
      const cfg = window.aiCompanion?.settings?.speechConfig || {};
      const resp = await window.aiCompanion.fetchJson('/chat', { method:'POST', body: JSON.stringify({ message: String(text||''), speechConfig: cfg, persona: window.aiCompanion?.settings?.persona || 'senior' }) });
      const audio = resp?.audio; if (!audio?.audioContent) return;
      const enc = (audio?.audioConfig?.encoding || '').toUpperCase();
      const type = enc==='MP3' ? 'audio/mpeg' : 'audio/wav';
      const el = new Audio(`data:${type};base64,${audio.audioContent}`);
      el.play().catch(()=>{});
    } catch(_) {}
  };

  function openSettingsPanel(){
    const { required, lead, confirm } = getSettings();
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:16px;max-width:520px;width:92%;padding:18px 16px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;position:relative;';
    panel.innerHTML = `
      <h3 style="margin:0 0 12px;font-size:18px;">備忘錄設定</h3>
      <button type="button" aria-label="關閉" id="rsClose" style="position:absolute;top:10px;right:10px;border:none;background:transparent;font-size:18px;cursor:pointer;line-height:1">✕</button>
      <div style="display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center">
        <label>標題（必填）</label><input type="checkbox" checked disabled>
        <label>日期（必填）</label><input type="checkbox" checked disabled>
        <label>時間（必填）</label><input type="checkbox" checked disabled>
        <label>類別</label><input id="rsCat" type="checkbox" ${required.category?'checked':''}>
        <label>說明</label><input id="rsDesc" type="checkbox" ${required.description?'checked':''}>
        <label>地點</label><input id="rsLoc" type="checkbox" ${required.location?'checked':''}>
      </div>
      <div style="margin-top:12px;display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:center">
        <label>提前提醒時間（預設）</label>
        <select id="rsLead" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px">
          <option value="none">無</option>
          <option value="5m">5 分鐘前</option>
          <option value="10m">10 分鐘前</option>
          <option value="30m">30 分鐘前</option>
          <option value="60m">1 小時前</option>
          <option value="custom">自訂（分鐘）</option>
        </select>
        <label id="rsLeadMinLabel" hidden>自訂分鐘</label>
        <input id="rsLeadMin" type="number" min="0" step="1" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px" hidden />
        <label>重複確認</label><input id="rsConfirm" type="checkbox" ${confirm?'checked':''}>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button type="button" class="btn secondary" id="rsCancel">取消</button>
        <button type="button" class="btn" id="rsSave">儲存</button>
      </div>`;
    overlay.appendChild(panel); document.body.appendChild(overlay);
    const $ = (id) => panel.querySelector(id);
    const leadSel = $('#rsLead');
    const leadMin = $('#rsLeadMin');
    const leadMinLabel = $('#rsLeadMinLabel');
    leadSel.value = lead.mode || '30m';
    leadMin.value = Number(lead.minutes||30);
    const syncLeadVisibility = () => {
      const isCustom = leadSel.value === 'custom';
      leadMin.hidden = !isCustom; leadMin.disabled = !isCustom;
      leadMinLabel.hidden = !isCustom;
    };
    syncLeadVisibility();
    leadSel.addEventListener('change', syncLeadVisibility);
    const close = () => { try { document.body.removeChild(overlay) } catch(_){} };
    $('#rsCancel').addEventListener('click', close); $('#rsClose').addEventListener('click', close); overlay.addEventListener('click', (e)=>{ if (e.target===overlay) close() });
    $('#rsSave').addEventListener('click', () => {
      window.aiCompanion.setSettings({
        reminder: {
          required: { title:true, date:true, time:true, category: $('#rsCat').checked, description: $('#rsDesc').checked, location: $('#rsLoc').checked },
          lead: { mode: $('#rsLead').value, minutes: Number($('#rsLeadMin').value||0) },
          confirm: $('#rsConfirm').checked
        }
      });
      close();
    });
  }

  // Confirm card renderer
  async function renderConfirmation(events){
    const container = document.querySelector('[data-ai-chat] #chat-log') || document.querySelector('#chat-log');
    if (!container) return true;
    const row = document.createElement('div'); row.className='message-row message-row--ai';
    const bubble = document.createElement('div'); bubble.className='message ai';
    const card = document.createElement('div'); card.className='card'; card.style.margin='6px 0'; card.style.padding='12px'; card.style.borderRadius='12px'; card.style.boxShadow='0 6px 18px rgba(0,0,0,.06)';
    const title = document.createElement('h4'); title.textContent = '確認行事曆'; title.style.margin='0 0 8px'; card.appendChild(title);
    const list = document.createElement('ul'); list.className='list';
    const ttsLines = [];
    events.forEach(ev => {
      const li = document.createElement('li');
      const start = new Date(ev.start_time);
      const timeStr = start.toTimeString().slice(0,5);
      const leadMin = Math.max(0, Math.round((new Date(ev.start_time) - new Date(ev.reminder_time))/60000));
      // 顯示時隱去空白欄位
      const parts = [ev.title, ev.start_time.slice(0,16).replace('T',' '), leadMin?`提前${leadMin}分鐘`:null, ev.category||null, ev.description||null, ev.location||null].filter(Boolean);
      li.textContent = parts.join('｜');
      list.appendChild(li);
      // 暫存，稍後用更自然的中文重組
      ttsLines.push(`${timeStr}|${leadMin}|${ev.title}`);
    });
    card.appendChild(list);
    const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='8px'; actions.style.justifyContent='flex-end'; actions.style.marginTop='8px';
    const redo = document.createElement('button'); redo.className='btn secondary'; redo.textContent='重新錄製'; redo.style.marginRight='auto';
    // make buttons visible (orange + gray)
    redo.style.background = '#FFE6CC'; redo.style.border = '1px solid #FFB980'; redo.style.color = '#A84B00';
    actions.appendChild(redo);
    const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent='取消';
    cancel.style.background = '#f3f4f6'; cancel.style.border = '1px solid #d1d5db'; cancel.style.color = '#111827';
    const ok = document.createElement('button'); ok.className='btn'; ok.textContent='確認';
    try {
      ok.style.background = '#10B981';
      ok.style.border = '1px solid #059669';
      ok.style.color = '#ffffff';
    } catch(_) {}
    actions.appendChild(cancel); actions.appendChild(ok); card.appendChild(actions);
    bubble.appendChild(card); row.appendChild(bubble); container.appendChild(row);
    try { container.scrollTop = container.scrollHeight } catch(_){}
    // 以更自然的中文組句：例如「我要提前30分鐘提醒你五點要吃藥嗎？」
    const toTimeLabel = (iso) => {
      try { const d = new Date(iso); const h = d.getHours(); const m = d.getMinutes(); const hh = (h%12)||12; if (m===0) return `${hh}點`; if (m===30) return `${hh}點半`; return `${hh}點${String(m).padStart(2,'0')}分`; } catch { return '' }
    };
    // 不在顯示卡片時播放語音，改為新增成功後再播出提示
    const result = await new Promise((resolve)=>{
      redo.addEventListener('click', ()=>{
        try { if (window.aiCompanion && window.aiCompanion.deleteLatestMemo) window.aiCompanion.deleteLatestMemo(); } catch(_){}
        try { if (window.aiCompanion && window.aiCompanion.startVoiceRecording) window.aiCompanion.startVoiceRecording(); else { const r=document.getElementById('record-toggle'); r && r.click(); } } catch(_){}
      }, { once:false });
      cancel.addEventListener('click', ()=>{ try { container.removeChild(row) } catch(_){}; resolve(false) }, { once:true });
      ok.addEventListener('click', ()=>{ try { ok.disabled=true } catch(_){}; try { container.removeChild(row) } catch(_){}; resolve(true) }, { once:true });
    });
    return result;
  }

  // Monkey-patch POST /events to enforce settings and confirmation
  const originalFetchJson = window.aiCompanion.fetchJson;
  window.aiCompanion.fetchJson = async (endpoint, options = {}) => {
    try {
      const url = String(endpoint||'');
      const method = (options?.method || 'GET').toUpperCase();
      if (method === 'POST' && /\bevents\b/.test(url)) {
        const cfg = getSettings();
        let body = {};
        try { body = typeof options.body === 'string' ? JSON.parse(options.body) : (options.body||{}); } catch { body = options.body || {}; }

        // Ensure start_time/lead
        if (!body.reminder_time && body.start_time) {
          body.reminder_time = computeLead(body.start_time, cfg.lead);
        }

        // Required checks -> prompt dialog if missing
        const missing = [];
        const get = (k) => (body[k]==null || String(body[k]).trim()==='') ? '' : String(body[k]).trim();
        if (!get('title')) missing.push('title');
        if (!get('start_time')) missing.push('date_time');
        if (cfg.required.location && !get('location')) missing.push('location');
        if (cfg.required.category && !get('category')) missing.push('category');
        if (cfg.required.description && !get('description')) missing.push('description');

        if (missing.length) {
          try {
            const nameMap = { title:'標題', date_time:'時間', location:'地點', category:'類別', description:'說明' };
            const need = missing.map(k => nameMap[k]||k).join('、');
            if (window.speakViaYating) await window.speakViaYating(`請補充：${need}。您可以在視窗中輸入。`);
          } catch(_){}
          // Open a small form to fill missing fields
          const overlay = document.createElement('div');
          overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
          const panel = document.createElement('div');
          panel.style.cssText = 'background:#fff;border-radius:16px;max-width:420px;width:92%;padding:18px 16px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;position:relative;';
          panel.innerHTML = `<h3 style="margin:0 0 12px;font-size:18px;">補齊備忘欄位</h3>`;
          const grid = document.createElement('div'); grid.style.cssText='display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px';
          const addInput = (label, type, value, id) => { const wrap=document.createElement('div'); wrap.style.gridColumn='1/-1'; const l=document.createElement('label'); l.textContent=label; const inp=document.createElement('input'); inp.type=type; inp.style.cssText='width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px'; inp.value=value||''; if(id) inp.id=id; wrap.appendChild(l); wrap.appendChild(inp); grid.appendChild(wrap); return inp; };
          let loc, cat, desc, time, date; let title;
          if (!get('title')) title = addInput('標題','text', body.title, 'fTitle');
          if (!get('start_time')){ date = addInput('日期','date', tzToday(), 'fDate'); time = addInput('時間','time', '', 'fTime'); }
          if (cfg.required.location && !get('location')) loc = addInput('地點','text','', 'fLoc');
          if (cfg.required.category && !get('category')) cat = addInput('類別','text','', 'fCat');
          if (cfg.required.description && !get('description')) desc = addInput('說明','text','', 'fDesc');
          panel.appendChild(grid);
          // 右上角關閉（叉叉）按鈕
          const closeBtn = document.createElement('button');
          closeBtn.type = 'button';
          closeBtn.setAttribute('aria-label','關閉');
          closeBtn.textContent = '✕';
          closeBtn.style.cssText = 'position:absolute;top:10px;right:10px;border:none;background:transparent;font-size:18px;cursor:pointer;line-height:1';
          panel.appendChild(closeBtn);
          const errorMsg = document.createElement('p');
          errorMsg.style.cssText = 'color:#dc2626;font-size:14px;margin:0 0 8px;';
          errorMsg.hidden = true;
          panel.appendChild(errorMsg);
          // Add small voice-fill buttons beside inputs
          try {
            const attachMic = (inputEl, label, mode) => {
              if (!inputEl) return;
              const btn = document.createElement('button');
              btn.type = 'button'; btn.className='btn secondary'; btn.textContent='用語音填入';
              btn.style.marginTop='6px'; btn.style.marginLeft='8px';
              btn.style.background='#FFE6CC'; btn.style.border='1px solid #FFB980'; btn.style.color='#A84B00';
              btn.addEventListener('click', () => {
                const recBtn = document.getElementById('record-toggle');
                try { if (recBtn && !recBtn.classList.contains('recording')) recBtn.click(); } catch(_){}
                const getLatest = () => { const li=document.querySelector('#memo-list li'); const t=li?li.querySelector('.memo-text'):null; return t?(t.textContent||'').trim():'' };
                const prev = getLatest();
                let ticks = 40; const timer = setInterval(() => {
                  const cur = getLatest();
                  if (cur && cur !== prev) {
                    clearInterval(timer);
                    try { if (recBtn && recBtn.classList.contains('recording')) recBtn.click(); } catch(_){}
                    if (mode === 'time') {
                      const parsed = extractTimeComponents(cur);
                      if (parsed?.time) {
                        inputEl.value = parsed.time;
                        return;
                      }
                    }
                    // Fallback: put raw text
                    inputEl.value = cur;
                  }
                  if (--ticks <= 0) { clearInterval(timer); try { if (recBtn && recBtn.classList.contains('recording')) recBtn.click(); } catch(_){} }
                }, 750);
              });
              inputEl.parentElement && inputEl.parentElement.appendChild(btn);
            };
            if (time) attachMic(time, '時間', 'time');
            if (loc) attachMic(loc, '地點', 'text');
            if (desc) attachMic(desc, '說明', 'text');
          } catch(_){}
          const actions = document.createElement('div'); actions.style.cssText='display:flex;gap:8px;justify-content:flex-end';
          const cancel=document.createElement('button'); cancel.className='btn secondary'; cancel.type='button'; cancel.textContent='取消';
          const ok=document.createElement('button'); ok.className='btn'; ok.type='button'; ok.textContent='確認';
          try {
            ok.style.background = '#10B981';
            ok.style.border = '1px solid #059669';
            ok.style.color = '#ffffff';
          } catch(_) {}
          actions.appendChild(cancel); actions.appendChild(ok); panel.appendChild(actions);
          overlay.appendChild(panel); document.body.appendChild(overlay);
          const resetValidity = (input) => {
            if (!input) return;
            input.style.borderColor = '#e5e7eb';
            input.removeAttribute('aria-invalid');
          };
          [title, date, time, loc, cat, desc].forEach((input) => input && input.addEventListener('input', () => resetValidity(input)));
          const requireValue = (input, label, trim = true) => {
            if (!input) return true;
            const raw = typeof input.value === 'string' ? (trim ? input.value.trim() : input.value) : input.value;
            if (raw) {
              resetValidity(input);
              return true;
            }
            input.style.borderColor = '#dc2626';
            input.setAttribute('aria-invalid', 'true');
            return label;
          };
          const validateInputs = () => {
            const missingLabels = [];
            const focusOrder = [];
            const check = (result, input) => {
              if (result === true) return;
              missingLabels.push(result);
              if (input && !focusOrder.length) focusOrder.push(input);
            };
            if (title) check(requireValue(title, '標題'), title);
            if (date) check(requireValue(date, '日期', false), date);
            if (time) check(requireValue(time, '時間', false), time);
            if (loc) check(requireValue(loc, '地點'), loc);
            if (cat) check(requireValue(cat, '類別'), cat);
            if (desc) check(requireValue(desc, '說明'), desc);
            if (missingLabels.length) {
              errorMsg.textContent = `請填寫：${missingLabels.join('、')}`;
              errorMsg.hidden = false;
              (focusOrder[0] || title || date || time)?.focus();
              return false;
            }
            errorMsg.textContent = '';
            errorMsg.hidden = true;
            return true;
          };
          let removeListeners = () => {};
          const confirmedMissing = await new Promise((resolve) => {
            let settled = false;
            const finish = (value) => {
              if (settled) return;
              settled = true;
              removeListeners();
              resolve(value);
            };
            const escHandler = (evt) => { if (evt.key === 'Escape') { evt.preventDefault(); finish(false); } };
            const overlayHandler = (evt) => { if (evt.target === overlay) finish(false); };
            const cancelHandler = () => finish(false);
            const okHandler = () => {
              if (!validateInputs()) return;
              finish(true);
            };
            removeListeners = () => {
              window.removeEventListener('keydown', escHandler);
              overlay.removeEventListener('click', overlayHandler);
              ok.removeEventListener('click', okHandler);
            };
            window.addEventListener('keydown', escHandler);
            overlay.addEventListener('click', overlayHandler);
            cancel.addEventListener('click', cancelHandler, { once:true });
            ok.addEventListener('click', okHandler);
            closeBtn.addEventListener('click', cancelHandler, { once:true });
          });
          try { document.body.removeChild(overlay) } catch(_){}
          if (!confirmedMissing) { return { ok:false, cancelled:true }; }
          // Merge values if user confirmed
          if (title) body.title = title.value.trim() || body.title;
          if (date && time) { const d = date.value; const t = time.value; body.start_time = `${d}T${t}:00+08:00`; body.end_time = body.end_time || body.start_time; if (!body.reminder_time) body.reminder_time = computeLead(body.start_time, cfg.lead); }
          if (loc) body.location = loc.value.trim();
          if (cat) body.category = (cat.value||'').trim();
          if (desc) body.description = (desc.value||'').trim();
        }

        let confirmed = !cfg.confirm;
        if (cfg.confirm) {
          const ok = await renderConfirmation([body]);
          if (!ok) { return { ok:false, cancelled:true }; }
          confirmed = true;
        }

        const nextOptions = { ...options, body: JSON.stringify(body) };
        const result = await originalFetchJson(endpoint, nextOptions);
        // 新增成功後再播語音提示
        try {
          const ok = result && (result.ok === undefined || result.ok === true);
          if (ok && body && body.title && body.start_time && window.speakViaYating) {
            const d = new Date(body.start_time);
            const h = String(d.getHours()).padStart(2,'0');
            const m = String(d.getMinutes()).padStart(2,'0');
            const t = `${h}:${m}`;
            const msg = `已為你加入提醒：${t}，${body.title}`;
            // 不阻塞：背景播放
            window.speakViaYating(msg).catch(()=>{});
          }
        } catch(_) {}
        if (confirmed) { try { setTimeout(()=>window.location.reload(), 150); } catch(_){} }
        return result;
      }
    } catch (e) {
      // fallthrough
    }
    return await originalFetchJson(endpoint, options);
  };

  // Inject a "備忘錄設定" button next to chat actions
  document.addEventListener('DOMContentLoaded', () => {
    const root = document.querySelector('[data-ai-chat]');
    const actions = root?.querySelector('.chat-actions');
    const sendBtn = root?.querySelector('#send-text');
    if (actions && !document.getElementById('reminder-settings')){
      const b = document.createElement('button'); b.className='btn secondary'; b.id='reminder-settings'; b.type='button'; b.style.marginLeft='8px'; b.textContent='備忘錄設定';
      b.addEventListener('click', openSettingsPanel);
      actions.insertBefore(b, sendBtn || actions.firstChild);
      try { b.textContent = '備忘錄設定'; } catch(_){}
      try {
        const langToggle = root && root.querySelector && root.querySelector('.chat-preferences__row--language .language-toggle');
        if (langToggle && b && langToggle.parentElement) {
          b.style.background = '#FFE6CC';
          b.style.border = '1px solid #FFB980';
          b.style.color = '#A84B00';
          b.style.marginLeft = '8px';
          langToggle.parentElement.insertBefore(b, langToggle.nextSibling);
        }
      } catch(_){}
    }

    // Prefer Gemini classify for parsing reminder speech (runs first and short-circuits others)
    document.addEventListener('click', async (event) => {
      const btn = event.target && event.target.closest('#add-reminder-voice');
      if (!btn) return;
      event.preventDefault(); event.stopImmediatePropagation();

      const first = document.querySelector('#memo-list li');
      const memoTextEl = first ? first.querySelector('.memo-text') : null;
      const latest = memoTextEl ? (memoTextEl.textContent || '').trim() : '';
      if (!latest) {
        try {
          const title = (document.querySelector('#chat-message')?.value || '').trim();
          const today = tzToday();
          if (window.openReminderDialog2) window.openReminderDialog2({ title, date: today });
        } catch(_) {}
        return;
      }

      const dayOffset = /後天/.test(latest) ? 2 : (/明天|翌日|隔天/.test(latest) ? 1 : 0);

      const fallbackData = deriveReminderFallback(latest, dayOffset);
      let startIso = fallbackData.startIso || null;
      let finalTitle = fallbackData.title || null;
      let categoryForSave = fallbackData.category || null;
      let locationForSave = fallbackData.location || null;
      const fallbackDate = fallbackData.date || getDateYMD(dayOffset);
      const timeoutMs = 1500;
      const withTimeout = (p) => Promise.race([ p, new Promise((_, rej)=>setTimeout(()=>rej(new Error('timeout')), timeoutMs)) ]);
      const tryClassify = async () => {
        const trimmed = latest.trim();
        if (!trimmed) return null;
        const payload = { rawText: trimmed, tz: 'Asia/Taipei' };
        try {
          const res = await withTimeout(window.aiCompanion.fetchJson('/chat/classify', { method:'POST', body: JSON.stringify(payload) }));
          if (res && !res.error) return res;
          if (res && res.error !== 'invalid_payload') return res;
        } catch(_) { /* ignore, fall back to heuristics */ }
        return null;
      };

      try {
        const data = await tryClassify() || {};
        const classifyStart = data.startIso || data.start_time || '';
        if (classifyStart) {
          startIso = classifyStart;
        } else {
          const d = (data.date || '').toString().trim();
          const t = (data.time || '').toString().trim();
          if (d && t) startIso = `${d}T${t}:00+08:00`;
          else if (t) startIso = `${fallbackDate}T${t}:00+08:00`;
        }
        if (typeof data.title === 'string' && data.title.trim()) finalTitle = data.title.trim();
        if (typeof data.category === 'string' && data.category.trim()) categoryForSave = data.category.trim();
        if (typeof data.location === 'string' && data.location.trim()) locationForSave = data.location.trim();
      } catch(_) {}

      if (finalTitle) {
        try {
          const r = await withTimeout(window.aiCompanion.fetchJson('/chat/refine-title', { method:'POST', body: JSON.stringify({ rawText: finalTitle }) }));
          if (r && typeof r.title === 'string' && r.title.trim()) finalTitle = r.title.trim();
        } catch(_) {}
      }

      if (!finalTitle) {
        finalTitle = latest
          .replace(/^(請|可以)?\s*(提醒我|幫我提醒|幫我|請提醒)\s*/, '')
          .replace(/(今天|明天|後天|上午|早上|中午|下午|晚上|傍晚)/g, '')
          .replace(/([零〇一二兩三四五六七八九十\d]{1,3})\s*點(?:\s*([零〇一二兩三四五六七八九十\d]{1,3})(?:\s*分)?)?|([零〇一二兩三四五六七八九十\d]{1,3})\s*點半/g, '')
          .replace(/[:：]\s*\d{2}/g, '')
          .replace(/^[，、。,.]+/, '')
          .replace(/[，。,.]+$/, '')
          .trim() || latest;
      }

      const isHalfA = /點半/.test(latest) || (startIso && (new Date(startIso)).getMinutes() === 30);
      const safeTitleA = sanitizeTitleAfterTime(finalTitle || latest, { isHalf: isHalfA });
      const payload = { title: safeTitleA, category: categoryForSave || null, description: null };
      if (locationForSave) payload.location = locationForSave;
      if (startIso) {
        payload.start_time = startIso;
        payload.end_time = startIso;
        payload.reminder_time = computeLead(startIso, getSettings().lead);
      }

      try { await window.aiCompanion.fetchJson('/events', { method:'POST', body: JSON.stringify(payload) }); } catch(_) {}
    }, true);

    // Per-memo add: handle CustomEvent from chat memo list
    document.addEventListener('add-reminder-from-memo', async (ev) => {
      try {
        const detail = ev && ev.detail || {};
        const memoId = detail.id;
        const latest = String(detail.text || '').trim();
        if (!latest) return;
        const dayOffset = /後天/.test(latest) ? 2 : (/明天|翌日|隔天/.test(latest) ? 1 : 0);

        // Use the same classify-first flow as voice button
        const fallbackData = (typeof deriveReminderFallback === 'function') ? deriveReminderFallback(latest, dayOffset) : {};
        let startIso = fallbackData.startIso || null;
        let finalTitle = fallbackData.title || null;
        let categoryForSave = fallbackData.category || null;
        let locationForSave = fallbackData.location || null;
        const timeoutMs = 1500;
        const withTimeout = (p) => Promise.race([ p, new Promise((_, rej)=>setTimeout(()=>rej(new Error('timeout')), timeoutMs)) ]);
        const tryClassify = async () => {
          const payload = { rawText: latest, tz: 'Asia/Taipei' };
          try {
            const res = await withTimeout(window.aiCompanion.fetchJson('/chat/classify', { method:'POST', body: JSON.stringify(payload) }));
            if (res && !res.error) return res;
          } catch(_) {}
          return null;
        };
        try {
          const data = await tryClassify() || {};
          startIso = startIso || data.startIso || data.start_time || '';
          if (!startIso) {
            const d = (data.date || '').toString().trim();
            const t = (data.time || '').toString().trim();
            if (d && t) startIso = `${d}T${t}:00+08:00`;
            else if (t) { const ymd = getDateYMD(dayOffset); startIso = `${ymd}T${t}:00+08:00`; }
          }
          if (typeof data.title === 'string' && data.title.trim()) finalTitle = data.title.trim();
          if (typeof data.category === 'string' && data.category.trim()) categoryForSave = data.category.trim();
          if (typeof data.location === 'string' && data.location.trim()) locationForSave = data.location.trim();
        } catch(_) {}

        // Build payload and send
        const isHalfB = /點半/.test(latest) || (startIso && (new Date(startIso)).getMinutes() === 30);
        const safeTitleB = sanitizeTitleAfterTime(finalTitle || latest, { isHalf: isHalfB });
        const payload = { title: safeTitleB, category: categoryForSave || null, description: null };
        if (locationForSave) payload.location = locationForSave;
        if (startIso) { payload.start_time = startIso; payload.end_time = startIso; payload.reminder_time = computeLead(startIso, getSettings().lead); }
        try {
          await window.aiCompanion.fetchJson('/events', { method:'POST', body: JSON.stringify(payload) });
          // After success, remove this memo from list
          if (memoId && window.aiCompanion.deleteMemoById) window.aiCompanion.deleteMemoById(memoId);
        } catch(_) {}
      } catch(_) {}
    });

    // Override the default behavior of "加入備忘錄（最近語音）" to trigger Q&A fill-in via interceptor
    document.addEventListener('click', async (event) => {
      const btn = event.target && event.target.closest('#add-reminder-voice');
      if (!btn) return;
      event.preventDefault(); event.stopPropagation();
      // Get latest memo text only (avoid grabbing UI timestamps/labels)
      const first = document.querySelector('#memo-list li');
      const memoTextEl = first ? first.querySelector('.memo-text') : null;
      const latest = memoTextEl ? (memoTextEl.textContent || '').trim() : '';
      // Relative-day offset from text: 明天/後天
      const dayOffset = /後天/.test(latest) ? 2 : (/明天|翌日|隔天/.test(latest) ? 1 : 0);
      if (!latest) {
        // Fallback to open the normal dialog
        const title = (document.querySelector('#chat-message')?.value || '').trim();
        const today = tzToday();
        // Try to open the built-in dialog if available
        try { window.openReminderDialog2 ? window.openReminderDialog2({ title, date: today }) : null } catch(_){}
        return;
      }
      let start_time;
      const parsedMemoTime = extractTimeComponents(latest);
      if (parsedMemoTime?.time) {
        const ymd = getDateYMD(dayOffset);
        start_time = `${ymd}T${parsedMemoTime.time}:00+08:00`;
      }

      const cleanedTitle = latest
        .replace(/^(請|可以)?\s*(提醒我|幫我提醒|幫我|請提醒)\s*/,'')
        .replace(/(今天|明天|後天|上午|早上|中午|下午|晚上|傍晚)/g,'')
        .replace(/([零〇一二兩三四五六七八九十\d]{1,3})\s*點(?:\s*([零〇一二兩三四五六七八九十\d]{1,3})(?:\s*分)?)?|([零〇一二兩三四五六七八九十\d]{1,3})\s*點半/g,'')
        .replace(/[:：]\s*\d{2}/g,'')
        .replace(/[，。,.]+$/,'')
        .trim();
      const isHalfC = /點半/.test(latest) || (start_time && (new Date(start_time)).getMinutes() === 30);
      const safeTitleC = sanitizeTitleAfterTime(cleanedTitle || latest, { isHalf: isHalfC });
      const payload = { title: safeTitleC, category: null, description: null };
      // Try naive location extraction
      const lm = latest.match(/(?:在|到|去)\s*([^，。\s]{1,20})/);
      if (lm) payload.location = lm[1].trim();
      if (!start_time && parsedMemoTime?.time) {
        const ymd = getDateYMD(dayOffset);
        start_time = `${ymd}T${parsedMemoTime.time}:00+08:00`;
      }
      if (start_time) { payload.start_time = start_time; payload.end_time = start_time; payload.reminder_time = computeLead(start_time, getSettings().lead); }
      try { await window.aiCompanion.fetchJson('/events', { method:'POST', body: JSON.stringify(payload) }); } catch(_) {}
    }, true);

    // Start today reminder watcher (notification + Yating speech)
    (function startTodayReminderWatcher(){
      if (!window.aiCompanion || !window.aiCompanion.fetchJson) return;
      const tz = 'Asia/Taipei';
      const ymd = (function(){ try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year:'numeric', month:'2-digit', day:'2-digit' }).format(new Date()); } catch { return new Date().toISOString().slice(0,10) } })();
      const nextYmd = (function(){ const d = new Date(ymd + 'T00:00:00'); d.setDate(d.getDate()+1); const yyyy=d.getFullYear(); const mm=String(d.getMonth()+1).padStart(2,'0'); const dd=String(d.getDate()).padStart(2,'0'); return `${yyyy}-${mm}-${dd}`; })();
      const from = `${ymd}T00:00:00+08:00`; const to = `${nextYmd}T00:00:00+08:00`;
      const lsKey = `ai-companion.firedReminders.${ymd}`;
      const loadFired = () => { try { return new Set(JSON.parse(localStorage.getItem(lsKey)||'[]')) } catch { return new Set() } };
      const saveFired = (set) => { try { localStorage.setItem(lsKey, JSON.stringify(Array.from(set))) } catch(_){} };
      const fired = loadFired();

      const requestPermission = () => { try { if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission().catch(()=>{}); } catch(_){} };
      requestPermission();

      const check = async () => {
        try {
          const res = await window.aiCompanion.fetchJson(`/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
          const list = Array.isArray(res?.events) ? res.events : [];
          const now = Date.now();
          for (const ev of list) {
            const whenIso = ev.reminder_time || ev.start_time;
            if (!whenIso || !ev.id) continue;
            const when = new Date(whenIso).getTime();
            // Fire if within past 60s or next 5s, and not fired before
            if (!Number.isFinite(when)) continue;
            if (when <= now + 5000 && when >= now - 60000 && !fired.has(String(ev.id))) {
              fired.add(String(ev.id));
              saveFired(fired);
              // Notification
              try {
                if ('Notification' in window && Notification.permission === 'granted') {
                  const body = `${(window.aiCompanion.formatTimestamp && window.aiCompanion.formatTimestamp(whenIso)) || ''}  ${ev.title || ''}${ev.location ? ' @' + ev.location : ''}`.trim();
                  new Notification('今日重點提醒', { body });
                }
              } catch(_){}
              // Speech via Yating
              try {
                const timeLabel = (function(){ try { const d=new Date(whenIso); const h=String(d.getHours()).padStart(2,'0'); const m=String(d.getMinutes()).padStart(2,'0'); return `${h}:${m}` } catch { return '' } })();
                const parts = [ '提醒：', timeLabel ? `${timeLabel}，` : '', ev.title || '' , ev.location ? `，地點 ${ev.location}` : '' ];
                const text = parts.join('');
                if (window.speakViaYating) await window.speakViaYating(text);
              } catch(_){}
            }
          }
        } catch(_){}
      };

      check();
      setInterval(check, 60000);
      // Additional watcher: fire at start_time and follow-up at +10m
      (function startEventStartAndFollowWatcher(){
        const lsKey2 = `ai-companion.firedStartFollow.${ymd}`;
        const load2 = () => { try { return new Set(JSON.parse(localStorage.getItem(lsKey2)||'[]')) } catch { return new Set() } };
        const save2 = (s) => { try { localStorage.setItem(lsKey2, JSON.stringify(Array.from(s))) } catch(_){} };
        const fired2 = load2();
        const notify = async (title, body) => { try { if ('Notification' in window && Notification.permission === 'granted') new Notification(title, { body }); } catch(_){} };
        const speak = async (text) => { try { if (window.speakViaYating) await window.speakViaYating(text); } catch(_){} };
        const toHM = (iso) => { try { const d=new Date(iso); return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}` } catch { return '' } };
        const tick = async () => {
          try {
            const res = await window.aiCompanion.fetchJson(`/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
            const list = Array.isArray(res?.events) ? res.events : [];
            const now = Date.now();
            const within = (ts) => Number.isFinite(ts) && ts <= now + 5000 && ts >= now - 60000;
            for (const ev of list) {
              if (!ev?.id || !ev.start_time) continue; const id=String(ev.id);
              const sIso = ev.start_time; const sTs = new Date(sIso).getTime(); if (within(sTs) && !fired2.has(id+':start')) {
                fired2.add(id+':start'); save2(fired2);
                const body = `${(window.aiCompanion.formatTimestamp && window.aiCompanion.formatTimestamp(sIso)) || ''}  ${ev.title || ''}${ev.location ? ' @' + ev.location : ''}`.trim();
                const text = `現在時間 ${toHM(sIso)}。${ev.title || ''}${ev.location ? '，地點 '+ev.location : ''}`;
                await notify('行程開始提醒', body); await speak(text);
              }
              const fIsoTs = (Number.isFinite(sTs) ? sTs + 600000 : NaN);
              if (within(fIsoTs) && !fired2.has(id+':follow10m')) {
                fired2.add(id+':follow10m'); save2(fired2);
                const text = `你開始做了嗎？${toHM(sIso)} 的 ${ev.title || ''}。完成之後記得按確認喔。`;
                await notify('追蹤提醒', '你開始做了嗎？完成後記得按確認喔。'); await speak(text);
              }
            }
          } catch(_) {}
        };
        tick(); setInterval(tick, 60000);
      })();
    })();
  });
})();
