import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const RATE_LIMIT_MS = 2 * 60 * 1000;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function getClientIp(req: Request) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  if (realIp) {
    return realIp.trim();
  }
  return "unknown";
}

function sanitizeText(value: unknown, maxLength = 200) {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().slice(0, maxLength);
}

function sanitizeToken(value: unknown) {
  return sanitizeText(value, 5000);
}

function getDatePartsInTimeZone(timeZone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = formatter.formatToParts(new Date());
  const lookup: Record<string, string> = {};
  for (const part of parts) {
    lookup[part.type] = part.value;
  }
  return {
    year: Number(lookup.year),
    month: Number(lookup.month),
    day: Number(lookup.day),
  };
}

function getIsoWeekIdFromDate(date: Date) {
  const work = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNr = (work.getUTCDay() + 6) % 7;
  work.setUTCDate(work.getUTCDate() - dayNr + 3);
  const weekYear = work.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(weekYear, 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  const weekNumber =
    1 + Math.round((work.getTime() - firstThursday.getTime()) / 86400000 / 7);
  return `${weekYear}-W${String(weekNumber).padStart(2, "0")}`;
}

function getIsoWeekId({ year, month, day }: { year: number; month: number; day: number }) {
  return getIsoWeekIdFromDate(new Date(Date.UTC(year, month - 1, day)));
}

function getCurrentBatchId() {
  const parts = getDatePartsInTimeZone("Asia/Taipei");
  if (!Number.isFinite(parts.year) || !Number.isFinite(parts.month) || !Number.isFinite(parts.day)) {
    return getIsoWeekIdFromDate(new Date());
  }
  return getIsoWeekId(parts);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return jsonResponse({ error: "Server not configured" }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch (_error) {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const authHeader = req.headers.get("authorization");
  let token = "";
  if (authHeader?.startsWith("Bearer ")) {
    token = sanitizeToken(authHeader.slice(7));
  }
  if (!token) {
    token = sanitizeToken(payload?.access_token);
  }
  if (!token) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData?.user) {
    return jsonResponse({ error: "Authentication required" }, 401);
  }
  const userId = userData.user.id;

  const deliveryLocation = sanitizeText(payload?.delivery_location, 50);
  const note = sanitizeText(payload?.note, 200);
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const deviceId = sanitizeText(payload?.device_id, 80);
  const idempotencyKey = sanitizeText(payload?.idempotency_key, 80);

  if (!deliveryLocation || !deviceId || !idempotencyKey) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }

  if (items.length === 0) {
    return jsonResponse({ error: "Items required" }, 400);
  }

  const { data: profile, error: profileError } = await supabase
    .from("member_profiles")
    .select("full_name, real_phone")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    return jsonResponse({ error: "Member profile required" }, 403);
  }

  const cleanedItems = [];
  for (const item of items) {
    const name = sanitizeText((item as Record<string, unknown>)?.product_name, 100);
    const unitPrice = Number((item as Record<string, unknown>)?.unit_price);
    const quantity = Number((item as Record<string, unknown>)?.quantity);

    if (!name) {
      continue;
    }

    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return jsonResponse({ error: "Invalid unit_price" }, 400);
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return jsonResponse({ error: "Invalid quantity" }, 400);
    }

    cleanedItems.push({
      product_name: name,
      unit_price: Math.floor(unitPrice),
      quantity: Math.floor(quantity),
    });
  }

  if (cleanedItems.length === 0) {
    return jsonResponse({ error: "Items required" }, 400);
  }

  const ip = getClientIp(req);
  const now = new Date();
  const rateKey = `${ip}|${deviceId}|${profile.real_phone}|${userId}`;

  const { data: rateRow, error: rateError } = await supabase
    .from("rate_limits")
    .select("last_request")
    .eq("key", rateKey)
    .maybeSingle();

  if (rateError) {
    return jsonResponse({ error: "Rate limit check failed" }, 500);
  }

  if (rateRow?.last_request) {
    const lastRequest = new Date(rateRow.last_request);
    const diffMs = now.getTime() - lastRequest.getTime();
    if (diffMs < RATE_LIMIT_MS) {
      const retryAfter = Math.ceil((RATE_LIMIT_MS - diffMs) / 1000);
      return jsonResponse(
        {
          error: "Too many requests. Please wait before trying again.",
          retry_after: retryAfter,
        },
        429
      );
    }
  }

  const { error: rateUpdateError } = await supabase.from("rate_limits").upsert({
    key: rateKey,
    ip,
    device_id: deviceId,
    phone: profile.real_phone,
    user_id: userId,
    last_request: now.toISOString(),
  });

  if (rateUpdateError) {
    return jsonResponse({ error: "Rate limit update failed" }, 500);
  }

  const { data: openNow, error: openError } = await supabase.rpc("ordering_open_now");
  if (openError) {
    return jsonResponse({ error: "Schedule check failed" }, 500);
  }
  if (!openNow) {
    return jsonResponse({ error: "Ordering is closed now" }, 403);
  }

  const { data: orderId, error: orderError } = await supabase.rpc("create_order", {
    p_delivery_location: deliveryLocation,
    p_note: note,
    p_items: cleanedItems,
    p_idempotency_key: idempotencyKey,
    p_batch_id: getCurrentBatchId(),
    p_user_id: userId,
  });

  if (orderError) {
    return jsonResponse({ error: "Failed to create order" }, 500);
  }
  return jsonResponse({ order_id: orderId }, 200);
});
