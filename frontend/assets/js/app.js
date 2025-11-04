"use strict";

(function () {
  const STORAGE_KEY = "ai-companion.settings";
  const DEFAULT_LANGUAGE_CODE = "zh-TW";
  const DEFAULT_PERSONA_KEY = "senior";
  const PERSONA_DEFAULT_VOICES = {
    child: {
      "zh-TW": "zh_en_female_2",
      "nan-TW": "tai_female_2"
    },
    adult: {
      "zh-TW": "zh_en_female_1",
      "nan-TW": "tai_female_1"
    },
    senior: {
      "zh-TW": "zh_en_male_1",
      "nan-TW": "tai_male_1"
    }
  };

  const VOICE_PERSONA_MAP = {
    zh_en_female_1: "adult",
    zh_en_female_2: "child",
    zh_en_male_1: "senior",
    tai_female_1: "adult",
    tai_female_2: "child",
    tai_male_1: "senior"
  };

  function resolvePersonaDefaultVoice(persona, languageCode = DEFAULT_LANGUAGE_CODE) {
    const personaKey = PERSONA_DEFAULT_VOICES[persona] ? persona : DEFAULT_PERSONA_KEY;
    const personaVoices = PERSONA_DEFAULT_VOICES[personaKey] ?? PERSONA_DEFAULT_VOICES.senior;
    if (!personaVoices) return "";
    if (personaVoices[languageCode]) {
      return personaVoices[languageCode];
    }
    if (personaVoices[DEFAULT_LANGUAGE_CODE]) {
      return personaVoices[DEFAULT_LANGUAGE_CODE];
    }
    const [fallback] = Object.values(personaVoices);
    return fallback ?? "";
  }

  function resolvePersonaByVoice(voiceName, fallbackPersona = DEFAULT_PERSONA_KEY) {
    const trimmed = typeof voiceName === "string" ? voiceName.trim() : "";
    if (!trimmed) return fallbackPersona;
    return VOICE_PERSONA_MAP[trimmed] ?? fallbackPersona;
  }

  const DEFAULT_SETTINGS = {
    apiBaseUrl: "http://localhost:3001/api",
    persona: DEFAULT_PERSONA_KEY,
    speechConfig: {
      languageCode: DEFAULT_LANGUAGE_CODE,
      voiceName: resolvePersonaDefaultVoice("senior", DEFAULT_LANGUAGE_CODE),
      speakingRate: 1,
      pitch: 1,
      energy: 1
    }
  };

  let currentSettings = { ...DEFAULT_SETTINGS };
  const listeners = new Set();

  const loadSettings = () => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        return { ...DEFAULT_SETTINGS };
      }
      const parsed = JSON.parse(stored);
      const mergedSpeech = {
        ...DEFAULT_SETTINGS.speechConfig,
        ...(parsed?.speechConfig ?? {})
      };
      const persistedPersona = parsed?.persona ?? DEFAULT_PERSONA_KEY;
      const normalizedPersona = normalizePersonaKey(persistedPersona);
      mergedSpeech.languageCode = mergedSpeech.languageCode || DEFAULT_LANGUAGE_CODE;
      if (!mergedSpeech.voiceName) {
        mergedSpeech.voiceName = resolvePersonaDefaultVoice(
          normalizedPersona,
          mergedSpeech.languageCode
        );
      }

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        persona: normalizedPersona,
        speechConfig: mergedSpeech
      };
    } catch (error) {
      console.warn("[AI Companion] 無法讀取設定，將使用預設值。", error);
      return { ...DEFAULT_SETTINGS };
    }
  };

  const persist = (settings) => {
    currentSettings = settings;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (error) {
      console.warn("[AI Companion] 設定儲存失敗。", error);
    }
    listeners.forEach((callback) => {
      try {
        callback(currentSettings);
      } catch (callbackError) {
        console.error("[AI Companion] 設定監聽器錯誤。", callbackError);
      }
    });
  };

  const getBaseUrl = () => currentSettings.apiBaseUrl.replace(/\/$/, "");

  const apiFetch = async (endpoint, options = {}) => {
    const url = /^https?:\/\//i.test(endpoint)
      ? endpoint
      : `${getBaseUrl()}/${endpoint.replace(/^\//, "")}`;

    const headers = {
      Accept: "application/json",
      ...(options.body && !options.headers?.["Content-Type"]
        ? { "Content-Type": "application/json" }
        : {}),
      ...options.headers
    };

    const response = await window.fetch(url, {
      credentials: options.credentials ?? 'include',
      ...options,
      headers
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(
        `[AI Companion] API 呼叫失敗 (${response.status}) ${message}`
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return await response.json();
    }
    return await response.text();
  };

  const formatTime = (timestamp) => {
    try {
      const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
      if (Number.isNaN(date.getTime())) return "";
      return date.toLocaleString("zh-TW", {
        hour12: false,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (error) {
      console.warn("[AI Companion] 時間格式化失敗。", error);
      return "";
    }
  };

  const normalizePersonaKey = (key) => {
    if (typeof key !== "string") {
      return DEFAULT_PERSONA_KEY;
    }
    const trimmed = key.trim();
    return PERSONA_DEFAULT_VOICES[trimmed] ? trimmed : DEFAULT_PERSONA_KEY;
  };

  const updateSettings = (changes = {}) => {
    const speechChanges = changes?.speechConfig ?? {};
    const personaProvided = Object.prototype.hasOwnProperty.call(changes, "persona");
    const voiceProvided = Object.prototype.hasOwnProperty.call(speechChanges, "voiceName");
    const languageProvided = Object.prototype.hasOwnProperty.call(speechChanges, "languageCode");

    const currentPersona = normalizePersonaKey(currentSettings.persona);
    let normalizedPersona = personaProvided
      ? normalizePersonaKey(changes.persona)
      : currentPersona;

    const mergedSpeech = {
      ...DEFAULT_SETTINGS.speechConfig,
      ...currentSettings.speechConfig,
      ...speechChanges
    };

    mergedSpeech.languageCode =
      typeof mergedSpeech.languageCode === "string" && mergedSpeech.languageCode.trim()
        ? mergedSpeech.languageCode.trim()
        : currentSettings.speechConfig.languageCode || DEFAULT_LANGUAGE_CODE;

    if (voiceProvided && typeof mergedSpeech.voiceName === "string") {
      mergedSpeech.voiceName = mergedSpeech.voiceName.trim();
    }

    if (voiceProvided) {
      const personaFromVoice = resolvePersonaByVoice(
        mergedSpeech.voiceName,
        normalizedPersona
      );
      if (personaFromVoice !== normalizedPersona) {
        normalizedPersona = personaFromVoice;
      }
    }

    if (!voiceProvided && (personaProvided || languageProvided)) {
      const personaVoice = resolvePersonaDefaultVoice(
        normalizedPersona,
        mergedSpeech.languageCode
      );
      if (personaVoice && personaVoice !== mergedSpeech.voiceName) {
        mergedSpeech.voiceName = personaVoice;
      }
    }

    if (!mergedSpeech.voiceName) {
      mergedSpeech.voiceName = resolvePersonaDefaultVoice(
        normalizedPersona,
        mergedSpeech.languageCode
      );
    }

    const next = {
      ...currentSettings,
      ...changes,
      persona: normalizedPersona,
      speechConfig: mergedSpeech
    };

    persist(next);
    return next;
  };

  const subscribe = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };

  currentSettings = loadSettings();

  window.aiCompanion = {
    get settings() {
      return { ...currentSettings };
    },
    setSettings: updateSettings,
    getPersonaDefaultVoice: resolvePersonaDefaultVoice,
    getPersonaForVoice: resolvePersonaByVoice,
    subscribeSettings: subscribe,
    fetchJson: apiFetch,
    formatTimestamp: formatTime
  };

  document.addEventListener("DOMContentLoaded", () => {
    const menuToggle = document.querySelector("[data-menu-toggle]");
    const menu = document.querySelector("[data-menu]");
    if (!menuToggle || !menu) {
      return;
    }

    const closeMenu = () => {
      menu.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    };

    menuToggle.addEventListener("click", () => {
      const isOpen = menu.classList.toggle("is-open");
      menuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });

    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) {
        closeMenu();
      }
    });

    window.addEventListener("resize", () => {
      if (window.innerWidth > 720) {
        closeMenu();
      }
    });
  });
})();
