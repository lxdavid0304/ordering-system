import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { FileText, MapPin, Package, RotateCcw, X } from "lucide-react";
import StatusBadge from "./StatusBadge";
import { formatCurrency, formatDateTime } from "../utils/format";
import { getMemberOrderStatusLabel } from "../utils/orders";

function getTotalQuantity(order) {
  return (order?.order_items || []).reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity) || 1),
    0
  );
}

export default function HistoryOrderDetailDrawer({
  order,
  selecting,
  selectedIndexes,
  onClose,
  onStartSelecting,
  onCancelSelecting,
  onToggleItem,
  onToggleAll,
  onReorder,
}) {
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
  const selectedCount = selectedIndexes.length;
  const allSelected = Boolean(items.length) && selectedCount === items.length;

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
        className="member-order-drawer history-order-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <header className="member-order-drawer-head">
          <div>
            <span>歷史訂單明細</span>
            <h2 id={titleId}>訂單 #{String(order.id).slice(0, 8)}</h2>
            <time>{formatDateTime(order.created_at)}</time>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="member-order-drawer-close"
            onClick={onClose}
            title="關閉明細"
            aria-label="關閉明細"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>

        <div className="member-order-drawer-status">
          <StatusBadge kind={`member-${order.status}`}>
            {getMemberOrderStatusLabel(order.status)}
          </StatusBadge>
          <span>完整訂單編號：{order.id}</span>
        </div>

        <section className="member-order-drawer-facts" aria-label="訂單摘要">
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

        <section className="history-drawer-total" aria-label="訂單總額">
          <span>訂單總額</span>
          <strong>{formatCurrency(order.total_amount)}</strong>
        </section>

        <section className="member-order-drawer-section">
          <div className="history-drawer-section-head">
            <h3><Package size={17} aria-hidden="true" />商品明細</h3>
            {selecting ? <span>已選 {selectedCount} 項</span> : null}
          </div>

          {selecting ? (
            <div className="history-drawer-selection-tools">
              <button type="button" className="member-auth-text-btn" onClick={onToggleAll}>
                {allSelected ? "取消全選" : "全選"}
              </button>
              <button type="button" className="member-auth-text-btn" onClick={onCancelSelecting}>
                取消挑選
              </button>
            </div>
          ) : null}

          <div className="member-order-drawer-items">
            {items.map((item, index) => {
              const unitPrice = Math.max(0, Number(item.unit_price) || 0);
              const quantity = Math.max(1, Number(item.quantity) || 1);
              const selected = selectedIndexes.includes(index);

              return (
                <label
                  key={`${order.id}-history-drawer-${index}`}
                  className={`history-drawer-item${selecting ? " selectable" : ""}${
                    selected ? " selected" : ""
                  }`}
                >
                  {selecting ? (
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => onToggleItem(index)}
                    />
                  ) : null}
                  <span>
                    <strong>{item.product_name}</strong>
                    <small>{formatCurrency(unitPrice)} × {quantity}</small>
                  </span>
                  <strong>{formatCurrency(unitPrice * quantity)}</strong>
                </label>
              );
            })}
          </div>
        </section>

        {order.note ? (
          <section className="member-order-drawer-section member-order-drawer-note">
            <h3><FileText size={17} aria-hidden="true" />訂單備註</h3>
            <p>{order.note}</p>
          </section>
        ) : null}

        <footer className="history-drawer-footer">
          {selecting ? (
            <>
              <span>已選擇 {selectedCount} 項商品</span>
              <button type="button" className="primary" disabled={!selectedCount} onClick={onReorder}>
                加入填單
              </button>
            </>
          ) : (
            <button type="button" className="primary" onClick={onStartSelecting}>
              <RotateCcw size={16} aria-hidden="true" />
              挑選商品再次購買
            </button>
          )}
        </footer>
      </aside>
    </div>,
    document.body
  );
}
