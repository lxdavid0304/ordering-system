import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronRight, MapPin, Package, RotateCcw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import HistoryOrderDetailDrawer from "../components/HistoryOrderDetailDrawer";
import MemberLayout from "../components/MemberLayout";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { loadMemberOrders } from "../services/orderService";
import { formatCurrency, formatDateTime } from "../utils/format";
import { getMemberOrderStatusLabel } from "../utils/orders";
import { saveReorderPayload } from "../utils/storage";

const PAGE_SIZE = 12;
const periodOptions = [
  { value: "3", label: "近 3 個月" },
  { value: "6", label: "近 6 個月" },
  { value: "all", label: "全部" },
];

function getOrderItemQuantity(order) {
  return (order.order_items || []).reduce(
    (sum, item) => sum + Math.max(1, Number(item.quantity) || 1),
    0
  );
}

function isWithinPeriod(createdAt, period) {
  if (period === "all") {
    return true;
  }

  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) {
    return false;
  }

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - Number(period));
  return createdTime >= cutoff.getTime();
}

function getMonthKey(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "unknown";
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function getMonthLabel(createdAt) {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) {
    return "日期未明";
  }
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "long",
  }).format(date);
}

function HistoryOrderCard({
  order,
  selected,
  onOpenDetails,
  onStartSelecting,
}) {
  const items = order.order_items || [];
  const shortId = String(order.id || "").slice(0, 8);
  const previewItems = items.slice(0, 2);
  const remainingItems = Math.max(0, items.length - previewItems.length);

  return (
    <article className={`history-order-card${selected ? " selected" : ""}`}>
      <div className="history-order-head">
        <div className="history-order-identity">
          <strong className="history-order-id">訂單 #{shortId}</strong>
          <span className="history-order-date">{formatDateTime(order.created_at)}</span>
        </div>
        <StatusBadge kind={`member-${order.status}`}>
          {getMemberOrderStatusLabel(order.status)}
        </StatusBadge>
      </div>

      <div className="history-order-preview" aria-label="商品摘要">
        {previewItems.map((item, index) => (
          <div className="history-preview-item" key={`${order.id}-preview-${index}`}>
            <strong>{item.product_name}</strong>
            <span>× {Math.max(1, Number(item.quantity) || 1)}</span>
          </div>
        ))}
        {remainingItems ? (
          <div className="history-preview-more">另有 {remainingItems} 項商品，請查看明細</div>
        ) : null}
      </div>

      <div className="history-order-summary">
        <div className="history-order-meta">
          <span title={order.delivery_location || "未指定交貨地點"}>
            <MapPin size={14} aria-hidden="true" />
            {order.delivery_location || "未指定交貨地點"}
          </span>
          <span>
            <Package size={14} aria-hidden="true" />
            共 {getOrderItemQuantity(order)} 件
          </span>
        </div>
        <div className="history-summary-primary">
          <span>訂單總額</span>
          <strong>{formatCurrency(order.total_amount)}</strong>
        </div>
      </div>

      <div className="history-order-actions">
        <button
          type="button"
          className="ghost history-detail-btn"
          aria-haspopup="dialog"
          onClick={onOpenDetails}
        >
          查看明細
          <ChevronRight size={15} aria-hidden="true" />
        </button>
        <button type="button" className="ghost history-select-btn" onClick={onStartSelecting}>
          <RotateCcw size={14} aria-hidden="true" />
          挑選回購
        </button>
      </div>

    </article>
  );
}

export default function HistoryPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [orders, setOrders] = useState([]);
  const [updatedAt, setUpdatedAt] = useState("--");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [recordView, setRecordView] = useState("fulfilled");
  const [searchText, setSearchText] = useState("");
  const [period, setPeriod] = useState("6");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [selectedOrderId, setSelectedOrderId] = useState(null);
  const [selectionByOrder, setSelectionByOrder] = useState({});

  const refreshOrders = useCallback(async () => {
    if (!user?.id) {
      setOrders([]);
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

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [period, recordView, searchText]);

  useEffect(() => {
    setSelectedOrderId(null);
    setSelectionByOrder({});
  }, [recordView]);

  const recentCompletedOrders = useMemo(
    () => orders.filter((order) => order.status === "fulfilled"),
    [orders]
  );

  const archivedOrders = useMemo(
    () => orders.filter((order) => order.status === "archived"),
    [orders]
  );

  const recordOrders = recordView === "fulfilled" ? recentCompletedOrders : archivedOrders;

  const periodOrders = useMemo(
    () => recordOrders.filter((order) => isWithinPeriod(order.created_at, period)),
    [recordOrders, period]
  );

  const filteredOrders = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return periodOrders;
    }

    return periodOrders.filter((order) => {
      const orderId = String(order.id || "").toLowerCase();
      return (
        orderId.includes(query) ||
        (order.order_items || []).some((item) =>
          String(item.product_name || "").toLowerCase().includes(query)
        )
      );
    });
  }, [periodOrders, searchText]);

  const visibleOrders = filteredOrders.slice(0, visibleCount);
  const selectedOrder = useMemo(
    () => orders.find((order) => order.id === selectedOrderId) || null,
    [orders, selectedOrderId]
  );
  const groupedOrders = useMemo(() => {
    const groups = [];
    visibleOrders.forEach((order) => {
      const key = getMonthKey(order.created_at);
      const latestGroup = groups[groups.length - 1];
      if (!latestGroup || latestGroup.key !== key) {
        groups.push({ key, label: getMonthLabel(order.created_at), orders: [order] });
      } else {
        latestGroup.orders.push(order);
      }
    });
    return groups;
  }, [visibleOrders]);

  const closeOrderDrawer = useCallback(() => {
    setSelectedOrderId(null);
    setSelectionByOrder({});
  }, []);

  function openOrderDetails(orderId) {
    setSelectionByOrder({});
    setSelectedOrderId(orderId);
  }

  function startSelecting(orderId) {
    setSelectedOrderId(orderId);
    setSelectionByOrder({ [orderId]: [] });
  }

  function cancelSelecting(orderId) {
    setSelectionByOrder((current) => {
      const next = { ...current };
      delete next[orderId];
      return next;
    });
  }

  function toggleItem(orderId, index) {
    setSelectionByOrder((current) => {
      const selected = current[orderId] || [];
      return {
        ...current,
        [orderId]: selected.includes(index)
          ? selected.filter((itemIndex) => itemIndex !== index)
          : [...selected, index],
      };
    });
  }

  function toggleAll(order) {
    setSelectionByOrder((current) => {
      const selected = current[order.id] || [];
      const itemCount = (order.order_items || []).length;
      return {
        ...current,
        [order.id]: selected.length === itemCount ? [] : Array.from({ length: itemCount }, (_, index) => index),
      };
    });
  }

  function handleReorder(order) {
    const selectedIndexes = selectionByOrder[order.id] || [];
    if (!selectedIndexes.length) {
      return;
    }

    saveReorderPayload({
      delivery_location: order.delivery_location || "",
      note: order.note || "",
      order_items: selectedIndexes.map((index) => {
        const item = order.order_items[index];
        return {
          product_name: item.product_name || "",
          unit_price: Number(item.unit_price || 0),
          quantity: Number(item.quantity || 1),
        };
      }),
    });
    navigate("/order");
  }

  function clearFilters() {
    setSearchText("");
    setPeriod("all");
  }

  const noResultsReason = !recordOrders.length
    ? recordView === "fulfilled"
      ? "目前沒有近期完成訂單。"
      : "目前沒有已封存的歷史紀錄。"
    : searchText.trim()
    ? "找不到符合搜尋條件的訂單。"
    : "所選期間內沒有符合的訂單紀錄。";

  return (
    <MemberLayout title="訂單紀錄" subtitle="查看近期完成與已封存訂單，快速再次購買。" active="history">
      <section className="card history-dashboard" id="historyCard">
        <div className="history-toolbar-head">
          <div>
            <span className="eyebrow">Order History</span>
            <h2>{recordView === "fulfilled" ? "近期完成" : "歷史紀錄"}</h2>
            <p>共 {filteredOrders.length} 筆，最後更新：{updatedAt}</p>
          </div>
          <button type="button" className="ghost history-refresh-btn" disabled={loading} onClick={refreshOrders}>
            {loading ? "更新中..." : "重新整理"}
          </button>
        </div>

        <div className="history-record-tabs" role="group" aria-label="訂單紀錄分類">
          <button
            type="button"
            className={recordView === "fulfilled" ? "active" : ""}
            aria-pressed={recordView === "fulfilled"}
            onClick={() => setRecordView("fulfilled")}
          >
            <span>近期完成</span>
            <strong>{recentCompletedOrders.length}</strong>
          </button>
          <button
            type="button"
            className={recordView === "archived" ? "active" : ""}
            aria-pressed={recordView === "archived"}
            onClick={() => setRecordView("archived")}
          >
            <span>歷史紀錄</span>
            <strong>{archivedOrders.length}</strong>
          </button>
        </div>

        <div className="history-filter-bar">
          <label className="field history-search-field">
            <span>搜尋訂單紀錄</span>
            <input
              type="search"
              value={searchText}
              placeholder="搜尋商品名稱或訂單編號"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <div className="history-period-filter" role="group" aria-label="訂單期間">
            {periodOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                className={period === option.value ? "active" : ""}
                aria-pressed={period === option.value}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <FormMessage text={message.text} type={message.type} />

        {loading ? <div className="history-loading">正在整理訂單紀錄...</div> : null}

        {!loading && !filteredOrders.length ? (
          <div className="history-empty-state">
            <strong>{noResultsReason}</strong>
            {recordOrders.length ? (
              <button type="button" className="ghost" onClick={clearFilters}>
                清除篩選
              </button>
            ) : null}
          </div>
        ) : null}

        {!loading ? (
          <div className="history-month-groups">
            {groupedOrders.map((group) => (
              <section key={group.key} className="history-month-group">
                <header className="history-month-head">
                  <h3>{group.label}</h3>
                  <span>{group.orders.length} 筆訂單</span>
                </header>
                <div className="history-order-list">
                  {group.orders.map((order) => (
                      <HistoryOrderCard
                        key={order.id}
                        order={order}
                        selected={selectedOrderId === order.id}
                        onOpenDetails={() => openOrderDetails(order.id)}
                        onStartSelecting={() => startSelecting(order.id)}
                      />
                  ))}
                </div>
              </section>
            ))}
          </div>
        ) : null}

        {visibleCount < filteredOrders.length ? (
          <div className="history-load-more">
            <span>
              已顯示 {visibleOrders.length} / {filteredOrders.length} 筆
            </span>
            <button type="button" className="ghost" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
              顯示更多
            </button>
          </div>
        ) : null}
      </section>

      <HistoryOrderDetailDrawer
        order={selectedOrder}
        selecting={Boolean(selectedOrder && Object.prototype.hasOwnProperty.call(selectionByOrder, selectedOrder.id))}
        selectedIndexes={selectedOrder ? selectionByOrder[selectedOrder.id] || [] : []}
        onClose={closeOrderDrawer}
        onStartSelecting={() => selectedOrder && startSelecting(selectedOrder.id)}
        onCancelSelecting={() => selectedOrder && cancelSelecting(selectedOrder.id)}
        onToggleItem={(index) => selectedOrder && toggleItem(selectedOrder.id, index)}
        onToggleAll={() => selectedOrder && toggleAll(selectedOrder)}
        onReorder={() => selectedOrder && handleReorder(selectedOrder)}
      />
    </MemberLayout>
  );
}
