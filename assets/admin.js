(function () {
  const loginCard = document.getElementById("loginCard");
  const adminPanel = document.getElementById("adminPanel");
  const ordersPanel = document.getElementById("ordersPanel");
  const loginForm = document.getElementById("loginForm");
  const loginMessage = document.getElementById("loginMessage");
  const githubLoginBtn = document.getElementById("githubLoginBtn");
  const adminEmail = document.getElementById("adminEmail");
  const adminPassword = document.getElementById("adminPassword");
  const logoutBtn = document.getElementById("logoutBtn");
  const saveScheduleBtn = document.getElementById("saveScheduleBtn");
  const scheduleSaved = document.getElementById("scheduleSaved");
  const ordersContainer = document.getElementById("ordersContainer");
  const refreshBtn = document.getElementById("refreshBtn");
  const lastUpdated = document.getElementById("lastUpdated");
  const alwaysOpen = document.getElementById("alwaysOpen");
  const openDay = document.getElementById("openDay");
  const openHour = document.getElementById("openHour");
  const closeDay = document.getElementById("closeDay");
  const closeHour = document.getElementById("closeHour");
  const statusFilter = document.getElementById("statusFilter");
  const yearFilter = document.getElementById("yearFilter");
  const monthFilter = document.getElementById("monthFilter");
  const selectAllOrders = document.getElementById("selectAllOrders");
  const selectedCount = document.getElementById("selectedCount");
  const bulkStatus = document.getElementById("bulkStatus");
  const bulkApplyBtn = document.getElementById("bulkApplyBtn");
  const bulkMessage = document.getElementById("bulkMessage");
  const prevPageBtn = document.getElementById("prevPageBtn");
  const nextPageBtn = document.getElementById("nextPageBtn");
  const pageInfo = document.getElementById("pageInfo");

  const supabase = window.App.getSupabaseClient();
  let refreshTimer = null;
  let ordersEditing = false;
  let lastRenderedOrderIds = [];
  const pageSize = 6;
  let currentPage = 1;
  let totalOrders = 0;
  let totalPages = 1;
  const selectedOrders = new Set();

  function setLoginMessage(text, type) {
    loginMessage.textContent = text;
    loginMessage.className = `form-message ${type || ""}`.trim();
  }

  function fillSelect(select, items, formatter) {
    select.innerHTML = "";
    items.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = formatter ? formatter(value) : value;
      select.appendChild(option);
    });
  }

  const statusLabels = {
    open: "未完成",
    fulfilled: "已完成",
    archived: "歷史紀錄",
  };

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function getDatePartsInTimeZoneForDate(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(date);
    const lookup = {};
    for (const part of parts) {
      lookup[part.type] = part.value;
    }
    return {
      year: Number(lookup.year),
      month: Number(lookup.month),
      day: Number(lookup.day),
    };
  }

  function getDatePartsInTimeZone(timeZone) {
    return getDatePartsInTimeZoneForDate(new Date(), timeZone);
  }

  function getTimeZoneOffsetMinutes(date, timeZone) {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = formatter.formatToParts(date);
    const lookup = {};
    for (const part of parts) {
      lookup[part.type] = part.value;
    }
    const asUtc = Date.UTC(
      Number(lookup.year),
      Number(lookup.month) - 1,
      Number(lookup.day),
      Number(lookup.hour),
      Number(lookup.minute),
      Number(lookup.second)
    );
    return (asUtc - date.getTime()) / 60000;
  }

  function getUtcDateForTimeZoneLocal(year, month, day, timeZone) {
    const utcGuess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
    const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);
    return new Date(utcGuess.getTime() - offsetMinutes * 60000);
  }

  function initTimeFilters() {
    const parts = getDatePartsInTimeZone("Asia/Taipei");
    if (yearFilter && Number.isFinite(parts.year)) {
      yearFilter.value = String(parts.year);
    }
    if (monthFilter && Number.isFinite(parts.month)) {
      monthFilter.value = String(parts.month);
    }
  }

  function buildStatusOptions(current) {
    return Object.entries(statusLabels)
      .map(([value, label]) => {
        const selected = value === current ? "selected" : "";
        return `<option value="${value}" ${selected}>${label}</option>`;
      })
      .join("");
  }

  function updateSelectionCount() {
    if (selectedCount) {
      selectedCount.textContent = `已選 ${selectedOrders.size} 筆`;
    }
    if (selectAllOrders) {
      if (lastRenderedOrderIds.length === 0) {
        selectAllOrders.checked = false;
        selectAllOrders.indeterminate = false;
        return;
      }
      const selectedVisible = lastRenderedOrderIds.filter((id) => selectedOrders.has(id));
      selectAllOrders.checked = selectedVisible.length === lastRenderedOrderIds.length;
      selectAllOrders.indeterminate =
        selectedVisible.length > 0 && selectedVisible.length < lastRenderedOrderIds.length;
    }
  }

  function updatePaginationUI() {
    totalPages = Math.max(1, Math.ceil((Number(totalOrders) || 0) / pageSize));
    if (currentPage > totalPages) {
      currentPage = totalPages;
    }
    if (pageInfo) {
      pageInfo.textContent = `第 ${currentPage} / ${totalPages} 頁（共 ${totalOrders} 筆）`;
    }
    if (prevPageBtn) {
      prevPageBtn.disabled = currentPage <= 1;
    }
    if (nextPageBtn) {
      nextPageBtn.disabled = currentPage >= totalPages;
    }
  }

  function resetToFirstPage() {
    currentPage = 1;
  }

  function initScheduleOptions() {
    const days = [0, 1, 2, 3, 4, 5, 6];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    fillSelect(openDay, days, (d) => `週${window.App.weekdayLabels[d]}`);
    fillSelect(closeDay, days, (d) => `週${window.App.weekdayLabels[d]}`);
    fillSelect(openHour, hours, (h) => `${String(h).padStart(2, "0")}:00`);
    fillSelect(closeHour, hours, (h) => `${String(h).padStart(2, "0")}:00`);
  }

  function initFilterDefaults() {
    initTimeFilters();
  }

  function toggleAdminUI(isLoggedIn) {
    loginCard.classList.toggle("hidden", isLoggedIn);
    adminPanel.classList.toggle("hidden", !isLoggedIn);
    ordersPanel.classList.toggle("hidden", !isLoggedIn);

    if (isLoggedIn) {
      resetToFirstPage();
      loadSchedule();
      initFilterDefaults();
      loadOrders(true);
      startAutoRefresh();
    } else {
      totalOrders = 0;
      totalPages = 1;
      resetToFirstPage();
      updatePaginationUI();
      stopAutoRefresh();
    }
  }

  function applyScheduleDisabled() {
    const disabled = Boolean(alwaysOpen.checked);
    openDay.disabled = disabled;
    openHour.disabled = disabled;
    closeDay.disabled = disabled;
    closeHour.disabled = disabled;
  }

  async function loadSchedule() {
    scheduleSaved.textContent = "";
    const { data, error } = await supabase
      .from("ordering_schedule")
      .select("open_day, open_hour, close_day, close_hour, is_always_open")
      .eq("id", 1)
      .single();

    if (error) {
      scheduleSaved.textContent = "讀取失敗";
      return;
    }
    alwaysOpen.checked = Boolean(data.is_always_open);
    openDay.value = data.open_day;
    openHour.value = data.open_hour;
    closeDay.value = data.close_day;
    closeHour.value = data.close_hour;
    applyScheduleDisabled();
  }

  async function saveSchedule() {
    scheduleSaved.textContent = "儲存中...";
    const payload = {
      is_always_open: Boolean(alwaysOpen.checked),
      open_day: Number(openDay.value),
      open_hour: Number(openHour.value),
      close_day: Number(closeDay.value),
      close_hour: Number(closeHour.value),
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("ordering_schedule").update(payload).eq("id", 1);

    if (error) {
      scheduleSaved.textContent = "儲存失敗";
      return;
    }
    scheduleSaved.textContent = "已更新";
  }

  function renderOrders(orders) {
    if (!orders || orders.length === 0) {
      ordersContainer.innerHTML = "<p class=\"muted\">目前沒有訂單。</p>";
      lastRenderedOrderIds = [];
      selectedOrders.clear();
      updateSelectionCount();
      return;
    }

    const grouped = {};
    const visibleIds = [];
    orders.forEach((order) => {
      const key = order.delivery_location || "未分類";
      if (!grouped[key]) {
        grouped[key] = [];
      }
      grouped[key].push(order);
      visibleIds.push(order.id);
    });

    const visibleIdSet = new Set(visibleIds);
    Array.from(selectedOrders).forEach((id) => {
      if (!visibleIdSet.has(id)) {
        selectedOrders.delete(id);
      }
    });
    lastRenderedOrderIds = visibleIds;

    const sections = Object.entries(grouped).map(([location, list]) => {
      const totalAmount = list.reduce((sum, order) => sum + (order.total_amount || 0), 0);
      const cards = list
        .map((order) => {
          const itemsHtml = (order.order_items || [])
            .map((item) => {
              const name = escapeHtml(item.product_name);
              const quantity = Number(item.quantity || 0);
              const price = window.App.formatCurrency(item.unit_price);
              return `<div>${name} × ${quantity}（${price}）</div>`;
            })
            .join("");

          const safeName = escapeHtml(order.customer_name);
          const safePhone = escapeHtml(order.phone);
          const customerNote = order.note ? escapeHtml(order.note) : "";
          const adminNote = order.admin_note ? escapeHtml(order.admin_note) : "";
          const statusValue = order.status || "open";
          const statusLabel = statusLabels[statusValue] || statusLabels.open;
          const isChecked = selectedOrders.has(order.id) ? "checked" : "";

          return `
            <div class="order-card">
              <label class="order-check">
                <input type="checkbox" class="order-select" data-id="${order.id}" ${isChecked} />
              </label>
              <div>
                <div class="order-meta">
                  <span>姓名：${safeName}</span>
                  <span>電話：${safePhone}</span>
                  <span>時間：${new Date(order.created_at).toLocaleString("zh-TW", {
                    timeZone: "Asia/Taipei",
                  })}</span>
                  <span>狀態：${statusLabel}</span>
                  <span>總額：${window.App.formatCurrency(order.total_amount)}</span>
                </div>
                <div class="order-items">${itemsHtml}</div>
                ${customerNote ? `<div class=\"order-items\">備註：${customerNote}</div>` : ""}
              </div>
              <div class="order-admin" data-order-id="${order.id}">
                <label class="field">
                  <span>狀態</span>
                  <select data-role="status">
                    ${buildStatusOptions(statusValue)}
                  </select>
                </label>
                <label class="field">
                  <span>後台備註</span>
                  <textarea rows="2" data-role="admin-note" placeholder="可填內部備註">${adminNote}</textarea>
                </label>
                <div class="order-admin-actions">
                  <button type="button" class="ghost" data-action="save-order" data-id="${order.id}">
                    儲存
                  </button>
                  <span class="muted" data-role="save-message"></span>
                </div>
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <div class="order-group">
          <h3>${escapeHtml(location)}</h3>
          <p class="muted">${list.length} 筆訂單・合計 ${window.App.formatCurrency(
        totalAmount
      )}</p>
          ${cards}
        </div>
      `;
    });

    ordersContainer.innerHTML = sections.join("");
    updateSelectionCount();
  }

  async function loadOrders(force = false, skipPageAdjust = false) {
    if (ordersEditing && !force) {
      return;
    }
    if (bulkMessage) {
      bulkMessage.textContent = "";
    }

    let query = supabase
      .from("orders")
      .select("id, created_at, customer_name, phone, delivery_location, note, total_amount, status, admin_note, order_items(*)", {
        count: "exact",
      })
      .order("created_at", { ascending: false });

    const status = statusFilter?.value;
    if (status && status !== "all") {
      query = query.eq("status", status);
    }

    const year = Number(yearFilter?.value);
    const month = Number(monthFilter?.value);
    if (Number.isFinite(year) && Number.isFinite(month)) {
      const start = getUtcDateForTimeZoneLocal(year, month, 1, "Asia/Taipei");
      const nextYear = month === 12 ? year + 1 : year;
      const nextMonth = month === 12 ? 1 : month + 1;
      const end = getUtcDateForTimeZoneLocal(nextYear, nextMonth, 1, "Asia/Taipei");
      query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
    }

    const rangeFrom = (currentPage - 1) * pageSize;
    const rangeTo = rangeFrom + pageSize - 1;
    const { data, error, count } = await query.range(rangeFrom, rangeTo);

    if (error) {
      ordersContainer.innerHTML = "<p class=\"muted\">讀取失敗。</p>";
      totalOrders = 0;
      totalPages = 1;
      updatePaginationUI();
      return;
    }

    totalOrders = Number.isFinite(count) ? count : (data || []).length;
    totalPages = Math.max(1, Math.ceil((totalOrders || 0) / pageSize));

    if (!skipPageAdjust && currentPage > totalPages) {
      currentPage = totalPages;
      return loadOrders(true, true);
    }

    renderOrders(data || []);
    updatePaginationUI();
    lastUpdated.textContent = `最後更新：${new Date().toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
    })}`;
  }

  function startAutoRefresh() {
    stopAutoRefresh();
    refreshTimer = setInterval(loadOrders, 30000);
  }

  function stopAutoRefresh() {
    if (refreshTimer) {
      clearInterval(refreshTimer);
    }
    refreshTimer = null;
  }

  if (!window.App.configOk) {
    setLoginMessage("請先設定 assets/config.js", "error");
  }

  if (window.App.config?.ADMIN_DEFAULT_EMAIL) {
    adminEmail.value = window.App.config.ADMIN_DEFAULT_EMAIL;
  }

  initScheduleOptions();
  applyScheduleDisabled();

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!supabase) {
      setLoginMessage("請先設定 assets/config.js", "error");
      return;
    }
    setLoginMessage("登入中...", "");

    const { error } = await supabase.auth.signInWithPassword({
      email: adminEmail.value.trim(),
      password: adminPassword.value,
    });

    if (error) {
      setLoginMessage("登入失敗，請確認帳號密碼。", "error");
      return;
    }
    setLoginMessage("");
  });

  githubLoginBtn.addEventListener("click", async () => {
    if (!supabase) {
      setLoginMessage("請先設定 assets/config.js", "error");
      return;
    }
    setLoginMessage("導向 GitHub 登入中...", "");
    const redirectTo = `${window.location.origin}${window.location.pathname}`;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: { redirectTo },
    });

    if (error) {
      setLoginMessage("GitHub 登入失敗，請稍後再試。", "error");
    }
  });

  logoutBtn.addEventListener("click", async () => {
    await supabase.auth.signOut();
  });

  alwaysOpen.addEventListener("change", applyScheduleDisabled);
  saveScheduleBtn.addEventListener("click", saveSchedule);
  refreshBtn.addEventListener("click", () => loadOrders(true));
  if (prevPageBtn) {
    prevPageBtn.addEventListener("click", () => {
      if (currentPage <= 1) {
        return;
      }
      currentPage -= 1;
      selectedOrders.clear();
      updateSelectionCount();
      loadOrders(true);
    });
  }
  if (nextPageBtn) {
    nextPageBtn.addEventListener("click", () => {
      if (currentPage >= totalPages) {
        return;
      }
      currentPage += 1;
      selectedOrders.clear();
      updateSelectionCount();
      loadOrders(true);
    });
  }

  if (statusFilter) {
    statusFilter.addEventListener("change", () => {
      resetToFirstPage();
      selectedOrders.clear();
      updateSelectionCount();
      loadOrders(true);
    });
  }
  if (yearFilter) {
    yearFilter.addEventListener("change", () => {
      resetToFirstPage();
      selectedOrders.clear();
      updateSelectionCount();
      loadOrders(true);
    });
  }
  if (monthFilter) {
    monthFilter.addEventListener("change", () => {
      resetToFirstPage();
      selectedOrders.clear();
      updateSelectionCount();
      loadOrders(true);
    });
  }

  if (selectAllOrders) {
    selectAllOrders.addEventListener("change", () => {
      const shouldSelect = selectAllOrders.checked;
      lastRenderedOrderIds.forEach((id) => {
        if (shouldSelect) {
          selectedOrders.add(id);
        } else {
          selectedOrders.delete(id);
        }
      });
      ordersContainer.querySelectorAll(".order-select").forEach((checkbox) => {
        checkbox.checked = shouldSelect;
      });
      updateSelectionCount();
    });
  }

  if (bulkApplyBtn) {
    bulkApplyBtn.addEventListener("click", async () => {
      if (!bulkStatus || !bulkMessage) {
        return;
      }
      const status = bulkStatus.value;
      if (!status) {
        bulkMessage.textContent = "請先選擇狀態";
        return;
      }
      const ids = Array.from(selectedOrders);
      if (ids.length === 0) {
        bulkMessage.textContent = "請先勾選訂單";
        return;
      }
      bulkApplyBtn.disabled = true;
      bulkMessage.textContent = "更新中...";
      const { error } = await supabase.from("orders").update({ status }).in("id", ids);
      if (error) {
        bulkMessage.textContent = "更新失敗";
        bulkApplyBtn.disabled = false;
        return;
      }
      bulkMessage.textContent = "已更新";
      bulkApplyBtn.disabled = false;
      selectedOrders.clear();
      updateSelectionCount();
      loadOrders(true);
    });
  }

  ordersContainer.addEventListener("focusin", () => {
    ordersEditing = true;
  });

  ordersContainer.addEventListener("focusout", () => {
    setTimeout(() => {
      ordersEditing = ordersContainer.contains(document.activeElement);
    }, 0);
  });

  ordersContainer.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
      return;
    }
    if (!target.classList.contains("order-select")) {
      return;
    }
    const orderId = target.dataset.id;
    if (!orderId) {
      return;
    }
    if (target.checked) {
      selectedOrders.add(orderId);
    } else {
      selectedOrders.delete(orderId);
    }
    updateSelectionCount();
  });

  ordersContainer.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }
    if (target.dataset.action !== "save-order") {
      return;
    }
    const orderId = target.dataset.id;
    if (!orderId) {
      return;
    }
    const card = target.closest(".order-card");
    if (!card) {
      return;
    }
    const statusSelect = card.querySelector("[data-role=\"status\"]");
    const noteInput = card.querySelector("[data-role=\"admin-note\"]");
    const messageEl = card.querySelector("[data-role=\"save-message\"]");
    if (!statusSelect || !noteInput || !messageEl) {
      return;
    }

    target.disabled = true;
    messageEl.textContent = "儲存中...";
    const payload = {
      status: statusSelect.value,
      admin_note: noteInput.value.trim(),
    };
    const { error } = await supabase.from("orders").update(payload).eq("id", orderId);
    if (error) {
      messageEl.textContent = "儲存失敗";
      target.disabled = false;
      return;
    }
    messageEl.textContent = "已更新";
    target.disabled = false;
    loadOrders(true);
  });

  supabase.auth.onAuthStateChange((_event, session) => {
    toggleAdminUI(Boolean(session));
  });

  supabase.auth.getSession().then(({ data }) => {
    toggleAdminUI(Boolean(data.session));
  });
})();
