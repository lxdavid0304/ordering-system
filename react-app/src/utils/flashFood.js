export const FLASH_FOOD_SHIPPING_FEE = 20;
export const FLASH_FOOD_MEMBER_PICKUP_LOCATION = "會員點餐時選擇";
export const flashFoodPickupLocations = ["明德樓", "據德樓", "蘊德樓", "機車停車場"];

export const flashFoodMenu = [
  { product_name: "熱狗堡＋飲料", unit_price: 50, category: "熱食", icon: "🌭", tone: "orange" },
  { product_name: "牛肉捲／海鮮捲", unit_price: 99, category: "熱食", icon: "🌯", tone: "coral" },
  { product_name: "蒜辣薄皮脆雞桶", unit_price: 289, category: "熱食", icon: "🍗", tone: "amber" },
  { product_name: "台式滷肉飯", unit_price: 99, category: "飯食", icon: "🍚", tone: "plum" },
  { product_name: "日式關東煮", unit_price: 99, category: "熱食", icon: "🍢", tone: "rose" },
  { product_name: "披薩（單片）", unit_price: 60, item_note: "請在點餐備註填寫口味", category: "披薩", icon: "🍕", tone: "tomato" },
  { product_name: "披薩（整盒 18 吋）", unit_price: 300, item_note: "請在點餐備註填寫口味", category: "披薩", icon: "🍕", tone: "tomato" },
  { product_name: "蛤蜊巧達湯", unit_price: 69, category: "熱湯", icon: "🥣", tone: "cream" },
  { product_name: "凱撒雞肉沙拉", unit_price: 189, category: "輕食", icon: "🥗", tone: "green" },
  { product_name: "美式咖啡", unit_price: 40, category: "飲品", icon: "☕", tone: "coffee" },
  { product_name: "拿鐵", unit_price: 50, category: "飲品", icon: "🥛", tone: "latte" },
  { product_name: "汽水", unit_price: 20, category: "飲品", icon: "🥤", tone: "blue" },
];

export function getFlashFoodProductMeta(productName) {
  const matched = flashFoodMenu.find((item) => item.product_name === productName);
  return matched || { category: "快閃熱食", icon: "🍽️", tone: "orange" };
}

export function getFlashFoodCampaignState(campaign, now = new Date()) {
  if (!campaign || campaign.status === "cancelled") return "cancelled";
  if (campaign.pickup_ready_at) return "ready";
  const current = now.getTime();
  const openAt = new Date(campaign.open_at).getTime();
  const deadlineAt = new Date(campaign.deadline_at).getTime();
  if (Number.isNaN(openAt) || Number.isNaN(deadlineAt)) return "scheduled";
  if (current < openAt) return "scheduled";
  if (current >= deadlineAt) return "locked";
  return "open";
}

export function getFlashFoodCampaignStateLabel(state) {
  return {
    scheduled: "即將開團",
    open: "開放點餐",
    ready: "已可取餐",
    locked: "已截止",
    cancelled: "已取消",
  }[state] || "未定義";
}

export function calculateFlashFoodAmounts(items, quantities, shippingFee = FLASH_FOOD_SHIPPING_FEE) {
  const amounts = (items || []).reduce(
    (total, item) => {
      const quantity = Math.max(0, Math.floor(Number(quantities?.[item.id]) || 0));
      const unitPrice = Math.max(0, Math.floor(Number(item.unit_price) || 0));
      total.quantity += quantity;
      total.subtotal += unitPrice * quantity;
      total.shipping += shippingFee * quantity;
      return total;
    },
    { quantity: 0, subtotal: 0, shipping: 0, total: 0 }
  );
  return { ...amounts, total: amounts.subtotal + amounts.shipping };
}

export function withFlashFoodTotal(amounts) {
  return { ...amounts, total: amounts.subtotal + amounts.shipping };
}

export function toDateTimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function formatFlashFoodDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "待確認";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}/${part("month")}/${part("day")} ${part("hour")}:${part("minute")}`;
}
