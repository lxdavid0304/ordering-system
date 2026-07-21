import { useEffect, useMemo, useState } from "react";
import { Bell, Check, ChevronRight, Clock3, CreditCard, Package, ReceiptText, Save, UserRound, X } from "lucide-react";
import {
  loadOrderEvents,
  loadOrderNotificationJobs,
  markAdminOrderReadyForPickup,
  saveAdminOrderPayment,
  updateAdminOrder,
} from "../services/adminService";
import {
  adminStatusLabels,
  adminStatusOrder,
  adminWorkflowStatusOrder,
  getAdminStatusLabel,
  getDepositDue,
  getNextAdminStatus,
  getPaymentStatus,
  paymentMethodLabels,
  paymentStatusLabels,
} from "../utils/adminOrders";
import { formatCurrency, formatDateTime } from "../utils/format";

const priceAdjustmentReasons = [
  "現場價格異動",
  "實際重量或規格異動",
  "商品替代或缺貨調整",
  "優惠或折扣調整",
  "其他價格調整",
];

function getErrorMessage(error) {
  const raw = String(error?.message || "");
  if (raw.includes("FINAL_TOTAL_REQUIRED")) return "請輸入大於 0 的實際總額。";
  if (raw.includes("FINAL_TOTAL_BELOW_PAID")) return "實際總額不能低於已收款項。";
  if (raw.includes("PRICE_ADJUSTMENT_REASON_REQUIRED")) return "調整金額時請填寫原因。";
  if (raw.includes("FINAL_TOTAL_ADJUSTMENT_NOT_ALLOWED")) return "僅能在採買進行中確認實際總額。";
  if (raw.includes("DEPOSIT_REQUIRED")) return "訂金尚未達到應收金額。";
  if (raw.includes("PAYMENT_REQUIRED")) return "款項尚未付清，不能完成訂單。";
  if (raw.includes("STATUS_STEP_REQUIRED")) return "訂單狀態必須依流程逐步更新。";
  if (raw.includes("STATUS_REASON_REQUIRED")) return "回復舊狀態時必須填寫原因。";
  if (raw.includes("FULFILLED_REQUIRED")) return "只有已完成訂單可以封存。";
  if (raw.includes("PAYMENT_EXCEEDS_TOTAL")) return "實收金額不可超過訂單總額。";
  return raw || "更新失敗，請稍後再試。";
}

function EventDescription({ event }) {
  const details = event.details || {};
  if (event.event_type === "price_adjusted") {
    return <>實際總額 {formatCurrency(details.from_total_amount)} <ChevronRight size={14} aria-hidden="true" /> {formatCurrency(details.to_total_amount)}</>;
  }
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
  const [notificationJobs, setNotificationJobs] = useState([]);
  const [notificationJobsError, setNotificationJobsError] = useState("");
  const [notificationQueueTotal, setNotificationQueueTotal] = useState(0);
  const [notificationDiagnostics, setNotificationDiagnostics] = useState({});
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
  const [finalTotalAmount, setFinalTotalAmount] = useState(order.total_amount || 0);
  const [priceAdjustmentReason, setPriceAdjustmentReason] = useState("現場價格異動");
  const [message, setMessage] = useState({ text: "", type: "" });

  const totalAmount = Math.max(0, Number(currentOrder.total_amount) || 0);
  const depositDue = getDepositDue(totalAmount);
  const paidAmount =
    Math.max(0, Number(currentOrder.deposit_paid_amount) || 0) +
    Math.max(0, Number(currentOrder.balance_paid_amount) || 0);
  const outstandingAmount = Math.max(0, totalAmount - paidAmount);
  const finalTotal = Math.max(0, Math.floor(Number(finalTotalAmount) || 0));
  const priceAdjustment = finalTotal - totalAmount;
  const finalOutstandingAmount = Math.max(0, finalTotal - paidAmount);
  const paymentStatus = getPaymentStatus(currentOrder);
  const currentRank = adminStatusOrder.indexOf(currentOrder.status);
  const selectedRank = adminStatusOrder.indexOf(status);
  const reasonRequired = selectedRank < currentRank || status === "archived";
  const statusOptions = currentOrder.status === "archived"
    ? ["archived", ...adminWorkflowStatusOrder]
    : adminWorkflowStatusOrder;
  const nextStatus = getNextAdminStatus(currentOrder.status);
  const canCompleteWithoutPayment = currentOrder.status === "ready_pickup" && outstandingAmount === 0;

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
    setFinalTotalAmount(order.total_amount || 0);
    setPriceAdjustmentReason("現場價格異動");
    setReason("");
    setMessage({ text: "", type: "" });
  }, [order]);

  async function refreshEvents() {
    setEventsLoading(true);
    const [{ data }, notificationResult] = await Promise.all([
      loadOrderEvents(order.id),
      loadOrderNotificationJobs(order.id),
    ]);
    setEvents(Array.isArray(data) ? data : []);
    setNotificationJobs(Array.isArray(notificationResult.data?.jobs) ? notificationResult.data.jobs : []);
    setNotificationQueueTotal(Number(notificationResult.data?.queueTotal || 0));
    setNotificationDiagnostics(notificationResult.data?.diagnostics || {});
    setNotificationJobsError(notificationResult.error ? String(notificationResult.error.message || notificationResult.error) : "");
    setEventsLoading(false);
  }

  useEffect(() => {
    refreshEvents();
  }, [order.id]);

  async function completeUpdate(data, successText, notificationError = null, completionError = null) {
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
    setFinalTotalAmount(nextOrder.total_amount || 0);
    setPriceAdjustmentReason("現場價格異動");
    setReason("");
    setMessage(
      completionError
        ? { text: `${successText} 但自動完成失敗：${getErrorMessage(completionError)}`, type: "warning" }
        : notificationError
          ? { text: `${successText} 但 LINE 通知未送出：${getErrorMessage(notificationError)}`, type: "warning" }
          : { text: successText, type: "success" }
    );
    await refreshEvents();
    onUpdated(nextOrder);
  }

  async function handleStatusSave() {
    if (reasonRequired && !reason.trim()) {
      setMessage({ text: "此狀態異動必須填寫原因。", type: "error" });
      return;
    }
    setBusy("status");
    const { data, error, notificationError } = await updateAdminOrder(
      order.id,
      { status, admin_note: adminNote.trim() },
      reason
    );
    setBusy("");
    if (error) {
      setMessage({ text: getErrorMessage(error), type: "error" });
      return;
    }
    await completeUpdate(data, "訂單狀態已更新。", notificationError);
  }

  async function handleWorkflowAdvance() {
    if (!nextStatus) return;
    if (nextStatus === "fulfilled" && outstandingAmount > 0) {
      setMessage({ text: "請先確認尾款，再完成訂單。", type: "error" });
      return;
    }

    if (nextStatus === "ready_pickup" && priceAdjustment !== 0 && !priceAdjustmentReason.trim()) {
      setMessage({ text: "調整實際總額時請填寫原因。", type: "error" });
      return;
    }

    setBusy("workflow");
    const { data, error, notificationError } = nextStatus === "ready_pickup"
      ? await markAdminOrderReadyForPickup(order.id, finalTotal, priceAdjustmentReason)
      : await updateAdminOrder(order.id, { status: nextStatus, admin_note: adminNote.trim() });
    setBusy("");
    if (error) {
      setMessage({ text: getErrorMessage(error), type: "error" });
      return;
    }
    await completeUpdate(
      data,
      nextStatus === "ready_pickup" ? "商品已買齊，訂單已設為待取貨。" : "款項已付清，訂單已完成。",
      notificationError
    );
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
    const { data, error, notificationError, completionError, autoCompleted } = await saveAdminOrderPayment(order.id, {
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
    await completeUpdate(
      data,
      phase === "deposit"
        ? "訂金紀錄已更新。"
        : autoCompleted
          ? "尾款紀錄已更新，訂單已自動完成。"
          : "尾款紀錄已更新。",
      notificationError,
      completionError
    );
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

          <div className="admin-order-workbench">
            <section className="admin-workflow-panel" aria-label="訂單流程">
              <div className="admin-workflow-panel-head">
                <h3><Check size={17} />訂單流程</h3>
                <span className={`admin-status-badge status-${currentOrder.status}`}>
                  {getAdminStatusLabel(currentOrder.status)}
                </span>
              </div>
              <ol className="admin-workflow-steps">
                {adminWorkflowStatusOrder.map((value, index) => {
                  const stepRank = adminStatusOrder.indexOf(value);
                  const isCurrent = currentOrder.status === value;
                  return (
                    <li key={value} className={isCurrent ? "current" : stepRank < currentRank ? "complete" : ""}>
                      <span>{stepRank < currentRank ? <Check size={13} /> : index + 1}</span>
                      <strong>{adminStatusLabels[value]}</strong>
                    </li>
                  );
                })}
              </ol>
              {currentOrder.status === "pending_deposit" ? <p className="admin-workflow-hint">確認訂金後會自動進入採買。</p> : null}
              {currentOrder.status === "ready_pickup" && outstandingAmount > 0 ? <p className="admin-workflow-hint">確認尾款後會自動完成訂單。</p> : null}
              {nextStatus === "ready_pickup" ? (
                <>
                  <div className="admin-final-total-editor">
                    <div className="admin-final-total-head">
                      <span><ReceiptText size={15} />實際總額</span>
                      <strong>{formatCurrency(finalTotal)}</strong>
                    </div>
                    <label className="admin-field">
                      <span>現場結帳金額</span>
                      <input type="number" min={paidAmount} step="1" value={finalTotalAmount} onChange={(event) => setFinalTotalAmount(event.target.value)} />
                    </label>
                    <div className="admin-final-total-summary">
                      <span>已收訂金 <strong>{formatCurrency(paidAmount)}</strong></span>
                      <span>通知尾款 <strong>{formatCurrency(finalOutstandingAmount)}</strong></span>
                    </div>
                    {priceAdjustment !== 0 ? (
                      <label className="admin-field admin-price-adjustment-reason">
                        <select
                          value={priceAdjustmentReason}
                          onChange={(event) => setPriceAdjustmentReason(event.target.value)}
                          aria-label="價格異動原因"
                        >
                          {priceAdjustmentReasons.map((value) => <option key={value} value={value}>{value}</option>)}
                        </select>
                        <span>金額調整原因</span>
                        <input value={priceAdjustmentReason} onChange={(event) => setPriceAdjustmentReason(event.target.value)} placeholder="例如：現場價格調整" />
                      </label>
                    ) : null}
                  </div>
                <button type="button" className="admin-primary-button admin-workflow-action" disabled={busy === "workflow" || finalTotal < paidAmount} onClick={handleWorkflowAdvance}>
                  <Package size={16} />{busy === "workflow" ? "更新中" : "商品已買齊，設為待取貨"}
                </button>
                </>
              ) : null}
              {canCompleteWithoutPayment ? (
                <button type="button" className="admin-primary-button admin-workflow-action" disabled={busy === "workflow"} onClick={handleWorkflowAdvance}>
                  <Check size={16} />{busy === "workflow" ? "完成中" : "款項已付清，完成訂單"}
                </button>
              ) : null}
              <details className="admin-workflow-correction">
                <summary>修正狀態</summary>
                <div className="admin-status-editor">
                  <label className="admin-field">
                    <span>更新狀態</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value)}>
                      {statusOptions.map((value) => (
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
                  <button type="button" className="admin-secondary-button" disabled={busy === "status" || status === currentOrder.status} onClick={handleStatusSave}>
                    <Save size={15} />{busy === "status" ? "更新中" : "儲存修正"}
                  </button>
                </div>
              </details>
            </section>

            <section className="admin-payment-panel" aria-label="付款紀錄">
              <h3><CreditCard size={17} />付款紀錄</h3>
              <div className="admin-payment-total"><span>訂單總額</span><strong>{formatCurrency(totalAmount)}</strong></div>
              <div className="admin-payment-overview">
                <div><span>應收訂金</span><strong>{formatCurrency(depositDue)}</strong></div>
                <div><span>累計實收</span><strong>{formatCurrency(paidAmount)}</strong></div>
                <div className="outstanding"><span>待收餘額</span><strong>{formatCurrency(outstandingAmount)}</strong></div>
              </div>
              {currentOrder.quoted_total_amount != null ? (
                <div className="admin-price-adjustment-record">
                  <span>原預估 {formatCurrency(currentOrder.quoted_total_amount)}</span>
                  <ChevronRight size={14} aria-hidden="true" />
                  <strong>實際 {formatCurrency(totalAmount)}</strong>
                  <small>目前收益 {formatCurrency(Number(currentOrder.profit_amount || 0))}</small>
                </div>
              ) : null}
              {currentOrder.payment_review_required ? (
                <div className="admin-review-notice">此為改版前訂單，請核對後儲存任一付款欄位完成補登。</div>
              ) : null}
              <PaymentEditor
                label="訂金"
                amount={depositAmount}
                method={depositMethod}
                paidAt={currentOrder.deposit_paid_at}
                busy={busy === "deposit"}
                actionLabel={currentOrder.status === "pending_deposit" ? "確認訂金並開始採買" : "儲存訂金"}
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
                actionLabel={currentOrder.status === "ready_pickup" ? "確認尾款並完成訂單" : "儲存尾款"}
                highlighted={currentOrder.status === "ready_pickup" && outstandingAmount > 0}
                onAmountChange={setBalanceAmount}
                onMethodChange={setBalanceMethod}
                onSave={() => handlePaymentSave("balance")}
              />
            </section>
          </div>

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

          <section className="admin-drawer-section admin-notification-section">
            <h3><Bell size={17} />LINE 通知</h3>
            <p className="admin-empty-text">通知佇列：{notificationQueueTotal} 筆</p>
            {notificationJobsError ? <p className="admin-notification-error">{notificationJobsError}</p> : null}
            {!notificationJobs.length ? <p className="admin-empty-text">尚無通知紀錄</p> : null}
            <div className="admin-notification-list">
              {notificationJobs.map((job) => (
                <div key={job.id} className={`admin-notification-job ${job.status}`}>
                  <div><strong>{job.status === "sent" ? "已送出" : job.status === "failed" ? "傳送失敗" : job.status === "processing" ? "傳送中" : job.status === "skipped" ? "略過" : "等待傳送"}</strong><span>第 {job.attempts} 次</span></div>
                  <time>{formatDateTime(job.sent_at || job.updated_at || job.created_at)}</time>
                  {job.error_message ? <p>{job.error_message}</p> : null}
                </div>
              ))}
            </div>
            <details className="admin-notification-diagnostics">
              <summary>系統診斷</summary>
              <pre>{JSON.stringify(notificationDiagnostics, null, 2)}</pre>
            </details>
          </section>
        </div>

        {message.text ? <div className={`admin-drawer-message ${message.type}`}>{message.text}</div> : null}
      </aside>
    </div>
  );
}

function PaymentEditor({ label, amount, method, paidAt, busy, actionLabel, highlighted = false, onAmountChange, onMethodChange, onSave }) {
  return (
    <div className={`admin-payment-editor${highlighted ? " highlighted" : ""}`}>
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
        <button
          type="button"
          className={highlighted ? "admin-primary-button" : "admin-secondary-button"}
          aria-label={actionLabel}
          title={actionLabel}
          disabled={busy}
          onClick={onSave}
        >
          <Save size={15} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
