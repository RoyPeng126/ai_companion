// Reminders UI: add events (user_events) from chat text or latest voice memo
(function () {
  const onReady = (fn) => (document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', fn) : fn());

  function tzToday() {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function openReminderDialog(defaults) {
    const d = Object.assign({ title: '', category: '', description: '', date: tzToday(), time: '09:00', remind: '' }, defaults || {});
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.35);display:flex;align-items:center;justify-content:center;z-index:9999;';
    const panel = document.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:16px;max-width:420px;width:92%;padding:18px 16px;box-shadow:0 10px 30px rgba(0,0,0,.2);font-family:inherit;position:relative;';
    panel.innerHTML = [
      '<h3 style="margin:0 0 12px;font-size:18px;">新增備忘錄</h3>',
      '<button id="rmClose" type="button" aria-label="關閉" style="position:absolute;top:10px;right:10px;border:none;background:transparent;font-size:18px;cursor:pointer;line-height:1">×</button>',
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:8px">',
      '  <div style="grid-column:1/-1"><label>標題</label><input id="rmTitle" type="text" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>',
      '  <div><label>日期</label><input id="rmDate" type="date" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>',
      '  <div><label>時間</label><input id="rmTime" type="time" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>',
      '  <div><label>提醒時間(可選)</label><input id="rmRemind" type="time" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>',
      '  <div><label>類別</label><select id="rmCat" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"><option value="">未分類</option><option value="medicine">用藥</option><option value="exercise">運動</option><option value="appointment">就醫</option><option value="chat">聊天</option><option value="other">其他</option></select></div>',
      '  <div style="grid-column:1/-1"><label>說明(可選)</label><input id="rmDesc" type="text" style="width:100%;padding:10px 12px;border:1px solid #e5e7eb;border-radius:10px"/></div>',
      '</div>',
      '<div style="display:flex;gap:8px;justify-content:flex-end">',
      '  <button id="rmCancel" class="btn secondary" type="button">取消</button>',
      '  <button id="rmSave" class="btn" type="button">儲存</button>',
      '</div>'
    ].join('');
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    const $ = (sel) => panel.querySelector(sel);
    $('#rmTitle').value = d.title; $('#rmCat').value = d.category; $('#rmDesc').value = d.description; $('#rmDate').value = d.date; $('#rmTime').value = d.time; $('#rmRemind').value = d.remind;
    const close = () => { try { document.body.removeChild(overlay) } catch { } };
    $('#rmCancel').addEventListener('click', close);
    $('#rmClose').addEventListener('click', close);
    overlay.addEventListener('click', (e)=>{ if (e.target === overlay) close() });
    const onKey = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', onKey) } };
    window.addEventListener('keydown', onKey);
    $('#rmSave').addEventListener('click', async () => {
      const title = $('#rmTitle').value.trim(); const date = $('#rmDate').value; const time = $('#rmTime').value; const remind = $('#rmRemind').value; const category = $('#rmCat').value || null; const description = ($('#rmDesc').value || '').trim() || null;
      if (!title || !date || !time) { alert('請填寫標題/日期/時間'); return }
      const startIso = `${date}T${time}:00+08:00`; const remindIso = remind ? `${date}T${remind}:00+08:00` : startIso;
      try {
        await window.aiCompanion.fetchJson('/events', { method: 'POST', body: JSON.stringify({ title, category, description, start_time: startIso, end_time: startIso, reminder_time: remindIso }) });
        close();
      } catch { alert('新增失敗，稍後再試') }
    });
  }

  function injectButtons() {
    const root = document.querySelector('[data-ai-chat]');
    if (!root || !window.aiCompanion) return false;
    const textarea = root.querySelector('#chat-message');
    const sendBtn = root.querySelector('#send-text');
    const actions = root.querySelector('.chat-actions');
    const voiceHeader = root.querySelector('.voice-memos-header');
    if (!actions || !sendBtn || !textarea) return false;

    if (!document.getElementById('add-reminder-text')) {
      const b = document.createElement('button'); b.className = 'btn secondary'; b.id = 'add-reminder-text'; b.type = 'button'; b.textContent = '加入備忘錄（文字）';
      b.addEventListener('click', () => { const title = (textarea.value || '').trim(); if (!title) { alert('請先輸入文字'); return } openDialog({ title, date: tzToday() }) });
      actions.insertBefore(b, sendBtn || actions.firstChild);
    }

    if (voiceHeader && !document.getElementById('add-reminder-voice')) {
      const b = document.createElement('button'); b.className = 'link-button'; b.id = 'add-reminder-voice'; b.type = 'button'; b.style.marginLeft = '8px'; b.textContent = '加入備忘錄';
      b.addEventListener('click', () => {
        const last = (document.querySelector('#memo-list li') && Array.from(document.querySelectorAll('#memo-list li')).pop()) || null;
        const title = last ? (last.textContent || '').trim() : (textarea.value || '').trim();
        openDialog({ title: title || '語音備忘錄', date: tzToday() });
      });
      voiceHeader.appendChild(b);
    }
    return true;
  }

  onReady(() => {
    // 嘗試立即注入，不行則用 MutationObserver 監聽直到可注入
    if (injectButtons()) return;
    const obs = new MutationObserver(() => { if (injectButtons()) obs.disconnect() });
    obs.observe(document.documentElement, { childList: true, subtree: true });
  });
})();

