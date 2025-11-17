"use strict";

(function () {
  const ROLE_STORAGE_KEY = "ai-companion-active-role";

  const readStoredRole = () => {
    const sources = [
      () => window.sessionStorage?.getItem?.(ROLE_STORAGE_KEY),
      () => window.localStorage?.getItem?.(ROLE_STORAGE_KEY)
    ];
    for (const read of sources) {
      try {
        const value = read();
        if (value) return value;
      } catch (_) {}
    }
    return "";
  };

  const ensureCareRole = () => {
    const role = readStoredRole();
    if (role === "elder" || role === "senior") {
      window.location.replace("index.html");
    }
  };

  const initUserMenu = () => {
    const avatarBtn = document.getElementById("avatarBtn");
    const dropdown = document.getElementById("userDropdown");
    const logoutBtn = document.getElementById("umLogout");
    const accountLink = document.getElementById("umAccount");
    const permissionsBtn = document.getElementById("permissions-row");
    const nameEl = document.getElementById("umName");
    const emailEl = document.getElementById("umEmail");

    const toggleMenu = () => {
      if (!dropdown) return;
      const isHidden = dropdown.hasAttribute("hidden");
      if (isHidden) {
        dropdown.removeAttribute("hidden");
        avatarBtn?.setAttribute("aria-expanded", "true");
      } else {
        dropdown.setAttribute("hidden", "");
        avatarBtn?.setAttribute("aria-expanded", "false");
      }
    };

    avatarBtn?.addEventListener("click", () => {
      toggleMenu();
    });

    document.addEventListener("click", (event) => {
      if (!dropdown || !avatarBtn) return;
      const target = event.target;
      if (target === avatarBtn || avatarBtn.contains(target)) return;
      if (!dropdown.hasAttribute("hidden") && !dropdown.contains(target)) {
        dropdown.setAttribute("hidden", "");
        avatarBtn.setAttribute("aria-expanded", "false");
      }
    });

    logoutBtn?.addEventListener("click", async () => {
      try {
        await window.aiCompanion?.fetchJson?.("auth/logout", { method: "POST" });
      } catch (_) {}
      try {
        window.aiCompanion?.clearAuthToken?.();
      } catch (_) {}
      try {
        window.sessionStorage?.removeItem?.(ROLE_STORAGE_KEY);
        window.localStorage?.removeItem?.(ROLE_STORAGE_KEY);
      } catch (_) {}
      window.location.replace("login.html");
    });

    accountLink?.addEventListener("click", () => {
      try {
        window.sessionStorage?.setItem?.("ai-companion-settings-tab", "account");
      } catch (_) {}
    });

    const hidePermissionsForNonElders = (role) => {
      const normalized = window.aiCompanion?.normalizeRole?.(role) || role || "";
      const isElder = normalized.toLowerCase() === "elder";
      if (permissionsBtn && !isElder) {
        // 從下拉選單移除權限項，避免留下空白行
        permissionsBtn.remove();
      }
    };

    (async () => {
      try {
        const me = await window.aiCompanion?.fetchJson?.("users/me", {
          method: "GET"
        });
        const user = me?.user || me;
        if (user) {
          if (nameEl && user.full_name) nameEl.textContent = user.full_name;
          if (emailEl && user.email) emailEl.textContent = user.email;
          hidePermissionsForNonElders(user.charactor || user.role || "");
        } else {
          hidePermissionsForNonElders(readStoredRole());
        }
      } catch (_) {
        hidePermissionsForNonElders(readStoredRole());
      }
    })();
  };

  const initCareDashboard = () => {
    const listEl = document.getElementById("care-elder-list");
    const titleEl = document.getElementById("care-detail-title");
    const subtitleEl = document.getElementById("care-detail-subtitle");
    const detailEl = document.getElementById("care-detail-content");
    const addElderBtn = document.getElementById("add-elder-btn");

    if (!listEl || !titleEl || !subtitleEl || !detailEl) return;

    let selectedElderId = null;

    const todayISODate = () => {
      const d = new Date();
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, "0");
      const day = String(d.getDate()).padStart(2, "0");
      return `${y}-${m}-${day}`;
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

    const renderEvents = (container, events) => {
      container.innerHTML = "";
      if (!events || events.length === 0) {
        const p = document.createElement("p");
        p.className = "helper-text";
        p.textContent = "這一天目前沒有備忘錄。";
        container.appendChild(p);
        return;
      }

      const ul = document.createElement("ul");
      ul.className = "list";

      events.forEach((evt) => {
        const li = document.createElement("li");

        const title = document.createElement("div");
        title.textContent = evt.title || "(無標題)";

        const meta = document.createElement("div");
        meta.className = "helper-text";
        const start = evt.start_time ? new Date(evt.start_time) : null;
        const timeText = start
          ? start.toLocaleTimeString("zh-TW", {
              hour12: false,
              hour: "2-digit",
              minute: "2-digit"
            })
          : "";
        const statusText = evt.status ? "已完成" : "未完成";
        meta.textContent = [timeText, statusText].filter(Boolean).join(" · ");

        li.appendChild(title);
        li.appendChild(meta);
        ul.appendChild(li);
      });

      container.appendChild(ul);
    };

    const loadElderEvents = async (elderId, dateStr, container) => {
      try {
        const res = await window.aiCompanion?.fetchJson?.(
          `care/elders/${elderId}/events?date=${encodeURIComponent(dateStr)}`,
          { method: "GET" }
        );
        renderEvents(container, res?.events || []);
      } catch (error) {
        const msg =
          (error && error.message) ||
          "無法載入該日期的備忘錄。";
        showToast(msg);
      }
    };

    const renderElderDetail = (elder) => {
      selectedElderId = elder.user_id;
      titleEl.textContent = `${elder.full_name || `長者 #${elder.user_id}`} 的狀態總覽`;
      detailEl.innerHTML = "";

      const wrapper = document.createElement("div");

      const controls = document.createElement("div");
      controls.className = "form-group";

      const label = document.createElement("label");
      label.setAttribute("for", "care-date");
      label.textContent = "日期";

      const dateInput = document.createElement("input");
      dateInput.id = "care-date";
      dateInput.type = "date";
      dateInput.value = todayISODate();

      controls.appendChild(label);
      controls.appendChild(dateInput);

      const eventsContainer = document.createElement("div");
      eventsContainer.id = "care-events";
      eventsContainer.style.marginTop = "12px";

      wrapper.appendChild(controls);
      wrapper.appendChild(eventsContainer);

      const bulkForm = document.createElement("form");
      bulkForm.style.marginTop = "16px";
      bulkForm.innerHTML = `
        <h4 style="margin:0 0 8px;font-size:14px;">新增多日備忘錄</h4>
        <div class="form-group">
          <label for="bulk-title">標題</label>
          <input id="bulk-title" type="text" required placeholder="例如：中午飯後吃藥">
        </div>
        <div class="form-group">
          <label for="bulk-start-date">開始日期</label>
          <input id="bulk-start-date" type="date" required>
        </div>
        <div class="form-group">
          <label for="bulk-days">連續天數</label>
          <input id="bulk-days" type="number" min="1" max="60" value="30">
        </div>
        <div class="form-group">
          <label for="bulk-time">每天時間</label>
          <input id="bulk-time" type="time" value="12:00" required>
        </div>
        <div class="form-group">
          <label for="bulk-remind-time">提醒時間（可留空，預設同上）</label>
          <input id="bulk-remind-time" type="time">
        </div>
        <div class="form-group">
          <label for="bulk-category">類別</label>
          <select id="bulk-category">
            <option value="">未分類</option>
            <option value="medicine">用藥</option>
            <option value="exercise">運動</option>
            <option value="appointment">就醫</option>
            <option value="chat">聊天</option>
            <option value="other">其他</option>
          </select>
        </div>
        <button type="submit" class="btn secondary care-bulk-confirm">新增多日備忘錄</button>
      `;

      const startInput = bulkForm.querySelector("#bulk-start-date");
      if (startInput) startInput.value = todayISODate();

      bulkForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const title = bulkForm.querySelector("#bulk-title")?.value.trim() || "";
        const startDate = bulkForm.querySelector("#bulk-start-date")?.value || "";
        const daysVal = bulkForm.querySelector("#bulk-days")?.value || "";
        const timeVal = bulkForm.querySelector("#bulk-time")?.value || "";
        const remindVal = bulkForm.querySelector("#bulk-remind-time")?.value || "";
        const categoryVal = bulkForm.querySelector("#bulk-category")?.value || "";

        if (!title || !startDate || !timeVal) {
          showToast("請填寫標題、開始日期與時間。");
          return;
        }

        const daysNum = Number(daysVal) || 0;
        if (!Number.isFinite(daysNum) || daysNum <= 0) {
          showToast("連續天數必須為正整數。");
          return;
        }

        const confirmMessage = [
          `標題：${title}`,
          `開始日期：${startDate}`,
          `連續天數：${daysNum} 天`,
          `每天時間：${timeVal}`,
          remindVal ? `提醒時間：${remindVal}` : "提醒時間：同每天時間",
          categoryVal ? `類別：${categoryVal}` : "類別：未分類",
          "",
          "是否確認為長者建立這組多日備忘錄？"
        ].join("\n");

        // eslint-disable-next-line no-alert
        const ok = window.confirm(confirmMessage);
        if (!ok) return;

        try {
          await window.aiCompanion?.fetchJson?.(
            `care/elders/${selectedElderId}/events/bulk`,
            {
              method: "POST",
              body: JSON.stringify({
                title,
                description: null,
                category: categoryVal || null,
                start_date: startDate,
                days: daysNum,
                time: timeVal,
                remind_time: remindVal || undefined
              })
            }
          );
          showToast("已為長者新增多日備忘錄。");
          const currentDate = document.getElementById("care-date")?.value || todayISODate();
          loadElderEvents(selectedElderId, currentDate, eventsContainer);
        } catch (error) {
          const msg =
            (error && error.message) ||
            "新增多日備忘錄失敗，請稍後再試。";
          showToast(msg);
        }
      });

      wrapper.appendChild(bulkForm);
      detailEl.appendChild(wrapper);

      const loadForCurrentDate = () => {
        const value = dateInput.value || todayISODate();
        loadElderEvents(selectedElderId, value, eventsContainer);
      };

      dateInput.addEventListener("change", loadForCurrentDate);
      loadForCurrentDate();
    };

    const renderElders = (elders) => {
      listEl.innerHTML = "";
      if (!elders || elders.length === 0) {
        const li = document.createElement("li");
        li.textContent = "目前尚未關注任何長者，請先新增。";
        listEl.appendChild(li);
        return;
      }
      elders.forEach((elder) => {
        const li = document.createElement("li");
        li.className = "care-elder-item";
        const name = elder.full_name || `長者 #${elder.user_id}`;
        li.textContent = `${name}（ID: ${elder.user_id}）`;
        li.addEventListener("click", () => {
          subtitleEl.textContent = "可查看該日期的備忘錄與完成狀態。";
          renderElderDetail(elder);
        });
        listEl.appendChild(li);
      });
    };

    const fetchElders = async () => {
      try {
        const res = await window.aiCompanion?.fetchJson?.("care/elders", {
          method: "GET"
        });
        renderElders(res?.elders || []);
        const role = (res?.caregiver_role || readStoredRole() || "").toString();
        if (role === "family" || role === "caregiver") {
          subtitleEl.textContent =
            "選擇一位長者後，可在右側查看備忘錄與安全紀錄。";
        } else {
          subtitleEl.textContent = "此介面為家屬與社工設計。";
        }
      } catch (_) {}
    };

    addElderBtn?.addEventListener("click", () => {
      detailEl.innerHTML = "";
      const form = document.createElement("form");
      form.innerHTML = `
        <div class="form-group">
          <label for="elder-id">長者 User ID</label>
          <input id="elder-id" name="elder-id" type="number" min="1" required placeholder="例如：25">
        </div>
        <div class="form-group">
          <label for="elder-phone">長者電話（或 Email 擇一）</label>
          <input id="elder-phone" name="elder-phone" type="tel" placeholder="09xxxxxxxx">
        </div>
        <div class="form-group">
          <label for="elder-email">長者 Email（可留空）</label>
          <input id="elder-email" name="elder-email" type="email" placeholder="name@example.com">
        </div>
        <p class="helper-text">請向長者確認 User ID 與電話 / Email，以確保身分正確。</p>
        <button type="submit" class="btn primary">送出關注邀請</button>
      `;

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const elderIdValue = form.querySelector("#elder-id")?.value || "";
        const phoneValue = form.querySelector("#elder-phone")?.value || "";
        const emailValue = form.querySelector("#elder-email")?.value || "";
        if (!elderIdValue || (!phoneValue && !emailValue)) {
          showToast("請至少填寫長者 User ID，並提供電話或 Email 其中一項。");
          return;
        }
        try {
          await window.aiCompanion?.fetchJson?.("care/invitations", {
            method: "POST",
            body: JSON.stringify({
              elderUserId: Number(elderIdValue),
              phone: phoneValue || undefined,
              email: emailValue || undefined
            })
          });
          showToast("邀請已送出，請等待長者同意。");
        } catch (error) {
          const msg =
            (error && error.message) ||
            "送出邀請失敗，請稍後再試。";
          showToast(msg);
        }
      });

      detailEl.appendChild(form);
    });

    fetchElders();
  };

  document.addEventListener("DOMContentLoaded", () => {
    ensureCareRole();
    initUserMenu();
    initCareDashboard();
  });
})();
