(function () {
  const memberOrdersContainer = document.getElementById("memberOrdersContainer");
  const memberOrdersUpdated = document.getElementById("memberOrdersUpdated");
  const memberOrdersMessage = document.getElementById("memberOrdersMessage");
  const memberOrderFilter = document.getElementById("memberOrderFilter");
  const refreshHistoryBtn = document.getElementById("refreshHistoryBtn");
  const globalLogoutBtn = document.getElementById("globalLogoutBtn");

  if (!memberOrdersContainer || !memberOrderFilter) {
    return;
  }

  const supabase = window.App.getSupabaseClient();
  const loginPagePath = "index.html";
  const reorderStorageKey = "member_reorder_payload";

  let currentSession = null;
  let memberOrders = [];

  const statusLabels = {
    open: "進行中",
    fulfilled: "已完成",
    archived: "歷史",
  };

  function redirectToLogin() {
    window.location.href = loginPagePath;
  }

  function setMessage(text, type) {
    if (!memberOrdersMessage) {
      return;
    }
    memberOrdersMessage.textContent = text;
    memberOrdersMessage.className = `form-message ${type || ""}`.trim();
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatOrderTime(value) {
    if (!value) {
      return "--";
    }
    return new Date(value).toLocaleString("zh-TW", {
      timeZone: "Asia/Taipei",
    });
  }

  function renderOrders() {
    if (!memberOrders || memberOrders.length === 0) {
      memberOrdersContainer.innerHTML = '<p class="muted">目前沒有訂單。</p>';
      return;
    }

    const filter = memberOrderFilter.value || "history";
    const filtered = memberOrders.filter((order) => {
      if (filter === "history") {
        return order.status === "archived";
      }
      if (filter === "current") {
        return order.status !== "archived";
      }
      return true;
    });

    if (filtered.length === 0) {
      memberOrdersContainer.innerHTML = '<p class="muted">目前沒有符合條件的訂單。</p>';
      return;
    }

    const cards = filtered
      .map((order) => {
        const itemsHtml = (order.order_items || [])
          .map((item) => {
            const name = escapeHtml(item.product_name);
            const qty = Number(item.quantity || 0);
            const price = window.App.formatCurrency(item.unit_price);
            return `<div>${name} x ${qty} (${price})</div>`;
          })
          .join("");

        const note = order.note ? `<div class="muted">備註: ${escapeHtml(order.note)}</div>` : "";
        const status = statusLabels[order.status] || statusLabels.open;

        return `
          <div class="member-order-card" data-id="${order.id}">
            <div class="member-order-meta">
              <span>時間: ${formatOrderTime(order.created_at)}</span>
              <span>狀態: ${status}</span>
              <span>運送地點: ${escapeHtml(order.delivery_location)}</span>
              <span>總額: ${window.App.formatCurrency(order.total_amount)}</span>
            </div>
            <div class="member-order-items">${itemsHtml}</div>
            ${note}
            <div class="member-order-actions">
              <button type="button" class="ghost" data-action="reorder" data-id="${order.id}">
                Reorder
              </button>
            </div>
          </div>
        `;
      })
      .join("");

    memberOrdersContainer.innerHTML = cards;
  }

  async function loadOrders() {
    if (!supabase || !currentSession?.user) {
      return;
    }

    memberOrdersContainer.innerHTML = '<p class="muted">載入中...</p>';
    setMessage("", "");

    const { data, error } = await supabase
      .from("orders")
      .select("id, created_at, delivery_location, note, total_amount, status, order_items(*)")
      .eq("user_id", currentSession.user.id)
      .order("created_at", { ascending: false });

    if (error) {
      memberOrdersContainer.innerHTML = '<p class="muted">讀取失敗。</p>';
      setMessage(error.message || "讀取失敗", "error");
      return;
    }

    memberOrders = data || [];
    renderOrders();

    if (memberOrdersUpdated) {
      memberOrdersUpdated.textContent = `最後更新：${formatOrderTime(new Date())}`;
    }
  }

  function reorderOrder(orderId) {
    const order = memberOrders.find((item) => item.id === orderId);
    if (!order) {
      return;
    }

    const payload = {
      delivery_location: order.delivery_location || "",
      note: order.note || "",
      order_items: (order.order_items || []).map((item) => ({
        product_name: item.product_name || "",
        unit_price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 1),
      })),
    };

    localStorage.setItem(reorderStorageKey, JSON.stringify(payload));
    window.location.href = "order.html";
  }

  async function handleSessionChange(session, options) {
    currentSession = session || null;
    const allowRedirect = Boolean(options?.allowRedirect);

    if (!currentSession?.user) {
      if (allowRedirect) {
        redirectToLogin();
      }
      return;
    }

    await loadOrders();
  }

  if (!window.App.configOk) {
    setMessage("Please configure assets/config.js", "error");
  }

  memberOrderFilter.addEventListener("change", renderOrders);

  if (refreshHistoryBtn) {
    refreshHistoryBtn.addEventListener("click", loadOrders);
  }

  if (globalLogoutBtn) {
    globalLogoutBtn.addEventListener("click", async () => {
      if (supabase) {
        await supabase.auth.signOut();
      }
      redirectToLogin();
    });
  }

  memberOrdersContainer.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const action = target.dataset.action;
    const orderId = target.dataset.id;
    if (action === "reorder" && orderId) {
      reorderOrder(orderId);
    }
  });

  if (supabase) {
    supabase.auth.onAuthStateChange((_event, session) => {
      handleSessionChange(session, { allowRedirect: true });
    });

    supabase.auth.getSession().then(({ data }) => {
      handleSessionChange(data.session, { allowRedirect: true });
    });
  }
})();
