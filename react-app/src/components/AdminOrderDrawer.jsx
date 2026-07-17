import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, Clock3, CreditCard, Package, Save, UserRound, X } from "lucide-react";
import {
  loadOrderEvents,
  saveAdminOrderPayment,
  updateAdminOrder,
} from "../services/adminService";
import {
  adminStatusLabels,
  adminStatusOrder,
  getAdminStatusLabel,
  getDepositDue,
  getPaymentStatus,
  paymentMethodLabels,
  paymentStatusLabels,
} from "../utils/adminOrders";
import { formatCurrency, formatDateTime } from "../utils/format";

function getErrorMessage(error) {
  const raw = String(error?.message || "");
  if (raw.includes("DEPOSIT_REQUIRED")) return "訂金尚未達到應收金額。";
  if (raw.includes("PAYMENT_REQUIRED")) return "尾款尚未付清，不能完成訂單。";
  if (raw.includes("STATUS_STEP_REQUIRED")) return "訂單狀態必須依流程逐步更新。";
  if (raw.includes("STATUS_REASON_REQUIRED")) return "回復舊狀態時必須填寫原因。";
  if (raw.includes("FULFILLED_REQUIRED")) return "只有已完成訂單可以封存。";
  if (raw.includes("PAYMENT_EXCEEDS_TOTAL")) return "實收金額不可超過訂單總額。";
  return raw || "更新失敗，請稍後再試。";
}

function EventDescription({ event }) {
  const details = event.details || {};
  if (event.event_type === "status_changed") {
    return (
      <>
        {getAdminStatusLabel(details.from_status)}
        <ChevronRight size={14} aria-hidden="true" />
        {getAdminStatusLabel(details.to_status)}
      </>
    );
  }
  if (event.event_type === "payment_updated") return <>付款資料已更新</>;
  if (event.event_type === "note_updated") return <>內部備註已更新</>;
  return <>訂單資料已更新</>;
}

export default function AdminOrderDrawer({ order, onClose, onUpdated }) {
  const [currentOrder, setCurrentOrder] = useState(order);
  const [events, setEvents] = useState([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [status, setStatus] = useState(order.status);
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState(order.admin_note || "");
  const [depositAmount, setDepositAmount] = useState(order.deposit_paid_amount || 0);
  const [depositMethod, setDepositMethod] = useState(
    order.deposit_payment_method || order.selected_payment_method || "transfer"
  );
  const [balanceAmount, setBalanceAmount] = useState(order.balance_paid_amount || 0);
  const [balanceMethod, setBalanceMethod] = useState(
    order.balance_payment_method || order.selected_payment_method || "cash"
  );
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });

  const totalAmount = Math.max(0, Number(currentOrder.total_amount) || 0);
  const depositDue = getDepositDue(totalAmount);
  const paidAmount =
    Math.max(0, Number(currentOrder.deposit_paid_amount) || 0) +
    Math.max(0, Number(currentOrder.balance_paid_amount) || 0);
  const outstandingAmount = Math.max(0, totalAmount - paidAmount);
  const paymentStatus = getPaymentStatus(currentOrder);
  const currentRank = adminStatusOrder.indexOf(currentOrder.status);
  const selectedRank = adminStatusOrder.indexOf(status);
  const reasonRequired = selectedRank < currentRank || status === "archived";

  const itemQuantity = useMemo(
    () =>
      (currentOrder.order_items || []).reduce(
        (sum, item) => sum + Math.max(1, Number(item.quantity) || 1),
        0
      ),
    [currentOrder.order_items]
  );

  useEffect(() => {
    setCurrentOrder(order);
    setStatus(order.status);
    setAdminNote(order.admin_note || "");
    setDepositAmount(order.deposit_paid_amount || 0);
    setDepositMethod(order.deposit_payment_method || order.selected_payment_method || "transfer");
    setBalanceAmount(order.balance_paid_amount || 0);
    setBalanceMethod(order.balance_payment_method || order.selected_payment_method || "cash");
    setReason("");
    setMessage({ text: "", type: "" });
  }, [order]);

  async function refreshEvents() {
    setEventsLoading(true);
    const { data } = await loadOrderEvents(order.id);
    setEvents(Array.isArray(data) ? data : []);
    setEventsLoading(false);
  }

  useEffect(() => {
    refreshEvents();
  }, [order.id]);

  async function completeUpdate(data, successText) {
    const nextOrder = {
      ...currentOrder,
      ...(data || {}),
      order_items: currentOrder.order_items || [],
    };
    setCurrentOrder(nextOrder);
    setStatus(nextOrder.status);
    setAdminNote(nextOrder.admin_note || "");
    setDepositAmount(nextOrder.deposit_paid_amount || 0);
    setBalanceAmount(nextOrder.balance_paid_amount || 0);
    setReason("");
    setMessage({ text: successText, type: "success" });
    await refreshEvents();
    onUpdated(nextOrder);
  }

  async function handleStatusSave() {
    if (reasonRequired && !reason.trim()) {
      setMessage({ text: "此狀態異動必須填寫原因。", type: "error" });
      return;
    }
    setBusy("status");
    const { data, error } = await updateAdminOrder(
      order.id,
      { status, admin_note: adminNote.trim() },
      reason
    );
    setBusy("");
    if (error) {
      setMessage({ text: getErrorMessage(error), type: "error" });
      return;
    }
    await completeUpdate(data, "訂單狀態已更新。");
  }

  async function handleNoteSave() {
    setBusy("note");
    const { data, error } = await updateAdminOrder(order.id, {
      status: currentOrder.status,
      admin_note: adminNote.trim(),
    });
    setBusy("");
    if (error) {
      setMessage({ text: getErrorMessage(error), type: "error" });
      return;
    }
    await completeUpdate(data, "內部備註已儲存。");
  }

  async function handlePaymentSave(phase) {
    const amount = phase === "deposit" ? depositAmount : balanceAmount;
    const method = phase === "deposit" ? depositMethod : balanceMethod;
    setBusy(phase);
    const { data, error } = await saveAdminOrderPayment(order.id, {
      phase,
      amount,
      method: Number(amount) > 0 ? method : null,
      reviewComplete: true,
    });
    setBusy("");
    if (error) {
      setMessage({ text: getErrorMessage(error), type: "error" });
      return;
    }
    await completeUpdate(data, phase === "deposit" ? "訂金紀錄已更新。" : "尾款紀錄已更新。");
  }

  return (
    <div className="admin-drawer-layer" role="presentation">
      <button type="button" className="admin-drawer-backdrop" aria-label="關閉訂單明細" onClick={onClose} />
      <aside className="admin-order-drawer" aria-label={`訂單 ${order.id} 明細`}>
        <header className="admin-drawer-header">
          <div>
            <span>訂單 #{order.id.slice(0, 8)}</span>
            <h2>{currentOrder.customer_name}</h2>
            <time>{formatDateTime(currentOrder.created_at)}</time>
          </div>
          <button type="button" className="admin-icon-button" title="關閉明細" aria-label="關閉明細" onClick={onClose}>
            <X size={20} />
          </button>
        </header>

        <div className="admin-drawer-scroll">
          <div className="admin-drawer-statuses">
            <span className={`admin-status-badge status-${currentOrder.status}`}>
              {getAdminStatusLabel(currentOrder.status)}
            </span>
            <span className={`admin-payment-badge payment-${paymentStatus}`}>
              {paymentStatusLabels[paymentStatus]}
            </span>
          </div>

          <section className="admin-drawer-section">
            <h3><UserRound size={17} />顧客與配送</h3>
            <dl className="admin-detail-grid">
              <div><dt>姓名</dt><dd>{currentOrder.customer_name}</dd></div>
              <div><dt>電話</dt><dd>{currentOrder.phone}</dd></div>
              <div><dt>交貨地點</dt><dd>{currentOrder.delivery_location}</dd></div>
              <div><dt>商品數量</dt><dd>{itemQuantity} 件</dd></div>
            </dl>
            {currentOrder.note ? <p className="admin-customer-note">顧客備註：{currentOrder.note}</p> : null}
          </section>

          <section className="admin-drawer-section">
            <h3><Package size={17} />商品明細</h3>
            <div className="admin-drawer-items">
              {(currentOrder.order_items || []).map((item, index) => (
                <div key={item.id || `${currentOrder.id}-${index}`}>
                  <div><strong>{item.product_name}</strong><span>{formatCurrency(item.unit_price)} × {item.quantity}</span></div>
                  <strong>{formatCurrency(item.line_total ?? item.unit_price * item.quantity)}</strong>
                </div>
              ))}
            </div>
            <div className="admin-order-total"><span>訂單總額</span><strong>{formatCurrency(totalAmount)}</strong></div>
          </section>

          <section className="admin-drawer-section">
            <h3><CreditCard size={17} />付款紀錄</h3>
            <div className="admin-payment-overview">
              <div><span>應收訂金</span><strong>{formatCurrency(depositDue)}</strong></div>
              <div><span>累計實收</span><strong>{formatCurrency(paidAmount)}</strong></div>
              <div className="outstanding"><span>待收餘額</span><strong>{formatCurrency(outstandingAmount)}</strong></div>
            </div>
            {currentOrder.payment_review_required ? (
              <div className="admin-review-notice">此為改版前訂單，請核對後儲存任一付款欄位完成補登。</div>
            ) : null}
            <PaymentEditor
              label="訂金"
              amount={depositAmount}
              method={depositMethod}
              paidAt={currentOrder.deposit_paid_at}
              busy={busy === "deposit"}
              onAmountChange={setDepositAmount}
              onMethodChange={setDepositMethod}
              onSave={() => handlePaymentSave("deposit")}
            />
            <PaymentEditor
              label="尾款"
              amount={balanceAmount}
              method={balanceMethod}
              paidAt={currentOrder.balance_paid_at}
              busy={busy === "balance"}
              onAmountChange={setBalanceAmount}
              onMethodChange={setBalanceMethod}
              onSave={() => handlePaymentSave("balance")}
            />
          </section>

          <section className="admin-drawer-section">
            <h3><Check size={17} />訂單流程</h3>
            <div className="admin-status-editor">
              <label className="admin-field">
                <span>更新狀態</span>
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  {adminStatusOrder.map((value) => (
                    <option key={value} value={value}>{adminStatusLabels[value]}</option>
                  ))}
                </select>
              </label>
              {reasonRequired ? (
                <label className="admin-field">
                  <span>異動原因</span>
                  <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="請填寫封存或回復原因" />
                </label>
              ) : null}
              <button type="button" className="admin-primary-button" disabled={busy === "status" || status === currentOrder.status} onClick={handleStatusSave}>
                <Check size={16} />{busy === "status" ? "更新中" : "更新狀態"}
              </button>
            </div>
          </section>

          <section className="admin-drawer-section">
            <h3><Save size={17} />內部備註</h3>
            <textarea rows="3" value={adminNote} onChange={(event) => setAdminNote(event.target.value)} placeholder="僅管理者看得到" />
            <button type="button" className="admin-secondary-button" disabled={busy === "note"} onClick={handleNoteSave}>
              <Save size={16} />{busy === "note" ? "儲存中" : "儲存備註"}
            </button>
          </section>

          <section className="admin-drawer-section admin-event-section">
            <h3><Clock3 size={17} />操作歷程</h3>
            {eventsLoading ? <p className="admin-empty-text">載入歷程中...</p> : null}
            {!eventsLoading && !events.length ? <p className="admin-empty-text">尚無操作紀錄。</p> : null}
            <div className="admin-event-list">
              {events.map((event) => (
                <div key={event.id} className="admin-event-item">
                  <span className="admin-event-dot" />
                  <div>
                    <strong><EventDescription event={event} /></strong>
                    {event.details?.reason ? <p>{event.details.reason}</p> : null}
                    <span>{event.actor_email || "系統"} · {formatDateTime(event.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {message.text ? <div className={`admin-drawer-message ${message.type}`}>{message.text}</div> : null}
      </aside>
    </div>
  );
}

function PaymentEditor({ label, amount, method, paidAt, busy, onAmountChange, onMethodChange, onSave }) {
  return (
    <div className="admin-payment-editor">
      <div className="admin-payment-editor-head">
        <strong>{label}</strong>
        <span>{paidAt ? `確認於 ${formatDateTime(paidAt)}` : "尚未確認"}</span>
      </div>
      <div className="admin-payment-editor-controls">
        <label className="admin-field">
          <span>實收金額</span>
          <input type="number" min="0" step="1" value={amount} onChange={(event) => onAmountChange(event.target.value)} />
        </label>
        <label className="admin-field">
          <span>付款方式</span>
          <select value={method} onChange={(event) => onMethodChange(event.target.value)}>
            {Object.entries(paymentMethodLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}
          </select>
        </label>
        <button type="button" className="admin-secondary-button" disabled={busy} onClick={onSave}>
          <Save size={15} />{busy ? "儲存中" : `儲存${label}`}
        </button>
      </div>
    </div>
  );
}
