export const adminStatusLabels = {
  pending_deposit: "待確認訂金",
  open: "進行中",
  ready_pickup: "待取貨",
  fulfilled: "已完成",
  archived: "歷史紀錄",
};

export const adminStatusOrder = [
  "pending_deposit",
  "open",
  "ready_pickup",
  "fulfilled",
  "archived",
];

export const paymentStatusLabels = {
  needs_review: "待補登",
  unpaid: "未付款",
  deposit_paid: "已付訂金",
  paid: "已付清",
};

export const paymentMethodLabels = {
  cash: "現金",
  transfer: "轉帳",
};

export function getAdminStatusLabel(status) {
  return adminStatusLabels[status] || "進行中";
}

export function getPaymentStatus(order) {
  if (order?.payment_review_required) return "needs_review";
  const total = Math.max(0, Number(order?.total_amount) || 0);
  const paid = Math.max(0, Number(order?.deposit_paid_amount) || 0) +
    Math.max(0, Number(order?.balance_paid_amount) || 0);
  if (paid >= total) return "paid";
  if (paid > 0) return "deposit_paid";
  return "unpaid";
}

export function getNextAdminStatus(status) {
  const index = adminStatusOrder.indexOf(status);
  return index >= 0 && index < adminStatusOrder.length - 1 ? adminStatusOrder[index + 1] : null;
}

export function getDepositDue(totalAmount) {
  const total = Math.max(0, Number(totalAmount) || 0);
  return total > 300 ? Math.ceil(total * 0.5) : 0;
}
