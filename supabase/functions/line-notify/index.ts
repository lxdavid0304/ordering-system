import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const statusLabels: Record<string, string> = {
  pending_deposit: "待確認訂金",
  open: "採買進行中",
  ready_pickup: "待取貨",
  fulfilled: "已完成",
  archived: "歷史紀錄",
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// A failed delivery must remain recoverable. The prior limit of three attempts
// left jobs marked "pending" but permanently excluded from processing.
const MAX_DELIVERY_ATTEMPTS = 8;
const STALE_PROCESSING_MS = 30 * 1000;
const RETRY_DELAYS_MS = [15 * 1000, 30 * 1000, 60 * 1000, 2 * 60 * 1000, 5 * 60 * 1000];
const knownStatuses = new Set(Object.keys(statusLabels));

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function toAmount(value: unknown, fallback = 0) {
  if (value === null || value === undefined || value === "") {
    return Math.max(0, Math.floor(fallback));
  }
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : Math.max(0, Math.floor(fallback));
}

function isRetryDue(value: unknown, now: number) {
  if (!value) return true;
  const timestamp = new Date(String(value)).getTime();
  return Number.isNaN(timestamp) || timestamp <= now;
}

function retryAt(attempts: number) {
  const delay = RETRY_DELAYS_MS[Math.max(0, Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1))];
  return new Date(Date.now() + delay).toISOString();
}

function readPayload(value: unknown) {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function getPayloadStatus(value: unknown) {
  const payload = readPayload(value);
  return typeof payload.to_status === "string" ? payload.to_status : "";
}

function formatOrderProducts(items: Array<{ product_name?: unknown; quantity?: unknown }>) {
  return items
    .map((item) => {
      const name = String(item.product_name || "").trim();
      const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
      return name ? `${name} × ${quantity}` : "";
    })
    .filter(Boolean)
    .join("、");
}

async function ensureRequestedStatusJob(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  requestedStatus: string
) {
  if (!orderId || !requestedStatus) return;

  const { data: existingJobs, error: existingJobsError } = await supabase
    .from("line_notification_jobs")
    .select("id, status, attempts, payload")
    .eq("order_id", orderId)
    .eq("event_type", "order_status_changed");
  if (existingJobsError) return;

  const hasUsableStatusJob = (existingJobs || []).some((job) => {
    if (getPayloadStatus(job.payload) !== requestedStatus) return false;
    if (job.status === "sent" || job.status === "processing") return true;
    return (job.status === "pending" || job.status === "failed")
      && Number(job.attempts || 0) < MAX_DELIVERY_ATTEMPTS;
  });
  if (hasUsableStatusJob) return;

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, user_id, delivery_location, total_amount, quoted_total_amount, status, deposit_paid_amount, balance_paid_amount"
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order || !order.user_id || order.status !== requestedStatus) return;

  await supabase.from("line_notification_jobs").insert({
    order_id: order.id,
    user_id: order.user_id,
    event_type: "order_status_changed",
    payload: {
      from_status: null,
      to_status: requestedStatus,
      delivery_location: order.delivery_location ?? null,
      total_amount: order.total_amount ?? null,
      quoted_total_amount: order.quoted_total_amount ?? null,
      deposit_paid_amount: order.deposit_paid_amount ?? 0,
      balance_paid_amount: order.balance_paid_amount ?? 0,
      price_adjusted: order.quoted_total_amount != null
        && Number(order.quoted_total_amount) !== Number(order.total_amount),
    },
  });
}

async function isAdmin(supabase: ReturnType<typeof createClient>, token: string) {
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return false;
  const { data } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  return Boolean(data);
}

async function pushMessage(token: string, to: string, text: string) {
  try {
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
      signal: AbortSignal.timeout(3500),
    });
    if (response.ok) return null;
    return `${response.status} ${await response.text()}`.slice(0, 500);
  } catch (error) {
    return `LINE network error: ${error instanceof Error ? error.message : String(error)}`.slice(0, 500);
  }
}

async function deliverMessage(token: string, to: string, text: string) {
  return pushMessage(token, to, text);
}

serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const workerToken = request.headers.get("x-notification-worker-token") || "";
  const apiKey = request.headers.get("apikey") || "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const expectedWorkerToken = Deno.env.get("LINE_NOTIFICATION_WORKER_TOKEN");
  const isNotificationWorker = Boolean(
    expectedWorkerToken && workerToken && workerToken === expectedWorkerToken
  ) || Boolean(serviceKey && apiKey && apiKey === serviceKey);
  if (!token && !isNotificationWorker) return jsonResponse({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !serviceKey || !lineToken) return jsonResponse({ error: "Server not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  if (!isNotificationWorker && !(await isAdmin(supabase, token))) {
    return jsonResponse({ error: "Admin required" }, 403);
  }

  const { error: retrySchemaError } = await supabase
    .from("line_notification_jobs")
    .select("next_attempt_at")
    .limit(1);
  const supportsRetrySchema = !retrySchemaError;

  let requestedOrderId = "";
  let requestedStatus = "";
  try {
    const body = await request.json();
    requestedOrderId = typeof body?.order_id === "string" ? body.order_id : "";
    const targetStatus = typeof body?.target_status === "string" ? body.target_status : "";
    requestedStatus = knownStatuses.has(targetStatus) ? targetStatus : "";
  } catch {
    // Empty body processes all queued notifications.
  }

  const now = Date.now();
  if (supportsRetrySchema) {
    const staleBefore = new Date(now - STALE_PROCESSING_MS).toISOString();
    let staleJobsQuery = supabase
      .from("line_notification_jobs")
      .update({
        status: "pending",
        claim_token: null,
        processing_started_at: null,
        next_attempt_at: new Date(now).toISOString(),
        updated_at: new Date(now).toISOString(),
      })
      .eq("status", "processing")
      .or(`processing_started_at.is.null,processing_started_at.lt.${staleBefore}`);
    if (requestedOrderId) staleJobsQuery = staleJobsQuery.eq("order_id", requestedOrderId);
    await staleJobsQuery;
  }

  await ensureRequestedStatusJob(supabase, requestedOrderId, requestedStatus);

  if (requestedOrderId && requestedStatus) {
    const { data: supersededJobs } = await supabase
      .from("line_notification_jobs")
      .select("id, payload")
      .eq("order_id", requestedOrderId)
      .in("status", ["pending", "failed", "processing"]);
    const supersededIds = (supersededJobs || [])
      .filter((job) => {
        const queuedStatus = getPayloadStatus(job.payload);
        return queuedStatus && queuedStatus !== requestedStatus;
      })
      .map((job) => job.id);
    if (supersededIds.length) {
      await supabase
        .from("line_notification_jobs")
        .update({
          status: "skipped",
          error_message: `Superseded by ${requestedStatus} notification`,
          ...(supportsRetrySchema
            ? { claim_token: null, processing_started_at: null, next_attempt_at: null }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .in("id", supersededIds);
    }
  }

  let jobsQuery = supabase
    .from("line_notification_jobs")
    .select(
      supportsRetrySchema
        ? "id, order_id, user_id, attempts, payload, status, created_at, next_attempt_at"
        : "id, order_id, user_id, attempts, payload, status, created_at"
    )
    .in("status", ["pending", "failed"])
    .order("created_at", { ascending: true })
    .limit(5);
  if (requestedOrderId) jobsQuery = jobsQuery.eq("order_id", requestedOrderId);
  const { data: queuedJobs, error: jobsError } = await jobsQuery;
  if (jobsError) return jsonResponse({ error: "Notification queue unavailable" }, 500);
  const jobs = (queuedJobs || [])
    .filter(
      (job) =>
        Number(job.attempts || 0) < MAX_DELIVERY_ATTEMPTS &&
        (!requestedStatus || getPayloadStatus(job.payload) === requestedStatus) &&
        (job.status === "pending" || !supportsRetrySchema || isRetryDue(job.next_attempt_at, now))
    )
    .slice(0, 5);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of jobs || []) {
    // An explicit status request is the latest state chosen by the admin.
    // Earlier notifications were superseded above, so they must not hold back
    // the current update even if an old worker invocation is still finishing.
    if (!requestedStatus) {
      const { data: earlierJobs } = await supabase
        .from("line_notification_jobs")
        .select("id, attempts")
        .eq("order_id", job.order_id)
        .in("status", ["pending", "processing", "failed"])
        .lt("created_at", String(job.created_at))
        .limit(1);
      if ((earlierJobs || []).some((earlierJob) => Number(earlierJob.attempts || 0) < MAX_DELIVERY_ATTEMPTS)) {
        continue;
      }
    }

    const claimToken = crypto.randomUUID();
    const claimedAt = new Date().toISOString();
    let claimQuery = supabase
      .from("line_notification_jobs")
      .update({
        status: "processing",
        attempts: Number(job.attempts || 0) + 1,
        ...(supportsRetrySchema
          ? { claim_token: claimToken, processing_started_at: claimedAt }
          : {}),
        updated_at: claimedAt,
      })
      .eq("id", job.id)
      .eq("status", job.status);
    if (supportsRetrySchema) claimQuery = claimQuery.is("claim_token", null);
    const { data: claimed } = await claimQuery.select("id").maybeSingle();
    if (!claimed) continue;

    const [{ data: binding }, { data: order }] = await Promise.all([
      supabase
        .from("member_line_bindings")
        .select("line_user_id, notifications_enabled, blocked_at")
        .eq("user_id", job.user_id)
        .maybeSingle(),
      supabase
        .from("orders")
        .select(
          "id, created_at, delivery_location, total_amount, quoted_total_amount, status, deposit_paid_amount, balance_paid_amount, order_items(product_name, quantity)"
        )
        .eq("id", job.order_id)
        .maybeSingle(),
    ]);

    if (!binding || !binding.notifications_enabled || binding.blocked_at || !order) {
      await supabase
        .from("line_notification_jobs")
        .update({
          status: "skipped",
          error_message: "LINE notification is unavailable",
          ...(supportsRetrySchema
            ? { claim_token: null, processing_started_at: null, next_attempt_at: null }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      skipped += 1;
      continue;
    }

    const notificationPayload = readPayload(job.payload);
    const queuedStatus = notificationPayload.to_status;
    const notificationStatus =
      typeof queuedStatus === "string" ? queuedStatus : String(order.status);
    const productText = formatOrderProducts(
      Array.isArray(order.order_items) ? order.order_items : []
    );
    const totalAmount = toAmount(notificationPayload.total_amount, Number(order.total_amount) || 0);
    const hasQuotedSnapshot = Object.prototype.hasOwnProperty.call(notificationPayload, "quoted_total_amount");
    const quotedValue = hasQuotedSnapshot ? notificationPayload.quoted_total_amount : order.quoted_total_amount;
    const quotedTotalAmount = quotedValue == null
      ? null
      : toAmount(quotedValue);
    const depositAmount = toAmount(notificationPayload.deposit_paid_amount, Number(order.deposit_paid_amount) || 0);
    const paidBalanceAmount = toAmount(notificationPayload.balance_paid_amount, Number(order.balance_paid_amount) || 0);
    const deliveryLocation = String(notificationPayload.delivery_location || order.delivery_location || "");
    const balanceAmount = Math.max(
      0,
      totalAmount - depositAmount - paidBalanceAmount
    );
    const priceChangeLine = notificationStatus === "ready_pickup"
      && (notificationPayload.price_adjusted === true || (quotedTotalAmount !== null && quotedTotalAmount !== totalAmount))
      ? `價格異動：原訂單金額 ${formatCurrency(quotedTotalAmount)} 元，實際總額 ${formatCurrency(totalAmount)} 元`
      : null;
    const totalLine = `訂單金額：${formatCurrency(totalAmount)} 元`;
    const depositLine = `訂金金額：${formatCurrency(depositAmount)} 元`;
    const balanceLine = `尾款金額：${formatCurrency(balanceAmount)} 元`;
    const statusLines =
      notificationStatus === "pending_deposit"
        ? [
            productText ? `商品：${productText}` : null,
            `交貨地點：${deliveryLocation || "未指定"}`,
            totalLine,
          ]
        : notificationStatus === "open"
          ? totalAmount < 300
            ? [
                productText ? `購買商品：${productText}` : null,
                `交貨地點：${deliveryLocation || "未指定"}`,
                totalLine,
                depositLine,
              ]
            : [totalLine, depositLine]
          : notificationStatus === "ready_pickup"
            ? [
                priceChangeLine,
                `交貨地點：${deliveryLocation || "未指定"}`,
                totalLine,
                balanceLine,
              ]
            : [`交貨地點：${deliveryLocation || "未指定"}`, totalLine];
    const text = [
      "【代購訂單狀態更新】",
      `訂單 #${String(order.id).slice(0, 8)}`,
      `目前狀態：${statusLabels[notificationStatus] || "處理中"}`,
      ...statusLines.filter(Boolean),
    ].join("\n");
    const pushError = await deliverMessage(lineToken, binding.line_user_id, text);
    if (pushError) {
      const attempts = Number(job.attempts || 0) + 1;
      const canRetry = attempts < MAX_DELIVERY_ATTEMPTS;
      await supabase
        .from("line_notification_jobs")
        .update({
          status: "failed",
          error_message: pushError,
          ...(supportsRetrySchema
            ? {
                claim_token: null,
                processing_started_at: null,
                next_attempt_at: canRetry ? retryAt(attempts) : null,
              }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      failed += 1;
    } else {
      await supabase
        .from("line_notification_jobs")
        .update({
          status: "sent",
          error_message: null,
          ...(supportsRetrySchema
            ? { claim_token: null, processing_started_at: null, next_attempt_at: null }
            : {}),
          sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", job.id);
      sent += 1;
    }
  }

  return jsonResponse({ sent, skipped, failed, queued: (jobs || []).length });
});
