"use strict";

// 健康排行榜：使用後端 /api/ranking 資料

let DATA = [];

const METRIC_KEY = {
  total: "total_score",
  care: "care_tasks_score",
  self: "self_tasks_score"
};

const ACHIEVEMENT_LABEL = {
  medicine_perfect_month: "百毒不侵",
  exercise_6_in_month: "強身健體",
  appointment_keeper: "門診不缺席",
  chatty_friend: "愛聊聊天",
  routine_master: "天天不間斷"
};

const segmentButtons = [
  ...document.querySelectorAll(".segment__item[data-metric]")
];
const thumb = document.querySelector(".segment__thumb");

const podium = document.querySelector(".podium");
const podiumItems = podium ? [...podium.querySelectorAll(".podium__item")] : [];

const listEl = document.getElementById("lb-list");
const syncBtn = document.getElementById("sync-btn");
const elBest = document.getElementById("insight-best");
const elAvg = document.getElementById("insight-avg");
const elStreak = document.getElementById("insight-streak");

function getActiveScope() {
  const btn = document.querySelector("[data-scope-toggle].is-active");
  return btn?.dataset.scope || "global";
}

function getSorted(metric) {
  const key = METRIC_KEY[metric] || METRIC_KEY.total;
  return [...DATA].sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
}

function renderPodium(sorted) {
  const top3 = sorted.slice(0, 3);
  const sourceIdx = [1, 0, 2]; // 左=第2，中=第1，右=第3
  const rankLabels = [2, 1, 3];

  sourceIdx.forEach((srcIdx, pos) => {
    const item = podiumItems[pos];
    if (!item) return;

    const data = top3[srcIdx];
    const av = item.querySelector("[data-avatar]");
    const label = item.querySelector("[data-label]");
    const rankEl = item.querySelector("[data-rank]");

    if (!data) {
      if (av) av.innerHTML = "";
      if (label) label.textContent = "—";
      if (rankEl) rankEl.textContent = String(rankLabels[pos]);
      return;
    }

    renderAvatar(av, data.name, data.avatar, pos === 1 ? 76 : 64);
    if (label) label.textContent = data.name;
    if (rankEl) rankEl.textContent = String(rankLabels[pos]);
  });
}

function renderStageScores(sorted, metric) {
  const top3 = sorted.slice(0, 3);
  const map = { 2: top3[1], 1: top3[0], 3: top3[2] };
  const key = METRIC_KEY[metric] || METRIC_KEY.total;

  document.querySelectorAll("[data-score-box]").forEach((box) => {
    const which = box.getAttribute("data-score-box");
    const data = map[which];
    const nameEl = box.querySelector("[data-name]");
    const valEl = box.querySelector("[data-score]");
    if (!data) {
      if (nameEl) nameEl.textContent = "—";
      if (valEl) valEl.textContent = "—";
      return;
    }
    if (nameEl) nameEl.textContent = data.name;
    if (valEl) valEl.textContent = `${data[key] ?? 0} 分`;
  });
}

function renderList(sorted, metric) {
  const rest = sorted.slice(3);
  const key = METRIC_KEY[metric] || METRIC_KEY.total;
  listEl.innerHTML = rest
    .map(
      (p, idx) => `
    <li class="lb-row">
      <div class="badge-rank">${idx + 4}</div>
      <div class="avatar" data-avatar-list="${p.id}"></div>
      <div class="lb-name">${p.name}</div>
      <div class="lb-score">${p[key] ?? 0} 分</div>
      ${
        p.achievements && p.achievements.length
          ? `<div class="lb-achievements">${p.achievements
              .map((a) => {
                const label = ACHIEVEMENT_LABEL[a.key] || a.key;
                const meta = a.meta || {};
                if (a.bonus_points && a.bonus_points > 0) {
                  return `${label}（已達成）`;
                }
                const current = meta.done ?? meta.days_with_score ?? meta.current;
                const target =
                  meta.total ?? meta.target ?? meta.needed ?? undefined;
                if (current != null && target != null && target > 0) {
                  return `${label}（${current}/${target}）`;
                }
                return label;
              })
              .join("、")}</div>`
          : ""
      }
    </li>
  `
    )
    .join("");

  rest.forEach((p) => {
    const el = document.querySelector(`[data-avatar-list="${p.id}"]`);
    if (el) renderAvatar(el, p.name, p.avatar, 56);
  });
}

function renderInsights(sorted, metric) {
  if (!sorted.length) return;
  const key = METRIC_KEY[metric] || METRIC_KEY.total;
  const best = sorted[0];
  const avg = Math.round(
    sorted.reduce((s, x) => s + (x[key] ?? 0), 0) / sorted.length
  );
  const streak = Math.floor(Math.random() * 3) + 2; // 先用隨機 2~4 人當示意

  if (elBest) elBest.textContent = `${best.name}（${best[key] ?? 0} 分）`;
  if (elAvg) elAvg.textContent = `${avg} 分`;
  if (elStreak) elStreak.textContent = `${streak} 人`;
}

function moveThumbTo(index) {
  if (thumb) thumb.style.transform = `translateX(${index * 100}%)`;
}

function render(metric = "total") {
  const sorted = getSorted(metric);
  renderPodium(sorted);
  renderStageScores(sorted, metric);
  renderList(sorted, metric);
  renderInsights(sorted, metric);
}

async function loadAndRender(metric = "total") {
  try {
    const scope = getActiveScope();
    const res = await window.aiCompanion?.fetchJson?.(
      `ranking/monthly?scope=${encodeURIComponent(scope)}`,
      { method: "GET" }
    );
    const entries = res?.entries || [];
    DATA = entries.map((e, idx) => ({
      id: e.user_id ?? idx + 1,
      name: e.name ?? `使用者 #${e.user_id}`,
      avatar: "",
      total_score: e.total_score ?? 0,
      care_tasks_score: e.care_tasks_score ?? 0,
      self_tasks_score: e.self_tasks_score ?? 0,
      achievements: e.achievements || []
    }));
    render(metric);
  } catch (error) {
    console.error("[Ranking] 載入月排行失敗", error);
  }
}

loadAndRender("total");

segmentButtons.forEach((btn, idx) => {
  btn.addEventListener("click", () => {
    if (!btn.dataset.metric) return;
    segmentButtons.forEach((b) => {
      if (!b.hasAttribute("data-scope-toggle")) b.classList.remove("is-active");
    });
    btn.classList.add("is-active");
    moveThumbTo(idx);
    render(btn.dataset.metric || "total");
  });
});

document.querySelectorAll("[data-scope-toggle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("[data-scope-toggle]")
      .forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    const activeMetric =
      document.querySelector(
        ".segment__item.is-active:not([data-scope-toggle])"
      )?.dataset.metric || "total";
    loadAndRender(activeMetric);
  });
});

function renderAvatar(el, name, url, size = 64) {
  if (!el) return;
  if (url) {
    el.innerHTML = `<img src="${url}" alt="${name}" width="${size}" height="${size}" />`;
    return;
  }
  const initials = (name || "").trim().slice(0, 2).toUpperCase();
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  el.style.background = `hsl(${hue}, 75%, 55%)`;
  el.textContent = initials || "—";
}

if (syncBtn) {
  syncBtn.addEventListener("click", () => {
    syncBtn.disabled = true;
    const original = syncBtn.textContent;
    syncBtn.textContent = "同步中…";
    (async () => {
      try {
        await window.aiCompanion?.fetchJson?.("ranking/rebuild/daily", {
          method: "POST"
        });
        await window.aiCompanion?.fetchJson?.("ranking/rebuild/monthly", {
          method: "POST"
        });
        const activeMetric =
          document.querySelector(
            ".segment__item.is-active:not([data-scope-toggle])"
          )?.dataset.metric || "total";
        await loadAndRender(activeMetric);
        syncBtn.textContent = "已同步";
      } catch (error) {
        console.error("[Ranking] 同步失敗", error);
        syncBtn.textContent = "同步失敗";
      } finally {
        setTimeout(() => {
          syncBtn.textContent = original;
          syncBtn.disabled = false;
        }, 1200);
      }
    })();
  });
}

(() => {
  const insightBtn = document.getElementById("insight-toggle");
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
      const metric =
        document.querySelector(
          ".segment__item.is-active:not([data-scope-toggle])"
        )?.dataset.metric || "total";
      const sorted = getSorted(metric);
      renderInsights(sorted, metric);
    }
  });
})();
