"use strict";

(function () {
  const card = document.querySelector("[data-elder-link]");
  if (!card || !window.aiCompanion) return;

  const statusText = card.querySelector("[data-elder-link-text]");
  const form = card.querySelector("[data-elder-link-form]");
  const selfBox = card.querySelector("[data-elder-self]");
  const selfIdLabel = card.querySelector("[data-current-elder-id]");

  const toast = (msg, variant = "info") => {
    if (window.showToast) {
      window.showToast(msg, { variant });
    } else {
      console.log("[elder-link]", msg);
    }
  };

  let currentUser = null;

  const ensureUser = async () => {
    if (currentUser) return currentUser;
    if (window.aiCompanion.currentUser) {
      currentUser = window.aiCompanion.currentUser;
      return currentUser;
    }
    try {
      const res = await window.aiCompanion.fetchJson("/auth/me");
      currentUser = res?.user || null;
      if (currentUser) window.aiCompanion.currentUser = currentUser;
      return currentUser;
    } catch (error) {
      console.warn("[elder-link] 無法取得使用者", error);
      return null;
    }
  };

  const renderStatus = (elders) => {
    if (!statusText) return;
    const list = Array.isArray(elders) ? elders : elders ? [elders] : [];
    if (!list.length) {
      statusText.textContent = "尚未綁定";
      return;
    }
    const text = list
      .map((elder) => {
        const name = elder.full_name || elder.username || `User ${elder.user_id}`;
        return `${name} (#${elder.user_id})`;
      })
      .join("、");
    statusText.textContent = text;
  };

  const loadLinkedElder = async () => {
    try {
      const res = await window.aiCompanion.fetchJson("/users/linked-elder");
      const elders = Array.isArray(res?.elders)
        ? res.elders
        : res?.elder
          ? [res.elder]
          : [];
      renderStatus(elders);
    } catch (error) {
      console.warn("[elder-link] 取得綁定狀態失敗", error);
      renderStatus([]);
    }
  };

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(form);
    const elderId = Number(formData.get("elder_user_id"));
    const phone = (formData.get("elder_phone") || "").toString().replace(/\D+/g, "");
    if (!Number.isFinite(elderId) || !phone) {
      toast("請輸入正確的 User ID 與手機號碼", "error");
      return;
    }
    try {
      const res = await window.aiCompanion.fetchJson("/users/link-elder", {
        method: "POST",
        body: JSON.stringify({ elder_user_id: elderId, elder_phone: phone })
      });
      const elders = Array.isArray(res?.elders)
        ? res.elders
        : res?.elder
          ? [res.elder]
          : [];
      renderStatus(elders);
      toast("已成功綁定長者", "success");
    } catch (error) {
      toast("綁定失敗，請再次確認資料", "error");
      console.warn("[elder-link] 綁定失敗", error);
    }
  });

  (async () => {
    const user = await ensureUser();
    if (!user) {
      renderStatus([]);
      return;
    }
    const normalizedRole = window.aiCompanion.normalizeRole?.(user.charactor) || "";
    if (normalizedRole === "elder") {
      renderStatus([]);
      if (selfBox) selfBox.hidden = false;
      if (form) form.hidden = true;
      if (selfIdLabel) selfIdLabel.textContent = user.user_id ?? "—";
    } else {
      if (selfBox) selfBox.hidden = true;
      if (form) form.hidden = false;
      await loadLinkedElder();
    }
  })();
})();
