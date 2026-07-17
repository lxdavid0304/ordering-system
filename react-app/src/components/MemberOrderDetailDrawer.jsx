import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { CreditCard, FileText, MapPin, Package, X } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { formatCurrency, formatDateTime } from "../utils/format";
import { getMemberOrderStatusLabel } from "../utils/orders";

function getTotalQuantity(order) {
  return (order?.order_items || []).reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity) || 1),
    0
  );
}

export default function MemberOrderDetailDrawer({ order, onClose }) {
  const titleId = useId();
  const closeButtonRef = useRef(null);

  useEffect(() => {
    if (!order) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = document.activeElement;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose, order]);

  if (!order) {
    return null;
  }

  const items = order.order_items || [];
  const totalAmount = Math.max(0, Number(order.total_amount) || 0);
  const paidAmount = Math.max(0, Number(order.deposit_paid_amount) || 0)
    + Math.max(0, Number(order.balance_paid_amount) || 0);
  const remainingAmount = Math.max(0, totalAmount - paidAmount);

  return createPortal(
    <div
      className="member-order-drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <aside
        className="member-order-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="member-order-drawer-head">
          <div>
            <span>訂單明細</span>
            <h2 id={titleId}>訂單 #{String(order.id).slice(0, 8)}</h2>
            <time>{formatDateTime(order.created_at)}</time>
          </div>
          <button ref={closeButtonRef} type="button" className="member-order-drawer-close" onClick={onClose} title="關閉明細" aria-label="關閉明細">
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="member-order-drawer-status">
          <StatusBadge kind={`member-${order.status}`}>
            {getMemberOrderStatusLabel(order.status)}
          </StatusBadge>
          <span>完整訂單編號：{order.id}</span>
        </div>

        <section className="member-order-drawer-facts" aria-label="交貨資訊">
          <div>
            <MapPin size={17} aria-hidden="true" />
            <span>交貨地點</span>
            <strong>{order.delivery_location || "未指定"}</strong>
          </div>
          <div>
            <Package size={17} aria-hidden="true" />
            <span>商品數量</span>
            <strong>{getTotalQuantity(order)} 件</strong>
          </div>
        </section>

        <section className="member-order-drawer-money" aria-label="付款摘要">
          <div><span>訂單總額</span><strong>{formatCurrency(totalAmount)}</strong></div>
          <div><span>已付款</span><strong>{formatCurrency(paidAmount)}</strong></div>
          <div><span>待付款</span><strong>{formatCurrency(remainingAmount)}</strong></div>
        </section>

        <section className="member-order-drawer-section">
          <h3><Package size={17} aria-hidden="true" />商品明細</h3>
          <div className="member-order-drawer-items">
            {items.map((item, index) => {
              const unitPrice = Math.max(0, Number(item.unit_price) || 0);
              const quantity = Math.max(1, Number(item.quantity) || 1);
              return (
                <div key={`${order.id}-drawer-${index}`} className="member-order-drawer-item">
                  <div>
                    <strong>{item.product_name}</strong>
                    <span>{formatCurrency(unitPrice)} × {quantity}</span>
                  </div>
                  <strong>{formatCurrency(unitPrice * quantity)}</strong>
                </div>
              );
            })}
          </div>
        </section>

        <section className="member-order-drawer-section">
          <h3><CreditCard size={17} aria-hidden="true" />付款狀態</h3>
          <p>{remainingAmount > 0 ? `尚有 ${formatCurrency(remainingAmount)} 元待付款。` : "款項已付清。"}</p>
        </section>

        {order.note ? (
          <section className="member-order-drawer-section member-order-drawer-note">
            <h3><FileText size={17} aria-hidden="true" />訂單備註</h3>
            <p>{order.note}</p>
          </section>
        ) : null}
      </aside>
    </div>,
    document.body
  );
}
