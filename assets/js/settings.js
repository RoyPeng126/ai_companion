"use strict";

(function () {
  const VOICE_OPTIONS = [
    {
      id: "zh_en_female_1",
      label: "雅婷（女性）",
      description: "自然溫柔、適合陪伴提醒。"
    },
    {
      id: "zh_en_female_2",
      label: "意晴（女性）",
      description: "活潑亮麗、適合充滿活力的對話。"
    },
    {
      id: "zh_en_male_1",
      label: "家豪（男性）",
      description: "沉穩可靠、適合叮嚀與關懷。"
    }
  ];

  const setActiveVoice = (voiceId) => {
    const buttons = Array.from(document.querySelectorAll("[data-voice-option]"));
    document.querySelectorAll("[data-voice-option]").forEach((button) => {
      const isActive = button.dataset.voiceOption === voiceId;
      button.classList.toggle("is-selected", isActive);
      button.setAttribute("aria-checked", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        button.setAttribute("data-selected", "true");
      } else {
        button.removeAttribute("data-selected");
      }
    });
    if (!buttons.some((button) => button.getAttribute("aria-checked") === "true") && buttons.length) {
      buttons[0].setAttribute("aria-checked", "true");
      buttons[0].tabIndex = 0;
      buttons[0].classList.add("is-selected");
    }
  };

  const renderVoiceOptions = () => {
    const containers = document.querySelectorAll("[data-voice-options]");
    if (!containers.length) return;

    containers.forEach((container) => {
      const variant = container.dataset.voiceVariant ?? "";
      const fragment = document.createDocumentFragment();
      VOICE_OPTIONS.forEach((voice) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "voice-option";
        if (variant === "compact") {
          button.classList.add("voice-option--compact");
        }
        button.dataset.voiceOption = voice.id;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        button.tabIndex = -1;
        button.innerHTML = `
          <span class="voice-name">${voice.label}</span>
          <span class="voice-desc">${voice.description}</span>
        `;
        fragment.appendChild(button);
      });

      container.innerHTML = "";
      container.appendChild(fragment);
    });
  };

  const applyListeners = () => {
    if (!window.aiCompanion) return;
    const containers = document.querySelectorAll("[data-voice-options]");
    if (!containers.length) return;

    containers.forEach((container) => {
      container.addEventListener("click", (event) => {
        const target = event.target.closest("[data-voice-option]");
        if (!target) return;
        const voiceId = target.dataset.voiceOption;
        window.aiCompanion.setSettings({
          speechConfig: { voiceName: voiceId }
        });
        setActiveVoice(voiceId);
      });

      container.addEventListener("keydown", (event) => {
        if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const buttons = Array.from(container.querySelectorAll("[data-voice-option]"));
        if (!buttons.length) return;
        const currentIndex = buttons.findIndex((btn) => btn.getAttribute("aria-checked") === "true");
        const increment = event.key === "ArrowUp" || event.key === "ArrowLeft" ? -1 : 1;
        let nextIndex = currentIndex + increment;
        if (nextIndex < 0) nextIndex = buttons.length - 1;
        if (nextIndex >= buttons.length) nextIndex = 0;
        const nextButton = buttons[nextIndex];
        if (nextButton) {
          nextButton.focus();
          nextButton.click();
        }
      });
    });

    const { speechConfig } = window.aiCompanion.settings;
    if (speechConfig?.voiceName) {
      setActiveVoice(speechConfig.voiceName);
    }

    window.aiCompanion.subscribeSettings((settings) => {
      if (settings?.speechConfig?.voiceName) {
        setActiveVoice(settings.speechConfig.voiceName);
      }
    });
  };

  window.addEventListener("DOMContentLoaded", () => {
    renderVoiceOptions();
    applyListeners();
  });
})();
