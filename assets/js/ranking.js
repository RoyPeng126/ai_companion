/* 健康排行榜 - 修正版（對齊 podium 結構，填分數/洞察） */
const DATA = [
  { id: 1, name: "小孫", avatar: "", steps: 9200, meds: 3,  chat: 18 },
  { id: 2, name: "小卓", avatar: "", steps: 8150, meds: 2,  chat: 15 },
  { id: 3, name: "小彭", avatar: "", steps: 7800, meds: 2,  chat: 11 },
  { id: 4, name: "阿茲奶奶", avatar: "", steps: 6600, meds: 2,  chat:  9 },
  { id: 5, name: "小盧", avatar: "", steps: 6400, meds: 1,  chat: 10 },
  { id: 6, name: "小黃", avatar: "", steps: 5900, meds: 3,  chat:  6 },
  { id: 7, name: "阿默爺爺", avatar: "", steps: 5400, meds: 1,  chat: 12 },
];

const METRIC_LABEL = { steps: "步數", meds: "服藥", chat: "聊天" };

const segmentButtons = [...document.querySelectorAll(".segment__item")];
const thumb = document.querySelector(".segment__thumb");

const podium = document.querySelector(".podium");
const podiumItems = podium ? [...podium.querySelectorAll(".podium__item")] : [];

const listEl   = document.getElementById("lb-list");
const syncBtn  = document.getElementById("sync-btn");
const elBest   = document.getElementById("insight-best");
const elAvg    = document.getElementById("insight-avg");
const elStreak = document.getElementById("insight-streak");

/* 排序 */
function getSorted(metric){ return [...DATA].sort((a,b) => b[metric] - a[metric]); }

/* 渲染前三名頒獎台（左=第二、 中=第一、右=第三） */
function renderPodium(sorted, metric){
  const top3 = sorted.slice(0,3);
  const sourceIdx = [1, 0, 2];     // 從 top3 取資料的索引：左取第二、中字第一、右取第三
  const rankLabels = [2, 1, 3];    // 對應顯示的名次數字

  sourceIdx.forEach((srcIdx, pos) => {
    const item   = podiumItems[pos];
    if (!item) return;

    const data   = top3[srcIdx];
    const av     = item.querySelector("[data-avatar]");
    const label  = item.querySelector("[data-label]");
    const rankEl = item.querySelector("[data-rank]");

    if (!data){
      if (av) av.innerHTML = "";
      if (label) label.textContent = "—";
      if (rankEl) rankEl.textContent = String(rankLabels[pos]);
      return;
    }

    renderAvatar(av, data.name, data.avatar, pos === 1 ? 76 : 64);
    if (rankEl) rankEl.textContent = String(rankLabels[pos]);
  });
}


/* 舞台下方三個分數框（左=2名／中=1名／右=3名） */
function renderStageScores(sorted, metric){
  const top3 = sorted.slice(0,3);
  const map  = { 2: top3[1], 1: top3[0], 3: top3[2] };
  document.querySelectorAll("[data-score-box]").forEach(box=>{
    const which = box.getAttribute("data-score-box");
    const data  = map[which];
    const nameEl = box.querySelector("[data-name]");
    const valEl  = box.querySelector("[data-score]");
    if (!data){
      if (nameEl) nameEl.textContent = "—";
      if (valEl)  valEl.textContent  = "—";
      return;
    }
    if (nameEl) nameEl.textContent = data.name;
    if (valEl)  valEl.textContent  = `${data[metric]} ${METRIC_LABEL[metric]==="步數" ? "步":"次"}`;
  });
}

/* 名單（第4名起） */
function renderList(sorted, metric){
  const rest = sorted.slice(3);
  listEl.innerHTML = rest.map((p, idx) => `
    <li class="lb-row">
      <div class="badge-rank">${idx+4}</div>
      <div class="avatar" data-avatar-list="${p.id}"></div>
      <div class="lb-name">${p.name}</div>
      <div class="lb-score">${p[metric]} ${METRIC_LABEL[metric]==="步數" ? "步" : "次"}</div>
    </li>
  `).join("");
  rest.forEach(p => {
    const el = document.querySelector(`[data-avatar-list="${p.id}"]`);
    if (el) renderAvatar(el, p.name, p.avatar, 56);
  });
}

/* 洞察（簡單統計） */
function renderInsights(sorted, metric){
  if (!sorted.length) return;
  const best = sorted[0];
  const avg  = Math.round(sorted.reduce((s,x)=>s + x[metric], 0) / sorted.length);
  const streak = Math.floor(Math.random()*3)+2; // 假資料：2~4 人連續達標
  if (elBest)   elBest.textContent   = `${best.name}（${best[metric]}${METRIC_LABEL[metric]==="步數"?"步":"次"}）`;
  if (elAvg)    elAvg.textContent    = `${avg} ${METRIC_LABEL[metric]==="步數"?"步":"次"}`;
  if (elStreak) elStreak.textContent = `${streak} 人`;
}

/* Segmented Thumb 動畫 */
function moveThumbTo(index){ if (thumb) thumb.style.transform = `translateX(${index*100}%)`; }

/* 初始化 + 切換 */
function render(metric="steps"){
  const sorted = getSorted(metric);
  renderPodium(sorted, metric);
  renderStageScores(sorted, metric);
  renderList(sorted, metric);
  renderInsights(sorted, metric);
}
render("steps");

segmentButtons.forEach((btn, idx) => {
  btn.addEventListener("click", () => {
    segmentButtons.forEach(b => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    moveThumbTo(idx);
    render(btn.dataset.metric);
  });
});

function renderAvatar(el, name, url, size = 64) {
  if (!el) return;
  if (url) {
    el.innerHTML = `<img src="${url}" alt="${name}" width="${size}" height="${size}" />`;
    return;
  }
  const initials = (name || "").trim().slice(0, 2).toUpperCase();
  let hash = 0; for (let i = 0; i < (name || "").length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  el.style.background = `hsl(${hue}, 75%, 55%)`;
  el.textContent = initials || "🙂";
}

// 假同步
if (syncBtn){
  syncBtn.addEventListener("click", () => {
    syncBtn.disabled = true;
    const original = syncBtn.textContent;
    syncBtn.textContent = "同步中…";
    setTimeout(() => {
      syncBtn.textContent = "已同步";
      setTimeout(() => {
        syncBtn.textContent = original;
        syncBtn.disabled = false;
      }, 1200);
    }, 1000);
  });
}

// 健康洞察：按一下切換顯示 / 隱藏（使用 hidden 屬性）
(() => {
  const insightBtn   = document.getElementById("insight-toggle");
  const insightPanel = document.getElementById("insight-panel");
  if (!insightBtn || !insightPanel) return;

  insightBtn.addEventListener("click", () => {
    const open = insightBtn.getAttribute("aria-expanded") === "true";
    if (open) {
      insightPanel.hidden = true;
      insightBtn.setAttribute("aria-expanded", "false");
    } else {
      insightPanel.hidden = false;
      insightBtn.setAttribute("aria-expanded", "true");
      // 展開時刷新內容
      const metric = document.querySelector(".segment__item.is-active")?.dataset.metric || "steps";
      const sorted = getSorted(metric);
      renderInsights(sorted, metric);
    }
  });
})();
