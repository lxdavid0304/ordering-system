import { adminSupabase, memberSupabase } from "../lib/supabase";

function missingClient() {
  return { data: null, error: new Error("尚未設定 Supabase 連線資訊") };
}

const campaignSelect = `
  id, title, open_at, deadline_at, purchase_at, pickup_location, pickup_ready_at,
  pickup_start_at, pickup_end_at, note, status, shipping_fee_per_unit,
  created_at, updated_at,
  flash_food_campaign_items (
    id, product_name, item_note, unit_price, sort_order, is_active
  )
`;

function sortCampaignItems(campaign) {
  return {
    ...campaign,
    flash_food_campaign_items: [...(campaign.flash_food_campaign_items || [])].sort(
      (left, right) => Number(left.sort_order) - Number(right.sort_order)
    ),
  };
}

export async function loadMemberFlashFoodCampaigns(userId) {
  if (!memberSupabase || !userId) return { data: [], error: null };

  const [campaignsResult, ordersResult] = await Promise.all([
    memberSupabase.from("flash_food_campaigns").select(campaignSelect).order("open_at", { ascending: true }),
    memberSupabase
      .from("flash_food_orders")
      .select("id, campaign_id, pickup_location, note, subtotal_amount, shipping_amount, total_amount, status, created_at, flash_food_order_items(*)")
      .eq("user_id", userId),
  ]);

  const error = campaignsResult.error || ordersResult.error;
  if (error) return { data: [], error };

  const orderByCampaign = new Map((ordersResult.data || []).map((order) => [order.campaign_id, order]));
  return {
    data: (campaignsResult.data || []).map((campaign) => ({
      ...sortCampaignItems(campaign),
      member_order: orderByCampaign.get(campaign.id) || null,
    })),
    error: null,
  };
}

export async function loadAdminFlashFoodCampaigns() {
  if (!adminSupabase) return missingClient();

  const { data, error } = await adminSupabase
    .from("flash_food_campaigns")
    .select(`${campaignSelect}, flash_food_orders (
      id, status, total_amount, subtotal_amount, shipping_amount, customer_name, phone, pickup_location, note, created_at,
      flash_food_order_items (id, product_name, item_note, unit_price, shipping_fee_per_unit, quantity, total_amount)
    )`)
    .order("created_at", { ascending: false });

  return { data: (data || []).map(sortCampaignItems), error };
}

export async function createFlashFoodCampaign(payload) {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_create_flash_food_campaign", {
    p_title: payload.title,
    p_open_at: payload.open_at,
    p_deadline_at: payload.deadline_at,
    p_purchase_at: payload.purchase_at,
    p_pickup_location: payload.pickup_location,
    p_pickup_start_at: payload.pickup_start_at,
    p_pickup_end_at: payload.pickup_end_at,
    p_note: payload.note || "",
    p_items: payload.items,
  });
  if (result.error || !result.data) return result;
  const notification = await adminSupabase.functions.invoke("flash-food-notify", {
    body: { campaign_id: result.data, event_type: "campaign_opened" },
  });
  return { ...result, notificationError: notification.error || (Number(notification.data?.failed || 0) > 0 ? new Error("LINE 通知部分發送失敗") : null) };
}

export async function updateFlashFoodCampaign(payload) {
  if (!adminSupabase) return missingClient();
  return adminSupabase.rpc("admin_update_flash_food_campaign", {
    p_campaign_id: payload.id,
    p_title: payload.title,
    p_open_at: payload.open_at,
    p_deadline_at: payload.deadline_at,
    p_purchase_at: payload.purchase_at,
    p_pickup_start_at: payload.pickup_start_at,
    p_pickup_end_at: payload.pickup_end_at,
    p_note: payload.note || "",
  });
}

export async function markFlashFoodCampaignReady(campaignId, pickupReadyAt) {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_mark_flash_food_campaign_ready", {
    p_campaign_id: campaignId,
    p_pickup_ready_at: pickupReadyAt,
  });
  if (result.error) return result;
  const notification = await adminSupabase.functions.invoke("flash-food-notify", {
    body: { campaign_id: campaignId, event_type: "campaign_ready" },
  });
  return { ...result, notificationError: notification.error || (Number(notification.data?.failed || 0) > 0 ? new Error("LINE 通知部分發送失敗") : null) };
}

export async function resendFlashFoodReadyNotification(campaignId) {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_requeue_flash_food_ready_notification", {
    p_campaign_id: campaignId,
  });
  if (result.error) return result;
  const notification = await adminSupabase.functions.invoke("flash-food-notify", {
    body: { campaign_id: campaignId, event_type: "campaign_ready" },
  });
  return { ...result, notificationError: notification.error || (Number(notification.data?.failed || 0) > 0 ? new Error("LINE 通知部分發送失敗") : null) };
}

export async function cancelFlashFoodCampaign(campaignId, reason = "") {
  if (!adminSupabase) return missingClient();
  const result = await adminSupabase.rpc("admin_cancel_flash_food_campaign", {
    p_campaign_id: campaignId,
    p_reason: reason || null,
  });
  if (result.error) return result;
  const notification = await adminSupabase.functions.invoke("flash-food-notify", {
    body: { campaign_id: campaignId, event_type: "campaign_cancelled" },
  });
  return { ...result, notificationError: notification.error || (Number(notification.data?.failed || 0) > 0 ? new Error("LINE 通知部分發送失敗") : null) };
}

export async function saveMemberFlashFoodOrder(campaignId, pickupLocation, items, note = "") {
  if (!memberSupabase) return missingClient();
  const result = await memberSupabase.rpc("member_save_flash_food_order", {
    p_campaign_id: campaignId,
    p_pickup_location: pickupLocation,
    p_note: note || "",
    p_items: items,
  });
  if (result.error || !result.data) return result;
  const notification = await memberSupabase.functions.invoke("flash-food-notify", {
    body: { campaign_id: campaignId, member_order_notification: true },
  });
  return { ...result, notificationError: notification.error || (Number(notification.data?.failed || 0) > 0 ? new Error("LINE 通知部分發送失敗") : null) };
}
