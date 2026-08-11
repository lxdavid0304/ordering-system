import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Filter,
  MapPin,
  Package,
  PackageCheck,
  Phone,
  RefreshCw,
  Search,
  Send,
  ShoppingBasket,
  WalletCards,
} from "lucide-react";
import AdminLayout from "../components/AdminLayout";
import AdminOrderDrawer from "../components/AdminOrderDrawer";
import {
  bulkCompleteReadyPickupOrders,
  bulkUpdateOrders,
  deleteAdminOrder,
  drainLineNotifications,
  exportAdminOrders,
  loadAdminDeliveryLocationSummary,
  loadAdminOrders,
  loadAdminPurchaseOrders,
  loadAdminSummary,
  sendDeliveryLocationNotification,
} from "../services/adminService";
import {
  adminStatusLabels,
  adminStatusTabs,
  getAdminStatusLabel,
  getNextAdminStatus,
  getPaymentStatus,
  paymentStatusLabels,
} from "../utils/adminOrders";
import { formatCurrency, formatDateTime } from "../utils/format";

const pageSize = 12;
const locations = ["明德樓", "據德樓", "蘊德樓", "機車停車場"];

const initialFilters = {
  status: "pending_deposit",
  paymentStatus: "all",
  location: "all",
  dateFrom: "",
  dateTo: "",
  historyMonths: "all",
};

const statusTabSummaryKeys = {
  pending_deposit: "pending_deposit",
  open: "open",
  ready_pickup: "ready_pickup",
  fulfilled: "fulfilled_recent",
  history: "history",
};

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function getAdminError(error) {
  const raw = String(error?.message || "");
  if (raw.includes("admin_delete_order")) {
    return "刪除訂單功能尚未套用到資料庫，請先執行最新 Supabase migration。";
  }
  if (raw.includes("Could not find the function") || raw.includes("admin_list_orders") || raw.includes("admin_delivery_location_summary")) {
    return "後台資料庫功能尚未更新，請先執行最新 Supabase migration。";
  }
  if (raw.includes("DEPOSIT_REQUIRED")) return "選取訂單仍有訂金未確認。";
  if (raw.includes("PAYMENT_REQUIRED")) return "選取訂單仍有尾款未付清。";
  return raw || "無法載入訂單，請稍後再試。";
}

export default function AdminPage() {
  const [orders, setOrders] = useState([]);
  const [totalOrders, setTotalOrders] = useState(0);
  const [summary, setSummary] = useState({
    today_orders: 0,
    pending_deposit: 0,
    open: 0,
    ready_pickup: 0,
    fulfilled_recent: 0,
    history: 0,
    outstanding_amount: 0,
  });
  const [locationSummary, setLocationSummary] = useState([]);
  const [filters, setFilters] = useState(initialFilters);
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastUpdated, setLastUpdated] = useState("--");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [deletingOrderId, setDeletingOrderId] = useState("");
  const [newOrdersAvailable, setNewOrdersAvailable] = useState(false);
  const [deliveryNoticeLocation, setDeliveryNoticeLocation] = useState("");
  const [deliveryNoticeTime, setDeliveryNoticeTime] = useState("");
  const [deliveryNoticeTimeConfirmed, setDeliveryNoticeTimeConfirmed] = useState(false);
  const [sendingDeliveryNotice, setSendingDeliveryNotice] = useState(false);
  const [purchaseOrders, setPurchaseOrders] = useState([]);
  const [purchaseOrderCount, setPurchaseOrderCount] = useState(0);
  const [purchaseListLoading, setPurchaseListLoading] = useState(false);
  const [purchaseListError, setPurchaseListError] = useState("");
  const [purchaseListOpen, setPurchaseListOpen] = useState(false);

  const requestFilters = useMemo(
    () => ({ ...filters, search: searchQuery }),
    [filters, searchQuery]
  );
  const totalPages = Math.max(1, Math.ceil(totalOrders / pageSize));
  const allVisibleSelected = Boolean(
    orders.length && orders.every((order) => selectedIds.includes(order.id))
  );
  const selectedOrders = orders.filter((order) => selectedIds.includes(order.id));
  const batchNextStatus = useMemo(() => {
    if (!selectedOrders.length) return null;
    const nextStatuses = new Set(selectedOrders.map((order) => getNextAdminStatus(order.status)));
    return nextStatuses.size === 1 ? Array.from(nextStatuses)[0] : null;
  }, [selectedOrders]);
  const deliveryLocations = useMemo(
    () => locations.map((location) => (
      locationSummary.find((group) => group.delivery_location === location) || {
        delivery_location: location,
        order_count: 0,
        member_count: 0,
      }
    )),
    [locationSummary]
  );
  const selectedDeliveryGroup = deliveryLocations.find(
    (group) => group.delivery_location === deliveryNoticeLocation
  );
  const purchaseItems = useMemo(() => buildPurchaseItems(purchaseOrders), [purchaseOrders]);
  const purchaseQuantity = useMemo(
    () => purchaseItems.reduce((sum, item) => sum + item.quantity, 0),
    [purchaseItems]
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setSearchQuery(searchText.trim());
      setPage(1);
      setSelectedIds([]);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setRefreshing(true);

    Promise.all([
      loadAdminOrders({ filters: requestFilters, page, pageSize }),
      loadAdminSummary(),
      drainLineNotifications(),
      loadAdminDeliveryLocationSummary(),
    ]).then(([ordersResult, summaryResult, , locationResult]) => {
      if (!active) return;
      if (ordersResult.error) {
        setOrders([]);
        setTotalOrders(0);
        setMessage({ text: getAdminError(ordersResult.error), type: "error" });
      } else {
        setOrders(ordersResult.data || []);
        setTotalOrders(Number(ordersResult.count || 0));
        setSelectedIds((current) => current.filter((id) => (ordersResult.data || []).some((order) => order.id === id)));
        setMessage({ text: "", type: "" });
      }
      if (!summaryResult.error && summaryResult.data) {
        setSummary(summaryResult.data);
      }
      if (locationResult.error) {
        setMessage({ text: getAdminError(locationResult.error), type: "error" });
      } else {
        setLocationSummary(locationResult.data || []);
      }
      setLastUpdated(formatDateTime(new Date().toISOString()));
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      active = false;
    };
  }, [page, refreshKey, requestFilters]);

  useEffect(() => {
    if (filters.status !== "open") {
      setPurchaseOrders([]);
      setPurchaseOrderCount(0);
      setPurchaseListError("");
      setPurchaseListOpen(false);
      return undefined;
    }

    let active = true;
    setPurchaseListLoading(true);
    loadAdminPurchaseOrders().then(({ data, count, error }) => {
      if (!active) return;
      if (error) {
        setPurchaseOrders([]);
        setPurchaseOrderCount(0);
        setPurchaseListError(getAdminError(error));
      } else {
        setPurchaseOrders(data || []);
        setPurchaseOrderCount(Number(count || 0));
        setPurchaseListError("");
      }
      setPurchaseListLoading(false);
    });

    return () => {
      active = false;
    };
  }, [filters.status, refreshKey]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const [{ data, error }, locationResult] = await Promise.all([
        loadAdminSummary(),
        loadAdminDeliveryLocationSummary(),
        drainLineNotifications(),
      ]);
      if (error || !data) return;
      const changed =
        Number(data.today_orders) !== Number(summary.today_orders) ||
        Number(data.pending_deposit) !== Number(summary.pending_deposit) ||
        Number(data.ready_pickup) !== Number(summary.ready_pickup);
      if (changed) setNewOrdersAvailable(true);
      setSummary(data);
      if (!locationResult.error) setLocationSummary(locationResult.data || []);
    }, 30000);
    return () => clearInterval(timer);
  }, [summary.pending_deposit, summary.ready_pickup, summary.today_orders]);

  function refreshOrders() {
    setNewOrdersAvailable(false);
    setRefreshKey((current) => current + 1);
  }

  function setFilter(name, value) {
    setFilters((current) => ({ ...current, [name]: value }));
    setPage(1);
    setSelectedIds([]);
  }

  function selectSummary(status) {
    setFilter("status", status);
    setFiltersOpen(false);
  }

  function toggleSelectAll(checked) {
    if (checked) {
      setSelectedIds((current) => Array.from(new Set([...current, ...orders.map((order) => order.id)])));
    } else {
      setSelectedIds((current) => current.filter((id) => !orders.some((order) => order.id === id)));
    }
  }

  async function handleBatchAdvance() {
    if (!batchNextStatus) return;
    if (batchNextStatus === "fulfilled") {
      const outstandingAmount = selectedOrders.reduce(
        (sum, order) => sum + Math.max(
          0,
          Number(order.total_amount || 0) - Number(order.deposit_paid_amount || 0) - Number(order.balance_paid_amount || 0)
        ),
        0
      );
      const confirmed = window.confirm(
        `確認 ${selectedOrders.length} 筆訂單的尾款都已收取嗎？\n\n將登記尾款：${formatCurrency(outstandingAmount)}\n並將所有勾選訂單標示為已完成。`
      );
      if (!confirmed) return;

      setMessage({ text: "正在登記尾款並完成選取訂單...", type: "" });
      const { data, error } = await bulkCompleteReadyPickupOrders(selectedOrders);
      if (error) {
        setMessage({ text: `${getAdminError(error)}（已完成 ${data?.length || 0} 筆）`, type: "error" });
        refreshOrders();
        return;
      }
      setMessage({ text: `已確認 ${data.length} 筆訂單尾款並完成訂單。`, type: "success" });
      setSelectedIds([]);
      refreshOrders();
      return;
    }

    const reason = batchNextStatus === "archived" ? "批次封存已完成訂單" : "批次推進訂單流程";
    const isMobile = window.matchMedia("(max-width: 767px)").matches;
    if (isMobile) {
      const confirmed = window.confirm(
        `確定將 ${selectedOrders.length} 筆訂單批次移至「${getAdminStatusLabel(batchNextStatus)}」嗎？`
      );
      if (!confirmed) return;
    }
    setMessage({ text: "正在更新選取訂單...", type: "" });
    const { data, error } = await bulkUpdateOrders(selectedIds, batchNextStatus, reason);
    if (error) {
      setMessage({ text: `${getAdminError(error)}（已更新 ${data?.length || 0} 筆）`, type: "error" });
      refreshOrders();
      return;
    }
    setMessage({ text: `已將 ${data.length} 筆訂單更新為${getAdminStatusLabel(batchNextStatus)}。`, type: "success" });
    setSelectedIds([]);
    refreshOrders();
  }

  async function handleDeliveryLocationNotification(event) {
    event.preventDefault();
    const orderCount = Number(selectedDeliveryGroup?.order_count || 0);
    const recipientCount = Number(selectedDeliveryGroup?.member_count || 0);
    if (!deliveryNoticeLocation || !deliveryNoticeTime || !deliveryNoticeTimeConfirmed || !orderCount || !recipientCount) return;

    const formattedTime = formatDateTime(new Date(deliveryNoticeTime).toISOString());
    const confirmed = window.confirm(
      `確定通知「${deliveryNoticeLocation}」嗎？\n\n待交貨訂單：${orderCount} 筆\n通知會員：${recipientCount} 位\n交貨時間：${formattedTime}\n\n每位會員只會收到一則此地點通知。`
    );
    if (!confirmed) return;

    setSendingDeliveryNotice(true);
    setMessage({ text: "正在建立交貨通知並發送...", type: "" });
    const { data, error } = await sendDeliveryLocationNotification(
      deliveryNoticeLocation,
      new Date(deliveryNoticeTime).toISOString()
    );
    setSendingDeliveryNotice(false);
    if (error) {
      setMessage({ text: getAdminError(error), type: "error" });
      return;
    }

    const recipients = Number(data?.recipients || recipientCount);
    const sent = Number(data?.sent || 0);
    const failed = Number(data?.failed || 0);
    setMessage({
      text: failed
        ? `已建立 ${recipients} 位的交貨通知；已送出 ${sent} 位，其餘會自動重試。`
        : `已通知 ${recipients} 位「${deliveryNoticeLocation}」訂購者。`,
      type: failed ? "error" : "success",
    });
    setDeliveryNoticeTime("");
    setDeliveryNoticeTimeConfirmed(false);
    refreshOrders();
  }

  async function handleExport() {
    setExporting(true);
    setMessage({ text: "正在整理匯出資料...", type: "" });
    const { data, error } = await exportAdminOrders(requestFilters);
    setExporting(false);
    if (error) {
      setMessage({ text: getAdminError(error), type: "error" });
      return;
    }

    const headers = [
      "訂單編號", "建立時間", "姓名", "電話", "交貨地點", "訂單狀態", "付款狀態",
      "總額", "訂金實收", "尾款實收", "待收餘額", "商品", "單價", "數量", "小計", "顧客備註", "內部備註",
    ];
    const rows = (data || []).map((row) => [
      row.order_id,
      formatDateTime(row.created_at),
      row.customer_name,
      row.phone,
      row.delivery_location,
      getAdminStatusLabel(row.order_status),
      paymentStatusLabels[row.payment_status] || row.payment_status,
      row.total_amount,
      row.deposit_paid_amount,
      row.balance_paid_amount,
      row.outstanding_amount,
      row.product_name,
      row.unit_price,
      row.quantity,
      row.line_total,
      row.customer_note,
      row.admin_note,
    ]);
    const csv = `\uFEFF${[headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `orders-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage({ text: `已匯出 ${rows.length} 筆商品明細。`, type: "success" });
  }

  function handleOrderUpdated(nextOrder) {
    const normalized = {
      ...nextOrder,
      payment_status: getPaymentStatus(nextOrder),
      outstanding_amount: Math.max(
        0,
        Number(nextOrder.total_amount || 0) -
          Number(nextOrder.deposit_paid_amount || 0) -
          Number(nextOrder.balance_paid_amount || 0)
      ),
    };
    setOrders((current) => current.map((order) => (order.id === normalized.id ? normalized : order)));
    setSelectedOrder(normalized);
    loadAdminSummary().then(({ data }) => {
      if (data) setSummary(data);
    });
    setRefreshKey((current) => current + 1);
  }

  async function handleDeleteOrder(order) {
    const orderLabel = `${order.customer_name}（#${order.id.slice(0, 8)}）`;
    const confirmed = window.confirm(
      `確定要刪除 ${orderLabel} 的訂單嗎？\n\n刪除後無法復原，相關商品與通知紀錄也會一併移除。`
    );
    if (!confirmed) return;

    setDeletingOrderId(order.id);
    const { error } = await deleteAdminOrder(order.id);
    setDeletingOrderId("");

    if (error) {
      setMessage({ text: getAdminError(error), type: "error" });
      return;
    }

    setOrders((current) => current.filter((item) => item.id !== order.id));
    setTotalOrders((current) => Math.max(0, current - 1));
    setSelectedIds((current) => current.filter((id) => id !== order.id));
    setSelectedOrder(null);
    setMessage({ text: `已刪除 ${orderLabel} 的訂單。`, type: "success" });
    refreshOrders();
  }

  const topbarActions = (
    <>
      <button type="button" className="admin-icon-button" title="重新整理" aria-label="重新整理" disabled={refreshing} onClick={refreshOrders}>
        <RefreshCw size={19} className={refreshing ? "spin" : ""} />
      </button>
      <button type="button" className="admin-secondary-button" disabled={exporting} onClick={handleExport}>
        <Download size={17} />{exporting ? "匯出中" : "匯出 CSV"}
      </button>
    </>
  );

  return (
    <AdminLayout title="訂單管理" subtitle={`最後更新：${lastUpdated}`} actions={topbarActions}>
      <section className="admin-summary-grid" aria-label="營運摘要">
        <SummaryCard icon={Bell} label="待確認訂金" value={`${summary.pending_deposit || 0} 筆`} tone="red" onClick={() => selectSummary("pending_deposit")} />
        <SummaryCard icon={CalendarDays} label="採買進行中" value={`${summary.open || 0} 筆`} tone="blue" onClick={() => selectSummary("open")} />
        <SummaryCard icon={PackageCheck} label="待取貨" value={`${summary.ready_pickup || 0} 筆`} tone="green" onClick={() => selectSummary("ready_pickup")} />
        <SummaryCard icon={WalletCards} label="近 7 日完成" value={`${summary.fulfilled_recent || 0} 筆`} tone="amber" onClick={() => selectSummary("fulfilled")} />
      </section>

      {newOrdersAvailable ? (
        <button type="button" className="admin-new-order-alert" onClick={refreshOrders}>
          <Bell size={17} />訂單資料已有更新，點擊載入最新內容
        </button>
      ) : null}

      <section className="admin-order-workspace">
        <div
          className="admin-delivery-workbench"
          aria-label="交貨地點作業"
          title="點選空白處即可顯示全部交貨地點訂單"
          onClick={(event) => {
            if (event.target.closest("button, input, label, form")) return;

            setDeliveryNoticeLocation("");
            setDeliveryNoticeTime("");
            setDeliveryNoticeTimeConfirmed(false);
            setFilter("location", "");
          }}
        >
          <div className="admin-delivery-workbench-head">
            <div>
              <span>DELIVERY FILTER</span>
              <h2><MapPin size={26} />交貨地點篩選</h2>
            </div>
          </div>
          <div className="admin-delivery-workbench-body">
            <div className="admin-delivery-location-grid">
              {deliveryLocations.map((group) => {
                const active = deliveryNoticeLocation === group.delivery_location;
                const members = Number(group.member_count || 0);
                return (
                  <button
                    key={group.delivery_location}
                    type="button"
                    className={`admin-delivery-location-card${active ? " active" : ""}`}
                    onClick={() => {
                      setDeliveryNoticeLocation(group.delivery_location);
                      setDeliveryNoticeTimeConfirmed(false);
                      setFilter("location", group.delivery_location);
                    }}
                  >
                    <span>交貨地點</span>
                    <strong>{group.delivery_location}</strong>
                    <small>{Number(group.order_count || 0)} 筆待交貨訂單 · {members} 位通知會員</small>
                  </button>
                );
              })}
            </div>
            {deliveryNoticeLocation ? (
              <form className="admin-delivery-notice-form" onSubmit={handleDeliveryLocationNotification}>
                <div className="admin-delivery-selected-location is-selected" aria-live="polite">
                  <span>通知地點</span>
                  <strong>{deliveryNoticeLocation}</strong>
                </div>
                <label className="admin-field admin-delivery-time-field">
                  <span>交貨時間</span>
                  <div className="admin-delivery-time-input-row">
                    <input
                      type="datetime-local"
                      value={deliveryNoticeTime}
                      onChange={(event) => {
                        setDeliveryNoticeTime(event.target.value);
                        setDeliveryNoticeTimeConfirmed(false);
                      }}
                    />
                    <button
                      type="button"
                      className={`admin-delivery-time-confirm${deliveryNoticeTimeConfirmed ? " confirmed" : ""}`}
                      disabled={!deliveryNoticeTime}
                      onClick={() => setDeliveryNoticeTimeConfirmed(true)}
                    >
                      {deliveryNoticeTimeConfirmed ? "已確認" : "確認時間"}
                    </button>
                  </div>
                </label>
                <p className="admin-delivery-notice-summary" aria-live="polite">
                  {`本次將通知 ${Number(selectedDeliveryGroup?.order_count || 0)} 筆待交貨訂單、${Number(selectedDeliveryGroup?.member_count || 0)} 位會員。${deliveryNoticeTime && !deliveryNoticeTimeConfirmed ? " 請先確認交貨時間。" : ""}`}
                </p>
                <button
                  type="submit"
                  className="admin-primary-button"
                  disabled={
                    sendingDeliveryNotice ||
                    !deliveryNoticeTime ||
                    !deliveryNoticeTimeConfirmed ||
                    !Number(selectedDeliveryGroup?.order_count || 0) ||
                    !Number(selectedDeliveryGroup?.member_count || 0)
                  }
                >
                  <Send size={17} />{sendingDeliveryNotice ? "通知發送中" : `通知 ${Number(selectedDeliveryGroup?.member_count || 0)} 位會員`}
                </button>
              </form>
            ) : (
              <div className="admin-delivery-notice-hint">
                <MapPin size={17} aria-hidden="true" />選擇地點後，可設定交貨時間並通知該地點會員。
              </div>
            )}
          </div>
        </div>
        <div className="admin-order-toolbar">
          <label className="admin-search-box">
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={searchText}
              placeholder="搜尋訂單編號、姓名、電話或商品"
              aria-label="搜尋訂單"
              onChange={(event) => setSearchText(event.target.value)}
            />
          </label>
          <button type="button" className={`admin-filter-button${filtersOpen ? " active" : ""}`} onClick={() => setFiltersOpen((current) => !current)}>
            <Filter size={17} />篩選
          </button>
        </div>

        <div className="admin-status-tabs" role="tablist" aria-label="訂單狀態">
          {adminStatusTabs.map((value) => (
            <StatusTab
              key={value}
              value={value}
              label={value === "history" ? "歷史紀錄" : adminStatusLabels[value]}
              count={summary[statusTabSummaryKeys[value]] || 0}
              active={filters.status}
              onClick={selectSummary}
            />
          ))}
        </div>

        {filters.status === "open" ? (
          <PurchaseList
            items={purchaseItems}
            orderCount={purchaseOrderCount}
            totalQuantity={purchaseQuantity}
            loading={purchaseListLoading}
            error={purchaseListError}
            open={purchaseListOpen}
            onToggle={() => setPurchaseListOpen((current) => !current)}
          />
        ) : null}

        {filters.status === "history" ? (
          <div className="admin-history-range" aria-label="歷史訂單完成時間">
            <span>完成時間</span>
            {[
              ["1", "近 1 個月"],
              ["3", "近 3 個月"],
              ["6", "近 6 個月"],
              ["all", "全部"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={filters.historyMonths === value ? "active" : ""}
                onClick={() => setFilter("historyMonths", value)}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        {filtersOpen ? (
          <div className="admin-filter-panel">
            <FilterSelect label="付款狀態" value={filters.paymentStatus} onChange={(value) => setFilter("paymentStatus", value)} options={[
              ["all", "全部付款狀態"], ["needs_review", "待補登"], ["unpaid", "未付款"], ["deposit_paid", "已付訂金"], ["paid", "已付清"],
            ]} />
            <FilterSelect label="交貨地點" value={filters.location} onChange={(value) => setFilter("location", value)} options={[["all", "全部地點"], ...locations.map((location) => [location, location])]} />
            <label className="admin-field"><span>開始日期</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilter("dateFrom", event.target.value)} /></label>
            <label className="admin-field"><span>結束日期</span><input type="date" value={filters.dateTo} onChange={(event) => setFilter("dateTo", event.target.value)} /></label>
            <button type="button" className="admin-text-button" onClick={() => { setFilters(initialFilters); setPage(1); }}>清除篩選</button>
          </div>
        ) : null}

        {selectedIds.length ? (
          <>
            <div className="admin-bulk-bar">
              <strong>已選 {selectedIds.length} 筆</strong>
              {batchNextStatus ? (
                <>
                  <button type="button" className="admin-primary-button" onClick={handleBatchAdvance}>
                    {batchNextStatus === "fulfilled" ? "確認尾款並批次完成" : `批次移至${getAdminStatusLabel(batchNextStatus)}`}
                  </button>
                </>
              ) : (
                <span>所選訂單階段不同，請選擇相同狀態的訂單。</span>
              )}
              <button type="button" className="admin-text-button" onClick={() => setSelectedIds([])}>取消選取</button>
            </div>
            <button
              type="button"
              className="admin-mobile-bulk-action"
              disabled={!batchNextStatus}
              onClick={handleBatchAdvance}
            >
              <PackageCheck size={17} aria-hidden="true" />
              <span>已選 {selectedIds.length} 筆</span>
              <strong>{batchNextStatus === "fulfilled" ? "確認尾款" : batchNextStatus ? `移至${getAdminStatusLabel(batchNextStatus)}` : "請選相同狀態"}</strong>
            </button>
          </>
        ) : null}

        {message.text ? <div className={`admin-page-message ${message.type}`}>{message.text}</div> : null}

        <div className="admin-order-list-head">
          <label><input type="checkbox" checked={allVisibleSelected} onChange={(event) => toggleSelectAll(event.target.checked)} aria-label="全選本頁" /></label>
          <span>訂單／顧客</span><span>交貨資訊</span><span>付款</span><span>總額</span><span>狀態</span><span />
        </div>

        <div className="admin-order-list" aria-busy={loading}>
          {loading ? <div className="admin-loading-state">正在載入訂單...</div> : null}
          {!loading && !orders.length ? <div className="admin-empty-state"><strong>找不到符合條件的訂單</strong><span>請調整搜尋或篩選條件。</span></div> : null}
          {!loading ? orders.map((order) => (
            <AdminOrderRow
              key={order.id}
              order={order}
              selected={selectedIds.includes(order.id)}
              onSelect={(checked) => setSelectedIds((current) => checked ? Array.from(new Set([...current, order.id])) : current.filter((id) => id !== order.id))}
              onOpen={() => setSelectedOrder(order)}
            />
          )) : null}
        </div>

        <div className="admin-pagination">
          <span>共 {totalOrders} 筆，第 {page} / {totalPages} 頁</span>
          <div>
            <button type="button" className="admin-icon-button" aria-label="上一頁" title="上一頁" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}><ChevronLeft size={18} /></button>
            <button type="button" className="admin-icon-button" aria-label="下一頁" title="下一頁" disabled={page >= totalPages} onClick={() => setPage((current) => Math.min(totalPages, current + 1))}><ChevronRight size={18} /></button>
          </div>
        </div>
      </section>

      {selectedOrder ? (
        <AdminOrderDrawer
          order={selectedOrder}
          deleting={deletingOrderId === selectedOrder.id}
          onClose={() => setSelectedOrder(null)}
          onDeleted={() => handleDeleteOrder(selectedOrder)}
          onUpdated={handleOrderUpdated}
        />
      ) : null}
    </AdminLayout>
  );
}

function SummaryCard({ icon: Icon, label, value, tone, onClick }) {
  return (
    <button type="button" className={`admin-summary-card ${tone}`} onClick={onClick}>
      <span className="admin-summary-icon"><Icon size={20} /></span>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function StatusTab({ value, label, count, active, onClick }) {
  return (
    <button type="button" role="tab" aria-selected={active === value} className={active === value ? "active" : ""} onClick={() => onClick(value)}>
      <span>{label}</span>
      <small className="admin-status-tab-count">{count}</small>
    </button>
  );
}

function FilterSelect({ label, value, options, onChange }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}
      </select>
    </label>
  );
}

function buildPurchaseItems(orders) {
  const groups = new Map();

  (orders || []).forEach((order) => {
    (order.order_items || []).forEach((item) => {
      const quantity = Math.max(1, Number(item.quantity) || 1);
      const name = String(item.product_name || "未命名商品").trim() || "未命名商品";
      const note = String(item.note || "").trim();
      const catalogProductId = String(item.catalog_product_id || "").trim();
      const key = catalogProductId
        ? `catalog:${catalogProductId}`
        : `custom:${name.toLocaleLowerCase("zh-TW")}:${note.toLocaleLowerCase("zh-TW")}`;
      const current = groups.get(key) || {
        key,
        name,
        note,
        quantity: 0,
        orderIds: new Set(),
        unitPrices: new Set(),
        estimatedAmount: 0,
      };

      current.quantity += quantity;
      current.orderIds.add(order.id);
      current.unitPrices.add(Math.max(0, Number(item.unit_price) || 0));
      current.estimatedAmount += Math.max(0, Number(item.unit_price) || 0) * quantity;
      groups.set(key, current);
    });
  });

  return Array.from(groups.values())
    .map((item) => ({
      ...item,
      orderCount: item.orderIds.size,
      unitPrices: Array.from(item.unitPrices).sort((left, right) => left - right),
    }))
    .sort((left, right) => right.quantity - left.quantity || left.name.localeCompare(right.name, "zh-TW"));
}

function PurchaseList({ items, orderCount, totalQuantity, loading, error, open, onToggle }) {
  return (
    <section className="admin-purchase-list" aria-label="採買統整清單" aria-busy={loading}>
      <button
        type="button"
        className={`admin-purchase-list-head${open ? " is-open" : ""}`}
        aria-expanded={open}
        onClick={onToggle}
      >
        <div>
          <span>SHOPPING LIST</span>
          <h2><ShoppingBasket size={23} />採買統整清單</h2>
          <p>採買進行中 {orderCount} 筆訂單，已依商品合併數量。</p>
        </div>
        <div className="admin-purchase-list-total">
          <span>本次採買</span>
          <strong>{totalQuantity} 件</strong>
          <span className="admin-purchase-list-toggle">
            {open ? "收合清單" : "展開清單"}<ChevronDown size={15} aria-hidden="true" />
          </span>
        </div>
      </button>

      {open && loading ? <div className="admin-purchase-list-state">正在整理所有採買進行中的商品...</div> : null}
      {open && !loading && error ? <div className="admin-purchase-list-state error">{error}</div> : null}
      {open && !loading && !error && !items.length ? <div className="admin-purchase-list-state">目前沒有採買進行中的商品。</div> : null}
      {open && !loading && !error && items.length ? (
        <div className="admin-purchase-list-items">
          {items.map((item) => {
            const unitPriceLabel = item.unitPrices.length === 1
              ? `單價 ${formatCurrency(item.unitPrices[0])}`
              : `單價 ${formatCurrency(item.unitPrices[0])}–${formatCurrency(item.unitPrices.at(-1))}`;
            return (
              <article key={item.key} className="admin-purchase-list-item">
                <div>
                  <strong>{item.name}</strong>
                  {item.note ? <small>備註：{item.note}</small> : null}
                </div>
                <span className="admin-purchase-list-meta">{unitPriceLabel} · {item.orderCount} 筆訂單</span>
                <strong className="admin-purchase-list-quantity">× {item.quantity}</strong>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function AdminOrderRow({ order, selected, onSelect, onOpen }) {
  const orderItems = order.order_items || [];
  const quantity = orderItems.reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
  const shippingAmount = orderItems.reduce((sum, item) => {
    const itemQuantity = Math.max(1, Number(item.quantity) || 1);
    const unitShipping = item.catalog_product_id
      ? Math.max(0, Number(item.shipping_fee_per_unit) || 0)
      : 20;
    return sum + itemQuantity * unitShipping;
  }, 0);
  const paymentStatus = order.payment_status || getPaymentStatus(order);
  return (
    <article className={`admin-order-row${selected ? " selected" : ""}`}>
      <label className="admin-row-check"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`選取訂單 ${order.id.slice(0, 8)}`} /></label>
      <button type="button" className="admin-order-row-main" onClick={onOpen}>
        <div className="admin-order-identity">
          <span className="admin-order-id-meta">#{order.id.slice(0, 8)} · {order.fulfilled_at ? `完成 ${formatDateTime(order.fulfilled_at)}` : formatDateTime(order.created_at)}</span>
          <strong className="admin-order-customer-name">{order.customer_name}</strong>
        </div>
        <div className="admin-order-mobile-contact">
          <strong>{order.customer_name}</strong>
          <span><Phone size={13} aria-hidden="true" />{order.phone || "未提供電話"}</span>
        </div>
        <div className="admin-order-delivery">
          <strong className="admin-order-desktop-location"><MapPin size={13} aria-hidden="true" />{order.delivery_location}</strong>
          <strong className="admin-order-mobile-phone"><Phone size={13} aria-hidden="true" />{order.phone || "未提供電話"}</strong>
          <span className="admin-order-desktop-quantity"><Package size={13} aria-hidden="true" />{quantity} 件商品<span className="admin-order-desktop-phone"> · {order.phone}</span></span>
          <div className="admin-order-mobile-fulfillment">
            <span><MapPin size={13} aria-hidden="true" />{order.delivery_location || "未指定交貨地點"}</span>
            <span><Package size={13} aria-hidden="true" />{quantity} 件商品</span>
          </div>
        </div>
        <div className="admin-order-payment">
          <span className={`admin-payment-badge payment-${paymentStatus}`}>{paymentStatusLabels[paymentStatus]}</span>
          <span className="admin-mobile-order-detail">查看明細<ChevronRight size={16} aria-hidden="true" /></span>
        </div>
        <div className="admin-row-total">
          <strong>{formatCurrency(order.total_amount)}</strong>
          <small>運費 {formatCurrency(shippingAmount)}</small>
        </div>
        <div className="admin-order-status"><span className={`admin-status-badge status-${order.status}`}>{getAdminStatusLabel(order.status)}</span></div>
        <ChevronRight size={18} className="admin-row-chevron" />
      </button>
    </article>
  );
}
