import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  BarChart3,
  CircleDollarSign,
  PackageOpen,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import AdminLayout from "../components/AdminLayout";
import { loadAdminOperatingReport } from "../services/adminService";
import { formatCurrency, formatDateTime } from "../utils/format";

const periods = [
  ["today", "今日"],
  ["week", "近 7 日"],
  ["month", "本月"],
  ["all", "全部"],
];

const emptyReport = {
  earned_shipping_amount: 0,
  earned_orders: 0,
  estimated_shipping_amount: 0,
  estimated_orders: 0,
  collected_amount: 0,
  outstanding_amount: 0,
  outstanding_orders: 0,
  daily_shipping: [],
};

function reportErrorMessage(error) {
  const message = String(error?.message || "");
  if (message.includes("admin_operating_report")) return "報表資料庫尚未更新。";
  return message || "無法載入營運報表。";
}

export default function AdminReportsPage() {
  const [period, setPeriod] = useState("month");
  const [report, setReport] = useState(emptyReport);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [lastUpdated, setLastUpdated] = useState("--");

  const loadReport = useCallback(async (nextPeriod, showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);
    setMessage("");
    const { data, error } = await loadAdminOperatingReport(nextPeriod);
    if (error || !data) {
      setMessage(reportErrorMessage(error));
      setReport(emptyReport);
    } else {
      setReport({ ...emptyReport, ...data, daily_shipping: Array.isArray(data.daily_shipping) ? data.daily_shipping : [] });
      setLastUpdated(formatDateTime(new Date().toISOString()));
    }
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    loadReport(period);
  }, [loadReport, period]);

  const trendMax = useMemo(
    () => Math.max(20, ...report.daily_shipping.map((item) => Number(item.amount || 0))),
    [report.daily_shipping]
  );

  const topbarActions = (
    <button
      type="button"
      className="admin-icon-button"
      aria-label="重新整理營運報表"
      title="重新整理"
      disabled={loading || refreshing}
      onClick={() => loadReport(period, true)}
    >
      <RefreshCw size={18} className={refreshing ? "is-spinning" : ""} aria-hidden="true" />
    </button>
  );

  return (
    <AdminLayout title="營運報表" subtitle={`更新於 ${lastUpdated}`} actions={topbarActions}>
      <section className="admin-report-panel" aria-label="營運摘要">
        <div className="admin-report-panel-head">
          <div>
            <span>OPERATIONS</span>
            <h2><BarChart3 size={21} aria-hidden="true" />營運摘要</h2>
          </div>
          <div className="admin-report-periods" role="group" aria-label="實收期間">
            {periods.map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={period === value ? "active" : ""}
                aria-pressed={period === value}
                onClick={() => setPeriod(value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {message ? <p className="admin-report-message" role="alert">{message}</p> : null}
        <div className={`admin-report-metrics${loading ? " is-loading" : ""}`} aria-live="polite">
          <ReportMetric
            icon={CircleDollarSign}
            tone="profit"
            label="近 7 日已賺運費"
            value={report.earned_shipping_amount}
            meta={`${report.earned_orders} 筆完成訂單`}
          />
          <ReportMetric
            icon={PackageOpen}
            tone="estimated"
            label="進行中預估運費"
            value={report.estimated_shipping_amount}
            meta={`${report.estimated_orders} 筆進行中`}
          />
          <ReportMetric
            icon={Banknote}
            tone="collected"
            label="本期實收"
            value={report.collected_amount}
            meta="訂金與尾款"
          />
          <ReportMetric
            icon={TriangleAlert}
            tone="outstanding"
            label="待收款"
            value={report.outstanding_amount}
            meta={`${report.outstanding_orders} 筆待確認`}
          />
        </div>
      </section>

      <section className="admin-report-trend" aria-label="近七日運費趨勢">
        <div className="admin-report-trend-head">
          <div>
            <span>SHIPPING REVENUE</span>
            <h2>近 7 日運費</h2>
          </div>
          <CircleDollarSign size={22} aria-hidden="true" />
        </div>
        <div className={`admin-report-bars${loading ? " is-loading" : ""}`}>
          {report.daily_shipping.map((item) => {
            const amount = Number(item.amount || 0);
            const height = Math.max(8, Math.round((amount / trendMax) * 100));
            const label = `${item.date}：${formatCurrency(amount)}，${item.orders || 0} 筆`;
            return (
              <div className="admin-report-bar-item" key={item.date} title={label} aria-label={label}>
                <strong>{amount > 0 ? formatCurrency(amount) : ""}</strong>
                <span className="admin-report-bar-track"><i style={{ height: `${height}%` }} /></span>
                <small>{item.date}</small>
              </div>
            );
          })}
        </div>
      </section>
    </AdminLayout>
  );
}

function ReportMetric({ icon: Icon, tone, label, value, meta }) {
  return (
    <div className={`admin-report-metric ${tone}`}>
      <span className="admin-report-metric-icon"><Icon size={21} aria-hidden="true" /></span>
      <div>
        <span>{label}</span>
        <strong>{formatCurrency(value)}</strong>
        <small>{meta}</small>
      </div>
    </div>
  );
}
