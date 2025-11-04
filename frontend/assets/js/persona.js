// assets/js/persona.js

document.addEventListener("DOMContentLoaded", () => {
  const personaButtons = document.querySelectorAll(".persona-pick");
  const status = document.getElementById("personaStatus");
  let selectedPersona = localStorage.getItem("persona") || null;

  // 初始化狀態
  if (selectedPersona) updateButtons(selectedPersona);

  personaButtons.forEach(btn => {
    btn.addEventListener("click", () => {
      personaButtons.forEach(b => { b.classList.remove("btn-selected"); b.textContent = "選擇"; });
      btn.classList.add("btn-selected");
      btn.textContent = "已選擇";
      selectedPersona = btn.closest(".companion-card").dataset.persona;
      localStorage.setItem("persona", selectedPersona);
      const name = btn.closest(".companion-card").querySelector("h3").textContent;
      status.textContent = `目前已設定的陪聊夥伴：${name}`;
    });
  });

  function updateButtons(key) {
    personaButtons.forEach(btn => {
      const card = btn.closest(".companion-card");
      const persona = card.dataset.persona;
      if (persona === key) {
        btn.classList.add("btn-selected");
        btn.textContent = "已選擇";
      } else {
        btn.classList.remove("btn-selected");
        btn.textContent = "選擇";
      }
    });
    const activeCard = document.querySelector(`[data-persona="${key}"] h3`);
    status.textContent = activeCard ? `目前已設定的陪聊夥伴：${activeCard.textContent}` : "目前尚未選擇陪聊夥伴";
  }

  // 表單送出
  const form = document.getElementById("prefForm");
  form.addEventListener("submit", e => {
    e.preventDefault();
    if (!selectedPersona) return alert("請先選擇一個陪聊夥伴");

    const tone = document.getElementById("tone").value;
    const topics = document.getElementById("topics").value.trim();
    const data = { persona: selectedPersona, tone, topics };

    localStorage.setItem("preferences", JSON.stringify(data));
    console.log("已儲存偏好設定：", data);
    alert("已儲存偏好設定");
  });
});
