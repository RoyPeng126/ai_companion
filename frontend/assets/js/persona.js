"use strict";

(function () {
  const personaLabels = {
    child: "活力童年版",
    adult: "溫柔青壯版",
    senior: "智慧長者版"
  };

  const getStatusText = (key) => {
    const label = personaLabels[key] ?? personaLabels.senior;
    return `目前已設定的陪聊夥伴：${label}`;
  };

  const markSelection = (persona) => {
    document.querySelectorAll(".persona-card").forEach((card) => {
      const cardPersona = card.dataset.persona;
      const isSelected = cardPersona === persona;
      card.classList.toggle("is-selected", isSelected);
      card.setAttribute("aria-pressed", isSelected ? "true" : "false");
      card.querySelectorAll(".persona-pick").forEach((button) => {
        button.setAttribute("aria-pressed", isSelected ? "true" : "false");
      });
    });

    const status = document.querySelector("#persona-status");
    if (status) {
      status.textContent = getStatusText(persona);
    }
  };

  const setupInteractions = () => {
    document.querySelectorAll(".persona-card").forEach((card) => {
      const persona = card.dataset.persona;
      if (!persona) return;

      const selectPersona = () => {
        window.aiCompanion.setSettings({ persona });
        markSelection(persona);
      };

      card.addEventListener("click", (event) => {
        const buttonClicked = event.target.closest("button, a");
        if (!buttonClicked) {
          selectPersona();
        }
      });
      card.querySelectorAll(".persona-pick").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          selectPersona();
        });
      });
    });
  };

  window.addEventListener("DOMContentLoaded", () => {
    if (!window.aiCompanion) return;

    const { persona } = window.aiCompanion.settings;
    markSelection(persona);
    setupInteractions();

    window.aiCompanion.subscribeSettings((settings) => {
      markSelection(settings.persona);
    });
  });
})();
