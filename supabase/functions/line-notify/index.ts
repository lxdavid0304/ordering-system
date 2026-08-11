import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
const requestedNotificationTypes = new Set(["deposit_confirmed", "price_adjusted"]);
const deliverableNotificationTypes = [
  "order_created",
  "deposit_confirmed",
  "price_adjusted",
  "delivery_location_ready",
];
const deliveryLocations = new Set(["明德樓", "據德樓", "蘊德樓", "機車停車場"]);
const activeDeliveryStatuses = ["ready_pickup"];
const DELIVERY_NOTIFICATION_LIMIT = 50;

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function formatCurrency(value: unknown) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function formatPickupDateTime(value: unknown) {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return "時間待確認";
  return new Intl.DateTimeFormat("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
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

function formatOrderStatus(value: unknown) {
  const status = String(value || "");
  if (status === "pending_deposit") return "待確認訂金";
  if (status === "open") return "採買進行中";
  return "訂單處理中";
}

function formatOrderItems(value: unknown) {
  if (!Array.isArray(value)) return "商品明細請見訂單";
  const items = value
    .map((item) => {
      const record = readPayload(item);
      const productName = String(record.product_name || "").trim();
      const quantity = Math.max(1, Math.floor(Number(record.quantity || 0)));
      return productName ? `${productName} × ${quantity}` : "";
    })
    .filter(Boolean);
  return items.length ? items.join("、") : "商品明細請見訂單";
}

async function ensureRequestedOrderNotificationJob(
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  notificationType: string
) {
  if (!orderId || !requestedNotificationTypes.has(notificationType)) {
    return { alreadyNotified: false, error: null };
  }

  const eventType = notificationType === "deposit_confirmed"
    ? "deposit_confirmed"
    : "price_adjusted";
  const { data: order } = await supabase
    .from("orders")
    .select("id, user_id, total_amount, quoted_total_amount, status, deposit_paid_amount, balance_paid_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (!order?.user_id) return { alreadyNotified: false, error: "Order not found or has no member" };

  const totalAmount = toAmount(order.total_amount);
  const depositAmount = toAmount(order.deposit_paid_amount);
  const balancePaidAmount = toAmount(order.balance_paid_amount);
  const quotedTotalAmount = order.quoted_total_amount == null
    ? null
    : toAmount(order.quoted_total_amount);
  const depositDue = totalAmount > 300 ? Math.ceil(totalAmount * 0.5) : 0;
  const canNotify = notificationType === "deposit_confirmed"
    ? order.status === "open" && depositAmount + balancePaidAmount >= depositDue
    : order.status === "ready_pickup"
      && quotedTotalAmount !== null
      && quotedTotalAmount !== totalAmount;
  if (!canNotify) {
    return { alreadyNotified: false, error: "This notification is not available for the current order state" };
  }

  const { data: existingJobs } = await supabase
    .from("line_notification_jobs")
    .select("id, status, payload")
    .eq("order_id", orderId)
    .eq("event_type", eventType);
  const hasSameSnapshot = (existingJobs || []).some((job) => {
    if (job.status === "skipped") return false;
    const payload = readPayload(job.payload);
    if (notificationType === "deposit_confirmed") return true;
    return toAmount(payload.total_amount) === totalAmount
      && toAmount(payload.quoted_total_amount) === quotedTotalAmount
      && toAmount(payload.deposit_paid_amount) === depositAmount;
  });
  if (hasSameSnapshot) return { alreadyNotified: true, error: null };

  const { error: insertError } = await supabase.from("line_notification_jobs").insert({
    order_id: order.id,
    user_id: order.user_id,
    event_type: eventType,
    payload: {
      total_amount: totalAmount,
      quoted_total_amount: quotedTotalAmount,
      deposit_paid_amount: depositAmount,
      balance_paid_amount: balancePaidAmount,
    },
  });
  if (insertError) {
    return { alreadyNotified: false, error: insertError.message || "Notification queue is unavailable" };
  }
  return { alreadyNotified: false, error: null };
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
  let requestedNotificationType = "";
  let requestedDeliveryLocation = "";
  let requestedPickupAt = "";
  try {
    const body = await request.json();
    requestedOrderId = typeof body?.order_id === "string" ? body.order_id : "";
    const notificationType = typeof body?.notification_type === "string" ? body.notification_type : "";
    requestedNotificationType = requestedNotificationTypes.has(notificationType) ? notificationType : "";
    requestedDeliveryLocation = typeof body?.delivery_location === "string" ? body.delivery_location.trim() : "";
    requestedPickupAt = typeof body?.pickup_at === "string" ? body.pickup_at : "";
  } catch {
    // Empty body processes all queued notifications.
  }

  const requestedDeliveryNotification = Boolean(requestedDeliveryLocation || requestedPickupAt);
  if (requestedDeliveryNotification) {
    if (!deliveryLocations.has(requestedDeliveryLocation)) {
      return jsonResponse({ error: "Invalid delivery location" }, 400);
    }
    if (Number.isNaN(new Date(requestedPickupAt).getTime())) {
      return jsonResponse({ error: "Invalid pickup time" }, 400);
    }
  }

  const now = Date.now();
  // `order_status_changed` remains a permitted historical value so existing
  // sent rows stay auditable, but it is never a member-facing event again.
  let legacyJobsQuery = supabase
    .from("line_notification_jobs")
    .update({
      status: "skipped",
      error_message: "Legacy status notifications are disabled",
      ...(supportsRetrySchema
        ? { claim_token: null, processing_started_at: null, next_attempt_at: null }
        : {}),
      updated_at: new Date(now).toISOString(),
    })
    .eq("event_type", "order_status_changed")
    .in("status", ["pending", "failed", "processing"]);
  if (requestedOrderId) legacyJobsQuery = legacyJobsQuery.eq("order_id", requestedOrderId);
  await legacyJobsQuery;

  let deliveryNotificationBatchId = "";
  let deliveryNotificationRecipients = 0;
  if (requestedDeliveryNotification) {
    const { data: activeOrders, error: activeOrdersError } = await supabase
      .from("orders")
      .select("id, user_id, created_at, total_amount, quoted_total_amount, deposit_paid_amount, balance_paid_amount")
      .eq("delivery_location", requestedDeliveryLocation)
      .in("status", activeDeliveryStatuses)
      .not("user_id", "is", null)
      .order("created_at", { ascending: false });
    if (activeOrdersError) return jsonResponse({ error: "Delivery recipients are unavailable" }, 500);

    const recipientOrders = new Map<string, {
      id: string;
      user_id: string;
      total_amount: number;
      deposit_paid_amount: number;
      outstanding_amount: number;
      price_adjusted: boolean;
    }>();
    for (const order of activeOrders || []) {
      if (typeof order.user_id !== "string" || !order.user_id) continue;
      const totalAmount = toAmount(order.total_amount);
      const depositAmount = toAmount(order.deposit_paid_amount);
      const outstandingAmount = Math.max(
        0,
        totalAmount - depositAmount - toAmount(order.balance_paid_amount)
      );
      const priceAdjusted = order.quoted_total_amount != null
        && toAmount(order.quoted_total_amount) !== totalAmount;
      const existingOrder = recipientOrders.get(order.user_id);
      if (existingOrder) {
        existingOrder.total_amount += totalAmount;
        existingOrder.deposit_paid_amount += depositAmount;
        existingOrder.outstanding_amount += outstandingAmount;
        existingOrder.price_adjusted = existingOrder.price_adjusted || priceAdjusted;
        continue;
      }
      recipientOrders.set(order.user_id, {
        id: String(order.id),
        user_id: order.user_id,
        total_amount: totalAmount,
        deposit_paid_amount: depositAmount,
        outstanding_amount: outstandingAmount,
        price_adjusted: priceAdjusted,
      });
    }
    if (!recipientOrders.size) {
      return jsonResponse({ sent: 0, skipped: 0, failed: 0, queued: 0, recipients: 0 });
    }

    const { data: deliveryBatch, error: deliveryBatchError } = await supabase
      .from("delivery_location_notification_batches")
      .insert({
        delivery_location: requestedDeliveryLocation,
        pickup_at: new Date(requestedPickupAt).toISOString(),
        recipient_count: recipientOrders.size,
        created_by: (await supabase.auth.getUser(token)).data.user?.id,
      })
      .select("id")
      .single();
    if (deliveryBatchError || !deliveryBatch?.id) {
      return jsonResponse({ error: "This delivery notification has already been created" }, 409);
    }
    deliveryNotificationBatchId = String(deliveryBatch.id);
    deliveryNotificationRecipients = recipientOrders.size;

    const { error: deliveryJobsError } = await supabase.from("line_notification_jobs").insert(
      Array.from(recipientOrders.values()).map((order) => ({
        order_id: order.id,
        user_id: order.user_id,
        event_type: "delivery_location_ready",
        delivery_notification_batch_id: deliveryNotificationBatchId,
        payload: {
          delivery_location: requestedDeliveryLocation,
          pickup_at: new Date(requestedPickupAt).toISOString(),
          total_amount: order.total_amount,
          deposit_paid_amount: order.deposit_paid_amount,
          outstanding_amount: order.outstanding_amount,
          price_adjusted: order.price_adjusted,
        },
      }))
    );
    if (deliveryJobsError) {
      await supabase.from("delivery_location_notification_batches").delete().eq("id", deliveryNotificationBatchId);
      return jsonResponse({ error: "Delivery notification queue is unavailable" }, 500);
    }
  }

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

  let requestedNotificationAlreadyExists = false;
  if (requestedNotificationType) {
    const result = await ensureRequestedOrderNotificationJob(
      supabase,
      requestedOrderId,
      requestedNotificationType
    );
    if (result.error) return jsonResponse({ error: result.error }, 500);
    requestedNotificationAlreadyExists = result.alreadyNotified;
  }

  let jobsQuery = supabase
    .from("line_notification_jobs")
    .select(
      supportsRetrySchema
        ? "id, order_id, user_id, event_type, delivery_notification_batch_id, attempts, payload, status, created_at, next_attempt_at"
        : "id, order_id, user_id, event_type, delivery_notification_batch_id, attempts, payload, status, created_at"
    )
    .in("status", ["pending", "failed"])
    .in("event_type", deliverableNotificationTypes)
    .order("created_at", { ascending: true });
  if (requestedOrderId) jobsQuery = jobsQuery.eq("order_id", requestedOrderId);
  if (deliveryNotificationBatchId) {
    jobsQuery = jobsQuery
      .eq("delivery_notification_batch_id", deliveryNotificationBatchId)
      .limit(DELIVERY_NOTIFICATION_LIMIT);
  } else {
    jobsQuery = jobsQuery.limit(5);
  }
  const { data: queuedJobs, error: jobsError } = await jobsQuery;
  if (jobsError) return jsonResponse({ error: "Notification queue unavailable" }, 500);
  const jobs = (queuedJobs || [])
    .filter(
      (job) =>
        Number(job.attempts || 0) < MAX_DELIVERY_ATTEMPTS &&
        (!requestedNotificationType || job.event_type === requestedNotificationType) &&
        (job.status === "pending" || !supportsRetrySchema || isRetryDue(job.next_attempt_at, now))
    )
    .slice(0, deliveryNotificationBatchId ? DELIVERY_NOTIFICATION_LIMIT : 5);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const job of jobs || []) {
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
    const { data: deliveryBatch } = job.event_type === "delivery_location_ready"
      ? await supabase
        .from("delivery_location_notification_batches")
        .select("delivery_location, pickup_at")
        .eq("id", job.delivery_notification_batch_id)
        .maybeSingle()
      : { data: null };

    if (
      !binding ||
      !binding.notifications_enabled ||
      binding.blocked_at ||
      !order ||
      (job.event_type === "delivery_location_ready" && !deliveryBatch)
    ) {
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
    const text = job.event_type === "order_created"
      ? [
        "【代購訂單狀態更新】",
        `訂單 #${String(job.order_id).slice(0, 8)}`,
        `目前狀態：${formatOrderStatus(notificationPayload.target_status)}`,
        `商品：${formatOrderItems(notificationPayload.items)}`,
        `交貨地點：${String(notificationPayload.delivery_location || "未指定")}`,
        `訂單金額：${formatCurrency(toAmount(notificationPayload.total_amount))} 元`,
      ].join("\n")
      : job.event_type === "delivery_location_ready"
      ? [
        "【交貨通知】",
        `交貨地點：${String(deliveryBatch?.delivery_location || "未指定")}`,
        `交貨時間：${formatPickupDateTime(deliveryBatch?.pickup_at)}`,
        notificationPayload.price_adjusted === true
          ? `調整後訂單總額：${formatCurrency(toAmount(notificationPayload.total_amount, Number(order.total_amount) || 0))} 元`
          : null,
        notificationPayload.price_adjusted === true
          ? `訂金金額：${formatCurrency(toAmount(notificationPayload.deposit_paid_amount, Number(order.deposit_paid_amount) || 0))} 元`
          : null,
        `尾款金額：${formatCurrency(toAmount(notificationPayload.outstanding_amount, Math.max(0, Number(order.total_amount || 0) - Number(order.deposit_paid_amount || 0) - Number(order.balance_paid_amount || 0))))} 元`,
        "商品已完成採買，請依時間前往取貨。",
      ].filter(Boolean).join("\n")
      : job.event_type === "deposit_confirmed"
        ? [
          "【訂金確認】",
          `訂單 #${String(order.id).slice(0, 8)}`,
          `訂單總額：${formatCurrency(toAmount(notificationPayload.total_amount, Number(order.total_amount) || 0))} 元`,
          `訂金金額：${formatCurrency(toAmount(notificationPayload.deposit_paid_amount, Number(order.deposit_paid_amount) || 0))} 元`,
        ].join("\n")
        : job.event_type === "price_adjusted"
          ? [
            "【代購訂單金額更正】",
            `訂單 #${String(order.id).slice(0, 8)}`,
            `原訂單總額：${formatCurrency(toAmount(notificationPayload.quoted_total_amount))} 元`,
            `更正後訂單總額：${formatCurrency(toAmount(notificationPayload.total_amount, Number(order.total_amount) || 0))} 元`,
            `訂金金額：${formatCurrency(toAmount(notificationPayload.deposit_paid_amount, Number(order.deposit_paid_amount) || 0))} 元`,
          ].join("\n")
          : "";
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

  return jsonResponse({
    sent,
    skipped,
    failed,
    queued: (jobs || []).length,
    recipients: deliveryNotificationRecipients,
    delivery_notification_batch_id: deliveryNotificationBatchId || null,
    already_notified: requestedNotificationAlreadyExists,
  });
});
