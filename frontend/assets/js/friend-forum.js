"use strict";

(function () {
  const root = document.querySelector("[data-friend-forum]");
  if (!root || !window.aiCompanion) return;

  const bodyEl = root.querySelector("[data-friend-forum-body]");
  const emptyEl = root.querySelector("[data-friend-forum-empty]");
  const userIdEl = root.querySelector("[data-user-id]");
  const userPhoneEl = root.querySelector("[data-user-phone]");
  const requestCountEl = root.querySelector("[data-request-count]");
  const friendCountEl = root.querySelector("[data-friend-count]");
  const incomingList = root.querySelector("[data-friend-incoming]");
  const sentList = root.querySelector("[data-friend-sent]");
  const friendList = root.querySelector("[data-friend-list]");
  const eventList = root.querySelector("[data-friend-events]");
  const requestForm = root.querySelector("[data-friend-request-form]");
  const eventForm = root.querySelector("[data-friend-event-form]");
  const refreshBtn = root.querySelector("[data-friend-refresh]");

  const FRIEND_LIMIT = 10;
  const statusLabel = {
    pending: "等待回覆",
    accepted: "好友",
    declined: "已婉拒",
    cancelled: "已取消",
    invited: "邀請中",
    going: "參加",
    host: "主辦人",
    null: ""
  };

  const state = {
    user: null,
    friends: [],
    incoming: [],
    sent: [],
    events: []
  };

  const toast = (msg, variant = "info") => {
    if (window.showToast) {
      window.showToast(msg, { variant });
    } else {
      console.log("[friend-forum]", msg);
    }
  };

  const ensureUser = async () => {
    if (state.user) return state.user;
    if (window.aiCompanion.currentUser) {
      state.user = window.aiCompanion.currentUser;
      return state.user;
    }
    try {
      const res = await window.aiCompanion.fetchJson("/auth/me");
      state.user = res?.user || null;
      if (state.user) window.aiCompanion.currentUser = state.user;
      return state.user;
    } catch (error) {
      console.warn("[friend-forum] 無法取得使用者資料", error);
      return null;
    }
  };

  const isElder = (user) => {
    const role = window.aiCompanion.normalizeRole?.(user?.charactor) || "";
    return role === "elder";
  };

  const toggleAvailability = (available) => {
    if (!bodyEl || !emptyEl) return;
    bodyEl.hidden = !available;
    emptyEl.hidden = available;
  };

  const formatTime = (ts) => {
    if (!ts) return "";
    if (window.aiCompanion.formatTimestamp) {
      return window.aiCompanion.formatTimestamp(ts);
    }
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString("zh-TW");
  };

  const fetchFriends = async () => {
    try {
      const data = await window.aiCompanion.fetchJson("/friends");
      state.friends = Array.isArray(data?.friends) ? data.friends : [];
    } catch (error) {
      console.warn("[friend-forum] 取得好友失敗", error);
      state.friends = [];
    }
  };

  const fetchRequests = async () => {
    try {
      const data = await window.aiCompanion.fetchJson("/friends/requests");
      state.incoming = Array.isArray(data?.incoming) ? data.incoming : [];
      state.sent = Array.isArray(data?.sent) ? data.sent : [];
    } catch (error) {
      console.warn("[friend-forum] 取得邀請失敗", error);
      state.incoming = [];
      state.sent = [];
    }
  };

  const fetchEvents = async () => {
    try {
      const data = await window.aiCompanion.fetchJson("/friend-events");
      state.events = Array.isArray(data?.events) ? data.events : [];
    } catch (error) {
      console.warn("[friend-forum] 取得活動失敗", error);
      state.events = [];
    }
  };

  const renderFriends = () => {
    if (!friendList || !friendCountEl) return;
    friendList.innerHTML = "";
    if (!state.friends.length) {
      const li = document.createElement("li");
      li.textContent = "尚未加入好友";
      friendList.appendChild(li);
    } else {
      state.friends.forEach((friend) => {
        const li = document.createElement("li");
        const name = friend.full_name || friend.username || `User ${friend.user_id}`;
        li.innerHTML = `<strong>${name}</strong><span>#${friend.user_id}</span>`;
        friendList.appendChild(li);
      });
    }
    friendCountEl.textContent = `${state.friends.length} / ${FRIEND_LIMIT} 位好友`;
  };

  const renderRequests = () => {
    if (!incomingList || !sentList || !requestCountEl) return;
    const buildRequestItem = (item, type) => {
      const li = document.createElement("li");
      li.className = "friend-request";
      const name = item.full_name || item.username || `User ${item.user_id}`;
      const meta = type === "incoming" ? "想加你為好友" : "等待對方回覆";
      li.innerHTML = `
        <div>
          <strong>${name}</strong>
          <p class="helper-text">${meta}</p>
        </div>
      `;
      if (type === "incoming") {
        const actions = document.createElement("div");
        actions.className = "friend-event__actions";
        const acceptBtn = document.createElement("button");
        acceptBtn.type = "button";
        acceptBtn.className = "btn primary";
        acceptBtn.textContent = "接受";
        acceptBtn.dataset.requestAction = "accept";
        acceptBtn.dataset.requestId = item.friendship_id;
        actions.appendChild(acceptBtn);

        const declineBtn = document.createElement("button");
        declineBtn.type = "button";
        declineBtn.className = "btn secondary";
        declineBtn.textContent = "婉拒";
        declineBtn.dataset.requestAction = "decline";
        declineBtn.dataset.requestId = item.friendship_id;
        actions.appendChild(declineBtn);
        li.appendChild(actions);
      } else {
        const pill = document.createElement("span");
        pill.className = "badge";
        pill.textContent = statusLabel.pending;
        li.appendChild(pill);
      }
      return li;
    };

    incomingList.innerHTML = "";
    sentList.innerHTML = "";
    state.incoming.forEach((req) => {
      const li = buildRequestItem(
        {
          friendship_id: req.friendship_id,
          full_name: req.full_name,
          username: req.username,
          user_id: req.user_id
        },
        "incoming"
      );
      incomingList.appendChild(li);
    });

    state.sent.forEach((req) => {
      const li = buildRequestItem(
        {
          friendship_id: req.friendship_id,
          full_name: req.full_name,
          username: req.username,
          user_id: req.user_id
        },
        "sent"
      );
      sentList.appendChild(li);
    });

    if (!state.incoming.length) {
      const li = document.createElement("li");
      li.className = "friend-request";
      li.textContent = "尚未收到邀請";
      incomingList.appendChild(li);
    }
    if (!state.sent.length) {
      const li = document.createElement("li");
      li.className = "friend-request";
      li.textContent = "沒有送出的邀請";
      sentList.appendChild(li);
    }

    requestCountEl.textContent = state.incoming.length;
  };

  const renderEvents = () => {
    if (!eventList) return;
    eventList.innerHTML = "";
    if (!state.events.length) {
      const li = document.createElement("li");
      li.className = "friend-event friend-event--empty";
      li.textContent = "尚未有活動，先發起一個吧！";
      eventList.appendChild(li);
      return;
    }

    state.events.forEach((event) => {
      const li = document.createElement("li");
      li.className = "friend-event";
      li.dataset.eventId = event.event_id;

      const hostName =
        event.host?.full_name || event.host?.username || `User ${event.host_user_id}`;
      const location = event.location ? `・${event.location}` : "";

      const participantChips = (Array.isArray(event.participants) ? event.participants : [])
        .map((participant) => {
          const name = participant.full_name || participant.username || `User ${participant.user_id}`;
          const status = statusLabel[participant.status] || "";
          return `<span>${name}${status ? `（${status}）` : ""}</span>`;
        })
        .join("");

      const viewerStatus =
        event.viewer_status || (event.host_user_id === state.user?.user_id ? "host" : null);

      const actionButtons = (() => {
        if (viewerStatus === "host") {
          return `<p class="helper-text">你是主辦人</p>`;
        }
        if (viewerStatus === "going") {
          return `<p class="helper-text">你已回覆參加</p>
            <div class="friend-event__actions">
              <button class="btn secondary" type="button" data-rsvp="declined">改成不克前往</button>
            </div>`;
        }
        if (viewerStatus === "declined") {
          return `<p class="helper-text">你婉拒了這場活動</p>
            <div class="friend-event__actions">
              <button class="btn primary" type="button" data-rsvp="going">改成要參加</button>
            </div>`;
        }
        return `
          <div class="friend-event__actions">
            <button class="btn primary" type="button" data-rsvp="going">我要參加</button>
            <button class="btn secondary" type="button" data-rsvp="declined">婉拒</button>
          </div>
        `;
      })();

      li.innerHTML = `
        <div class="friend-event__meta">
          <strong>${event.title}</strong>
          <span>主辦：${hostName}</span>
        </div>
        <p>${formatTime(event.start_time)}${location}</p>
        <div class="friend-event__participants">
          ${participantChips || "<span>尚無回覆</span>"}
        </div>
        ${actionButtons}
      `;
      eventList.appendChild(li);
    });
  };

  const loadAll = async () => {
    await Promise.all([fetchFriends(), fetchRequests(), fetchEvents()]);
    renderFriends();
    renderRequests();
    renderEvents();
  };

  incomingList?.addEventListener("click", async (event) => {
    const actionBtn = event.target.closest("[data-request-action]");
    if (!actionBtn) return;
    const action = actionBtn.dataset.requestAction;
    const id = Number(actionBtn.dataset.requestId);
    if (!id || !action) return;
    try {
      await window.aiCompanion.fetchJson(`/friends/requests/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ action })
      });
      toast(action === "accept" ? "已加入好友" : "已回覆邀請", "success");
      await loadAll();
    } catch (error) {
      toast("操作失敗，請稍後再試", "error");
      console.warn("[friend-forum] 回覆邀請失敗", error);
    }
  });

  requestForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(requestForm);
    const phone = (formData.get("phone") || "").toString().trim();
    if (!phone) return;
    try {
      await window.aiCompanion.fetchJson("/friends/requests", {
        method: "POST",
        body: JSON.stringify({ phone })
      });
      toast("已送出好友邀請", "success");
      requestForm.reset();
      await loadAll();
    } catch (error) {
      toast("送出邀請失敗，請確認手機號碼是否正確", "error");
      console.warn("[friend-forum] 送出邀請失敗", error);
    }
  });

  eventList?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-rsvp]");
    if (!target) return;
    const li = target.closest("[data-event-id]");
    const eventId = Number(li?.dataset?.eventId);
    const status = target.dataset.rsvp;
    if (!eventId || !status) return;
    try {
      await window.aiCompanion.fetchJson(`/friend-events/${eventId}/rsvp`, {
        method: "POST",
        body: JSON.stringify({ status })
      });
      toast("已更新活動回覆", "success");
      await loadAll();
    } catch (error) {
      toast("更新回覆失敗，請稍後再試", "error");
      console.warn("[friend-forum] RSVP 失敗", error);
    }
  });

  eventForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(eventForm);
    const payload = {
      title: (formData.get("title") || "").toString().trim(),
      start_time: formData.get("start_time"),
      location: (formData.get("location") || "").toString().trim() || null,
      participant_user_ids: []
    };
    const participantsRaw = (formData.get("participant_user_ids") || "").toString();
    if (participantsRaw) {
      payload.participant_user_ids = participantsRaw
        .split(",")
        .map((id) => Number(id.trim()))
        .filter((id) => Number.isFinite(id));
    }
    if (!payload.title || !payload.start_time) return;
    try {
      await window.aiCompanion.fetchJson("/friend-events", {
        method: "POST",
        body: JSON.stringify(payload)
      });
      toast("活動已發布", "success");
      eventForm.reset();
      await loadAll();
    } catch (error) {
      toast("發布活動失敗，請稍後再試", "error");
      console.warn("[friend-forum] 發布活動失敗", error);
    }
  });

  refreshBtn?.addEventListener("click", () => {
    loadAll();
  });

  (async () => {
    const user = await ensureUser();
    if (!user) {
      toggleAvailability(false);
      return;
    }
    state.user = user;
    if (userIdEl) userIdEl.textContent = user.user_id ?? "未知";
    if (userPhoneEl) userPhoneEl.textContent = user.phone || "尚未設定";
    if (!isElder(user)) {
      toggleAvailability(false);
      return;
    }
    toggleAvailability(true);
    await loadAll();
  })();
})();
