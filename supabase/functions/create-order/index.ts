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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value
  );
}

type CleanedItem = {
  product_name: string;
  unit_price: number;
  quantity: number;
  catalog_product_id?: string;
};

type CatalogProduct = {
  id: string;
  product_name: string;
  specification: string;
  category: string;
  unit_price_min: number | null;
  unit_price: number;
  cost_price: number;
  shipping_fee_per_unit: number;
  is_active: boolean;
};

function mapCatalogProduct(product: CatalogProduct) {
  const displayName = [product.product_name, product.specification].filter(Boolean).join(" ");
  return {
    id: product.id,
    product_name: product.product_name,
    specification: product.specification,
    category: product.category,
    unit_price_min: product.unit_price_min,
    unit_price: product.unit_price,
    shipping_fee_per_unit: product.shipping_fee_per_unit,
    display_name: displayName,
  };
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

async function queueInitialStatusNotification(
  supabase: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  orderId: string,
  userId: string,
  status: unknown
) {
  const { data: orderSnapshot, error: orderSnapshotError } = await supabase
    .from("orders")
    .select("delivery_location, total_amount, quoted_total_amount, deposit_paid_amount, balance_paid_amount")
    .eq("id", orderId)
    .maybeSingle();
  if (orderSnapshotError || !orderSnapshot) {
    console.error("Unable to load created order for LINE notification", orderSnapshotError);
    return;
  }

  const { data: existingJobs, error: existingJobError } = await supabase
    .from("line_notification_jobs")
    .select("id, status, payload")
    .eq("order_id", orderId)
    .eq("event_type", "order_status_changed");

  if (existingJobError) {
    console.error("Unable to check LINE notification queue", existingJobError);
    return;
  }

  // Older database fallback logic could enqueue an insert-time snapshot before
  // create_order had calculated the real total. Never send that zero-value draft.
  const zeroValueJobs = (existingJobs || []).filter((job) => {
    const payload = job.payload && typeof job.payload === "object"
      ? job.payload as Record<string, unknown>
      : {};
    return Number(orderSnapshot.total_amount) > 0
      && Object.prototype.hasOwnProperty.call(payload, "total_amount")
      && Number(payload.total_amount) === 0
      && job.status !== "sent";
  });
  if (zeroValueJobs.length) {
    await supabase
      .from("line_notification_jobs")
      .update({
        status: "skipped",
        error_message: "Superseded zero-value order draft",
        claim_token: null,
        processing_started_at: null,
        next_attempt_at: null,
        updated_at: new Date().toISOString(),
      })
      .in("id", zeroValueJobs.map((job) => job.id));
  }

  const existingJob = (existingJobs || []).find((job) => !zeroValueJobs.some((zeroJob) => zeroJob.id === job.id));
  if (!existingJob) {
    const { error: queueError } = await supabase.from("line_notification_jobs").insert({
      order_id: orderId,
      user_id: userId,
      event_type: "order_status_changed",
      payload: {
        from_status: null,
        to_status: String(status || "pending_deposit"),
        delivery_location: orderSnapshot?.delivery_location ?? null,
        total_amount: orderSnapshot?.total_amount ?? null,
        quoted_total_amount: orderSnapshot?.quoted_total_amount ?? null,
        deposit_paid_amount: orderSnapshot?.deposit_paid_amount ?? 0,
        balance_paid_amount: orderSnapshot?.balance_paid_amount ?? 0,
        price_adjusted: false,
      },
    });
    if (queueError) {
      console.error("Unable to queue initial LINE notification", queueError);
      return;
    }
  }

  const workerToken = Deno.env.get("LINE_NOTIFICATION_WORKER_TOKEN");
  if (!workerToken) {
    console.error("LINE_NOTIFICATION_WORKER_TOKEN is not configured");
    return;
  }

  try {
    const response = await fetch(`${supabaseUrl}/functions/v1/line-notify`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
        "x-notification-worker-token": workerToken,
      },
      body: JSON.stringify({ order_id: orderId, target_status: String(status || "pending_deposit") }),
    });
    if (!response.ok) {
      console.error("Unable to deliver initial LINE notification", await response.text());
    }
  } catch (error) {
    console.error("Unable to reach LINE notification worker", error);
  }
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
  const paymentMethod = sanitizeText(payload?.payment_method, 20);

  if (!deliveryLocation || !deviceId || !idempotencyKey || !paymentMethod) {
    return jsonResponse({ error: "Missing required fields" }, 400);
  }

  if (paymentMethod !== "cash" && paymentMethod !== "transfer") {
    return jsonResponse({ error: "Invalid payment method" }, 400);
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

  const cleanedItems: CleanedItem[] = [];
  for (const item of items) {
    const name = sanitizeText((item as Record<string, unknown>)?.product_name, 100);
    const unitPrice = Number((item as Record<string, unknown>)?.unit_price);
    const quantity = Number((item as Record<string, unknown>)?.quantity);
    const catalogProductId = sanitizeText(
      (item as Record<string, unknown>)?.catalog_product_id,
      64
    );

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
      ...(catalogProductId ? { catalog_product_id: catalogProductId } : {}),
    });
  }

  if (cleanedItems.length === 0) {
    return jsonResponse({ error: "Items required" }, 400);
  }

  const catalogItems = cleanedItems.filter((item) => item.catalog_product_id);
  const invalidCatalogIds = catalogItems
    .map((item) => item.catalog_product_id || "")
    .filter((id) => !isUuid(id));
  if (invalidCatalogIds.length) {
    return jsonResponse(
      {
        code: "CATALOG_UNAVAILABLE",
        error: "Catalog product unavailable",
        product_ids: invalidCatalogIds,
      },
      409
    );
  }

  const catalogIds = Array.from(
    new Set(catalogItems.map((item) => item.catalog_product_id).filter(Boolean))
  ) as string[];

  const catalogMap = new Map<string, CatalogProduct>();
  if (catalogIds.length) {
    const { data: catalogData, error: catalogError } = await supabase
      .from("popular_products")
      .select("id, product_name, specification, category, unit_price_min, unit_price, cost_price, shipping_fee_per_unit, is_active")
      .in("id", catalogIds);

    if (catalogError) {
      return jsonResponse({ error: "Catalog validation failed" }, 500);
    }

    ((catalogData || []) as CatalogProduct[]).forEach((product) => {
      catalogMap.set(product.id, product);
    });
    const unavailableIds = catalogIds.filter((id) => !catalogMap.get(id)?.is_active);
    if (unavailableIds.length) {
      return jsonResponse(
        {
          code: "CATALOG_UNAVAILABLE",
          error: "Catalog product unavailable",
          product_ids: unavailableIds,
        },
        409
      );
    }

    const changedProducts = catalogItems
      .filter((item) => {
        const product = catalogMap.get(item.catalog_product_id || "");
        return product && item.unit_price !== Number(product.unit_price);
      })
      .map((item) => mapCatalogProduct(catalogMap.get(item.catalog_product_id || "")!));

    if (changedProducts.length) {
      return jsonResponse(
        {
          code: "CATALOG_PRICE_CHANGED",
          error: "Catalog price changed",
          items: changedProducts,
        },
        409
      );
    }
  }

  const requestedTotal = cleanedItems.reduce((sum, item) => {
    const catalogProduct = item.catalog_product_id
      ? catalogMap.get(item.catalog_product_id)
      : null;
    const shippingFeePerUnit = catalogProduct ? 0 : 20;
    return sum + item.unit_price * item.quantity + item.quantity * shippingFeePerUnit;
  }, 0);
  if (requestedTotal > 300 && paymentMethod !== "transfer") {
    return jsonResponse({ error: "Transfer payment is required for this order" }, 400);
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
    const message = String(orderError.message || "");
    if (message.includes("CATALOG_PRICE_CHANGED") || message.includes("CATALOG_UNAVAILABLE")) {
      const { data: latestCatalog } = catalogIds.length
        ? await supabase
            .from("popular_products")
            .select("id, product_name, specification, category, unit_price_min, unit_price, cost_price, shipping_fee_per_unit, is_active")
            .in("id", catalogIds)
        : { data: [] };
      const latestMap = new Map(
        ((latestCatalog || []) as CatalogProduct[]).map((product) => [product.id, product])
      );
      const unavailableIds = catalogIds.filter((id) => !latestMap.get(id)?.is_active);
      if (unavailableIds.length || message.includes("CATALOG_UNAVAILABLE")) {
        return jsonResponse(
          {
            code: "CATALOG_UNAVAILABLE",
            error: "Catalog product unavailable",
            product_ids: unavailableIds.length ? unavailableIds : catalogIds,
          },
          409
        );
      }
      return jsonResponse(
        {
          code: "CATALOG_PRICE_CHANGED",
          error: "Catalog price changed",
          items: ((latestCatalog || []) as CatalogProduct[])
            .filter((product) => product.is_active)
            .map(mapCatalogProduct),
        },
        409
      );
    }
    return jsonResponse({ error: "Failed to create order" }, 500);
  }

  const { data: savedOrder, error: savedOrderError } = await supabase
    .from("orders")
    .select(
      "id, total_amount, shipping_amount, status, order_items(product_name, unit_price, quantity, line_total, catalog_product_id, shipping_fee_per_unit)"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (savedOrderError || !savedOrder) {
    return jsonResponse({ error: "Order created but could not be reloaded" }, 500);
  }

  const { error: paymentMethodError } = await supabase
    .from("orders")
    .update({
      selected_payment_method: paymentMethod,
      payment_selected_at: new Date().toISOString(),
    })
    .eq("id", savedOrder.id)
    .eq("user_id", userId);
  if (paymentMethodError) {
    return jsonResponse({ error: "Order created but payment method could not be saved" }, 500);
  }

  await queueInitialStatusNotification(
    supabase,
    supabaseUrl,
    serviceKey,
    savedOrder.id,
    userId,
    savedOrder.status
  );

  const acceptedItems = Array.isArray(savedOrder.order_items) ? savedOrder.order_items : [];
  const itemsTotal = acceptedItems.reduce(
    (sum, item) => sum + Number(item.line_total || 0),
    0
  );
  const shippingAmount = Number(savedOrder.shipping_amount || 0);

  return jsonResponse(
    {
      order_id: savedOrder.id,
      items_total: itemsTotal,
      shipping_amount: shippingAmount,
      total_amount: Number(savedOrder.total_amount || 0),
      status: savedOrder.status,
      order_items: acceptedItems,
    },
    200
  );
});
