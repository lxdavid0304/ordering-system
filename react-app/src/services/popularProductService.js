import { adminSupabase, memberSupabase } from "../lib/supabase";

export const POPULAR_PRODUCT_BUCKET = "popular-products";
export const POPULAR_PRODUCT_MAX_FILE_SIZE = 5 * 1024 * 1024;
export const POPULAR_PRODUCT_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PUBLIC_FIELDS =
  "id, product_name, specification, category, unit_price_min, unit_price, cost_price_min, cost_price, shipping_fee_per_unit, image_path, costco_url, is_active, sort_order, updated_at";
const ADMIN_FIELDS = `${PUBLIC_FIELDS}, created_at`;
const LEGACY_PUBLIC_FIELDS =
  "id, product_name, specification, category, unit_price, image_path, is_active, sort_order, updated_at";
const LEGACY_ADMIN_FIELDS = `${LEGACY_PUBLIC_FIELDS}, created_at`;

function isMissingCostcoUrlColumn(error) {
  return Boolean(
    error &&
      (error.code === "PGRST204" || error.code === "42703") &&
      String(error.message || "").includes("costco_url")
  );
}

function isMissingShippingFeeColumn(error) {
  return Boolean(
    error &&
      (error.code === "PGRST204" || error.code === "42703") &&
      String(error.message || "").includes("shipping_fee_per_unit")
  );
}

export function normalizeCostcoUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "www.costco.com.tw") {
      return null;
    }
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function buildImageUrl(client, imagePath) {
  if (!client || !imagePath) {
    return "";
  }
  return client.storage.from(POPULAR_PRODUCT_BUCKET).getPublicUrl(imagePath).data.publicUrl || "";
}

function mapProduct(client, product) {
  return {
    ...product,
    shipping_fee_per_unit:
      product.shipping_fee_per_unit === null || product.shipping_fee_per_unit === undefined
        ? 20
        : Math.max(0, Math.floor(Number(product.shipping_fee_per_unit) || 0)),
    cost_price:
      product.cost_price === null || product.cost_price === undefined
        ? Math.max(0, Math.floor(Number(product.unit_price) || 0))
        : Math.max(0, Math.floor(Number(product.cost_price) || 0)),
    cost_price_min:
      product.cost_price_min === null || product.cost_price_min === undefined
        ? null
        : Math.max(0, Math.floor(Number(product.cost_price_min) || 0)),
    costco_url: product.costco_url || "",
    image_url: buildImageUrl(client, product.image_path),
    display_name: [product.product_name, product.specification].filter(Boolean).join(" "),
  };
}

function mapProducts(client, products) {
  return (products || []).map((product) => mapProduct(client, product));
}

export async function loadActivePopularProducts() {
  if (!memberSupabase) {
    return { data: [], error: null };
  }

  let result = await memberSupabase
    .from("popular_products")
    .select(PUBLIC_FIELDS)
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (isMissingCostcoUrlColumn(result.error) || isMissingShippingFeeColumn(result.error)) {
    result = await memberSupabase
      .from("popular_products")
      .select(LEGACY_PUBLIC_FIELDS)
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });
  }

  if (result.error?.code === "PGRST205") {
    return { data: [], error: null };
  }
  return { data: mapProducts(memberSupabase, result.data), error: result.error };
}

export async function loadAdminPopularProducts() {
  if (!adminSupabase) {
    return { data: [], error: new Error("尚未設定 Supabase。") };
  }

  let result = await adminSupabase
    .from("popular_products")
    .select(ADMIN_FIELDS)
    .order("sort_order", { ascending: true })
    .order("updated_at", { ascending: false });

  if (isMissingCostcoUrlColumn(result.error) || isMissingShippingFeeColumn(result.error)) {
    result = await adminSupabase
      .from("popular_products")
      .select(LEGACY_ADMIN_FIELDS)
      .order("sort_order", { ascending: true })
      .order("updated_at", { ascending: false });
  }

  return { data: mapProducts(adminSupabase, result.data), error: result.error };
}

export async function savePopularProduct(product) {
  if (!adminSupabase) {
    return { data: null, error: new Error("尚未設定 Supabase。") };
  }

  const costcoUrl = normalizeCostcoUrl(product.costco_url);
  if (costcoUrl === null) {
    return { data: null, error: new Error("Costco 連結必須是 https://www.costco.com.tw/ 開頭。") };
  }

  const payload = {
    id: product.id,
    product_name: String(product.product_name || "").trim(),
    specification: String(product.specification || "").trim(),
    category: String(product.category || "其他").trim() || "其他",
    unit_price_min:
      product.unit_price_min === null ||
      product.unit_price_min === undefined ||
      String(product.unit_price_min).trim() === ""
        ? null
        : Math.max(0, Math.floor(Number(product.unit_price_min) || 0)),
    unit_price: Math.max(0, Math.floor(Number(product.unit_price) || 0)),
    cost_price_min:
      product.cost_price_min === null ||
      product.cost_price_min === undefined ||
      String(product.cost_price_min).trim() === ""
        ? null
        : Math.max(0, Math.floor(Number(product.cost_price_min) || 0)),
    cost_price: Math.max(
      0,
      Math.floor(Number(product.cost_price ?? product.unit_price) || 0)
    ),
    shipping_fee_per_unit: Math.max(
      0,
      Math.floor(Number(product.shipping_fee_per_unit ?? 20) || 0)
    ),
    image_path: String(product.image_path || "").trim(),
    costco_url: costcoUrl || null,
    is_active: Boolean(product.is_active),
    sort_order: Math.floor(Number(product.sort_order) || 0),
  };

  if (!payload.id || !payload.product_name || !payload.image_path) {
    return { data: null, error: new Error("商品名稱與圖片不可空白。") };
  }
  if (payload.unit_price_min !== null && payload.unit_price_min > payload.unit_price) {
    return { data: null, error: new Error("最低預估價不可高於最高預估價。") };
  }
  if (payload.cost_price_min !== null && payload.cost_price_min > payload.cost_price) {
    return { data: null, error: new Error("最低成本不可高於最高成本。") };
  }

  const { data, error } = await adminSupabase
    .from("popular_products")
    .upsert(payload, { onConflict: "id" })
    .select(ADMIN_FIELDS)
    .single();

  if (isMissingCostcoUrlColumn(error) || isMissingShippingFeeColumn(error)) {
    return {
      data: null,
      error: new Error("請先執行 popular_product_costco_url migration，再儲存 Costco 連結。"),
    };
  }

  return { data: data ? mapProduct(adminSupabase, data) : null, error };
}

export async function setPopularProductActive(id, isActive) {
  if (!adminSupabase) {
    return { data: null, error: new Error("尚未設定 Supabase。") };
  }

  return adminSupabase
    .from("popular_products")
    .update({ is_active: Boolean(isActive) })
    .eq("id", id)
    .select("id, is_active")
    .single();
}

export async function deletePopularProduct(id) {
  if (!adminSupabase) {
    return { error: new Error("尚未設定 Supabase。") };
  }
  return adminSupabase.from("popular_products").delete().eq("id", id);
}

export async function uploadPopularProductImage(productId, file) {
  if (!adminSupabase) {
    return { data: null, error: new Error("尚未設定 Supabase。") };
  }
  if (!file || !POPULAR_PRODUCT_IMAGE_TYPES.includes(file.type)) {
    return { data: null, error: new Error("圖片僅支援 JPG、PNG 或 WebP。") };
  }
  if (file.size > POPULAR_PRODUCT_MAX_FILE_SIZE) {
    return { data: null, error: new Error("圖片不可超過 5 MB。") };
  }

  const extension = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const uniquePart = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const path = `${productId}/${uniquePart}.${extension}`;
  const { error } = await adminSupabase.storage
    .from(POPULAR_PRODUCT_BUCKET)
    .upload(path, file, { cacheControl: "3600", upsert: false });

  if (error) {
    return { data: null, error };
  }
  return { data: { path, publicUrl: buildImageUrl(adminSupabase, path) }, error: null };
}

export async function deletePopularProductImage(imagePath) {
  if (!adminSupabase || !imagePath) {
    return { error: null };
  }
  return adminSupabase.storage.from(POPULAR_PRODUCT_BUCKET).remove([imagePath]);
}
