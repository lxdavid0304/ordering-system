(function () {
  const form = document.getElementById("orderForm");
  const orderLockMessage = document.getElementById("orderLockMessage");
  const itemList = document.getElementById("itemList");
  const addItemBtn = document.getElementById("addItemBtn");
  const totalEl = document.getElementById("grandTotal");
  const formMessage = document.getElementById("formMessage");
  const scheduleInfo = document.getElementById("scheduleInfo");
  const openBadge = document.getElementById("openBadge");
  const submitBtn = document.getElementById("submitBtn");
  const template = document.getElementById("itemRowTemplate");
  const orderFormCard = document.getElementById("orderFormCard");
  const globalLogoutBtn = document.getElementById("globalLogoutBtn");

  const locationInput = document.getElementById("deliveryLocation");
  const noteInput = document.getElementById("note");

  if (!form || !itemList || !addItemBtn || !template) {
    return;
  }

  const supabase = window.App.getSupabaseClient();
  const loginPagePath = "index.html";
  const reorderStorageKey = "member_reorder_payload";
  const draftStorageKeyPrefix = "member_order_form_draft_v1";

  let scheduleCache = null;
  let countdownTimer = null;
  let countdownRemaining = 0;
  let countdownMessageType = "error";
  let countdownPrefix = "Please wait";
  let deviceId = null;
  let idempotencyKey = null;
  let isSubmitting = false;
  let orderFormLocked = true;
  let lastPriceMap = new Map();
  let currentSession = null;
  let currentProfile = null;
  let draftHydratedForUserId = null;
  let sessionSyncVersion = 0;

  function redirectToLogin() {
    window.location.href = loginPagePath;
  }

  function setMessage(text, type) {
    if (!formMessage) {
      return;
    }
    formMessage.textContent = text;
    formMessage.className = `form-message ${type || ""}`.trim();
  }

  function getDraftStorageKey() {
    const userId = currentSession?.user?.id;
    if (!userId) {
      return null;
    }
    return `${draftStorageKeyPrefix}:${userId}`;
  }

  function normalizeOrderItem(item) {
    const productName = String(item?.product_name || "").trim();
    if (!productName) {
      return null;
    }

    const unitPrice = Number(item?.unit_price || 0);
    const quantity = Number(item?.quantity || 1);

    return {
      product_name: productName,
      unit_price: Math.max(0, Math.floor(unitPrice)),
      quantity: Math.max(1, Math.floor(quantity)),
    };
  }

  function normalizeOrderPayload(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const items = Array.isArray(payload.order_items)
      ? payload.order_items.map((item) => normalizeOrderItem(item)).filter(Boolean)
      : [];

    return {
      delivery_location: String(payload.delivery_location || "").trim(),
      note: String(payload.note || ""),
      order_items: items,
    };
  }

  function normalizeProductName(name) {
    return String(name || "").trim().toLowerCase();
  }

  function setOrderFormLocked(locked, reason) {
    orderFormLocked = Boolean(locked);
    const controls = form.querySelectorAll("input, select, textarea, button");
    controls.forEach((control) => {
      control.disabled = locked;
    });

    if (orderLockMessage) {
      if (locked) {
        orderLockMessage.textContent = reason || "Login required before ordering.";
        orderLockMessage.classList.remove("hidden");
      } else {
        orderLockMessage.classList.add("hidden");
      }
    }
  }

  function applyMemberProfile(profile) {
    currentProfile = profile || null;
  }

  function buildLastPriceMap(orders) {
    const map = new Map();
    const sortedOrders = [...orders].sort((a, b) => {
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    sortedOrders.forEach((order) => {
      (order.order_items || []).forEach((item) => {
        const key = normalizeProductName(item.product_name);
        if (!key || map.has(key)) {
          return;
        }
        map.set(key, Number(item.unit_price || 0));
      });
    });

    lastPriceMap = map;
  }

  function applyLastPriceHint(row) {
    const nameField = row.querySelector(".item-name");
    const priceField = row.querySelector(".item-price");
    const hint = row.querySelector(".item-hint");
    if (!nameField || !priceField) {
      return;
    }

    const key = normalizeProductName(nameField.value);
    if (!key || !lastPriceMap.has(key)) {
      if (hint) {
        hint.textContent = "";
      }
      return;
    }

    const lastPrice = lastPriceMap.get(key);
    if (hint) {
      hint.textContent = `上次單價: ${window.App.formatCurrency(lastPrice)}`;
    }

    const currentPrice = Number(priceField.value);
    if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
      priceField.value = lastPrice;
    }
  }

  function refreshPriceHints() {
    itemList.querySelectorAll(".item-row").forEach((row) => applyLastPriceHint(row));
    computeTotals();
  }

  function computeTotals() {
    let total = 0;
    const rows = itemList.querySelectorAll(".item-row");

    rows.forEach((row) => {
      const price = Number(row.querySelector(".item-price").value) || 0;
      const qty = Number(row.querySelector(".item-qty").value) || 0;
      const line = Math.max(0, price) * Math.max(0, qty);
      row.querySelector(".item-line-total").textContent = window.App.formatCurrency(line);
      total += line;
    });

    totalEl.textContent = window.App.formatCurrency(total);
    return total;
  }

  function createUuid() {
    if (crypto?.randomUUID) {
      return crypto.randomUUID();
    }

    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
      16,
      20
    )}-${hex.slice(20)}`;
  }

  function getDeviceId() {
    if (deviceId) {
      return deviceId;
    }
    const storageKey = "order_device_id";
    const existing = localStorage.getItem(storageKey);
    if (existing) {
      deviceId = existing;
      return existing;
    }
    const created = createUuid();
    localStorage.setItem(storageKey, created);
    deviceId = created;
    return created;
  }

  function resetIdempotencyKey() {
    idempotencyKey = null;
  }

  function getIdempotencyKey() {
    if (!idempotencyKey) {
      idempotencyKey = createUuid();
    }
    return idempotencyKey;
  }

  async function invokeFunction(name, body) {
    const baseUrl = window.App.config?.SUPABASE_URL;
    if (!baseUrl) {
      return { data: null, error: { status: 0, message: "Please configure assets/config.js" } };
    }

    const { data, error } = await supabase.functions.invoke(name, {
      body: body || {},
    });

    if (error) {
      let payload = null;
      const raw = error?.context?.body;
      if (typeof raw === "string" && raw) {
        try {
          payload = JSON.parse(raw);
        } catch (_parseError) {
          payload = { message: raw };
        }
      } else if (raw && typeof raw === "object") {
        payload = raw;
      }

      const status = error?.context?.status || error?.status || 500;
      const message = payload?.error || payload?.message || error.message || "Please try again.";
      const retryAfter = Number(payload?.retry_after);
      return {
        data: null,
        error: {
          status,
          message,
          retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
        },
      };
    }

    return { data, error: null };
  }

  function formatCountdown(seconds) {
    const safe = Math.max(0, Number(seconds) || 0);
    const mins = Math.floor(safe / 60);
    const secs = safe % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }

  function updateCountdownMessage() {
    setMessage(`${countdownPrefix} ${formatCountdown(countdownRemaining)}.`, countdownMessageType);
  }

  function clearCountdown() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
    }
    countdownTimer = null;
    countdownRemaining = 0;
  }

  function startCountdown(seconds, options) {
    clearCountdown();
    countdownRemaining = Math.max(1, Math.floor(seconds || 0));
    countdownMessageType = options?.type || "error";
    countdownPrefix = options?.prefix || "Please wait";
    submitBtn.disabled = true;
    updateCountdownMessage();

    countdownTimer = setInterval(() => {
      countdownRemaining -= 1;
      if (countdownRemaining <= 0) {
        clearCountdown();
        setMessage("", "");
        submitBtn.disabled = false;
        return;
      }
      updateCountdownMessage();
    }, 1000);
  }

  function createRow() {
    const fragment = template.content.cloneNode(true);
    const row = fragment.querySelector(".item-row");
    const removeBtn = row.querySelector(".icon");

    row.addEventListener("input", (event) => {
      if (event.target?.classList?.contains("item-name")) {
        applyLastPriceHint(row);
      }
      computeTotals();
      saveOrderDraft();
    });

    removeBtn.addEventListener("click", () => {
      row.remove();
      computeTotals();
      saveOrderDraft();
    });

    if (orderFormLocked) {
      row.querySelectorAll("input, button").forEach((control) => {
        control.disabled = true;
      });
    }

    applyLastPriceHint(row);
    return fragment;
  }

  function addRow() {
    itemList.appendChild(createRow());
    computeTotals();
    saveOrderDraft();
  }

  function addRowWithValues(item) {
    const fragment = createRow();
    itemList.appendChild(fragment);
    const row = itemList.lastElementChild;
    if (!row) {
      return;
    }

    const nameField = row.querySelector(".item-name");
    const priceField = row.querySelector(".item-price");
    const qtyField = row.querySelector(".item-qty");

    if (nameField) {
      nameField.value = item.product_name || "";
    }
    if (priceField) {
      priceField.value = Number(item.unit_price || 0);
    }
    if (qtyField) {
      qtyField.value = Number(item.quantity || 1);
    }

    applyLastPriceHint(row);
    saveOrderDraft();
  }

  function collectItems() {
    const rows = Array.from(itemList.querySelectorAll(".item-row"));
    const items = [];

    rows.forEach((row) => {
      const productName = row.querySelector(".item-name").value.trim();
      const unitPrice = Number(row.querySelector(".item-price").value);
      const quantity = Number(row.querySelector(".item-qty").value);

      if (!productName) {
        return;
      }

      items.push({
        product_name: productName,
        unit_price: Math.max(0, Math.floor(unitPrice)),
        quantity: Math.max(1, Math.floor(quantity)),
      });
    });

    return items;
  }

  function collectFormState() {
    return {
      delivery_location: String(locationInput?.value || "").trim(),
      note: String(noteInput?.value || ""),
      order_items: collectItems(),
    };
  }

  function hasDraftContent(draft) {
    if (!draft) {
      return false;
    }
    return Boolean(
      String(draft.delivery_location || "").trim() ||
        String(draft.note || "").trim() ||
        (Array.isArray(draft.order_items) && draft.order_items.length > 0)
    );
  }

  function saveOrderDraft() {
    const key = getDraftStorageKey();
    if (!key) {
      return;
    }

    const draft = collectFormState();
    if (!hasDraftContent(draft)) {
      localStorage.removeItem(key);
      return;
    }

    localStorage.setItem(key, JSON.stringify(draft));
  }

  function clearOrderDraft() {
    const key = getDraftStorageKey();
    if (!key) {
      return;
    }
    localStorage.removeItem(key);
  }

  function readOrderDraft() {
    const key = getDraftStorageKey();
    if (!key) {
      return null;
    }

    const raw = localStorage.getItem(key);
    if (!raw) {
      return null;
    }

    try {
      const payload = JSON.parse(raw);
      const normalized = normalizeOrderPayload(payload);
      if (!normalized) {
        localStorage.removeItem(key);
        return null;
      }
      return normalized;
    } catch (_error) {
      localStorage.removeItem(key);
      return null;
    }
  }

  async function loadSchedule() {
    if (!supabase) {
      scheduleInfo.textContent = "Please configure assets/config.js";
      openBadge.textContent = "Config Missing";
      openBadge.classList.remove("open", "closed");
      return;
    }

    const { data, error } = await supabase
      .from("ordering_schedule")
      .select("open_day, open_hour, close_day, close_hour, is_always_open")
      .eq("id", 1)
      .single();

    if (error) {
      scheduleInfo.textContent = "Unable to read schedule";
      openBadge.textContent = "Read Failed";
      openBadge.classList.remove("open", "closed");
      return;
    }

    scheduleCache = data;
    scheduleInfo.textContent = window.App.formatSchedule(data);
    const isOpen = window.App.isWithinSchedule(data);
    openBadge.textContent = isOpen ? "Open" : "Closed";
    openBadge.classList.toggle("open", isOpen);
    openBadge.classList.toggle("closed", !isOpen);
  }

  async function loadMemberOrdersForHints() {
    if (!supabase || !currentSession?.user) {
      lastPriceMap = new Map();
      refreshPriceHints();
      return;
    }

    const { data, error } = await supabase
      .from("orders")
      .select("created_at, order_items(*)")
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      return;
    }

    buildLastPriceMap(data || []);
    refreshPriceHints();
  }

  async function loadMemberProfile() {
    if (!supabase || !currentSession?.user) {
      applyMemberProfile(null);
      return null;
    }

    const { data, error } = await supabase
      .from("member_profiles")
      .select("user_id, full_name, account, email, real_phone")
      .eq("user_id", currentSession.user.id)
      .maybeSingle();

    if (error || !data) {
      applyMemberProfile(null);
      return null;
    }

    applyMemberProfile(data);
    return data;
  }

  function focusOrderFormCard() {
    if (!orderFormCard) {
      return;
    }

    const rect = orderFormCard.getBoundingClientRect();
    const isOutsideViewport = rect.top < 0 || rect.bottom > window.innerHeight;
    if (isOutsideViewport) {
      orderFormCard.scrollIntoView({ behavior: "auto", block: "start" });
    }
    orderFormCard.classList.remove("form-highlight");
    void orderFormCard.offsetWidth;
    orderFormCard.classList.add("form-highlight");
    setTimeout(() => {
      orderFormCard.classList.remove("form-highlight");
    }, 1000);
  }

  function replaceFormWithOrder(order) {
    if (locationInput) {
      locationInput.value = order.delivery_location || "";
    }
    if (noteInput) {
      noteInput.value = order.note || "";
    }

    itemList.innerHTML = "";
    order.order_items.forEach((item) => addRowWithValues(item));
    if (order.order_items.length === 0) {
      addRow();
    }

    computeTotals();
    saveOrderDraft();
  }

  function mergeOrderIntoForm(order) {
    if (locationInput && order.delivery_location) {
      const currentLocation = String(locationInput.value || "").trim();
      if (!currentLocation) {
        locationInput.value = order.delivery_location;
      }
    }

    if (noteInput && order.note) {
      const currentNote = String(noteInput.value || "").trim();
      if (!currentNote) {
        noteInput.value = order.note;
      }
    }

    order.order_items.forEach((item) => addRowWithValues(item));
    if (itemList.querySelectorAll(".item-row").length === 0) {
      addRow();
    }

    computeTotals();
    saveOrderDraft();
  }

  function restoreSavedDraft() {
    if (!currentSession?.user) {
      return;
    }

    const userId = currentSession.user.id;
    if (draftHydratedForUserId === userId) {
      return;
    }

    const draft = readOrderDraft();
    if (draft) {
      replaceFormWithOrder(draft);
    }

    draftHydratedForUserId = userId;
  }

  function applyPendingReorder() {
    const raw = localStorage.getItem(reorderStorageKey);
    if (!raw) {
      return;
    }

    localStorage.removeItem(reorderStorageKey);
    try {
      const payload = normalizeOrderPayload(JSON.parse(raw));
      if (!payload) {
        return;
      }
      mergeOrderIntoForm(payload);
      setMessage("已加入重新下單商品，請確認後送出。", "success");
      focusOrderFormCard();
    } catch (_error) {
      return;
    }
  }

  async function submitOrder(event) {
    event.preventDefault();

    if (!supabase) {
      setMessage("Please configure assets/config.js", "error");
      return;
    }

    if (!currentSession?.user || !currentProfile) {
      setMessage("請先登入並完成會員資料。", "error");
      setOrderFormLocked(true, "Login required before ordering.");
      return;
    }

    if (countdownRemaining > 0) {
      updateCountdownMessage();
      return;
    }

    if (!window.App.isWithinSchedule(scheduleCache)) {
      setMessage("目前不在開放時段。", "error");
      return;
    }

    const location = locationInput?.value || "";
    const note = noteInput?.value.trim() || "";
    const items = collectItems();

    if (!location) {
      setMessage("請先選擇運送地址。", "error");
      return;
    }

    if (items.length === 0) {
      setMessage("請至少新增一項商品。", "error");
      return;
    }

    submitBtn.disabled = true;
    setMessage("送出中...", "");
    isSubmitting = true;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token || currentSession?.access_token || "";
    if (sessionError || !accessToken) {
      setMessage("登入狀態失效，請重新登入。", "error");
      isSubmitting = false;
      submitBtn.disabled = false;
      return;
    }

    const { error } = await invokeFunction("create-order", {
      delivery_location: location,
      note,
      items,
      device_id: getDeviceId(),
      idempotency_key: getIdempotencyKey(),
      access_token: accessToken,
    });

    if (error) {
      if (error.status === 429 || error.retryAfter) {
        startCountdown(error.retryAfter || 120);
        isSubmitting = false;
        return;
      }
      const message = error.status === 401 ? "登入狀態失效，請重新登入。" : error.message;
      setMessage(`送出失敗: ${message}`, "error");
      isSubmitting = false;
      submitBtn.disabled = false;
      return;
    }

    clearCountdown();
    resetIdempotencyKey();
    isSubmitting = false;

    if (locationInput) {
      locationInput.value = "";
    }
    if (noteInput) {
      noteInput.value = "";
    }
    itemList.innerHTML = "";
    addRow();
    computeTotals();
    clearOrderDraft();

    startCountdown(120, {
      type: "success",
      prefix: "送出成功，倒數",
    });
    loadMemberOrdersForHints();
    submitBtn.disabled = false;
  }

  async function handleSessionChange(session, options) {
    const syncVersion = ++sessionSyncVersion;
    currentSession = session || null;
    const isLoggedIn = Boolean(currentSession?.user);
    const allowRedirect = Boolean(options?.allowRedirect);

    if (!isLoggedIn) {
      draftHydratedForUserId = null;
      applyMemberProfile(null);
      clearCountdown();
      setOrderFormLocked(true, "Login required before ordering.");
      setMessage("請先登入會員。", "error");
      if (allowRedirect) {
        redirectToLogin();
      }
      return;
    }

    const profile = await loadMemberProfile();
    if (syncVersion !== sessionSyncVersion) {
      return;
    }
    if (!profile) {
      setOrderFormLocked(true, "Member profile is missing.");
      setMessage("會員資料不存在，請先到會員資料頁補齊。", "error");
      return;
    }

    setOrderFormLocked(false, "");
    if (!isSubmitting && countdownRemaining <= 0) {
      setMessage("", "");
    }

    restoreSavedDraft();
    await loadMemberOrdersForHints();
    if (syncVersion !== sessionSyncVersion) {
      return;
    }
    applyPendingReorder();
  }

  if (!window.App.configOk) {
    setMessage("Please configure assets/config.js", "error");
  }

  setOrderFormLocked(true, "Login required before ordering.");

  addItemBtn.addEventListener("click", addRow);
  form.addEventListener("submit", submitOrder);
  form.addEventListener("input", () => {
    if (!isSubmitting) {
      resetIdempotencyKey();
    }
    saveOrderDraft();
  });

  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      handleSessionChange(session, { allowRedirect: true });
    });

    supabase.auth.getSession().then(({ data }) => {
      handleSessionChange(data.session, { allowRedirect: true });
    });
  }

  if (globalLogoutBtn) {
    globalLogoutBtn.addEventListener("click", async () => {
      if (supabase) {
        await supabase.auth.signOut();
      }
      redirectToLogin();
    });
  }

  addRow();
  loadSchedule();
  setInterval(loadSchedule, 60000);
})();
