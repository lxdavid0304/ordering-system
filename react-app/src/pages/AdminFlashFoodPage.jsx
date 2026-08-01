import { useEffect, useMemo, useState } from "react";
import { BarChart3, BellRing, CalendarClock, ChevronDown, ChevronUp, CircleOff, ClipboardList, Clock3, MapPin, PackageCheck, Pencil, RefreshCw, Save, UsersRound } from "lucide-react";
import AdminLayout from "../components/AdminLayout";
import FormMessage from "../components/FormMessage";
import { cancelFlashFoodCampaign, createFlashFoodCampaign, loadAdminFlashFoodCampaigns, loadAdminFlashFoodOperatingReport, markFlashFoodCampaignReady, resendFlashFoodReadyNotification, updateFlashFoodCampaign } from "../services/flashFoodService";
import {
  FLASH_FOOD_SHIPPING_FEE,
  FLASH_FOOD_MEMBER_PICKUP_LOCATION,
  flashFoodPickupLocations,
  flashFoodMenu,
  formatFlashFoodDateTime,
  fromDateTimeLocalValue,
  getFlashFoodCampaignState,
  getFlashFoodCampaignStateLabel,
  toDateTimeLocalValue,
} from "../utils/flashFood";
import { formatCurrency } from "../utils/format";

function nextLocalDateParts(hoursFromNow) {
  return splitEditDateTime(new Date(Date.now() + hoursFromNow * 60 * 60 * 1000));
}

function createInitialForm() {
  const openAt = nextLocalDateParts(1);
  const deadlineAt = nextLocalDateParts(3);
  const pickupAt = nextLocalDateParts(4);
  return {
    title: "",
    year: openAt.year,
    open_day: openAt.monthDay,
    open_time: openAt.time,
    deadline_day: deadlineAt.monthDay,
    deadline_time: deadlineAt.time,
    pickup_start_day: pickupAt.monthDay,
    pickup_start_time: pickupAt.time,
    note: "",
    // 快閃熱食團預設開放完整菜單；管理員仍可依當日供應狀況取消個別品項。
    menu: flashFoodMenu.map((item) => ({ ...item, selected: true })),
  };
}

function normalizeTenMinuteTime(value) {
  const match = String(value || "").match(/^(\d{2}):(\d{2})$/);
  if (!match) return "00:00";
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.floor(Math.min(59, Math.max(0, Number(match[2]))) / 10) * 10;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function splitEditDateTime(value) {
  const [date = "", time = ""] = toDateTimeLocalValue(value).split("T");
  const [year = "", month = "", day = ""] = date.split("-");
  return { year, monthDay: month && day ? `${month}/${day}` : "", time: normalizeTenMinuteTime(time) };
}

function toCampaignDateTime(year, monthDay, time) {
  const match = String(monthDay || "").trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!match || !/^\d{4}$/.test(String(year || "")) || !/^\d{2}:\d{2}$/.test(String(time || ""))) return null;
  const month = String(match[1]).padStart(2, "0");
  const day = String(match[2]).padStart(2, "0");
  return fromDateTimeLocalValue(`${year}-${month}-${day}T${time}`);
}

function createEditDraft(campaign) {
  const openAt = splitEditDateTime(campaign.open_at);
  const deadlineAt = splitEditDateTime(campaign.deadline_at);
  const pickupStartAt = splitEditDateTime(campaign.pickup_start_at);
  return {
    id: campaign.id,
    title: campaign.title || "",
    year: openAt.year,
    open_day: openAt.monthDay,
    open_time: openAt.time,
    deadline_day: deadlineAt.monthDay,
    deadline_time: deadlineAt.time,
    pickup_start_day: pickupStartAt.monthDay,
    pickup_start_time: pickupStartAt.time,
    note: campaign.note || "",
  };
}

function createReadyDraft(campaign) {
  const pickupAt = splitEditDateTime(campaign.pickup_start_at);
  return {
    campaignId: campaign.id,
    year: pickupAt.year,
    day: pickupAt.monthDay,
    time: pickupAt.time,
  };
}

function CampaignTimeSlot({ label, day, time, onDayChange, onTimeChange }) {
  const [hour = "00", minute = "00"] = String(time || "00:00").split(":");
  const updateTimePart = (nextHour, nextMinute) => onTimeChange(`${nextHour}:${nextMinute}`);

  return (
    <label className="flash-schedule-slot">
      <span>{label}</span>
      <div className="flash-schedule-inputs">
        <span className="flash-time-wheel" aria-label={`${label} 24-hour time picker`}>
          <select value={hour} aria-label={`${label} hour`} onChange={(event) => updateTimePart(event.target.value, minute)}>
            {Array.from({ length: 24 }, (_, value) => String(value).padStart(2, "0")).map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
          <b aria-hidden="true">:</b>
          <select value={minute} aria-label={`${label} minute`} onChange={(event) => updateTimePart(hour, event.target.value)}>
            {Array.from({ length: 6 }, (_, value) => String(value * 10).padStart(2, "0")).map((value) => <option value={value} key={value}>{value}</option>)}
          </select>
        </span>
        <input value={day} inputMode="numeric" pattern="\d{1,2}/\d{1,2}" placeholder="MM/DD" aria-label={`${label}日期`} onChange={(event) => onDayChange(event.target.value)} required />
        <input value={time} inputMode="numeric" pattern="(?:[01]\\d|2[0-3]):[0-5]\\d" placeholder="HH:mm" aria-label={`${label}時間（24 小時制）`} onChange={(event) => onTimeChange(event.target.value)} required />
      </div>
    </label>
  );
}

function buildPurchaseTotals(campaign, orders) {
  const menuOrder = new Map((campaign.flash_food_campaign_items || []).map((item, index) => [item.product_name, index]));
  const totals = new Map();

  orders.forEach((order) => {
    (order.flash_food_order_items || []).forEach((item) => {
      const key = `${item.product_name}__${item.item_note || ""}`;
      const current = totals.get(key) || {
        productName: item.product_name,
        itemNote: item.item_note || "",
        quantity: 0,
        sortOrder: menuOrder.get(item.product_name) ?? Number.MAX_SAFE_INTEGER,
      };
      current.quantity += Number(item.quantity || 0);
      totals.set(key, current);
    });
  });

  return [...totals.values()].sort((left, right) => left.sortOrder - right.sortOrder || left.productName.localeCompare(right.productName, "zh-Hant"));
}

function buildPickupGroups(orders) {
  return flashFoodPickupLocations.map((location) => ({
    location,
    orders: orders.filter((order) => order.pickup_location === location),
  }));
}

const reportPeriods = [
  ["week", "本週開團"],
  ["month", "本月開團"],
  ["all", "所有開團"],
];

const emptyOperatingReport = {
  campaigns: [],
};

function getOperatingReportError(error) {
  const message = String(error?.message || "");
  if (message.includes("admin_flash_food_operating_report")) return "快閃熱食報表資料庫尚未更新。";
  return message || "無法讀取快閃熱食營運報表。";
}

function FlashFoodOperatingReport({ report, period, loading, message, onPeriodChange, onRefresh }) {
  const campaigns = Array.isArray(report.campaigns) ? report.campaigns : [];

  return (
    <section className="flash-operating-report" aria-label="快閃熱食營運報表">
      <div className="flash-operating-report-head">
        <div>
          <span>FLASH FOOD OPERATIONS</span>
          <h2><BarChart3 size={21} aria-hidden="true" />營運報表</h2>
          <p>依每次開團時間統計；已送出與已完成訂單皆納入，取消訂單不計入。</p>
        </div>
        <button type="button" className="admin-secondary-button flash-report-refresh" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={16} className={loading ? "is-spinning" : ""} aria-hidden="true" />重新整理
        </button>
      </div>

      <div className="flash-report-periods flash-report-periods-three" role="group" aria-label="開團期間">
        {reportPeriods.map(([value, label]) => <button key={value} type="button" className={period === value ? "active" : ""} aria-pressed={period === value} onClick={() => onPeriodChange(value)}>{label}</button>)}
      </div>

      {message ? <p className="flash-report-message" role="alert">{message}</p> : null}

      <section className="flash-report-section" aria-labelledby="flash-report-campaigns-title">
        <div className="flash-report-section-head"><div><span>CAMPAIGN REPORT</span><h3 id="flash-report-campaigns-title">每次開團統計</h3></div><small>{campaigns.length} 團</small></div>
        <div className={`flash-report-table-wrap${loading ? " is-loading" : ""}`}><table><thead><tr><th>開團活動</th><th>訂單數</th><th>訂購人數</th><th>商品總金額</th><th>運費收入</th></tr></thead><tbody>{campaigns.length ? campaigns.map((campaign) => <tr key={campaign.campaign_id}><td><strong>{campaign.title}</strong><small>{formatFlashFoodDateTime(campaign.open_at)} 開團</small></td><td>{campaign.order_count} 筆</td><td>{campaign.customer_count} 人</td><td><b>${formatCurrency(campaign.product_amount)}</b></td><td>${formatCurrency(campaign.shipping_amount)}</td></tr>) : <tr className="flash-report-empty-row"><td colSpan="5">此期間尚無開團活動。</td></tr>}</tbody></table></div>
      </section>
    </section>
  );
}

export default function AdminFlashFoodPage() {
  const [form, setForm] = useState(createInitialForm);
  const [campaigns, setCampaigns] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [cancelDraft, setCancelDraft] = useState({ campaignId: "", reason: "" });
  const [editDraft, setEditDraft] = useState(null);
  const [readyDraft, setReadyDraft] = useState(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState("");
  const [expandedPickupManifest, setExpandedPickupManifest] = useState({ campaignId: "", location: "" });
  const [activePanel, setActivePanel] = useState("manage");
  const [reportPeriod, setReportPeriod] = useState("month");
  const [operatingReport, setOperatingReport] = useState(emptyOperatingReport);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportMessage, setReportMessage] = useState("");

  const selectedCount = useMemo(
    () => form.menu.filter((item) => item.selected).length,
    [form.menu]
  );

  const campaignPanels = useMemo(() => {
    const current = campaigns.filter((campaign) => {
      const state = getFlashFoodCampaignState(campaign);
      return state !== "ready" && state !== "cancelled";
    });
    const history = campaigns.filter((campaign) => {
      const state = getFlashFoodCampaignState(campaign);
      return state === "ready" || state === "cancelled";
    });
    return { current, history };
  }, [campaigns]);

  const visibleCampaigns = activePanel === "manage"
    ? campaignPanels.current
    : activePanel === "history"
      ? campaignPanels.history
      : [];

  async function refreshCampaigns() {
    setLoading(true);
    const { data, error } = await loadAdminFlashFoodCampaigns();
    if (error) {
      setCampaigns([]);
      setMessage({ text: error.message || "無法載入快閃熱食活動。", type: "error" });
    } else {
      setCampaigns(data || []);
    }
    setLoading(false);
  }

  async function refreshOperatingReport() {
    setReportLoading(true);
    setReportMessage("");
    const { data, error } = await loadAdminFlashFoodOperatingReport(reportPeriod);
    if (error || !data) {
      setOperatingReport(emptyOperatingReport);
      setReportMessage(getOperatingReportError(error));
    } else {
      setOperatingReport({
        ...emptyOperatingReport,
        ...data,
        campaigns: Array.isArray(data.campaigns) ? data.campaigns : [],
      });
    }
    setReportLoading(false);
  }

  useEffect(() => {
    document.title = "快閃熱食開團｜管理後台";
    refreshCampaigns();
  }, []);

  useEffect(() => {
    if (activePanel === "report") refreshOperatingReport();
  }, [activePanel, reportPeriod]);

  function updateField(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  function updateMenu(index, nextValues) {
    setForm((current) => ({
      ...current,
      menu: current.menu.map((item, itemIndex) => (itemIndex === index ? { ...item, ...nextValues } : item)),
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!form.title.trim()) {
      setActivePanel("create");
      setMessage({ text: "請先填寫活動名稱，例如：7/28 宵夜熱食。", type: "error" });
      return;
    }
    const items = form.menu
      .filter((item) => item.selected)
      .map((item) => ({
        product_name: item.product_name,
        item_note: item.item_note || "",
        unit_price: Math.max(0, Math.floor(Number(item.unit_price) || 0)),
      }));

    if (!items.length) {
      setMessage({ text: "請至少選擇一個本次開放品項。", type: "error" });
      return;
    }

    const schedule = {
      open_at: toCampaignDateTime(form.year, form.open_day, form.open_time),
      deadline_at: toCampaignDateTime(form.year, form.deadline_day, form.deadline_time),
      // 熱食在截止後立即統一採買，無需由管理員額外排程採買時間。
      purchase_at: toCampaignDateTime(form.year, form.deadline_day, form.deadline_time),
      pickup_start_at: toCampaignDateTime(form.year, form.pickup_start_day, form.pickup_start_time),
      pickup_end_at: toCampaignDateTime(form.year, form.pickup_start_day, form.pickup_start_time),
    };
    if (Object.values(schedule).some((value) => !value)) {
      setMessage({ text: "請完整填寫開團、截止、採買與取貨時間。", type: "error" });
      return;
    }

    setSaving(true);
    setMessage({ text: "正在建立快閃熱食團…", type: "" });
    const { error, notificationError } = await createFlashFoodCampaign({
      ...form,
      ...schedule,
      pickup_location: FLASH_FOOD_MEMBER_PICKUP_LOCATION,
      items,
    });
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || "建立活動失敗。", type: "error" });
      return;
    }

    setForm(createInitialForm());
    setMessage({
      text: notificationError ? "快閃熱食團已建立；LINE 通知部分發送失敗，已保留在通知佇列。" : "快閃熱食團已建立，已通知已綁定官方 LINE 的會員。",
      type: "success",
    });
    await refreshCampaigns();
  }

  async function handleCancel(campaign) {
    const { error, notificationError } = await cancelFlashFoodCampaign(campaign.id, cancelDraft.reason);
    if (error) {
      setMessage({ text: error.message || "取消活動失敗。", type: "error" });
      return;
    }
    setCancelDraft({ campaignId: "", reason: "" });
    setMessage({ text: notificationError ? "活動已取消；LINE 通知部分發送失敗，已保留在通知佇列。" : "活動已取消，會員訂單與 LINE 通知已同步處理。", type: "success" });
    await refreshCampaigns();
  }

  async function handleCampaignUpdate(event) {
    event.preventDefault();
    if (!editDraft) return;

    const schedule = {
      open_at: toCampaignDateTime(editDraft.year, editDraft.open_day, editDraft.open_time),
      deadline_at: toCampaignDateTime(editDraft.year, editDraft.deadline_day, editDraft.deadline_time),
      purchase_at: toCampaignDateTime(editDraft.year, editDraft.deadline_day, editDraft.deadline_time),
      pickup_start_at: toCampaignDateTime(editDraft.year, editDraft.pickup_start_day, editDraft.pickup_start_time),
      pickup_end_at: toCampaignDateTime(editDraft.year, editDraft.pickup_start_day, editDraft.pickup_start_time),
    };
    if (Object.values(schedule).some((value) => !value)) {
      setMessage({ text: "請完整填寫活動時間。", type: "error" });
      return;
    }

    setSaving(true);
    const { error } = await updateFlashFoodCampaign({ ...editDraft, ...schedule });
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || "活動設定更新失敗。", type: "error" });
      return;
    }

    setEditDraft(null);
    setMessage({ text: "活動設定已更新。", type: "success" });
    await refreshCampaigns();
  }

  async function handleReadyNotification(event) {
    event.preventDefault();
    if (!readyDraft) return;
    const pickupReadyAt = toCampaignDateTime(readyDraft.year, readyDraft.day, readyDraft.time);
    if (!pickupReadyAt) {
      setMessage({ text: "請填入正確的實際取餐時間。", type: "error" });
      return;
    }

    setSaving(true);
    const { error, notificationError } = await markFlashFoodCampaignReady(readyDraft.campaignId, pickupReadyAt);
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || "取餐通知發送失敗。", type: "error" });
      return;
    }
    setReadyDraft(null);
    setMessage({ text: notificationError ? "已更新實際取餐時間；LINE 通知部分發送失敗，已保留在通知佇列。" : "已通知本團已送出點餐的會員前來取餐。", type: "success" });
    await refreshCampaigns();
  }

  async function handleResendReadyNotification(campaignId) {
    setSaving(true);
    const { error, notificationError } = await resendFlashFoodReadyNotification(campaignId);
    setSaving(false);
    if (error) {
      setMessage({ text: error.message || "重新通知失敗。", type: "error" });
      return;
    }
    setMessage({ text: notificationError ? "通知已重新排入佇列，但部分發送失敗。" : "已重新通知本團會員。", type: "success" });
  }

  return (
    <AdminLayout
      title="快閃熱食開團"
      subtitle="限定管理員建立活動；每一份商品固定加收 $20 運費。"
    >
      <div className="flash-admin-workbench">
        <div className="flash-admin-workbench-head">
          <div>
            <span>FLASH FOOD WORKSPACE</span>
            <h2>快閃熱食工作台</h2>
            <p>在同一頁切換開團、處理進行中活動與查閱歷史紀錄。</p>
          </div>
          <button type="button" className="admin-secondary-button flash-workbench-refresh" onClick={refreshCampaigns} disabled={loading}>重新整理</button>
        </div>

        <div className="flash-admin-tabs" role="tablist" aria-label="快閃熱食工作區">
          <button type="button" role="tab" aria-selected={activePanel === "report"} className={activePanel === "report" ? "active" : ""} onClick={() => setActivePanel("report")}>
            <span>營運報表</span><small>◎</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "manage"} className={activePanel === "manage" ? "active" : ""} onClick={() => setActivePanel("manage")}>
            <span>管理中</span><small>{campaignPanels.current.length}</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "create"} className={activePanel === "create" ? "active" : ""} onClick={() => setActivePanel("create")}>
            <span>開新團</span><small>＋</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "menu"} className={activePanel === "menu" ? "active" : ""} onClick={() => setActivePanel("menu")}>
            <span>菜單品項</span><small>{selectedCount}</small>
          </button>
          <button type="button" role="tab" aria-selected={activePanel === "history"} className={activePanel === "history" ? "active" : ""} onClick={() => setActivePanel("history")}>
            <span>歷史紀錄</span><small>{campaignPanels.history.length}</small>
          </button>
        </div>

        <div className={`flash-admin-layout flash-admin-panel-${activePanel}`}>
        {["create", "menu"].includes(activePanel) ? <section className="flash-admin-form-panel">
          <div className="admin-section-heading">
            <div>
              <span>FLASH FOOD COURT</span>
              <h2>{activePanel === "create" ? "開新快閃團" : "菜單品項"}</h2>
            </div>
            <span className="flash-fee-pill">{activePanel === "create" ? `每件運費 $${FLASH_FOOD_SHIPPING_FEE}` : `已選 ${selectedCount} 項`}</span>
          </div>

          <form className="flash-campaign-form" onSubmit={handleSubmit} noValidate>
            {activePanel === "create" ? <div className="flash-form-grid">
              <label className="admin-field flash-title-field">
                <span>活動名稱</span>
                <input value={form.title} onChange={(event) => updateField("title", event.target.value)} placeholder="例如：7/30（三）午餐熱食快閃團" required />
              </label>
              <label className="admin-field flash-year-field">
                <span>年份</span>
                <select value={form.year} onChange={(event) => updateField("year", event.target.value)}>{[String(new Date().getFullYear()), String(new Date().getFullYear() + 1)].map((year) => <option value={year} key={year}>{year} 年</option>)}</select>
              </label>
              <div className="flash-schedule-editor" aria-label="活動時間設定">
                <CampaignTimeSlot label="開團" day={form.open_day} time={form.open_time} onDayChange={(value) => updateField("open_day", value)} onTimeChange={(value) => updateField("open_time", value)} />
                <CampaignTimeSlot label="截止" day={form.deadline_day} time={form.deadline_time} onDayChange={(value) => updateField("deadline_day", value)} onTimeChange={(value) => updateField("deadline_time", value)} />
                <CampaignTimeSlot label="預估取餐" day={form.pickup_start_day} time={form.pickup_start_time} onDayChange={(value) => updateField("pickup_start_day", value)} onTimeChange={(value) => updateField("pickup_start_time", value)} />
              </div>
              <label className="admin-field flash-field-wide">
                <span>活動提醒</span>
                <textarea rows="3" value={form.note} onChange={(event) => updateField("note", event.target.value)} placeholder="例如：熱食請在取貨時段內領取；售完品項將不計費。" />
              </label>
            </div> : null}

            {activePanel === "menu" ? <div className="flash-menu-editor">
              <div className="flash-menu-editor-head">
                <div>
                  <strong>本次開放品項</strong>
                  <span>已選 {selectedCount} 項；披薩可在備註填寫口味。</span>
                </div>
                <span>現場價 + $20 運費</span>
              </div>
              <div className="flash-menu-options">
                {form.menu.map((item, index) => (
                  <div className={`flash-menu-option${item.selected ? " selected" : ""}`} key={item.product_name}>
                    <label className="flash-menu-toggle">
                      <input type="checkbox" checked={item.selected} onChange={(event) => updateMenu(index, { selected: event.target.checked })} />
                      <span>{item.product_name}</span>
                    </label>
                    <label>
                      <span>現場價</span>
                      <input type="number" min="0" value={item.unit_price} disabled={!item.selected} onChange={(event) => updateMenu(index, { unit_price: event.target.value })} />
                    </label>
                    <label>
                      <span>備註</span>
                      <input value={item.item_note || ""} disabled={!item.selected} onChange={(event) => updateMenu(index, { item_note: event.target.value })} placeholder={item.product_name.includes("披薩") ? "例如：起司" : "選填"} />
                    </label>
                  </div>
                ))}
              </div>
            </div> : null}

            <div className="admin-form-actions flash-campaign-actions">
              {activePanel === "create" ? <button type="button" className="admin-secondary-button" onClick={() => setActivePanel("menu")}>
                設定菜單品項
              </button> : <button type="button" className="admin-secondary-button" onClick={() => setActivePanel("create")}>
                返回開新團
              </button>}
              <button type="submit" className="admin-primary-button" disabled={saving}>
                <Save size={17} aria-hidden="true" />
                {saving ? "建立中…" : "建立熱食部"}
              </button>
              <FormMessage text={message.text} type={message.type} />
            </div>
          </form>
        </section> : null}

        {activePanel === "report" ? <FlashFoodOperatingReport report={operatingReport} period={reportPeriod} loading={reportLoading} message={reportMessage} onPeriodChange={setReportPeriod} onRefresh={refreshOperatingReport} /> : null}

        {["manage", "history"].includes(activePanel) ? <section className="flash-admin-list-panel">
          <div className="admin-section-heading">
            <div>
              <span>CAMPAIGN STATUS</span>
              <h2>{activePanel === "manage" ? "進行中活動" : "歷史活動"}</h2>
            </div>
            <span className="flash-panel-count">{visibleCampaigns.length} 筆</span>
          </div>
          {loading ? <p className="admin-loading-state">正在讀取活動…</p> : null}
          {!loading && !visibleCampaigns.length ? <p className="admin-empty-text">{activePanel === "manage" ? "目前沒有進行中的快閃活動。可從「開新團」建立活動。" : "目前沒有可查閱的歷史快閃活動。"}</p> : null}
          <div className="flash-admin-campaign-list">
            {visibleCampaigns.map((campaign) => {
              const state = getFlashFoodCampaignState(campaign);
              const orders = campaign.flash_food_orders || [];
              const activeOrders = orders.filter((order) => order.status === "submitted");
              const purchaseTotals = buildPurchaseTotals(campaign, activeOrders);
              const pickupGroups = buildPickupGroups(activeOrders);
              const isCampaignExpanded = expandedCampaignId === campaign.id;
              const selectedPickupGroup = expandedPickupManifest.campaignId === campaign.id
                ? pickupGroups.find((group) => group.location === expandedPickupManifest.location)
                : null;
              const pickupCounts = flashFoodPickupLocations.map((location) => ({
                location,
                count: orders.filter((order) => order.status === "submitted" && order.pickup_location === location).length,
              }));
              return (
                <article className={`flash-admin-campaign-card${isCampaignExpanded ? " is-expanded" : ""}`} key={campaign.id}>
                  <div className="flash-admin-campaign-topline">
                    <span className={`flash-state-badge ${state}`}>{getFlashFoodCampaignStateLabel(state)}</span>
                    <span>{formatFlashFoodDateTime(campaign.deadline_at)} 截止</span>
                  </div>
                  <h3>{campaign.title}</h3>
                  <div className="flash-admin-campaign-times">
                    <span><Clock3 size={15} aria-hidden="true" /> 點餐：{formatFlashFoodDateTime(campaign.open_at)} 至 {formatFlashFoodDateTime(campaign.deadline_at)}</span>
                    <span><MapPin size={15} aria-hidden="true" /> 預估取餐：{formatFlashFoodDateTime(campaign.pickup_start_at)}</span>
                  </div>
                  <button
                    type="button"
                    className="flash-admin-campaign-toggle"
                    aria-expanded={isCampaignExpanded}
                    onClick={() => {
                      setExpandedCampaignId((current) => current === campaign.id ? "" : campaign.id);
                      if (isCampaignExpanded) setExpandedPickupManifest({ campaignId: "", location: "" });
                    }}
                  >
                    <span>{isCampaignExpanded ? "收合詳細資料" : "查看詳細資料"}</span>
                    {isCampaignExpanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
                  </button>
                  {isCampaignExpanded ? <div className="flash-admin-campaign-detail">
                  {campaign.note ? <p className="flash-admin-campaign-note">{campaign.note}</p> : null}
                  <div className="flash-admin-campaign-summary">
                    <span><UsersRound size={15} aria-hidden="true" /> {activeOrders.length} 筆點餐</span>
                    <strong>預估 ${formatCurrency(activeOrders.reduce((sum, order) => sum + Number(order.total_amount || 0), 0))}</strong>
                  </div>
                  {campaign.pickup_ready_at ? <p className="flash-ready-time"><BellRing size={15} aria-hidden="true" /> 已通知取餐：{formatFlashFoodDateTime(campaign.pickup_ready_at)}</p> : null}
                  {activeOrders.length ? <div className="flash-pickup-counts" aria-label="交貨地點點餐人數">{pickupCounts.map(({ location, count }) => <span key={location}>{location} <b>{count}</b></span>)}</div> : null}
                  {state === "open" && activeOrders.length ? (
                    <details className="flash-live-orders" open>
                      <summary><span><ClipboardList size={16} aria-hidden="true" /> 即時點餐明細</span><small>{activeOrders.length} 筆已送出點餐</small></summary>
                      <div className="flash-live-order-list">
                        {activeOrders.map((order) => (
                          <article key={order.id}>
                            <div><strong>{order.customer_name || "未填姓名"}</strong><small>{order.phone || "未填電話"} · {order.pickup_location}</small></div>
                            <b>${formatCurrency(order.total_amount)}</b>
                            <p>{(order.flash_food_order_items || []).map((item) => `${item.product_name} × ${item.quantity}`).join("、")}</p>
                          </article>
                        ))}
                      </div>
                    </details>
                  ) : null}
                  {state !== "open" && purchaseTotals.length ? (
                    <section className="flash-purchase-summary" aria-label="截止後採買統計">
                      <div className="flash-ops-heading"><span><ClipboardList size={16} aria-hidden="true" /> 截止後採買統計</span><small>{activeOrders.length} 筆已送出訂單</small></div>
                      <ul>{purchaseTotals.map((item) => <li key={`${item.productName}-${item.itemNote}`}><span>{item.productName}{item.itemNote ? <small>・{item.itemNote}</small> : null}</span><strong>× {item.quantity}</strong></li>)}</ul>
                    </section>
                  ) : null}
                  {state !== "open" && state !== "cancelled" && state !== "ready" && activeOrders.length ? (
                    readyDraft?.campaignId === campaign.id ? (
                      <form className="flash-ready-notice-form" onSubmit={handleReadyNotification} noValidate>
                        <strong>採買完成，通知取餐</strong>
                        <p>只會通知本團已送出點餐的 {activeOrders.length} 位會員，訊息會帶入各自選擇的交貨地點。</p>
                        <label><span>年份</span><select value={readyDraft.year} onChange={(event) => setReadyDraft((current) => ({ ...current, year: event.target.value }))}>{Array.from(new Set([String(new Date().getFullYear()), readyDraft.year, String(new Date().getFullYear() + 1)])).sort().map((year) => <option value={year} key={year}>{year} 年</option>)}</select></label>
                        <div className="flash-schedule-editor flash-schedule-editor-single"><CampaignTimeSlot label="實際取餐" day={readyDraft.day} time={readyDraft.time} onDayChange={(value) => setReadyDraft((current) => ({ ...current, day: value }))} onTimeChange={(value) => setReadyDraft((current) => ({ ...current, time: value }))} /></div>
                        <div className="flash-ready-notice-actions"><button type="submit" className="admin-primary-button" disabled={saving}><BellRing size={15} aria-hidden="true" /> 通知本團會員</button><button type="button" className="admin-secondary-button" onClick={() => setReadyDraft(null)}>返回</button></div>
                      </form>
                    ) : <div className="flash-purchase-actions"><button type="button" className="flash-ready-button" onClick={() => { setEditDraft(null); setCancelDraft({ campaignId: "", reason: "" }); setReadyDraft(createReadyDraft(campaign)); }} disabled={saving}><BellRing size={15} aria-hidden="true" /> 採買完成／通知取餐</button></div>
                  ) : null}
                  {state === "ready" && activeOrders.length ? (
                    <section className="flash-pickup-manifest" aria-label="依交貨地點整理的交貨清單">
                      <div className="flash-ops-heading"><span><PackageCheck size={16} aria-hidden="true" /> 交貨清單</span><small>已依交貨地點整理</small></div>
                      <div className="flash-pickup-manifest-grid">
                        {pickupGroups.map(({ location, orders: locationOrders }) => (
                          <button key={location} type="button" className={`flash-pickup-manifest-group${locationOrders.length ? " has-orders" : ""}${selectedPickupGroup?.location === location ? " selected" : ""}`} onClick={() => setExpandedPickupManifest((current) => current.campaignId === campaign.id && current.location === location ? { campaignId: "", location: "" } : { campaignId: campaign.id, location })}>
                            <span><MapPin size={14} aria-hidden="true" /> {location}</span><b>{locationOrders.length}</b>{selectedPickupGroup?.location === location ? <ChevronUp size={15} aria-hidden="true" /> : <ChevronDown size={15} aria-hidden="true" />}
                          </button>
                        ))}
                      </div>
                      {selectedPickupGroup ? <div className="flash-pickup-manifest-detail">
                        <strong><MapPin size={15} aria-hidden="true" /> {selectedPickupGroup.location}交貨明細</strong>
                        {selectedPickupGroup.orders.length ? <ul>{selectedPickupGroup.orders.map((order) => <li key={order.id}><div><strong>{order.customer_name || "未填姓名"}</strong><small>{order.phone || "未填電話"}</small></div><b>${formatCurrency(order.total_amount)}</b><span>{(order.flash_food_order_items || []).map((item) => `${item.product_name} × ${item.quantity}`).join("、")}</span></li>)}</ul> : <p>此地點暫無點餐。</p>}
                      </div> : null}
                    </section>
                  ) : null}
                  {state !== "cancelled" && editDraft?.id === campaign.id ? (
                    <form className="flash-campaign-edit-form" onSubmit={handleCampaignUpdate} noValidate>
                      <label className="flash-campaign-edit-title"><span>活動名稱</span><input value={editDraft.title} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} required /></label>
                      <label className="flash-campaign-edit-year"><span>年份</span><select value={editDraft.year} onChange={(event) => setEditDraft((current) => ({ ...current, year: event.target.value }))}>{Array.from(new Set([String(new Date().getFullYear()), editDraft.year, String(new Date().getFullYear() + 1)])).sort().map((year) => <option value={year} key={year}>{year} 年</option>)}</select></label>
                      <div className="flash-schedule-editor"><CampaignTimeSlot label="開團" day={editDraft.open_day} time={editDraft.open_time} onDayChange={(value) => setEditDraft((current) => ({ ...current, open_day: value }))} onTimeChange={(value) => setEditDraft((current) => ({ ...current, open_time: value }))} /><CampaignTimeSlot label="截止" day={editDraft.deadline_day} time={editDraft.deadline_time} onDayChange={(value) => setEditDraft((current) => ({ ...current, deadline_day: value }))} onTimeChange={(value) => setEditDraft((current) => ({ ...current, deadline_time: value }))} /><CampaignTimeSlot label="預估取餐" day={editDraft.pickup_start_day} time={editDraft.pickup_start_time} onDayChange={(value) => setEditDraft((current) => ({ ...current, pickup_start_day: value }))} onTimeChange={(value) => setEditDraft((current) => ({ ...current, pickup_start_time: value }))} /></div>
                      <label className="flash-campaign-edit-note"><span>活動提醒</span><textarea rows="2" value={editDraft.note} onChange={(event) => setEditDraft((current) => ({ ...current, note: event.target.value }))} /></label>
                      <div className="flash-campaign-edit-actions"><button type="submit" className="admin-primary-button" disabled={saving}>儲存設定</button><button type="button" className="admin-secondary-button" onClick={() => setEditDraft(null)}>返回</button></div>
                    </form>
                  ) : null}
                  {state !== "cancelled" ? (
                    cancelDraft.campaignId === campaign.id ? (
                      <div className="flash-cancel-confirm">
                        <textarea value={cancelDraft.reason} onChange={(event) => setCancelDraft({ campaignId: campaign.id, reason: event.target.value })} placeholder="取消原因（選填，會顯示於活動說明）" rows="2" />
                        <div><button type="button" className="flash-cancel-button" onClick={() => handleCancel(campaign)}><CircleOff size={15} aria-hidden="true" /> 確認取消</button><button type="button" className="admin-secondary-button" onClick={() => setCancelDraft({ campaignId: "", reason: "" })}>返回</button></div>
                      </div>
                    ) : state === "ready" ? <div className="flash-admin-campaign-actions"><button type="button" className="flash-ready-button" onClick={() => handleResendReadyNotification(campaign.id)} disabled={saving || !activeOrders.length}><BellRing size={15} aria-hidden="true" /> 重新通知本團會員</button></div> : <div className="flash-admin-campaign-actions"><button type="button" className="flash-edit-button" onClick={() => { setReadyDraft(null); setCancelDraft({ campaignId: "", reason: "" }); setEditDraft(createEditDraft(campaign)); }}><Pencil size={15} aria-hidden="true" /> 編輯設定</button><button type="button" className="flash-cancel-button" onClick={() => { setEditDraft(null); setReadyDraft(null); setCancelDraft({ campaignId: campaign.id, reason: "" }); }}><CircleOff size={15} aria-hidden="true" /> 取消活動</button></div>
                  ) : null}
                  </div> : null}
                </article>
              );
            })}
          </div>
        </section> : null}
        </div>
      </div>
    </AdminLayout>
  );
}
