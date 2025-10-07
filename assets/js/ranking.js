"use strict";

(function () {
  if (!window.aiCompanion) return;

  const metricSelect = document.querySelector("#metric-select");
  const refreshButton = document.querySelector("#refresh-ranking");
  const statusElement = document.querySelector("#ranking-status");
  const tableBody = document.querySelector("#ranking-table");
  const metricHeader = document.querySelector("#metric-header");
  const chartElement = document.querySelector("#ranking-chart");
  const insightList = document.querySelector("#insight-list");
  const syncList = document.querySelector("#sync-list");

  if (!metricSelect || !statusElement || !tableBody || !chartElement || !insightList || !syncList || !metricHeader) {
    console.warn("[AI Companion] 健康排行榜頁面元素缺失，無法載入資料。");
    return;
  }

  const metrics = {
    steps: {
      label: "今日步數",
      chartUnit: "步",
      format(value) {
        const safeValue = Number(value ?? 0);
        return `${Math.round(safeValue).toLocaleString("zh-TW")} 步`;
      },
      chartValue(value) {
        return Math.max(0, Number(value ?? 0));
      },
      delta(value) {
        return `${Math.round(Number(value ?? 0)).toLocaleString("zh-TW")} 步`;
      }
    },
    medicationAdherence: {
      label: "服藥準時度",
      chartUnit: "%",
      format(value) {
        const safeValue = Number(value ?? 0) * 100;
        return `${Math.round(safeValue)}%`;
      },
      chartValue(value) {
        return Math.max(0, Number(value ?? 0) * 100);
      },
      delta(value) {
        return `${Math.round(Number(value ?? 0) * 100)} 個百分點`;
      }
    },
    sleepHours: {
      label: "睡眠時數",
      chartUnit: "小時",
      format(value) {
        const safeValue = Number(value ?? 0);
        return `${safeValue.toFixed(1)} 小時`;
      },
      chartValue(value) {
        return Math.max(0, Number(value ?? 0));
      },
      delta(value) {
        return `${Number(value ?? 0).toFixed(1)} 小時`;
      }
    }
  };

  let currentMetric = metricSelect.value in metrics ? metricSelect.value : "steps";

  const medals = ["🥇", "🥈", "🥉"];
  const getRankLabel = (rank) => {
    const medal = medals[rank - 1];
    return medal ? `${medal} ${rank}` : `${rank}`;
  };

  const setStatus = (text, isError = false) => {
    statusElement.textContent = text;
    statusElement.classList.toggle("ranking-status-error", isError);
  };

  const updateMetricHeader = () => {
    const meta = metrics[currentMetric];
    metricHeader.textContent = meta.label;
  };

  const formatTimestamp = (value) => {
    if (!value) return "—";
    return window.aiCompanion.formatTimestamp(value);
  };

  const renderTable = (items, meta) => {
    tableBody.innerHTML = "";

    if (!items.length) {
      const emptyRow = document.createElement("tr");
      const cell = document.createElement("td");
      cell.colSpan = 4;
      cell.textContent = "尚無統計資料，請稍後再試。";
      emptyRow.appendChild(cell);
      tableBody.appendChild(emptyRow);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("tr");

      const rankCell = document.createElement("td");
      rankCell.textContent = getRankLabel(item.rank);

      const nameCell = document.createElement("td");
      nameCell.textContent = item.displayName ?? item.userId ?? "匿名成員";

      const metricCell = document.createElement("td");
      metricCell.textContent = meta.format(item[currentMetric]);

      const syncCell = document.createElement("td");
      syncCell.textContent = formatTimestamp(item.lastSync);

      row.append(rankCell, nameCell, metricCell, syncCell);
      tableBody.appendChild(row);
    });
  };

  const renderChart = (items, meta) => {
    chartElement.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "helper-text";
      empty.textContent = "還沒有資料可以顯示圖表。";
      chartElement.appendChild(empty);
      return;
    }

    const values = items.map((item) => meta.chartValue(item[currentMetric]));
    const maxValue = Math.max(...values, 0.0001);

    items.forEach((item, index) => {
      const value = meta.chartValue(item[currentMetric]);
      const ratio = Math.max(0.05, Math.min(1, value / maxValue));

      const row = document.createElement("div");
      row.className = "chart-row";

      const name = document.createElement("span");
      name.className = "chart-name";
      name.textContent = `${index + 1}. ${item.displayName ?? item.userId ?? "匿名成員"}`;

      const bar = document.createElement("div");
      bar.className = "chart-bar";
      const fill = document.createElement("span");
      fill.style.transform = `scaleX(${ratio})`;
      bar.appendChild(fill);

      const valueText = document.createElement("span");
      valueText.className = "chart-value";
      valueText.textContent = meta.format(item[currentMetric]);

      row.append(name, bar, valueText);
      chartElement.appendChild(row);
    });
  };

  const renderInsights = (items, meta) => {
    insightList.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("li");
      empty.textContent = "暫時沒有可顯示的洞察。";
      insightList.appendChild(empty);
      return;
    }

    const top = items[0];
    const bottom = items[items.length - 1];
    const rawValues = items.map((item) => Number(item[currentMetric] ?? 0));
    const average = rawValues.reduce((sum, value) => sum + value, 0) / rawValues.length;

    const insights = [];

    insights.push(`目前由 ${top.displayName ?? top.userId ?? "匿名成員"} 暫居第一，${meta.format(top[currentMetric])}。`);
    insights.push(`全家平均為 ${meta.format(average)}。`);

    const gap = average - Number(bottom[currentMetric] ?? 0);
    if (gap > 0.01) {
      insights.push(`${bottom.displayName ?? bottom.userId ?? "匿名成員"} 若再努力 ${meta.delta(gap)} 就能追上平均！`);
    } else {
      insights.push("大家表現旗鼓相當，持續保持！");
    }

    insights.forEach((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      insightList.appendChild(item);
    });
  };

  const renderSyncStatus = (items) => {
    syncList.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("li");
      empty.textContent = "尚無同步紀錄。";
      syncList.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const entry = document.createElement("li");
      const name = item.displayName ?? item.userId ?? "匿名成員";
      const time = formatTimestamp(item.lastSync);
      entry.innerHTML = `<strong>${name}</strong><span>${time || "尚未同步"}</span>`;
      syncList.appendChild(entry);
    });
  };

  const fetchRanking = async () => {
    const meta = metrics[currentMetric];
    setStatus("資料讀取中，請稍候...");

    try {
      const response = await window.aiCompanion.fetchJson(`/ranking?metric=${encodeURIComponent(currentMetric)}`);
      const items = Array.isArray(response?.items) ? response.items : [];

      renderTable(items, meta);
      renderChart(items, meta);
      renderInsights(items, meta);
      renderSyncStatus(items);

      if (items.length) {
        const updatedAt = items[0]?.lastSync ? window.aiCompanion.formatTimestamp(items[0].lastSync) : "剛剛";
        setStatus(`資料已更新（${meta.label}），最後同步：${updatedAt}`);
      } else {
        setStatus(`目前沒有 ${meta.label} 的資料，請稍後再試。`);
      }
    } catch (error) {
      console.error("[AI Companion] 無法載入排行榜資料。", error);
      setStatus("排行榜資料讀取失敗，請稍後再試。", true);
      tableBody.innerHTML = `
        <tr>
          <td colspan="4">無法讀取資料。</td>
        </tr>
      `;
      chartElement.innerHTML = `<p class="helper-text">因資料讀取失敗，無法顯示圖表。</p>`;
      insightList.innerHTML = `<li>暫時無法取得洞察資料。</li>`;
      syncList.innerHTML = `<li>同步狀態暫時無法取得。</li>`;
    }
  };

  metricSelect.addEventListener("change", () => {
    currentMetric = metricSelect.value in metrics ? metricSelect.value : "steps";
    updateMetricHeader();
    fetchRanking();
  });

  refreshButton?.addEventListener("click", () => {
    fetchRanking();
  });

  updateMetricHeader();
  fetchRanking();
})();
