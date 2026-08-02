import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Save } from "lucide-react";
import AdminLayout from "../components/AdminLayout";
import FormMessage from "../components/FormMessage";
import { loadOrderingSchedule, saveOrderingSchedule } from "../services/scheduleService";
import { loadAdminLineTransferMembers, transferAdminMemberToLine } from "../services/adminService";
import { weekdayLabels } from "../utils/schedule";

const initialSchedule = {
  is_always_open: false,
  open_day: 0,
  open_hour: 0,
  close_day: 0,
  close_hour: 0,
};

export default function AdminSettingsPage() {
  const [schedule, setSchedule] = useState(initialSchedule);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [members, setMembers] = useState([]);
  const [membersLoading, setMembersLoading] = useState(true);
  const [legacyUserId, setLegacyUserId] = useState("");
  const [lineUserId, setLineUserId] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [transferMessage, setTransferMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    let active = true;

    loadOrderingSchedule("admin").then(({ data, error }) => {
      if (!active) return;
      if (error || !data) {
        setMessage({ text: "無法載入營業設定。", type: "error" });
      } else {
        setSchedule({
          is_always_open: Boolean(data.is_always_open),
          open_day: Number(data.open_day),
          open_hour: Number(data.open_hour),
          close_day: Number(data.close_day),
          close_hour: Number(data.close_hour),
        });
      }
      setLoading(false);
    });

    loadAdminLineTransferMembers().then(({ data, error }) => {
      if (!active) return;
      if (error) setTransferMessage({ text: "無法讀取會員遷移資料。", type: "error" });
      else setMembers(data);
      setMembersLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const legacyMembers = useMemo(() => members.filter((member) => !member.has_line_identity), [members]);
  const lineMembers = useMemo(() => members.filter((member) => member.has_line_identity), [members]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage({ text: "儲存中...", type: "" });
    const { data, error } = await saveOrderingSchedule(schedule, "admin");
    setSaving(false);
    setMessage(
      error || !data
        ? { text: "儲存失敗，請確認管理員權限後重試。", type: "error" }
        : { text: "營業時間已更新。", type: "success" }
    );
  }

  async function handleLineTransfer(event) {
    event.preventDefault();
    if (!legacyUserId || !lineUserId) {
      setTransferMessage({ text: "請選擇舊 Email 會員與目標 LINE 會員。", type: "error" });
      return;
    }
    const legacy = members.find((member) => member.user_id === legacyUserId);
    const target = members.find((member) => member.user_id === lineUserId);
    if (!window.confirm(`確定將「${legacy?.full_name || "舊會員"}」的資料移至「${target?.full_name || "LINE 會員"}」嗎？舊 Email 登入會被永久移除。`)) return;

    setTransferBusy(true);
    setTransferMessage({ text: "正在遷移會員資料…", type: "" });
    const { error } = await transferAdminMemberToLine(legacyUserId, lineUserId);
    setTransferBusy(false);
    if (error) {
      setTransferMessage({ text: `遷移失敗：${error.message}`, type: "error" });
      return;
    }
    setTransferMessage({ text: "遷移完成。舊 Email 登入已移除；請以目標 LINE 會員重新登入。", type: "success" });
    setMembers((current) => current.filter((member) => member.user_id !== legacyUserId));
    setLegacyUserId("");
  }

  return (
    <AdminLayout title="營業設定" subtitle="管理訂購開放時段與前台接單狀態。">
      <section className="admin-settings-panel">
        <div className="admin-section-heading">
          <div>
            <span>ORDERING HOURS</span>
            <h2>訂購開放時間</h2>
          </div>
          <span className={`admin-live-state ${schedule.is_always_open ? "open" : "scheduled"}`}>
            {schedule.is_always_open ? "全天開放" : "依排程開放"}
          </span>
        </div>

        {loading ? <div className="admin-loading-state">載入營業設定中...</div> : null}
        {!loading ? (
          <form className="admin-settings-form" onSubmit={handleSubmit}>
            <label className="admin-switch-row">
              <div>
                <strong>永遠開放</strong>
                <span>啟用後不限制星期與時段。</span>
              </div>
              <input
                type="checkbox"
                checked={schedule.is_always_open}
                onChange={(event) =>
                  setSchedule((current) => ({ ...current, is_always_open: event.target.checked }))
                }
              />
            </label>

            <div className="admin-settings-grid">
              <ScheduleSelect
                label="開放星期"
                value={schedule.open_day}
                disabled={schedule.is_always_open}
                options={weekdayLabels.map((label, index) => ({ value: index, label: `週${label}` }))}
                onChange={(value) => setSchedule((current) => ({ ...current, open_day: value }))}
              />
              <ScheduleSelect
                label="開放時間"
                value={schedule.open_hour}
                disabled={schedule.is_always_open}
                options={Array.from({ length: 24 }, (_, value) => ({
                  value,
                  label: `${String(value).padStart(2, "0")}:00`,
                }))}
                onChange={(value) => setSchedule((current) => ({ ...current, open_hour: value }))}
              />
              <ScheduleSelect
                label="關閉星期"
                value={schedule.close_day}
                disabled={schedule.is_always_open}
                options={weekdayLabels.map((label, index) => ({ value: index, label: `週${label}` }))}
                onChange={(value) => setSchedule((current) => ({ ...current, close_day: value }))}
              />
              <ScheduleSelect
                label="關閉時間"
                value={schedule.close_hour}
                disabled={schedule.is_always_open}
                options={Array.from({ length: 24 }, (_, value) => ({
                  value,
                  label: `${String(value).padStart(2, "0")}:00`,
                }))}
                onChange={(value) => setSchedule((current) => ({ ...current, close_hour: value }))}
              />
            </div>

            <p className="admin-settings-note">關閉時間會視為該小時的 59 分，時區固定為 Asia/Taipei。</p>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-button" disabled={saving}>
                <Save size={17} aria-hidden="true" />
                {saving ? "儲存中" : "儲存設定"}
              </button>
              <FormMessage text={message.text} type={message.type} />
            </div>
          </form>
        ) : null}
      </section>

      <section className="admin-settings-panel">
        <div className="admin-section-heading">
          <div>
            <span>LINE MEMBER MIGRATION</span>
            <h2>舊會員轉 LINE 會員</h2>
          </div>
        </div>
        <p className="admin-settings-note">
          僅在會員已先使用 LINE 登入並完成基本資料後使用。遷移會保留訂單、快閃熱食紀錄與管理權限，並永久移除舊 Email 登入。
        </p>
        {membersLoading ? <div className="admin-loading-state">正在讀取會員資料…</div> : (
          <form className="admin-settings-form" onSubmit={handleLineTransfer}>
            <label className="admin-field">
              <span>舊 Email 會員</span>
              <select value={legacyUserId} onChange={(event) => setLegacyUserId(event.target.value)} disabled={transferBusy}>
                <option value="">請選擇舊會員</option>
                {legacyMembers.map((member) => <option key={member.user_id} value={member.user_id}>{formatMemberLabel(member)}</option>)}
              </select>
            </label>
            <label className="admin-field">
              <span>目標 LINE 會員</span>
              <select value={lineUserId} onChange={(event) => setLineUserId(event.target.value)} disabled={transferBusy}>
                <option value="">請選擇已 LINE 登入的會員</option>
                {lineMembers.map((member) => <option key={member.user_id} value={member.user_id}>{formatMemberLabel(member)}</option>)}
              </select>
            </label>
            <p className="admin-settings-note"><AlertTriangle size={16} />目標 LINE 會員必須尚未建立訂單、收藏或快閃熱食紀錄。</p>
            <div className="admin-form-actions">
              <button type="submit" className="admin-primary-button" disabled={transferBusy}>{transferBusy ? "正在遷移…" : "遷移至 LINE 會員"}</button>
              <FormMessage text={transferMessage.text} type={transferMessage.type} />
            </div>
          </form>
        )}
      </section>
    </AdminLayout>
  );
}

function formatMemberLabel(member) {
  return `${member.full_name || "未命名"}｜${member.real_phone || "未填手機"}${member.email ? `｜${member.email}` : ""}`;
}

function ScheduleSelect({ label, value, disabled, options, onChange }) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      <select value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}>
        {options.map((option) => (
          <option key={`${label}-${option.value}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}
