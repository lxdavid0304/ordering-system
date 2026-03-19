import { adminSupabase } from "../lib/supabase";

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

export async function loadAdminOrders({ filters, page, pageSize }) {
  if (!adminSupabase) {
    return { data: null, error: new Error("請先設定 config.js"), count: 0 };
  }

  let query = adminSupabase
    .from("orders")
    .select(
      "id, created_at, customer_name, phone, delivery_location, note, total_amount, status, admin_note, order_items(*)",
      { count: "exact" }
    )
    .order("created_at", { ascending: false });

  if (filters.status && filters.status !== "all") {
    query = query.eq("status", filters.status);
  }

  if (filters.location && filters.location !== "all") {
    query = query.eq("delivery_location", filters.location);
  }

  const year = Number(filters.year);
  const month = Number(filters.month);
  if (Number.isFinite(year) && Number.isFinite(month)) {
    const start = getUtcDateForTimeZoneLocal(year, month, 1, "Asia/Taipei");
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const end = getUtcDateForTimeZoneLocal(nextYear, nextMonth, 1, "Asia/Taipei");
    query = query.gte("created_at", start.toISOString()).lt("created_at", end.toISOString());
  }

  const rangeFrom = (page - 1) * pageSize;
  const rangeTo = rangeFrom + pageSize - 1;
  return query.range(rangeFrom, rangeTo);
}

export async function updateAdminOrder(orderId, payload) {
  if (!adminSupabase) {
    return { data: null, error: new Error("請先設定 config.js") };
  }

  return adminSupabase.from("orders").update(payload).eq("id", orderId).select("id").maybeSingle();
}

export async function checkAdminAccess() {
  if (!adminSupabase) {
    return { data: false, error: new Error("請先設定 config.js") };
  }

  const { data, error } = await adminSupabase.from("admin_users").select("user_id").limit(1).maybeSingle();
  return {
    data: Boolean(data),
    error,
  };
}

export async function bulkUpdateOrders(ids, status) {
  if (!adminSupabase) {
    return { data: null, error: new Error("請先設定 config.js") };
  }

  return adminSupabase.from("orders").update({ status }).in("id", ids).select("id");
}
