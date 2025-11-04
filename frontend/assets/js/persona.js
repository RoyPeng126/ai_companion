// assets/js/persona.js

document.addEventListener("DOMContentLoaded", () => {
  const personaButtons = document.querySelectorAll(".persona-pick");
  const status = document.getElementById("personaStatus");
  const form = document.getElementById("prefForm");
  let selectedPersona = null;

  const updateButtons = (key) => {
    personaButtons.forEach((btn) => {
      const card = btn.closest(".companion-card");
      const persona = card?.dataset.persona;
      if (persona === key) {
        btn.classList.add("btn-selected");
        btn.textContent = "已選擇";
      } else {
        btn.classList.remove("btn-selected");
        btn.textContent = "選擇";
      }
    });
    if (!status) return;
    const activeCard = key ? document.querySelector(`[data-persona="${key}"] h3`) : null;
    status.textContent = activeCard
      ? `目前已設定的陪聊夥伴：${activeCard.textContent}`
      : "目前尚未選擇陪聊夥伴";
  };

  const applyPersona = (personaKey, { syncSettings = true, persist = true } = {}) => {
    if (!personaKey) {
      selectedPersona = null;
      updateButtons("");
      if (persist) window.localStorage.removeItem("persona");
      return;
    }
    selectedPersona = personaKey;
    updateButtons(personaKey);
    if (persist) {
      window.localStorage.setItem("persona", personaKey);
    }
    if (
      syncSettings &&
      window.aiCompanion &&
      window.aiCompanion.settings?.persona !== personaKey
    ) {
      window.aiCompanion.setSettings({ persona: personaKey });
    }
  };

  const storedPersona = window.localStorage.getItem("persona");
  const aiPersona = window.aiCompanion?.settings?.persona ?? null;
  const initialPersona = storedPersona || aiPersona || null;
  if (initialPersona) {
    applyPersona(initialPersona, { syncSettings: !!window.aiCompanion });
  } else {
    updateButtons("");
  }

  personaButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const persona = btn.closest(".companion-card")?.dataset.persona;
      if (!persona) return;
      applyPersona(persona);
    });
  });

  if (window.aiCompanion?.subscribeSettings) {
    window.aiCompanion.subscribeSettings((settings) => {
      const persona = settings?.persona;
      if (persona && persona !== selectedPersona) {
        applyPersona(persona, { syncSettings: false });
      }
    });
  }

  if (form) {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (!selectedPersona) {
        alert("請先選擇一個陪聊夥伴");
        return;
      }

      const tone = document.getElementById("tone")?.value;
      const topics = document.getElementById("topics")?.value.trim() ?? "";
      const data = { persona: selectedPersona, tone, topics };

      window.localStorage.setItem("preferences", JSON.stringify(data));
      console.log("已儲存偏好設定：", data);
      alert("已儲存偏好設定");
    });
  }
});
