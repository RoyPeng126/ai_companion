"use strict";

(function () {
  const DEFAULT_LANGUAGE = "zh-TW";
  const LANGUAGE_VOICES = {
    "zh-TW": [
      {
        id: "zh_en_female_1",
        label: "雅婷（國語）",
        description: "自然溫柔，適合每日陪伴提醒。"
      },
      {
        id: "zh_en_female_2",
        label: "意晴（國語）",
        description: "活潑亮麗，為聊天增添活力。"
      },
      {
        id: "zh_en_male_1",
        label: "家豪（國語）",
        description: "沉穩可靠，貼心叮嚀與關懷。"
      }
    ],
    "nan-TW": [
      {
        id: "tai_female_1",
        label: "雅婷（台語）",
        description: "柔和親切，細膩傳遞關懷。"
      },
      {
        id: "tai_female_2",
        label: "意晴（台語）",
        description: "清亮溫暖，活力鼓勵打氣。"
      },
      {
        id: "tai_male_1",
        label: "家豪（台語）",
        description: "厚實穩重，陪你安心叮嚀。"
      }
    ]
  };

  const getValidLanguage = (languageCode) =>
    LANGUAGE_VOICES[languageCode] ? languageCode : DEFAULT_LANGUAGE;

  const getVoiceOptions = (languageCode) =>
    LANGUAGE_VOICES[getValidLanguage(languageCode)];

  const ensureVoiceForLanguage = (languageCode, voiceId) => {
    const options = getVoiceOptions(languageCode);
    if (options.some((option) => option.id === voiceId)) {
      return voiceId;
    }
    return options[0]?.id ?? "";
  };

  const setActiveVoice = (voiceId) => {
    const buttons = Array.from(document.querySelectorAll("[data-voice-option]"));
    if (!buttons.length) return voiceId;
    let activeVoice = voiceId;
    let matched = false;
    buttons.forEach((button, index) => {
      const isActive = button.dataset.voiceOption === voiceId;
      button.classList.toggle("is-selected", isActive);
      button.setAttribute("aria-checked", isActive ? "true" : "false");
      button.tabIndex = isActive ? 0 : -1;
      if (isActive) {
        matched = true;
      }
    });
    if (!matched) {
      const [first, ...rest] = buttons;
      if (!first) {
        return activeVoice;
      }
      activeVoice = first.dataset.voiceOption;
      first.classList.add("is-selected");
      first.setAttribute("aria-checked", "true");
      first.tabIndex = 0;
      rest.forEach((button) => {
        button.classList.remove("is-selected");
        button.setAttribute("aria-checked", "false");
        button.tabIndex = -1;
      });
    }
    return activeVoice;
  };

  const renderVoiceOptions = (languageCode, activeVoiceId) => {
    const containers = document.querySelectorAll("[data-voice-options]");
    if (!containers.length) return activeVoiceId;
    const options = getVoiceOptions(languageCode);

    containers.forEach((container) => {
      const variant = container.dataset.voiceVariant ?? "";
      const fragment = document.createDocumentFragment();
      options.forEach((voice) => {
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

    return setActiveVoice(activeVoiceId);
  };

  const setActiveLanguageButton = (container, languageCode) => {
    if (!container) return;
    Array.from(container.querySelectorAll("[data-language-option]")).forEach((button) => {
      const isActive = button.dataset.languageOption === languageCode;
      button.classList.toggle("is-selected", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive) {
        button.tabIndex = 0;
      } else {
        button.removeAttribute("tabindex");
      }
    });
  };

  const applyVoiceListeners = () => {
    if (!window.aiCompanion) return;
    const containers = document.querySelectorAll("[data-voice-options]");
    if (!containers.length) return;

    containers.forEach((container) => {
      container.addEventListener("click", (event) => {
        const target = event.target.closest("[data-voice-option]");
        if (!target) return;
        const voiceId = target.dataset.voiceOption;
        const languageCode = getValidLanguage(
          window.aiCompanion.settings?.speechConfig?.languageCode
        );
        window.aiCompanion.setSettings({
          speechConfig: {
            languageCode,
            voiceName: voiceId
          }
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
        const currentIndex = buttons.findIndex(
          (btn) => btn.getAttribute("aria-checked") === "true"
        );
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
  };

  window.addEventListener("DOMContentLoaded", () => {
    if (!window.aiCompanion) return;
    const languageContainer = document.querySelector("[data-language-options]");
    const voiceContainers = document.querySelectorAll("[data-voice-options]");
    if (!voiceContainers.length) return;

    const syncFromSettings = (settings) => {
      const languageCode = getValidLanguage(settings?.speechConfig?.languageCode);
      const ensuredVoice = ensureVoiceForLanguage(languageCode, settings?.speechConfig?.voiceName);
      const activeVoice = renderVoiceOptions(languageCode, ensuredVoice);
      setActiveLanguageButton(languageContainer, languageCode);

      if (
        activeVoice !== settings?.speechConfig?.voiceName ||
        languageCode !== settings?.speechConfig?.languageCode
      ) {
        window.aiCompanion.setSettings({
          speechConfig: {
            languageCode,
            voiceName: activeVoice
          }
        });
      }
    };

    const initialSettings = window.aiCompanion.settings;
    syncFromSettings(initialSettings);

    if (languageContainer) {
      languageContainer.addEventListener("click", (event) => {
        const target = event.target.closest("[data-language-option]");
        if (!target) return;
        const selectedLanguage = getValidLanguage(target.dataset.languageOption);
        const currentVoice = window.aiCompanion.settings?.speechConfig?.voiceName;
        const ensuredVoice = ensureVoiceForLanguage(selectedLanguage, currentVoice);
        renderVoiceOptions(selectedLanguage, ensuredVoice);
        setActiveLanguageButton(languageContainer, selectedLanguage);
        window.aiCompanion.setSettings({
          speechConfig: {
            languageCode: selectedLanguage,
            voiceName: ensuredVoice
          }
        });
      });
    }

    applyVoiceListeners();

    window.aiCompanion.subscribeSettings((settings) => {
      syncFromSettings(settings);
    });
  });
})();
