import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import AdminLayout from "../components/AdminLayout";
import FormMessage from "../components/FormMessage";
import { loadOrderingSchedule, saveOrderingSchedule } from "../services/scheduleService";
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

    return () => {
      active = false;
    };
  }, []);

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
    </AdminLayout>
  );
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
