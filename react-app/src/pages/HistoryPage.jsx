import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { loadMemberOrders } from "../services/orderService";
import { formatCurrency, formatDateTime } from "../utils/format";
import { getMemberOrderStatusLabel, isCompletedOrderStatus } from "../utils/orders";
import { saveReorderPayload } from "../utils/storage";

export default function HistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("--");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(true);

  async function refreshOrders() {
    if (!user?.id) {
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
  }

  useEffect(() => {
    refreshOrders();
  }, [user]);

  function handleReorder(order) {
    saveReorderPayload({
      delivery_location: order.delivery_location || "",
      note: order.note || "",
      order_items: (order.order_items || []).map((item) => ({
        product_name: item.product_name || "",
        unit_price: Number(item.unit_price || 0),
        quantity: Number(item.quantity || 1),
      })),
    });
    navigate("/order");
  }

  const filteredOrders = orders.filter((order) => isCompletedOrderStatus(order.status));

  return (
    <MemberLayout title="歷史訂單" subtitle="此頁僅保留已完成的訂單紀錄。" active="history">
      <section className="card history-card" id="historyCard">
        <div className="panel-header">
          <div>
            <h2>已完成訂單</h2>
            <p className="muted">最後更新：{updatedAt}</p>
          </div>
          <div className="actions">
            <button type="button" className="ghost" onClick={refreshOrders}>
              重新整理
            </button>
          </div>
        </div>

        <div className="member-orders">
          {loading ? <p className="muted">載入中...</p> : null}
          {!loading && !filteredOrders.length ? (
            <p className="muted">目前沒有已完成訂單。</p>
          ) : null}
          {filteredOrders.map((order) => (
            <div key={order.id} className="member-order-card">
              <div className="member-order-meta">
                <span>時間：{formatDateTime(order.created_at)}</span>
                <span>狀態：{getMemberOrderStatusLabel(order.status)}</span>
                <span>運送地點：{order.delivery_location}</span>
                <span>總額：{formatCurrency(order.total_amount)}</span>
              </div>
              <div className="member-order-items">
                {(order.order_items || []).map((item) => (
                  <div key={`${order.id}-${item.product_name}-${item.quantity}-${item.unit_price}`}>
                    {item.product_name} x {item.quantity} ({formatCurrency(item.unit_price)})
                  </div>
                ))}
              </div>
              {order.note ? <div className="muted">備註：{order.note}</div> : null}
              <div className="member-order-actions">
                <button type="button" className="ghost" onClick={() => handleReorder(order)}>
                  Reorder
                </button>
              </div>
            </div>
          ))}
        </div>
        <FormMessage text={message.text} type={message.type} />
      </section>
    </MemberLayout>
  );
}
