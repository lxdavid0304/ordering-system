import { memberSupabase } from "../lib/supabase";

export async function loadFavoriteItems(userId) {
  if (!memberSupabase || !userId) {
    return { data: [], error: null };
  }

  return memberSupabase
    .from("favorite_items")
    .select("id, product_name, unit_price, note, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
}

export async function saveFavoriteItem(userId, favorite) {
  if (!memberSupabase || !userId) {
    return { data: null, error: new Error("請先設定 config.js") };
  }

  const payload = {
    user_id: userId,
    product_name: String(favorite?.product_name || "").trim(),
    unit_price: Math.max(0, Math.floor(Number(favorite?.unit_price) || 0)),
    note: String(favorite?.note || "").trim() || null,
    updated_at: new Date().toISOString(),
  };

  if (!payload.product_name) {
    return { data: null, error: new Error("請輸入商品名稱。") };
  }

  return memberSupabase
    .from("favorite_items")
    .upsert(payload, { onConflict: "user_id,product_name" })
    .select("id, product_name, unit_price, note, created_at, updated_at")
    .maybeSingle();
}

export async function deleteFavoriteItem(id) {
  if (!memberSupabase || !id) {
    return { error: new Error("請先設定 config.js") };
  }

  return memberSupabase.from("favorite_items").delete().eq("id", id);
}
