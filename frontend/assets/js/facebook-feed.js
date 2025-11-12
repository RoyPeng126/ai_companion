"use strict";

(function () {
  const root = document.querySelector("[data-facebook-feed]");
  if (!root || !window.aiCompanion) return;

  const listEl = root.querySelector("#facebook-feed-list");
  const statusEl = root.querySelector("#facebook-feed-status");
  const refreshBtn = root.querySelector("[data-facebook-refresh]");

  let posts = [];
  let contextPosts = [];
  let meta = {};
  let disabled = false;
  let loading = false;
  let cachedUser = window.aiCompanion.currentUser || null;
  let userPromise = null;
  const subscribers = new Set();

  const notifySubscribers = () => {
    const snapshot = posts.slice();
    subscribers.forEach((callback) => {
      try {
        callback(snapshot);
      } catch (_) {}
    });
  };

  const formatDate = (timestamp) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "";
    const diffMs = date.getTime() - Date.now();
    const diffMinutes = Math.round(diffMs / (60 * 1000));
    if (window.Intl?.RelativeTimeFormat) {
      const rtf = new Intl.RelativeTimeFormat("zh-TW", { numeric: "auto" });
      if (Math.abs(diffMinutes) < 60) {
        return rtf.format(diffMinutes, "minute");
      }
      const diffHours = Math.round(diffMinutes / 60);
      if (Math.abs(diffHours) < 24) {
        return rtf.format(diffHours, "hour");
      }
      const diffDays = Math.round(diffHours / 24);
      return rtf.format(diffDays, "day");
    }
    return window.aiCompanion.formatTimestamp(timestamp);
  };

  const resolveElderId = (user) => {
    if (!user) return null;
    if (Array.isArray(user.owner_user_ids) && user.owner_user_ids.length) {
      return user.owner_user_ids[0];
    }
    if (Number.isFinite(user.owner_user_id)) {
      return user.owner_user_id;
    }
    return user.user_id || null;
  };

  const ensureCurrentUser = async () => {
    if (cachedUser) return cachedUser;
    if (!userPromise) {
      userPromise = window.aiCompanion
        .fetchJson("/auth/me")
        .then((res) => res?.user || null)
        .catch(() => null)
        .finally(() => {
          userPromise = null;
        });
    }
    cachedUser = await userPromise;
    if (cachedUser && window.aiCompanion) {
      window.aiCompanion.currentUser = cachedUser;
    }
    return cachedUser;
  };

  const formatExcerpt = (text) => {
    const normalized = (text || "").toString().trim();
    if (!normalized) return "（此貼文無文字內容）";
    return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
  };

  const sourceLabel = (source) => {
    if (source === "manual_share") return "手動分享";
    if (source === "facebook_page") return "Facebook 專頁";
    if (source === "facebook_member") return "Facebook 親友";
    if (source === "facebook_legacy") return "Facebook";
    return "家族分享";
  };

  const normalizeLegacyPosts = (legacyPosts = []) =>
    legacyPosts.map((post) => ({
      id: post.id,
      speakerName: post.author || "親友",
      ttsText: post.text || "",
      link: post.permalink || "",
      createdTimeISO: post.createdTime || null,
      source: "facebook_legacy"
    }));

  const renderPosts = () => {
    if (!listEl) return;
    listEl.innerHTML = "";

    if (disabled) {
      const li = document.createElement("li");
      li.className = "facebook-feed__empty";
      li.innerHTML = "<span>尚未邀請家人授權 Facebook，請至「家庭」頁啟用分享。</span>";
      listEl.appendChild(li);
      return;
    }

    if (!posts.length) {
      const li = document.createElement("li");
      li.className = "facebook-feed__empty";
      li.innerHTML = "<span>暫無可分享的貼文，稍後再試。</span>";
      listEl.appendChild(li);
      return;
    }

    posts.forEach((post) => {
      const li = document.createElement("li");
      li.className = "facebook-feed__item";
      const excerpt = formatExcerpt(post.ttsText || post.text);
      const source = sourceLabel(post.source);
      const link = post.link || post.permalink || "";
      const createdAt = post.createdTimeISO || post.createdTime;
      li.innerHTML = `
        <div class="facebook-feed__meta">
          <div class="facebook-feed__meta-author">
            <strong>${post.speakerName || post.author || "家人"}</strong>
            <span class="facebook-feed__source" data-source="${post.source || "manual_share"}">${source}</span>
          </div>
          <span>${formatDate(createdAt)}</span>
        </div>
        <p class="facebook-feed__text">${excerpt}</p>
        ${link ? `<a class="facebook-feed__link" href="${link}" target="_blank" rel="noopener">查看貼文</a>` : ""}
      `;
      listEl.appendChild(li);
    });
  };

  const setStatus = (message, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = message || "";
    statusEl.dataset.state = isError ? "error" : "default";
  };

  const mapToContextPosts = (items = []) =>
    items.map((item) => ({
      id: item.id,
      author: item.speakerName || item.author || "親友",
      text: item.ttsText || item.text || "",
      permalink: item.link || item.permalink || "",
      createdTime: item.createdTimeISO || item.createdTime || null
    }));

  const fetchPosts = async ({ force = false } = {}) => {
    if (loading && !force) return;
    loading = true;
    setStatus("同步家族分享中...");
    try {
      const user = await ensureCurrentUser();
      const elderId = resolveElderId(user);
      const params = new URLSearchParams({ limit: 5 });
      if (force) params.set("refresh", "true");

      if (elderId) {
        const data = await window.aiCompanion.fetchJson(
          `/family-feed/for-elder/${elderId}?${params.toString()}`
        );
        posts = Array.isArray(data?.items) ? data.items : [];
        meta = data?.meta || {};
        disabled = (meta?.facebook?.totalConfigured ?? 0) === 0;
      } else {
        const data = await window.aiCompanion.fetchJson(`/facebook/posts?${params.toString()}`);
        posts = normalizeLegacyPosts(Array.isArray(data?.posts) ? data.posts : []);
        meta = data?.meta || {};
        disabled = Boolean(data?.disabled);
      }
      contextPosts = mapToContextPosts(posts);

      renderPosts();
      notifySubscribers();
      if (disabled) {
        setStatus("尚未邀請家人授權 Facebook，請前往家庭頁設定。", true);
      } else if (!posts.length) {
        setStatus("目前沒有偵測到新的分享。");
      } else {
        setStatus(`已載入 ${posts.length} 則授權貼文。`);
      }
    } catch (error) {
      console.warn("[AI Companion] 無法載入 Facebook 貼文", error);
      setStatus("貼文載入失敗，請稍後再試。", true);
    } finally {
      loading = false;
    }
  };

  refreshBtn?.addEventListener("click", () => fetchPosts({ force: true }));
  fetchPosts();
  window.setInterval(() => fetchPosts(), 5 * 60 * 1000);

  const feedApi = {
    refresh: fetchPosts,
    subscribe: (callback) => {
      if (typeof callback !== "function") return () => {};
      subscribers.add(callback);
      callback(posts.slice());
      return () => subscribers.delete(callback);
    },
    getPosts: () => contextPosts.slice()
  };

  window.aiCompanion.facebookFeed = feedApi;
})();
