import { adminSupabase } from "../lib/supabase";

function missingClient(extra = {}) {
  return { data: null, error: new Error("請先設定 config.js"), ...extra };
}

function normalizeFilters(filters = {}) {
  return {
    p_search: String(filters.search || "").trim() || null,
    p_status: filters.status && filters.status !== "all" ? filters.status : null,
    p_payment_status:
      filters.paymentStatus && filters.paymentStatus !== "all" ? filters.paymentStatus : null,
    p_location: filters.location && filters.location !== "all" ? filters.location : null,
    p_date_from: filters.dateFrom || null,
    p_date_to: filters.dateTo || null,
  };
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

export async function updateAdminOrder(orderId, payload, reason = "") {
  if (!adminSupabase) return missingClient();
  return adminSupabase.rpc("admin_update_order", {
    p_order_id: orderId,
    p_status: payload.status,
    p_admin_note: payload.admin_note ?? null,
    p_reason: String(reason || "").trim() || null,
  });
}

export async function saveAdminOrderPayment(orderId, payment) {
  if (!adminSupabase) return missingClient();
  return adminSupabase.rpc("admin_save_order_payment", {
    p_order_id: orderId,
    p_phase: payment.phase,
    p_amount: Math.max(0, Math.floor(Number(payment.amount) || 0)),
    p_method: payment.method || null,
    p_paid_at: payment.paidAt || null,
    p_review_complete: payment.reviewComplete !== false,
  });
}

export async function loadOrderEvents(orderId) {
  if (!adminSupabase || !orderId) return { data: [], error: null };
  return adminSupabase
    .from("order_events")
    .select("id, order_id, actor_user_id, actor_email, event_type, details, created_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
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
