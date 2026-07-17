import { memberSupabase } from "../lib/supabase";

export async function invokeFunction(name, body) {
  if (!memberSupabase) {
    return { data: null, error: { status: 0, message: "請先設定 config.js" } };
  }

  const { data, error } = await memberSupabase.functions.invoke(name, {
    body: body || {},
  });

  if (!error) {
    return { data, error: null };
  }

  let payload = null;
  const context = error?.context;

  if (context && typeof context.json === "function") {
    try {
      const response = typeof context.clone === "function" ? context.clone() : context;
      payload = await response.json();
    } catch (_parseError) {
      payload = null;
    }
  }

  const raw = context?.body;

  if (!payload && typeof raw === "string" && raw) {
    try {
      payload = JSON.parse(raw);
    } catch (_parseError) {
      payload = { message: raw };
    }
  } else if (!payload && raw && typeof raw === "object" && !("getReader" in raw)) {
    payload = raw;
  }

  const status = context?.status || error?.status || 500;
  const retryAfter = Number(payload?.retry_after);

  return {
    data: null,
    error: {
      status,
      message: payload?.error || payload?.message || error.message || "請稍後再試。",
      code: payload?.code || "",
      items: Array.isArray(payload?.items) ? payload.items : [],
      productIds: Array.isArray(payload?.product_ids) ? payload.product_ids : [],
      retryAfter: Number.isFinite(retryAfter) ? retryAfter : null,
    },
  };
}

export async function loadMemberOrders(userId) {
  if (!memberSupabase || !userId) {
    return { data: [], error: null };
  }

  return memberSupabase
    .from("orders")
    .select("id, created_at, delivery_location, note, total_amount, status, selected_payment_method, deposit_paid_amount, balance_paid_amount, order_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}

export async function loadMemberOrdersForHints(userId) {
  if (!memberSupabase || !userId) {
    return { data: [], error: null };
  }

  return memberSupabase
    .from("orders")
    .select("created_at, order_items(*)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
}

export async function loadOrderById(orderId) {
  if (!memberSupabase || !orderId) {
    return { data: null, error: null };
  }

  return memberSupabase
    .from("orders")
    .select("id, created_at, delivery_location, note, total_amount, status, selected_payment_method, deposit_paid_amount, balance_paid_amount, order_items(*)")
    .eq("id", orderId)
    .maybeSingle();
}

export async function setOrderPaymentMethod(orderId, method) {
  if (!memberSupabase || !orderId) {
    return { data: null, error: new Error("找不到訂單或尚未設定 Supabase。") };
  }

  return memberSupabase.rpc("member_set_order_payment_method", {
    p_order_id: orderId,
    p_method: method,
  });
}
