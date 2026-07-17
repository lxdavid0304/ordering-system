import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, MapPin, Package } from "lucide-react";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import MemberOrderDetailDrawer from "../components/MemberOrderDetailDrawer";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { loadMemberOrders } from "../services/orderService";
import { formatCurrency, formatDateTime } from "../utils/format";
import {
  getMemberOrderStatusLabel,
  isOngoingOrderStatus,
} from "../utils/orders";
import { readPaymentPreview } from "../utils/storage";

const statusTabs = [
  { value: "all", label: "全部進行中" },
  { value: "pending_deposit", label: "待確認訂金" },
  { value: "open", label: "採買進行中" },
  { value: "ready_pickup", label: "待取貨" },
];

const statusGuidance = {
  all: "訂單狀態更新後會自動移動至下一階段。",
  pending_deposit: "轉帳後請等待管理員核對，確認訂金後會進入採買流程。",
  open: "訂單已確認，管理員正在安排採買與配送。",
  ready_pickup: "商品已完成採買，請依管理員通知前往指定地點取貨。",
};

function getTotalQuantity(order) {
  return (order.order_items || []).reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity) || 1),
    0
  );
}

function PendingOrderCard({ order, isLatest, onOpenDetails }) {
  const items = order.order_items || [];
  const totalAmount = Math.max(0, Number(order.total_amount) || 0);
  const previewItems = items.slice(0, 2);
  const remainingItems = Math.max(0, items.length - previewItems.length);

  return (
    <article className={`ongoing-order-card order-status-${order.status}${isLatest ? " latest" : ""}`}>
      <div className="ongoing-order-card-head">
        <div>
          <div className="ongoing-order-id-line">
            <span className="ongoing-order-id">訂單 #{String(order.id).slice(0, 8)}</span>
            {isLatest ? <span className="latest-order-flag">最新</span> : null}
          </div>
          <time>{formatDateTime(order.created_at)}</time>
        </div>
        <StatusBadge kind={`member-${order.status}`}>
          {getMemberOrderStatusLabel(order.status)}
        </StatusBadge>
      </div>

      <div className="ongoing-compact-products" aria-label="商品摘要">
        {previewItems.map((item, index) => (
          <div key={`${order.id}-preview-${index}`} className="ongoing-compact-product">
            <strong>{item.product_name}</strong>
            <span>× {Math.max(1, Number(item.quantity) || 1)}</span>
          </div>
        ))}
        {remainingItems ? <div className="ongoing-more-items">另有 {remainingItems} 項商品</div> : null}
      </div>

      <div className="ongoing-compact-footer">
        <div>
          <span><MapPin size={14} aria-hidden="true" />{order.delivery_location || "未指定交貨地點"}</span>
          <small><Package size={14} aria-hidden="true" />共 {getTotalQuantity(order)} 件商品</small>
        </div>
        <div>
          <span>訂單總額</span>
          <strong>{formatCurrency(totalAmount)}</strong>
        </div>
      </div>

      <div className="ongoing-card-actions">
        <button
          type="button"
          aria-haspopup="dialog"
          onClick={onOpenDetails}
        >
          <span>查看明細</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}

export default function PendingOrderPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [activeStatus, setActiveStatus] = useState("all");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [updatedAt, setUpdatedAt] = useState("--");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(true);

  const latestPreviewOrderId = useMemo(() => String(readPaymentPreview()?.order_id || "").trim(), []);

  const refreshOrders = useCallback(async () => {
    if (!user?.id) {
      setOrders([]);
      setUpdatedAt("--");
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error } = await loadMemberOrders(user.id);
    if (error) {
      setOrders([]);
      setMessage({ text: error.message || "讀取失敗", type: "error" });
      setLoading(false);
      return;
    }

    setOrders(data || []);
    setUpdatedAt(formatDateTime(new Date().toISOString()));
    setMessage({ text: "", type: "" });
    setLoading(false);
  }, [user?.id]);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  const ongoingOrders = useMemo(
    () => orders.filter((order) => isOngoingOrderStatus(order.status)),
    [orders]
  );

  const statusCounts = useMemo(
    () => ({
      all: ongoingOrders.length,
      pending_deposit: ongoingOrders.filter((order) => order.status === "pending_deposit").length,
      open: ongoingOrders.filter((order) => order.status === "open").length,
      ready_pickup: ongoingOrders.filter((order) => order.status === "ready_pickup").length,
    }),
    [ongoingOrders]
  );

  const visibleOrders = useMemo(
    () => activeStatus === "all"
      ? ongoingOrders
      : ongoingOrders.filter((order) => order.status === activeStatus),
    [activeStatus, ongoingOrders]
  );

  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );

  useEffect(() => {
    if (!ongoingOrders.length) {
      return undefined;
    }
    const timer = window.setInterval(refreshOrders, 30000);
    return () => window.clearInterval(timer);
  }, [ongoingOrders.length, refreshOrders]);

  const closeOrderDetails = useCallback(() => setSelectedOrderId(""), []);

  return (
    <MemberLayout
      title="訂單進度"
      subtitle="追蹤待確認訂金、採買處理與待取貨狀態。"
      active="pending-order"
    >
      <section className="card ongoing-orders-card" id="pendingOrderCard">
        <div className="ongoing-page-toolbar">
          <div>
            <span className="eyebrow">Order Tracking</span>
            <h2>目前進行中的訂單</h2>
            <p>共 {ongoingOrders.length} 筆訂單，最後更新：{updatedAt}</p>
          </div>
          <button type="button" className="ghost ongoing-refresh-btn" disabled={loading} onClick={refreshOrders}>
            {loading ? "更新中..." : "重新整理"}
          </button>
        </div>

        <div className="ongoing-status-tabs" role="group" aria-label="訂單狀態篩選">
          {statusTabs.map((tab) => (
            <button
              key={tab.value}
              type="button"
              className={activeStatus === tab.value ? "active" : ""}
              aria-pressed={activeStatus === tab.value}
              onClick={() => setActiveStatus(tab.value)}
            >
              <span>{tab.label}</span>
              <strong>{statusCounts[tab.value]}</strong>
            </button>
          ))}
        </div>

        <div className={`ongoing-info-banner filter-${activeStatus}`}>
          {statusGuidance[activeStatus]}
        </div>

        {loading ? <div className="ongoing-loading">正在更新訂單狀態...</div> : null}

        {!loading && visibleOrders.length ? (
          <div className="ongoing-card-grid">
            {visibleOrders.map((order) => (
              <PendingOrderCard
                key={order.id}
                order={order}
                isLatest={order.id === latestPreviewOrderId}
                onOpenDetails={() => setSelectedOrderId(order.id)}
              />
            ))}
          </div>
        ) : null}

        {!loading && !visibleOrders.length ? (
          <div className="ongoing-empty-state">
            <strong>此狀態目前沒有訂單</strong>
            <span>訂單狀態更新後會自動顯示在對應分頁。</span>
          </div>
        ) : null}

        <FormMessage text={message.text} type={message.type} />

        <div className="actions payment-actions">
          <Link className="ghost" to="/order">返回填單頁</Link>
        </div>
      </section>
      <MemberOrderDetailDrawer order={selectedOrder} onClose={closeOrderDetails} />
    </MemberLayout>
  );
}
