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

  if (catalogIds.length) {
    const { data: catalogData, error: catalogError } = await supabase
      .from("popular_products")
      .select("id, product_name, specification, category, unit_price_min, unit_price, is_active")
      .in("id", catalogIds);

    if (catalogError) {
      return jsonResponse({ error: "Catalog validation failed" }, 500);
    }

    const catalogMap = new Map(
      ((catalogData || []) as CatalogProduct[]).map((product) => [product.id, product])
    );
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
            .select("id, product_name, specification, category, unit_price_min, unit_price, is_active")
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
      "id, total_amount, status, order_items(product_name, unit_price, quantity, line_total)"
    )
    .eq("id", orderId)
    .maybeSingle();

  if (savedOrderError || !savedOrder) {
    return jsonResponse({ error: "Order created but could not be reloaded" }, 500);
  }

  const acceptedItems = Array.isArray(savedOrder.order_items) ? savedOrder.order_items : [];
  const itemsTotal = acceptedItems.reduce(
    (sum, item) => sum + Number(item.line_total || 0),
    0
  );
  const shippingAmount = acceptedItems.reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity) || 1) * 20,
    0
  );

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
