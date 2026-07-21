import { adminSupabase } from "../lib/supabase";

function missingClient(extra = {}) {
  return { data: null, error: new Error("請先設定 config.js"), ...extra };
}

function normalizeFilters(filters = {}) {
  const status = filters.status || "pending_deposit";
  const isHistory = status === "history";
  const isRecentFulfilled = status === "fulfilled";
  const historyMonths = Number(filters.historyMonths);

  return {
    p_search: String(filters.search || "").trim() || null,
    p_status: isHistory ? null : status,
    p_payment_status:
      filters.paymentStatus && filters.paymentStatus !== "all" ? filters.paymentStatus : null,
    p_location: filters.location && filters.location !== "all" ? filters.location : null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
    p_view: isHistory ? "history" : isRecentFulfilled ? "recent_fulfilled" : "status",
    p_history_months: isHistory && [1, 3, 6].includes(historyMonths) ? historyMonths : null,
  };
}

function isReadyForAutoCompletion(order) {
  if (!order || order.status !== "ready_pickup") return false;
  const paidAmount =
    Math.max(0, Number(order.deposit_paid_amount) || 0) +
    Math.max(0, Number(order.balance_paid_amount) || 0);
  return paidAmount >= Math.max(0, Number(order.total_amount) || 0);
}

function normalizeOrderResult(data) {
  if (Array.isArray(data)) return data[0] || null;
  return data && typeof data === "object" ? data : null;
}

async function sendLineNotification(orderId, status = "") {
  const result = await adminSupabase.functions.invoke("line-notify", {
    body: { order_id: orderId, target_status: status || undefined },
  });
  if (result.error) return result.error;
  if (Number(result.data?.failed || 0) > 0) {
    return new Error("LINE notification delivery failed and will retry automatically");
  }
  return null;
}

export async function loadAdminOrders({ filters, page, pageSize }) {
  if (!adminSupabase) return missingClient({ count: 0 });

  const { data, error } = await adminSupabase.rpc("admin_list_orders", {
    ...normalizeFilters(filters),
    p_limit: pageSize,
    p_offset: Math.max(0, (page - 1) * pageSize),
  });

  return {
    data: Array.isArray(data?.items) ? data.items : [],
    count: Number(data?.total || 0),
    error,
  };
}

export async function loadAdminSummary() {
  if (!adminSupabase) return missingClient();
  return adminSupabase.rpc("admin_order_summary");
}

export async function loadAdminOperatingReport(period = "month") {
  if (!adminSupabase) return missingClient();
  return adminSupabase.rpc("admin_operating_report", { p_period: period });
}

export async function drainLineNotifications() {
  if (!adminSupabase) return missingClient();
  return adminSupabase.functions.invoke("line-notify", { body: {} });
}

export async function updateAdminOrder(orderId, payload, reason = "") {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_update_order", {
    p_order_id: orderId,
    p_status: payload.status,
    p_admin_note: payload.admin_note ?? null,
    p_reason: String(reason || "").trim() || null,
  });

  const order = normalizeOrderResult(result.data);
  if (!result.error && payload.status && order?.status === payload.status) {
    const notificationError = await sendLineNotification(orderId, payload.status);
    return { ...result, data: order, notificationError };
  }

  return { ...result, data: order || result.data };
}

export async function markAdminOrderReadyForPickup(orderId, finalTotalAmount, reason = "") {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_mark_order_ready_for_pickup", {
    p_order_id: orderId,
    p_final_total_amount: Math.max(0, Math.floor(Number(finalTotalAmount) || 0)),
    p_reason: String(reason || "").trim() || null,
  });

  const order = normalizeOrderResult(result.data);
  if (!result.error && order?.status === "ready_pickup") {
    const notificationError = await sendLineNotification(orderId, "ready_pickup");
    return { ...result, data: order, notificationError };
  }

  return { ...result, data: order || result.data };
}

export async function saveAdminOrderPayment(orderId, payment) {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_save_order_payment", {
    p_order_id: orderId,
    p_phase: payment.phase,
    p_amount: Math.max(0, Math.floor(Number(payment.amount) || 0)),
    p_method: payment.method || null,
    p_paid_at: payment.paidAt || null,
    p_review_complete: payment.reviewComplete !== false,
  });

  const order = normalizeOrderResult(result.data);
  if (!result.error && order?.status) {
    if (isReadyForAutoCompletion(order)) {
      const completion = await updateAdminOrder(
        orderId,
        { status: "fulfilled" },
        "尾款已付清，自動完成訂單"
      );
      return {
        data: completion.data || order,
        error: null,
        notificationError: completion.notificationError || null,
        completionError: completion.error || null,
        autoCompleted: !completion.error,
      };
    }

    const notificationError = await sendLineNotification(orderId, order.status);
    return { ...result, data: order, notificationError };
  }

  return { ...result, data: order || result.data };
}

export async function loadOrderEvents(orderId) {
  if (!adminSupabase || !orderId) return { data: [], error: null };
  return adminSupabase
    .from("order_events")
    .select("id, order_id, actor_user_id, actor_email, event_type, details, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
}

export async function loadOrderNotificationJobs(orderId) {
  if (!adminSupabase || !orderId) return { data: [], error: null };
  const { data, error } = await adminSupabase.functions.invoke("notification-diagnostics", {
    body: { order_id: orderId },
  });
  return {
    data: {
      jobs: Array.isArray(data?.jobs) ? data.jobs : [],
      queueTotal: Number(data?.queue_total || 0),
      diagnostics: data?.diagnostics || {},
    },
    error,
  };
}

export async function exportAdminOrders(filters) {
  if (!adminSupabase) return missingClient();
  return adminSupabase.rpc("admin_export_orders", normalizeFilters(filters));
}

export async function checkAdminAccess() {
  if (!adminSupabase) return { data: false, error: new Error("請先設定 config.js") };
  const { data, error } = await adminSupabase
    .from("admin_users")
    .select("user_id")
    .limit(1)
    .maybeSingle();
  return { data: Boolean(data), error };
}

export async function bulkUpdateOrders(ids, status, reason = "批次更新") {
  const updated = [];
  for (const id of ids) {
    const { data, error } = await updateAdminOrder(id, { status }, reason);
    if (error) return { data: updated, error };
    if (data) updated.push(data);
  }
  return { data: updated, error: null };
}
