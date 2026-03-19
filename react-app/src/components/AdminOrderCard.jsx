import { useEffect, useState } from "react";
import { formatCurrency, formatDateTime } from "../utils/format";
import { calculateDepositAmount, CASH_THRESHOLD, isTransferRequired } from "../utils/orders";

export default function AdminOrderCard({
  order,
  selected,
  statusLabels,
  onSelectedChange,
  onSave,
}) {
  const [status, setStatus] = useState(order.status || "open");
  const [adminNote, setAdminNote] = useState(order.admin_note || "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setStatus(order.status || "open");
    setAdminNote(order.admin_note || "");
    setMessage("");
  }, [order.id, order.status, order.admin_note]);

  const totalAmount = Math.max(0, Math.floor(Number(order.total_amount || 0)));
  const needsDeposit = isTransferRequired(totalAmount);
  const depositAmount = needsDeposit ? calculateDepositAmount(totalAmount) : 0;
  const remainingAmount = Math.max(0, totalAmount - depositAmount);
  const paymentSummary = needsDeposit
    ? `轉帳訂金 ${formatCurrency(depositAmount)}`
    : `現金（${CASH_THRESHOLD} 以下）`;

  async function handleSave(mode) {
    setBusy(true);
    setMessage("儲存中...");

    const payload =
      mode === "confirm-deposit"
        ? {
            status: "open",
            admin_note: adminNote.trim() || "已確認訂金",
          }
        : {
            status,
            admin_note: adminNote.trim(),
          };

    if (mode === "confirm-deposit") {
      setStatus("open");
      setAdminNote(payload.admin_note);
    }

    const result = await onSave(order.id, payload, mode);
    setBusy(false);
    setMessage(result.message);
  }

  return (
    <div className="order-card">
      <label className="order-check">
        <input
          type="checkbox"
          className="order-select"
          checked={selected}
          onChange={(event) => onSelectedChange(order.id, event.target.checked)}
        />
      </label>
      <div>
        <div className="order-meta">
          <span>姓名：{order.customer_name}</span>
          <span>電話：{order.phone}</span>
          <span>地點：{order.delivery_location || "未分類"}</span>
          <span>時間：{formatDateTime(order.created_at)}</span>
          <span>狀態：{statusLabels[order.status] || statusLabels.open}</span>
          <span>付款：{paymentSummary}</span>
          <span>訂金：{formatCurrency(depositAmount)}</span>
          <span>總額：{formatCurrency(totalAmount)}</span>
          <span>剩餘金額：{formatCurrency(remainingAmount)}</span>
        </div>
        <div className="order-items">
          {(order.order_items || []).map((item) => (
            <div key={`${order.id}-${item.product_name}-${item.quantity}-${item.unit_price}`}>
              {item.product_name} × {item.quantity}（{formatCurrency(item.unit_price)}）
            </div>
          ))}
        </div>
        {order.note ? <div className="order-items">備註：{order.note}</div> : null}
      </div>
      <div className="order-admin" data-order-id={order.id}>
        <label className="field">
          <span>狀態</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {Object.entries(statusLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>後台備註</span>
          <textarea
            rows="2"
            placeholder="可填內部備註"
            value={adminNote}
            onChange={(event) => setAdminNote(event.target.value)}
          />
        </label>
        <div className="order-admin-actions">
          <button type="button" className="ghost" disabled={busy} onClick={() => handleSave("save")}>
            儲存
          </button>
          {needsDeposit && status === "pending_deposit" ? (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => handleSave("confirm-deposit")}
            >
              確認訂金
            </button>
          ) : null}
          <span className="muted">{message}</span>
        </div>
      </div>
    </div>
  );
}
