import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
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

function normalizeOrderId(value: unknown) {
  const text = sanitizeText(value, 64);
  const isUuid = /^[0-9a-fA-F-]{32,36}$/.test(text);
  return isUuid ? text : "";
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

  const orderId = normalizeOrderId(payload?.order_id);
  if (!orderId) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }

  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, created_at, customer_name, phone, delivery_location, note, total_amount, status, order_items(*)"
    )
    .eq("id", orderId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    return jsonResponse({ error: "Lookup failed" }, 500);
  }

  if (!data) {
    return jsonResponse({ error: "Order not found" }, 404);
  }

  return jsonResponse({ order: data }, 200);
});
