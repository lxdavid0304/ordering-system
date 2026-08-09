import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const MAX_ATTEMPTS = 3;

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function isAdmin(supabase: ReturnType<typeof createClient>, token: string) {
  const { data: userData, error } = await supabase.auth.getUser(token);
  if (error || !userData.user) return false;
  const { data } = await supabase.from("admin_users").select("user_id").eq("user_id", userData.user.id).maybeSingle();
  return Boolean(data);
}

function formatDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "待公告";
  return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(date);
}

function formatCompactDate(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "待確認";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}

function formatCompactPickupRange(start: unknown, end: unknown) {
  const startText = formatCompactDate(start);
  const endText = formatCompactDate(end);
  const [startDay, startTime] = startText.split(" ");
  const [endDay, endTime] = endText.split(" ");
  return startDay === endDay ? `${startDay} ${startTime}–${endTime}` : `${startText}–${endText}`;
}

function formatOrderItems(payload: Record<string, unknown>) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  return items.map((item) => {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    const name = String(record.product_name || "餐點").trim();
    const quantity = Math.max(1, Number(record.quantity || 0));
    const note = String(record.item_note || "").trim();
    return `${name}${note ? `（${note}）` : ""} × ${quantity}`;
  }).filter(Boolean).join("、");
}

function messageFor(eventType: string, campaign: Record<string, unknown>, pickupLocation = "", payload: Record<string, unknown> = {}) {
  const title = String(campaign.title || "快閃熱食團");
  if (eventType === "order_submitted" || eventType === "order_updated") {
    const items = formatOrderItems(payload) || "請至網站查看點餐內容";
    const total = Number(payload.total_amount || 0);
    return [
      eventType === "order_updated" ? "🍴 快閃熱食｜點餐已更新" : "🍴 快閃熱食｜點餐已送出",
      `活動：${title}`,
      `品項：${items}`,
      pickupLocation ? `交貨地點：${pickupLocation}` : null,
      total > 0 ? `本次合計：$${total.toLocaleString("zh-TW")}` : null,
      "截止前仍可回到網站調整點餐。",
    ].filter(Boolean).join("\n");
  }
  if (eventType === "campaign_ready" || eventType === "pickup_location_ready") {
    const pickupReadyAt = payload.pickup_ready_at || campaign.pickup_ready_at;
    const customMessage = String(payload.custom_message || "").trim();
    return [
      "🍴 快閃熱食｜已可取餐",
      title,
      `實際取餐　${formatCompactDate(pickupReadyAt)}`,
      pickupLocation ? `交貨地點　${pickupLocation}` : null,
      customMessage ? `\n${customMessage}` : null,
      "請依你選擇的交貨地點前往取餐。",
    ].filter(Boolean).join("\n");
  }
  if (eventType === "campaign_cancelled") {
    return ["【快閃熱食團取消】", title, "本團已取消；若已點餐，請留意後續通知。"].join("\n");
  }
  const note = String(campaign.note || "").trim();
  if (eventType === "campaign_opened") {
    const openAt = new Date(String(campaign.open_at || ""));
    const isUpcoming = !Number.isNaN(openAt.getTime()) && openAt.getTime() > Date.now();
    return [
      isUpcoming ? "🍴 快閃熱食｜即將開團" : "🍴 快閃熱食｜現在開放點餐",
      `活動：${title}`,
      isUpcoming ? `開放時間：${formatCompactDate(campaign.open_at)}` : null,
      `點餐截止：${formatCompactDate(campaign.deadline_at)}`,
      `預估可取餐：${formatCompactDate(campaign.pickup_start_at)}`,
      note || null,
      isUpcoming ? "開放後請前往「快閃熱食」選餐並選擇交貨地點。" : "請前往「快閃熱食」選餐，並選擇交貨地點。",
    ].filter(Boolean).join("\n");
  }
  return [
    "【快閃熱食開團】",
    title,
    `現在可開始點餐，截止：${formatDate(campaign.deadline_at)}`,
    `取貨時段：${formatDate(campaign.pickup_start_at)} 至 ${formatDate(campaign.pickup_end_at)}`,
    note || null,
    "請至網站的「快閃熱食」選擇商品與交貨地點。",
  ].filter(Boolean).join("\n");
}

async function pushMessage(accessToken: string, to: string, text: string) {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(5000),
    });
    return response.ok ? null : `${response.status} ${await response.text()}`.slice(0, 500);
  } catch (error) {
    return `LINE network error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
  }
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const cronSecret = Deno.env.get("FLASH_FOOD_CRON_SECRET");
  if (!supabaseUrl || !serviceKey || !lineToken) return json({ error: "Server not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  let campaignId = "";
  let requestedEvent = "";
  let memberOrderNotification = false;
  let dispatchDueCampaignOpened = false;
  try {
    const body = await request.json();
    campaignId = typeof body?.campaign_id === "string" ? body.campaign_id : "";
    requestedEvent = typeof body?.event_type === "string" ? body.event_type : "";
    memberOrderNotification = body?.member_order_notification === true;
    dispatchDueCampaignOpened = body?.dispatch_due_campaign_opened === true;
  } catch {
    // Empty body is allowed for an admin retry of all pending jobs.
  }

  if (dispatchDueCampaignOpened && (!cronSecret || request.headers.get("x-flash-food-cron-secret") !== cronSecret)) {
    return json({ error: "Scheduled dispatch is not authorized" }, 403);
  }

  let callerUserId = "";
  let admin = dispatchDueCampaignOpened;
  if (!dispatchDueCampaignOpened) {
    if (!token) return json({ error: "Authentication required" }, 401);
    const { data: userData, error: userError } = await supabase.auth.getUser(token);
    if (userError || !userData.user) return json({ error: "Authentication required" }, 401);
    callerUserId = userData.user.id;
    admin = await isAdmin(supabase, token);
  }

  if (!admin && (!campaignId || !memberOrderNotification)) {
    return json({ error: "Admin required" }, 403);
  }

  let query = supabase
    .from("flash_food_notification_jobs")
    .select("id, campaign_id, user_id, event_type, payload, attempts, status")
    .in("status", ["pending", "failed"])
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(100);
  if (campaignId) query = query.eq("campaign_id", campaignId);
  if (dispatchDueCampaignOpened) query = query.eq("event_type", "campaign_opened");
  else if (admin && requestedEvent) query = query.eq("event_type", requestedEvent);
  if (!admin) query = query.eq("user_id", callerUserId).in("event_type", ["order_submitted", "order_updated"]);
  const { data: jobs, error } = await query;
  if (error) return json({ error: "Notification queue unavailable" }, 500);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of jobs || []) {
    const now = new Date().toISOString();
    const { data: claimed } = await supabase.from("flash_food_notification_jobs")
      .update({ status: "processing", attempts: Number(job.attempts || 0) + 1, updated_at: now })
      .eq("id", job.id).eq("status", job.status).select("id").maybeSingle();
    if (!claimed) continue;

    const [{ data: binding }, { data: campaign }, { data: order }] = await Promise.all([
      supabase.from("member_line_bindings").select("line_user_id, notifications_enabled, blocked_at").eq("user_id", job.user_id).maybeSingle(),
      supabase.from("flash_food_campaigns").select("title, open_at, deadline_at, pickup_start_at, pickup_end_at, pickup_ready_at, note").eq("id", job.campaign_id).maybeSingle(),
      supabase.from("flash_food_orders").select("pickup_location").eq("campaign_id", job.campaign_id).eq("user_id", job.user_id).maybeSingle(),
    ]);
    if (!binding || !binding.notifications_enabled || binding.blocked_at || !campaign) {
      await supabase.from("flash_food_notification_jobs").update({ status: "skipped", error_message: "LINE notification is unavailable", updated_at: new Date().toISOString() }).eq("id", job.id);
      skipped += 1;
      continue;
    }

    const payload = job.payload || {};
    const campaignOpenAt = new Date(String(campaign.open_at || ""));
    if (job.event_type === "campaign_opened" && (Number.isNaN(campaignOpenAt.getTime()) || campaignOpenAt.getTime() > Date.now())) {
      await supabase.from("flash_food_notification_jobs").update({
        status: "pending",
        attempts: Number(job.attempts || 0),
        error_message: "Waiting for the campaign open time",
        updated_at: new Date().toISOString(),
      }).eq("id", job.id);
      continue;
    }
    const pickupLocation = job.event_type === "order_submitted" || job.event_type === "order_updated" || job.event_type === "pickup_location_ready"
      ? String(payload.pickup_location || order?.pickup_location || "")
      : order?.pickup_location || "";
    const pushError = await pushMessage(lineToken, binding.line_user_id, messageFor(job.event_type, campaign, pickupLocation, payload));
    if (pushError) {
      await supabase.from("flash_food_notification_jobs").update({ status: "failed", error_message: pushError, updated_at: new Date().toISOString() }).eq("id", job.id);
      failed += 1;
    } else {
      await supabase.from("flash_food_notification_jobs").update({ status: "sent", error_message: null, sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", job.id);
      sent += 1;
    }
  }

  return json({ sent, skipped, failed, queued: (jobs || []).length });
});
