"use strict";

(function () {
  const STORAGE_KEY = "ai-companion.settings";
  const DEFAULT_SETTINGS = {
    apiBaseUrl: "http://localhost:3001/api",
    persona: "senior",
    speechConfig: {
      languageCode: "zh-TW",
      voiceName: "",
      speakingRate: 0.9
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
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        speechConfig: {
          ...DEFAULT_SETTINGS.speechConfig,
          ...(parsed?.speechConfig ?? {})
        }
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

  const updateSettings = (changes) => {
    const next = {
      ...currentSettings,
      ...changes,
      speechConfig: {
        ...currentSettings.speechConfig,
        ...(changes?.speechConfig ?? {})
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

  window.aiCompanion = {
    get settings() {
      return { ...currentSettings };
    },
    setSettings: updateSettings,
    subscribeSettings: subscribe,
    fetchJson: apiFetch,
    formatTimestamp: formatTime
  };
})();
