import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Download,
  Filter,
  PackageCheck,
  RefreshCw,
  Search,
  WalletCards,
} from "lucide-react";
import AdminLayout from "../components/AdminLayout";
import AdminOrderDrawer from "../components/AdminOrderDrawer";
import {
  bulkUpdateOrders,
  exportAdminOrders,
  loadAdminOrders,
  loadAdminSummary,
} from "../services/adminService";
import {
  adminStatusLabels,
  adminStatusOrder,
  getAdminStatusLabel,
  getNextAdminStatus,
  getPaymentStatus,
  paymentStatusLabels,
} from "../utils/adminOrders";
import { formatCurrency, formatDateTime } from "../utils/format";

const pageSize = 12;
const locations = ["明德樓", "據德樓", "蘊德樓", "機車停車場"];

const initialFilters = {
  status: "all",
  paymentStatus: "all",
  location: "all",
  dateFrom: "",
  dateTo: "",
};

function escapeCsv(value) {
  const text = String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function getAdminError(error) {
  const raw = String(error?.message || "");
  if (raw.includes("Could not find the function") || raw.includes("admin_list_orders")) {
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
    ready_pickup: 0,
    outstanding_amount: 0,
  });
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
  const [newOrdersAvailable, setNewOrdersAvailable] = useState(false);

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
    ]).then(([ordersResult, summaryResult]) => {
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
      setLastUpdated(new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }));
      setLoading(false);
      setRefreshing(false);
    });

    return () => {
      active = false;
    };
  }, [page, refreshKey, requestFilters]);

  useEffect(() => {
    const timer = setInterval(async () => {
      const { data, error } = await loadAdminSummary();
      if (error || !data) return;
      const changed =
        Number(data.today_orders) !== Number(summary.today_orders) ||
        Number(data.pending_deposit) !== Number(summary.pending_deposit) ||
        Number(data.ready_pickup) !== Number(summary.ready_pickup);
      if (changed) setNewOrdersAvailable(true);
      setSummary(data);
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
    const reason = batchNextStatus === "archived" ? "批次封存已完成訂單" : "批次推進訂單流程";
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
        <SummaryCard icon={CalendarDays} label="今日新單" value={`${summary.today_orders || 0} 筆`} tone="blue" onClick={() => selectSummary("all")} />
        <SummaryCard icon={Bell} label="待確認訂金" value={`${summary.pending_deposit || 0} 筆`} tone="red" onClick={() => selectSummary("pending_deposit")} />
        <SummaryCard icon={PackageCheck} label="待取貨" value={`${summary.ready_pickup || 0} 筆`} tone="green" onClick={() => selectSummary("ready_pickup")} />
        <SummaryCard icon={WalletCards} label="待收餘額" value={formatCurrency(summary.outstanding_amount || 0)} tone="amber" onClick={() => setFilter("paymentStatus", "unpaid")} />
      </section>

      {newOrdersAvailable ? (
        <button type="button" className="admin-new-order-alert" onClick={refreshOrders}>
          <Bell size={17} />訂單資料已有更新，點擊載入最新內容
        </button>
      ) : null}

      <section className="admin-order-workspace">
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
          <StatusTab value="all" label="全部" active={filters.status} onClick={selectSummary} />
          {adminStatusOrder.map((value) => (
            <StatusTab key={value} value={value} label={adminStatusLabels[value]} active={filters.status} onClick={selectSummary} />
          ))}
        </div>

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
          <div className="admin-bulk-bar">
            <strong>已選 {selectedIds.length} 筆</strong>
            {batchNextStatus ? (
              <button type="button" className="admin-primary-button" onClick={handleBatchAdvance}>
                批次移至{getAdminStatusLabel(batchNextStatus)}
              </button>
            ) : (
              <span>所選訂單階段不同，請選擇相同狀態的訂單。</span>
            )}
            <button type="button" className="admin-text-button" onClick={() => setSelectedIds([])}>取消選取</button>
          </div>
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
        <AdminOrderDrawer order={selectedOrder} onClose={() => setSelectedOrder(null)} onUpdated={handleOrderUpdated} />
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

function StatusTab({ value, label, active, onClick }) {
  return <button type="button" role="tab" aria-selected={active === value} className={active === value ? "active" : ""} onClick={() => onClick(value)}>{label}</button>;
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

function AdminOrderRow({ order, selected, onSelect, onOpen }) {
  const quantity = (order.order_items || []).reduce((sum, item) => sum + Math.max(1, Number(item.quantity) || 1), 0);
  const paymentStatus = order.payment_status || getPaymentStatus(order);
  return (
    <article className={`admin-order-row${selected ? " selected" : ""}`}>
      <label className="admin-row-check"><input type="checkbox" checked={selected} onChange={(event) => onSelect(event.target.checked)} aria-label={`選取訂單 ${order.id.slice(0, 8)}`} /></label>
      <button type="button" className="admin-order-row-main" onClick={onOpen}>
        <div className="admin-order-identity">
          <strong>{order.customer_name}</strong>
          <span>#{order.id.slice(0, 8)} · {formatDateTime(order.created_at)}</span>
        </div>
        <div className="admin-order-delivery"><strong>{order.delivery_location}</strong><span>{quantity} 件商品 · {order.phone}</span></div>
        <div><span className={`admin-payment-badge payment-${paymentStatus}`}>{paymentStatusLabels[paymentStatus]}</span></div>
        <strong className="admin-row-total">{formatCurrency(order.total_amount)}</strong>
        <div><span className={`admin-status-badge status-${order.status}`}>{getAdminStatusLabel(order.status)}</span></div>
        <ChevronRight size={18} className="admin-row-chevron" />
      </button>
    </article>
  );
}
