import { useEffect, useMemo, useRef, useState } from "react";
import AdminOrderCard from "../components/AdminOrderCard";
import FormMessage from "../components/FormMessage";
import { useAdminAuth } from "../context/AuthContext";
import { appConfig, configOk } from "../lib/config";
import { bulkUpdateOrders, checkAdminAccess, loadAdminOrders, updateAdminOrder } from "../services/adminService";
import { signInAdmin, signInAdminWithGitHub } from "../services/authService";
import { loadOrderingSchedule, saveOrderingSchedule } from "../services/scheduleService";
import { weekdayLabels } from "../utils/schedule";

const statusLabels = {
  pending_deposit: "待確認訂金",
  open: "進行中",
  fulfilled: "已完成",
  archived: "歷史紀錄",
};

const locationOptions = ["明德樓", "據德樓", "蘊德樓", "機車停車場"];
const yearOptions = ["all", "2026", "2027"];
const monthOptions = ["all", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"];
const pageSize = 6;
const adminRequiredMessage =
  "目前登入帳號未加入 admin_users，無法使用管理功能。請先將該帳號的 auth.users.id 加入 public.admin_users。";

function getErrorText(error, fallbackText) {
  const raw = String(error?.message || "").trim();
  if (!raw) {
    return fallbackText;
  }
  if (/row-level security|permission denied|not allowed/i.test(raw)) {
    return "權限不足，請確認目前登入帳號已加入 admin_users。";
  }
  return raw;
}

async function resolveNoDataPermissionMessage(fallbackText) {
  const { data, error } = await checkAdminAccess();
  if (error) {
    return getErrorText(error, fallbackText);
  }
  if (!data) {
    return adminRequiredMessage;
  }
  return fallbackText;
}

export default function AdminPage() {
  const { user: adminUser, signOut } = useAdminAuth();
  const ordersRef = useRef(null);
  const scheduleGearRef = useRef(null);
  const schedulePanelRef = useRef(null);
  const filterToggleRef = useRef(null);
  const filterPanelRef = useRef(null);
  const bulkToggleRef = useRef(null);
  const bulkPanelRef = useRef(null);
  const [email, setEmail] = useState(appConfig.ADMIN_DEFAULT_EMAIL || "");
  const [password, setPassword] = useState("");
  const [loginMessage, setLoginMessage] = useState({ text: "", type: "" });
  const [adminVerified, setAdminVerified] = useState(false);
  const [schedule, setSchedule] = useState({
    is_always_open: false,
    open_day: 0,
    open_hour: 0,
    close_day: 0,
    close_hour: 0,
  });
  const [scheduleMessage, setScheduleMessage] = useState("");
  const [orders, setOrders] = useState([]);
  const [lastUpdated, setLastUpdated] = useState("--");
  const [filters, setFilters] = useState({
    status: "all",
    location: "all",
    year: "all",
    month: "all",
  });
  const [currentPage, setCurrentPage] = useState(1);
  const [totalOrders, setTotalOrders] = useState(0);
  const [selectedOrders, setSelectedOrders] = useState([]);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkMessage, setBulkMessage] = useState("");
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const [bulkPanelOpen, setBulkPanelOpen] = useState(false);
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(true);
  const [ordersEditing, setOrdersEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const isDev = import.meta.env.DEV;

  const totalPages = Math.max(1, Math.ceil((Number(totalOrders) || 0) / pageSize));
  const visibleIds = useMemo(() => orders.map((order) => order.id), [orders]);
  const allVisibleSelected = Boolean(visibleIds.length && visibleIds.every((id) => selectedOrders.includes(id)));

  useEffect(() => {
    document.title = "管理後台 | 訂購系統";
  }, []);

  useEffect(() => {
    if (!adminUser) {
      setAdminVerified(false);
      setOrders([]);
      setSelectedOrders([]);
      setTotalOrders(0);
      setCurrentPage(1);
      setScheduleMessage("");
    }
  }, [adminUser]);

  useEffect(() => {
    if (!adminUser) {
      return;
    }

    let active = true;

    async function verifyAdmin() {
      setAdminVerified(false);
      setLoginMessage({ text: "權限確認中...", type: "" });

      const { data, error } = await checkAdminAccess();
      if (!active) {
        return;
      }

      if (error) {
        setLoginMessage({
          text: `權限檢查失敗：${getErrorText(error, "請稍後再試")}`,
          type: "error",
        });
        return;
      }

      if (!data) {
        setLoginMessage({ text: adminRequiredMessage, type: "error" });
        return;
      }

      setAdminVerified(true);
      setLoginMessage({ text: "", type: "" });
    }

    verifyAdmin();
    return () => {
      active = false;
    };
  }, [adminUser]);

  useEffect(() => {
    if (!adminUser || !adminVerified) {
      return;
    }

    let active = true;

    async function refreshSchedule() {
      const { data, error } = await loadOrderingSchedule("admin");
      if (!active) {
        return;
      }
      if (error || !data) {
        setScheduleMessage("讀取失敗");
        return;
      }
      setSchedule({
        is_always_open: Boolean(data.is_always_open),
        open_day: Number(data.open_day),
        open_hour: Number(data.open_hour),
        close_day: Number(data.close_day),
        close_hour: Number(data.close_hour),
      });
      setScheduleMessage("");
    }

    refreshSchedule();
    return () => {
      active = false;
    };
  }, [adminUser, adminVerified]);

  useEffect(() => {
    if (!adminUser || !adminVerified) {
      return;
    }

    let active = true;

    async function refreshOrders(force = false) {
      if (ordersEditing && !force) {
        return;
      }

      const { data, error, count } = await loadAdminOrders({
        filters,
        page: currentPage,
        pageSize,
      });

      if (!active) {
        return;
      }

      if (error) {
        setOrders([]);
        setTotalOrders(0);
        setLoginMessage({ text: getErrorText(error, "讀取失敗"), type: "error" });
        return;
      }

      const nextOrders = data || [];
      const nextTotalOrders = Number.isFinite(count) ? count : nextOrders.length;
      const nextTotalPages = Math.max(1, Math.ceil((nextTotalOrders || 0) / pageSize));
      if (currentPage > nextTotalPages) {
        setCurrentPage(nextTotalPages);
        return;
      }

      setOrders(nextOrders);
      setTotalOrders(nextTotalOrders);
      setSelectedOrders((current) => current.filter((id) => nextOrders.some((order) => order.id === id)));
      setLastUpdated(new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" }));
      setLoginMessage({ text: "", type: "" });
    }

    refreshOrders(true);
    const timer = setInterval(() => refreshOrders(false), 30000);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [adminUser, adminVerified, currentPage, filters, ordersEditing, refreshKey]);

  useEffect(() => {
    if (!adminUser || !adminVerified) {
      return;
    }

    function isOutside(target, refs) {
      return refs.every((ref) => !ref.current?.contains(target));
    }

    function handleDocumentPointerDown(event) {
      const target = event.target;
      if (!(target instanceof Node)) {
        return;
      }

      if (
        schedulePanelOpen &&
        isOutside(target, [scheduleGearRef, schedulePanelRef])
      ) {
        setSchedulePanelOpen(false);
      }

      if (
        filterPanelOpen &&
        isOutside(target, [filterToggleRef, filterPanelRef])
      ) {
        if (isDev) {
          console.debug("[AdminPage] closing filter panel from outside click");
        }
        setFilterPanelOpen(false);
      }

      if (
        bulkPanelOpen &&
        isOutside(target, [bulkToggleRef, bulkPanelRef])
      ) {
        if (isDev) {
          console.debug("[AdminPage] closing bulk panel from outside click");
        }
        setBulkPanelOpen(false);
      }
    }

    document.addEventListener("pointerdown", handleDocumentPointerDown);

    return () => {
      document.removeEventListener("pointerdown", handleDocumentPointerDown);
    };
  }, [adminUser, adminVerified, bulkPanelOpen, filterPanelOpen, isDev, schedulePanelOpen]);

  useEffect(() => {
    if (!isDev) {
      return;
    }

    console.debug("[AdminPage] toolbar panel visibility", {
      filterPanelOpen,
      bulkPanelOpen,
    });
  }, [bulkPanelOpen, filterPanelOpen, isDev]);

  async function handleLoginSubmit(event) {
    event.preventDefault();

    if (!configOk) {
      setLoginMessage({ text: "請先設定 react-app/public/config.js", type: "error" });
      return;
    }

    setLoginMessage({ text: "登入中...", type: "" });
    const { error } = await signInAdmin(email, password);
    if (error) {
      setLoginMessage({ text: "登入失敗，請確認帳號密碼。", type: "error" });
      return;
    }

    setPassword("");
    setLoginMessage({ text: "", type: "" });
  }

  async function handleGitHubLogin() {
    if (!configOk) {
      setLoginMessage({ text: "請先設定 react-app/public/config.js", type: "error" });
      return;
    }

    setLoginMessage({ text: "導向 GitHub 登入中...", type: "" });
    const redirectTo = `${window.location.origin}/admin`;
    const { error } = await signInAdminWithGitHub(redirectTo);
    if (error) {
      setLoginMessage({ text: "GitHub 登入失敗，請稍後再試。", type: "error" });
    }
  }

  async function handleSaveSchedule() {
    setScheduleMessage("儲存中...");
    const { data, error } = await saveOrderingSchedule(schedule, "admin");
    if (error) {
      setScheduleMessage(`儲存失敗：${getErrorText(error, "請稍後再試")}`);
      return;
    }
    if (!data) {
      setScheduleMessage(await resolveNoDataPermissionMessage("沒有可更新的資料，請重新整理後再試。"));
      return;
    }
    setScheduleMessage("已更新");
  }

  async function handleSaveOrder(orderId, payload, mode) {
    const { data, error } = await updateAdminOrder(orderId, payload);
    if (error) {
      return { ok: false, message: `儲存失敗：${getErrorText(error, "請稍後再試")}` };
    }
    if (!data) {
      return {
        ok: false,
        message: await resolveNoDataPermissionMessage("沒有可更新的訂單，請重新整理後再試。"),
      };
    }

    setOrdersEditing(false);
    setRefreshKey((current) => current + 1);

    return {
      ok: true,
      message: mode === "confirm-deposit" ? "已確認訂金，訂單成立" : "已更新",
    };
  }

  async function handleBulkApply() {
    if (!bulkStatus) {
      setBulkMessage("請先選擇狀態");
      return;
    }
    if (!selectedOrders.length) {
      setBulkMessage("請先勾選訂單");
      return;
    }

    setBulkMessage("更新中...");
    const { data, error } = await bulkUpdateOrders(selectedOrders, bulkStatus);
    if (error) {
      setBulkMessage(`更新失敗：${getErrorText(error, "請稍後再試")}`);
      return;
    }
    if (!Array.isArray(data) || !data.length) {
      setBulkMessage(await resolveNoDataPermissionMessage("沒有可更新的訂單，請重新整理後再試。"));
      return;
    }

    setBulkMessage(`已更新 ${data.length} 筆`);
    setSelectedOrders([]);
    setRefreshKey((current) => current + 1);
  }

  function handleSelectOrder(orderId, checked) {
    setSelectedOrders((current) => {
      if (checked) {
        return Array.from(new Set([...current, orderId]));
      }
      return current.filter((id) => id !== orderId);
    });
    if (checked) {
      setBulkPanelOpen(true);
    }
  }

  function handleSelectAll(checked) {
    if (checked) {
      setSelectedOrders((current) => Array.from(new Set([...current, ...visibleIds])));
      setBulkPanelOpen(true);
      return;
    }
    setSelectedOrders((current) => current.filter((id) => !visibleIds.includes(id)));
  }

  function handleOrdersBlur() {
    setTimeout(() => {
      if (!ordersRef.current?.contains(document.activeElement)) {
        setOrdersEditing(false);
      }
    }, 0);
  }

  const splitIndex = Math.ceil(orders.length / 2);
  const leftOrders = orders.slice(0, splitIndex);
  const rightOrders = orders.slice(splitIndex);

  return (
    <>
      <div className="bg-glow"></div>
      <main className="page admin-page app-shell">
        <header className="hero">
          <p className="eyebrow">管理後台</p>
          <h1>訂購系統後台</h1>
          <p className="subtitle">請先登入後即可查看訂單與設定開放時段。</p>
        </header>

        {!adminUser || !adminVerified ? (
          <section className="card" id="loginCard">
            <form className="stack" onSubmit={handleLoginSubmit}>
              <label className="field">
                <span>管理員 Email</span>
                <input
                  type="email"
                  value={email}
                  placeholder="admin@example.com"
                  required
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="field">
                <span>管理員密碼</span>
                <input
                  type="password"
                  value={password}
                  required
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button type="submit" className="primary">
                Email 登入
              </button>
              <button type="button" className="ghost" onClick={handleGitHubLogin}>
                GitHub 登入
              </button>
              <FormMessage text={loginMessage.text} type={loginMessage.type} />
            </form>
          </section>
        ) : (
          <>
            <button
              ref={scheduleGearRef}
              type="button"
              className={`schedule-gear${adminUser ? "" : " hidden"}`}
              aria-label="開放時間設定"
              onClick={() => setSchedulePanelOpen((current) => !current)}
            >
              ⚙
            </button>

            <section
              ref={schedulePanelRef}
              className={`card schedule-panel${schedulePanelOpen ? "" : " hidden"}`}
              id="adminPanel"
            >
              <div className="panel-header">
                <div>
                  <h2>開放時間設定</h2>
                  <p className="muted">關閉時間會視為該小時的 59 分。</p>
                </div>
                <button type="button" className="ghost" onClick={signOut}>
                  登出
                </button>
              </div>
              <div className="grid schedule-grid">
                <label className="field checkbox-field">
                  <span>永遠開放</span>
                  <input
                    type="checkbox"
                    checked={schedule.is_always_open}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        is_always_open: event.target.checked,
                      }))
                    }
                  />
                </label>
                <label className="field">
                  <span>開放星期</span>
                  <select
                    value={schedule.open_day}
                    disabled={schedule.is_always_open}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        open_day: Number(event.target.value),
                      }))
                    }
                  >
                    {weekdayLabels.map((label, index) => (
                      <option key={`open-day-${label}`} value={index}>
                        週{label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>開放時間</span>
                  <select
                    value={schedule.open_hour}
                    disabled={schedule.is_always_open}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        open_hour: Number(event.target.value),
                      }))
                    }
                  >
                    {Array.from({ length: 24 }, (_, index) => (
                      <option key={`open-hour-${index}`} value={index}>
                        {String(index).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>關閉星期</span>
                  <select
                    value={schedule.close_day}
                    disabled={schedule.is_always_open}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        close_day: Number(event.target.value),
                      }))
                    }
                  >
                    {weekdayLabels.map((label, index) => (
                      <option key={`close-day-${label}`} value={index}>
                        週{label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>關閉時間</span>
                  <select
                    value={schedule.close_hour}
                    disabled={schedule.is_always_open}
                    onChange={(event) =>
                      setSchedule((current) => ({
                        ...current,
                        close_hour: Number(event.target.value),
                      }))
                    }
                  >
                    {Array.from({ length: 24 }, (_, index) => (
                      <option key={`close-hour-${index}`} value={index}>
                        {String(index).padStart(2, "0")}:00
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="actions">
                <button type="button" className="primary" onClick={handleSaveSchedule}>
                  儲存設定
                </button>
                <span className="muted">{scheduleMessage}</span>
              </div>
            </section>

            <section className="card" id="ordersPanel">
              <div className="panel-header">
                <div>
                  <h2>訂單清單</h2>
                  <p className="muted">最後更新：{lastUpdated}</p>
                </div>
                <div className="actions admin-top-actions">
                  <button type="button" className="ghost" onClick={() => setRefreshKey((current) => current + 1)}>
                    重新整理
                  </button>
                  <button type="button" className="ghost" onClick={signOut}>
                    登出
                  </button>
                </div>
              </div>
              <div className="order-toolbar-controls">
                <button
                  ref={filterToggleRef}
                  type="button"
                  className={`ghost toolbar-toggle-btn${filterPanelOpen ? " active" : ""}`}
                  aria-expanded={filterPanelOpen}
                  onClick={() => setFilterPanelOpen((current) => !current)}
                >
                  ⚙ 篩選
                </button>
                <button
                  ref={bulkToggleRef}
                  type="button"
                  className={`ghost toolbar-toggle-btn${bulkPanelOpen ? " active" : ""}`}
                  aria-expanded={bulkPanelOpen}
                  onClick={() => setBulkPanelOpen((current) => !current)}
                >
                  ⚙ 批次
                </button>
              </div>
              <div className="order-toolbar-panels">
                <div
                  ref={filterPanelRef}
                  className={filterPanelOpen ? "order-filters toolbar-box" : "order-filters hidden"}
                >
                  <p className="toolbar-title">篩選條件</p>
                  <label className="field">
                    <span>狀態</span>
                    <select
                      value={filters.status}
                      onChange={(event) => {
                        setCurrentPage(1);
                        setSelectedOrders([]);
                        setFilters((current) => ({ ...current, status: event.target.value }));
                      }}
                    >
                      <option value="pending_deposit">待確認訂金</option>
                      <option value="open">進行中</option>
                      <option value="fulfilled">已完成</option>
                      <option value="archived">歷史紀錄</option>
                      <option value="all">全部</option>
                    </select>
                  </label>
                  <label className="field">
                    <span>地點</span>
                    <select
                      value={filters.location}
                      onChange={(event) => {
                        setCurrentPage(1);
                        setSelectedOrders([]);
                        setFilters((current) => ({ ...current, location: event.target.value }));
                      }}
                    >
                      <option value="all">全部地點</option>
                      {locationOptions.map((location) => (
                        <option key={location} value={location}>
                          {location}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field time-field">
                    <span>時間</span>
                    <div className="time-selects">
                      <select
                        value={filters.year}
                        onChange={(event) => {
                          setCurrentPage(1);
                          setSelectedOrders([]);
                          setFilters((current) => ({ ...current, year: event.target.value }));
                        }}
                      >
                        {yearOptions.map((year) => (
                          <option key={`year-${year}`} value={year}>
                            {year === "all" ? "全部年" : year}
                          </option>
                        ))}
                      </select>
                      <select
                        value={filters.month}
                        onChange={(event) => {
                          setCurrentPage(1);
                          setSelectedOrders([]);
                          setFilters((current) => ({ ...current, month: event.target.value }));
                        }}
                      >
                        {monthOptions.map((month) => (
                          <option key={`month-${month}`} value={month}>
                            {month === "all" ? "全部月" : `${month}月`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </label>
                </div>

                <div
                  ref={bulkPanelRef}
                  className={bulkPanelOpen ? "bulk-actions toolbar-box" : "bulk-actions hidden"}
                >
                  <p className="toolbar-title">批次操作</p>
                  <label className="checkbox-inline select-all-pill">
                    <input
                      type="checkbox"
                      checked={allVisibleSelected}
                      onChange={(event) => handleSelectAll(event.target.checked)}
                    />
                    全選本頁
                  </label>
                  <span className="selected-pill">已選 {selectedOrders.length} 筆</span>
                  <label className="field bulk-field">
                    <span>批次狀態</span>
                    <select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value)}>
                      <option value="">選擇狀態</option>
                      {Object.entries(statusLabels).map(([value, label]) => (
                        <option key={`bulk-${value}`} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="primary bulk-apply-btn" onClick={handleBulkApply}>
                    套用
                  </button>
                  <span className="muted bulk-message">{bulkMessage}</span>
                </div>
              </div>

              <div
                ref={ordersRef}
                className="orders"
                onFocusCapture={() => setOrdersEditing(true)}
                onBlurCapture={handleOrdersBlur}
              >
                {!orders.length ? <p className="muted">目前沒有訂單。</p> : null}
                {orders.length ? (
                  <div
                    className="orders-two-column"
                    style={{
                      display: "grid",
                      gridTemplateColumns: window.innerWidth <= 520 ? "1fr" : "1fr 1fr",
                      gap: "12px",
                    }}
                  >
                    <div className="orders-column" style={{ display: "grid", gap: "12px", alignContent: "start" }}>
                      {leftOrders.map((order) => (
                        <AdminOrderCard
                          key={order.id}
                          order={order}
                          selected={selectedOrders.includes(order.id)}
                          statusLabels={statusLabels}
                          onSelectedChange={handleSelectOrder}
                          onSave={handleSaveOrder}
                        />
                      ))}
                    </div>
                    <div className="orders-column" style={{ display: "grid", gap: "12px", alignContent: "start" }}>
                      {rightOrders.map((order) => (
                        <AdminOrderCard
                          key={order.id}
                          order={order}
                          selected={selectedOrders.includes(order.id)}
                          statusLabels={statusLabels}
                          onSelectedChange={handleSelectOrder}
                          onSave={handleSaveOrder}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="pagination-controls">
                <button
                  type="button"
                  className="ghost"
                  disabled={currentPage <= 1}
                  onClick={() => {
                    setSelectedOrders([]);
                    setCurrentPage((current) => Math.max(1, current - 1));
                  }}
                >
                  上一頁
                </button>
                <span className="muted">
                  第 {currentPage} / {totalPages} 頁（共 {totalOrders} 筆）
                </span>
                <button
                  type="button"
                  className="ghost"
                  disabled={currentPage >= totalPages}
                  onClick={() => {
                    setSelectedOrders([]);
                    setCurrentPage((current) => Math.min(totalPages, current + 1));
                  }}
                >
                  下一頁
                </button>
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
