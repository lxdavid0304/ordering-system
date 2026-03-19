export const CASH_THRESHOLD = 300;
export const SHIPPING_FEE_PER_ITEM = 20;

export function createUuid() {
  if (crypto?.randomUUID) {
    return crypto.randomUUID();
  }

  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20
  )}-${hex.slice(20)}`;
}

export function createEmptyOrderItem() {
  return {
    id: createUuid(),
    product_name: "",
    unit_price: 0,
    quantity: 1,
  };
}

export function normalizeAmount(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) {
    return 0;
  }
  return Math.max(0, Math.floor(amount));
}

export function normalizeOrderItem(item) {
  const productName = String(item?.product_name || "").trim();
  if (!productName) {
    return null;
  }
  return {
    product_name: productName,
    unit_price: normalizeAmount(item?.unit_price),
    quantity: Math.max(1, Math.floor(Number(item?.quantity) || 1)),
  };
}

export function normalizeOrderPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const items = Array.isArray(payload.order_items)
    ? payload.order_items.map((item) => normalizeOrderItem(item)).filter(Boolean)
    : [];

  return {
    delivery_location: String(payload.delivery_location || "").trim(),
    note: String(payload.note || ""),
    order_items: items,
  };
}

export function calculateItemsTotal(items) {
  if (!Array.isArray(items)) {
    return 0;
  }
  return items.reduce((sum, item) => {
    const price = normalizeAmount(item?.unit_price);
    const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    return sum + price * qty;
  }, 0);
}

export function calculateItemsQuantity(items) {
  if (!Array.isArray(items)) {
    return 0;
  }
  return items.reduce((sum, item) => {
    const qty = Math.max(1, Math.floor(Number(item?.quantity) || 1));
    return sum + qty;
  }, 0);
}

export function calculateShippingAmount(items) {
  return calculateItemsQuantity(items) * SHIPPING_FEE_PER_ITEM;
}

export function calculateOrderAmounts(items) {
  const itemsTotal = calculateItemsTotal(items);
  const shippingAmount = calculateShippingAmount(items);
  const finalTotalAmount = itemsTotal + shippingAmount;
  const needsDeposit = isTransferRequired(finalTotalAmount);
  const depositAmount = needsDeposit ? calculateDepositAmount(finalTotalAmount) : 0;
  const remainingAmount = Math.max(0, finalTotalAmount - depositAmount);

  return {
    itemsTotal,
    shippingAmount,
    finalTotalAmount,
    needsDeposit,
    depositAmount,
    remainingAmount,
  };
}

export function normalizeProductName(name) {
  return String(name || "").trim().toLowerCase();
}

export function buildLastPriceMap(orders) {
  const map = {};
  const sortedOrders = [...(orders || [])].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  sortedOrders.forEach((order) => {
    (order.order_items || []).forEach((item) => {
      const key = normalizeProductName(item.product_name);
      if (!key || Object.prototype.hasOwnProperty.call(map, key)) {
        return;
      }
      map[key] = normalizeAmount(item.unit_price);
    });
  });

  return map;
}

export function calculateDepositAmount(totalAmount) {
  return Math.ceil(normalizeAmount(totalAmount) * 0.5);
}

export function isTransferRequired(totalAmount) {
  return normalizeAmount(totalAmount) > CASH_THRESHOLD;
}

export function getMethodLabel(method) {
  if (method === "cash") {
    return "現金付款";
  }
  if (method === "transfer") {
    return "轉帳付款";
  }
  return "未選擇";
}

export function getMemberOrderStatusLabel(status) {
  if (status === "pending_deposit") {
    return "待確認訂金";
  }
  if (status === "open") {
    return "進行中";
  }
  if (status === "fulfilled" || status === "archived") {
    return "已完成";
  }
  return "進行中";
}

export function isOngoingOrderStatus(status) {
  return status === "pending_deposit" || status === "open";
}

export function isCompletedOrderStatus(status) {
  return status === "fulfilled" || status === "archived";
}
