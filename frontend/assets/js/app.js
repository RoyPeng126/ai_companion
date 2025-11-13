"use strict";

(function () {
  const previousApi = window.aiCompanion || {};

  const API_BASE_STORAGE_KEY = "AI_COMPANION_API_BASE";
  const AUTH_TOKEN_STORAGE_KEY = "AI_COMPANION_AUTH_TOKEN";
  let proxyGetApiBase = null;

  const sanitizeOrigin = (value) => {
    if (!value) return "";
    return String(value).trim().replace(/\/$/, "");
  };

  const readStoredApiOrigin = () => {
    try {
      const stored = window.localStorage?.getItem
        ? window.localStorage.getItem(API_BASE_STORAGE_KEY)
        : "";
      return sanitizeOrigin(stored);
    } catch (_) {
      return "";
    }
  };

  const deriveDefaultApiOrigin = () => {
    const protocol = window.location?.protocol || "http:";
    const hostname = window.location?.hostname || "localhost";
    const defaultPort = "3001";
    return sanitizeOrigin(`${protocol}//${hostname || "localhost"}:${defaultPort}`);
  };

  const resolveApiOrigin = () => {
    const helper = window.aiCompanion?.getApiBase;
    if (typeof helper === "function" && helper !== proxyGetApiBase) {
      const fromHelper = sanitizeOrigin(helper());
      if (fromHelper) return fromHelper;
    }
    const stored = readStoredApiOrigin();
    if (stored) return stored;
    return deriveDefaultApiOrigin();
  };

  const readStoredAuthToken = () => {
    try {
      const value = window.localStorage?.getItem
        ? window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY)
        : "";
      return typeof value === "string" ? value.trim() : "";
    } catch (_) {
      return "";
    }
  };

  const persistAuthToken = (token) => {
    const normalized = typeof token === "string" ? token.trim() : "";
    try {
      if (normalized) {
        window.localStorage?.setItem?.(AUTH_TOKEN_STORAGE_KEY, normalized);
      } else {
        window.localStorage?.removeItem?.(AUTH_TOKEN_STORAGE_KEY);
      }
    } catch (_) {}
    return normalized;
  };

  const clearStoredAuthToken = () => {
    try {
      window.localStorage?.removeItem?.(AUTH_TOKEN_STORAGE_KEY);
    } catch (_) {}
  };

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

  const ROLE_STORAGE_KEY = "ai-companion-active-role";
  const ROLE_FALLBACK_KEYS = [ROLE_STORAGE_KEY, "ai-companion-register-role"];

  const normalizeRoleValue = (value) => {
    const text = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!text) return "";
    if (["grandpa", "grandma", "senior", "elder"].includes(text)) return "elder";
    if (text === "family") return "family";
    if (text === "social-worker" || text === "caregiver") return "caregiver";
    return text;
  };

  const readRoleFromStorage = (key) => {
    try {
      const sessionValue = window.sessionStorage?.getItem
        ? window.sessionStorage.getItem(key)
        : null;
      if (sessionValue) return sessionValue;
    } catch (_) {}
    try {
      const localValue = window.localStorage?.getItem
        ? window.localStorage.getItem(key)
        : null;
      if (localValue) return localValue;
    } catch (_) {}
    return "";
  };

  const getStoredRole = () => {
    for (const key of ROLE_FALLBACK_KEYS) {
      const candidate = normalizeRoleValue(readRoleFromStorage(key));
      if (candidate) return candidate;
    }
    return "";
  };

  const persistRoleValue = (value) => {
    const normalized = normalizeRoleValue(value);
    try {
      if (normalized) {
        if (window.sessionStorage?.setItem) {
          window.sessionStorage.setItem(ROLE_STORAGE_KEY, normalized);
        }
      } else if (window.sessionStorage?.removeItem) {
        window.sessionStorage.removeItem(ROLE_STORAGE_KEY);
      }
    } catch (_) {}
    try {
      if (normalized) {
        if (window.localStorage?.setItem) {
          window.localStorage.setItem(ROLE_STORAGE_KEY, normalized);
        }
      } else if (window.localStorage?.removeItem) {
        window.localStorage.removeItem(ROLE_STORAGE_KEY);
      }
    } catch (_) {}
    return normalized;
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
    apiBaseUrl: `${resolveApiOrigin()}/api`,
    persona: DEFAULT_PERSONA_KEY,
    // Reminder-related defaults
    reminder: {
      required: {
        title: true,
        date: true,
        time: true,
        category: false,
        description: false,
        location: false
      },
      // Lead time default: 30 minutes before
      lead: { mode: "30m", minutes: 30 },
      // Ask for confirmation in chat before creating
      confirm: true
    },
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

      // Merge reminder settings deeply with sensible defaults
      const persistedReminder = parsed?.reminder ?? {};
      const mergedReminder = {
        ...DEFAULT_SETTINGS.reminder,
        ...persistedReminder,
        required: {
          ...DEFAULT_SETTINGS.reminder.required,
          ...(persistedReminder?.required ?? {})
        },
        lead: {
          ...DEFAULT_SETTINGS.reminder.lead,
          ...(persistedReminder?.lead ?? {})
        },
        confirm:
          typeof persistedReminder?.confirm === "boolean"
            ? persistedReminder.confirm
            : DEFAULT_SETTINGS.reminder.confirm
      };

      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        persona: normalizedPersona,
        speechConfig: mergedSpeech,
        reminder: mergedReminder
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

  const getBaseUrl = () => {
    const origin = resolveApiOrigin();
    if (origin) return `${origin}/api`.replace(/\/$/, "");
    return currentSettings.apiBaseUrl.replace(/\/$/, "");
  };

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

    if (!headers.Authorization && !headers.authorization) {
      const token = readStoredAuthToken();
      if (token) {
        headers.Authorization = `Bearer ${token}`;
      }
    }

    const response = await window.fetch(url, {
      credentials: options.credentials ?? 'include',
      ...options,
      headers
    });

    if (!response.ok) {
      if (response.status === 401) {
        clearStoredAuthToken();
      }
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
    const reminderChanges = changes?.reminder ?? {};
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
      speechConfig: mergedSpeech,
      reminder: {
        ...DEFAULT_SETTINGS.reminder,
        ...(currentSettings.reminder ?? {}),
        ...reminderChanges,
        required: {
          ...DEFAULT_SETTINGS.reminder.required,
          ...(currentSettings.reminder?.required ?? {}),
          ...(reminderChanges.required ?? {})
        },
        lead: {
          ...DEFAULT_SETTINGS.reminder.lead,
          ...(currentSettings.reminder?.lead ?? {}),
          ...(reminderChanges.lead ?? {})
        },
        confirm:
          typeof reminderChanges.confirm === "boolean"
            ? reminderChanges.confirm
            : (currentSettings.reminder?.confirm ?? DEFAULT_SETTINGS.reminder.confirm)
      }
    };

    persist(next);
    return next;
  };

  const subscribe = (callback) => {
    listeners.add(callback);
    return () => listeners.delete(callback);
  };

  currentSettings = loadSettings();

  proxyGetApiBase = () => resolveApiOrigin();

  window.aiCompanion = {
    ...previousApi,
    get settings() {
      return { ...currentSettings };
    },
    setSettings: updateSettings,
    getPersonaDefaultVoice: resolvePersonaDefaultVoice,
    getPersonaForVoice: resolvePersonaByVoice,
    subscribeSettings: subscribe,
    fetchJson: apiFetch,
    formatTimestamp: formatTime,
    getActiveRole: getStoredRole,
    setActiveRole: persistRoleValue,
    normalizeRole: normalizeRoleValue,
    getApiBase: previousApi.getApiBase || proxyGetApiBase,
    getAuthToken: () => readStoredAuthToken(),
    setAuthToken: (token) => persistAuthToken(token),
    clearAuthToken: () => clearStoredAuthToken()
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
