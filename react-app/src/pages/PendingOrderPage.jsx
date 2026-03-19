import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { loadMemberOrders } from "../services/orderService";
import { formatCurrency, formatDateTime } from "../utils/format";
import { getMemberOrderStatusLabel, isOngoingOrderStatus } from "../utils/orders";
import { readPaymentPreview } from "../utils/storage";

export default function PendingOrderPage() {
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
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

  const hasPendingDeposit = ongoingOrders.some((order) => order.status === "pending_deposit");

  useEffect(() => {
    if (!hasPendingDeposit) {
      return undefined;
    }

    const timer = window.setInterval(refreshOrders, 20000);
    return () => window.clearInterval(timer);
  }, [hasPendingDeposit, refreshOrders]);

  return (
    <MemberLayout
      title="進行中訂單"
      subtitle="送單後可在這裡查看待確認訂金與進行中的訂單狀態。"
      active="pending-order"
    >
      <section className="card history-card" id="pendingOrderCard">
        <div className="panel-header">
          <div>
            <h2>目前進行中的訂單</h2>
            <p className="muted">最後更新：{updatedAt}</p>
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={refreshOrders}>
              重新整理
            </button>
          </div>
        </div>

        {hasPendingDeposit ? <p className="muted">若為轉帳訂金，後台確認後狀態會自動更新為進行中。</p> : null}

        <div className="member-orders">
          {loading ? <p className="muted">載入中...</p> : null}
          {!loading && !ongoingOrders.length ? <p className="muted">目前沒有進行中的訂單。</p> : null}
          {ongoingOrders.map((order) => (
            <div key={order.id} className="member-order-card">
              <div className="member-order-meta">
                <span>訂單編號：{order.id}</span>
                <span>時間：{formatDateTime(order.created_at)}</span>
                <span>狀態：{getMemberOrderStatusLabel(order.status)}</span>
                <span>運送地點：{order.delivery_location}</span>
                <span>總額：{formatCurrency(order.total_amount)}</span>
              </div>
              {order.id === latestPreviewOrderId ? (
                <div className="muted">這是你最近送出的訂單，可在此持續查看處理狀態。</div>
              ) : null}
              <div className="member-order-items">
                {(order.order_items || []).map((item) => (
                  <div key={`${order.id}-${item.product_name}-${item.quantity}-${item.unit_price}`}>
                    {item.product_name} x {item.quantity} ({formatCurrency(item.unit_price)})
                  </div>
                ))}
              </div>
              {order.note ? <div className="muted">備註：{order.note}</div> : null}
            </div>
          ))}
        </div>

        <FormMessage text={message.text} type={message.type} />

        <div className="actions payment-actions">
          <Link className="ghost" to="/order">
            返回填單頁
          </Link>
        </div>
      </section>
    </MemberLayout>
  );
}
