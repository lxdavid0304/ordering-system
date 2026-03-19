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
  const retryAfter = Number(payload?.retry_after);

  return {
    data: null,
    error: {
      status,
      message: payload?.error || payload?.message || error.message || "請稍後再試。",
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
    .select("id, created_at, delivery_location, note, total_amount, status, order_items(*)")
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
    .select("id, created_at, delivery_location, note, total_amount, status, order_items(*)")
    .eq("id", orderId)
    .maybeSingle();
}
