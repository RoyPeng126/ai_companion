"use strict";

(function () {
  const ROLE_STORAGE_KEY = "ai-companion-active-role";

  const readRole = () => {
    try {
      const fromApi = window.aiCompanion?.getActiveRole?.();
      if (fromApi) return fromApi;
    } catch (_) {}
    try {
      const session = window.sessionStorage?.getItem?.(ROLE_STORAGE_KEY);
      if (session) return session;
    } catch (_) {}
    try {
      const local = window.localStorage?.getItem?.(ROLE_STORAGE_KEY);
      if (local) return local;
    } catch (_) {}
    return "";
  };

  const showToast = (msg) => {
    try {
      if (window.AIToast) {
        window.AIToast.show(msg);
        return;
      }
    } catch (_) {}
    // eslint-disable-next-line no-alert
    alert(msg);
  };

  const createCardContainer = () => {
    const main = document.querySelector("main");
    if (!main) return null;
    const card = document.createElement("section");
    card.className = "card";
    card.id = "care-invitations-card";
    card.setAttribute("aria-label", "家屬與社工邀請");

    card.innerHTML = `
      <h2>家屬與社工邀請</h2>
      <p class="helper-text">當家人或社工想一起關心您時，會在這裡出現邀請。</p>
      <div id="care-invitations-content">
        <p class="helper-text">目前沒有新的邀請。</p>
      </div>
    `;

    main.appendChild(card);
    return card.querySelector("#care-invitations-content");
  };

  const renderInvitations = (container, invitations) => {
    container.innerHTML = "";
    if (!invitations || invitations.length === 0) {
      const p = document.createElement("p");
      p.className = "helper-text";
      p.textContent = "目前沒有新的邀請。";
      container.appendChild(p);
      return;
    }

    const list = document.createElement("ul");
    list.className = "list";

    invitations.forEach((inv) => {
      const li = document.createElement("li");
      const name = inv.caregiver_name || `使用者 #${inv.caregiver_id}`;
      const role = inv.caregiver_role === "family" ? "家屬" : "社工 / 照護者";

      const title = document.createElement("div");
      title.textContent = `${name}（${role}）`;

      const sub = document.createElement("div");
      sub.className = "helper-text";
      sub.textContent = "想加入您的關注名單。";

      const actions = document.createElement("div");
      actions.style.display = "flex";
      actions.style.gap = "8px";
      actions.style.marginTop = "8px";

      const acceptBtn = document.createElement("button");
      acceptBtn.type = "button";
      acceptBtn.className = "btn secondary care-invite-accept";
      acceptBtn.textContent = "同意";

      const rejectBtn = document.createElement("button");
      rejectBtn.type = "button";
      rejectBtn.className = "btn secondary care-invite-reject";
      rejectBtn.textContent = "拒絕";

      acceptBtn.addEventListener("click", async () => {
        try {
          await window.aiCompanion?.fetchJson?.(`care/invitations/${inv.id}/accept`, {
            method: "POST"
          });
          showToast("已同意邀請。");
          li.remove();
          if (!list.children.length) {
            renderInvitations(container, []);
          }
        } catch (error) {
          const msg =
            (error && error.message) ||
            "無法處理邀請，請稍後再試。";
          showToast(msg);
        }
      });

      rejectBtn.addEventListener("click", async () => {
        try {
          await window.aiCompanion?.fetchJson?.(`care/invitations/${inv.id}/reject`, {
            method: "POST"
          });
          showToast("已拒絕邀請。");
          li.remove();
          if (!list.children.length) {
            renderInvitations(container, []);
          }
        } catch (error) {
          const msg =
            (error && error.message) ||
            "無法處理邀請，請稍後再試。";
          showToast(msg);
        }
      });

      actions.appendChild(acceptBtn);
      actions.appendChild(rejectBtn);

      li.appendChild(title);
      li.appendChild(sub);
      li.appendChild(actions);

      list.appendChild(li);
    });

    container.appendChild(list);
  };

  document.addEventListener("DOMContentLoaded", async () => {
    const role = readRole();
    if (role !== "elder" && role !== "senior") return;

    const container = createCardContainer();
    if (!container) return;

    try {
      const res = await window.aiCompanion?.fetchJson?.("care/invitations?direction=received", {
        method: "GET"
      });
      renderInvitations(container, res?.invitations || []);
    } catch (_) {
      // 讀取失敗就保留預設提示，不阻止其他功能
    }
  });
})();

