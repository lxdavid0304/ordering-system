import { useEffect, useRef, useState } from "react";
import { BadgeCheck, BellRing, Pencil, Phone, Save, ShieldCheck, UserRound, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { hasCompletedMemberProfile, loadMemberProfile, updateMemberProfile } from "../services/profileService";
import { ensureLineMemberBinding, loadLineBinding, updateLineNotifications } from "../services/lineService";
import { normalizePhone } from "../utils/auth";

function validateProfile(profile) {
  if (!profile.full_name || !profile.real_phone) return "請填寫姓名與手機。";
  if (profile.real_phone.length < 8 || profile.real_phone.length > 20) return "請輸入正確的手機號碼。";
  return "";
}

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const [profilePersisted, setProfilePersisted] = useState(false);
  const logoutTimerRef = useRef(null);
  const [form, setForm] = useState({ full_name: "", account: "", real_phone: "" });
  const [message, setMessage] = useState({ text: "", type: "" });
  const [lineBinding, setLineBinding] = useState(null);
  const [lineMessage, setLineMessage] = useState({ text: "", type: "" });
  const [lineBusy, setLineBusy] = useState(false);
  const profileReady = Boolean(profilePersisted && profileSnapshot?.full_name && profileSnapshot?.real_phone);
  const profileInitial = (form.full_name || "會").trim().slice(0, 1).toUpperCase();

  useEffect(() => {
    let active = true;

    async function run() {
      const bindResult = await ensureLineMemberBinding();
      if (!active) return;
      if (bindResult.error) {
        setLineMessage({ text: "尚未完成 LINE 綁定，請重新使用 LINE 登入。", type: "error" });
      }

      const result = await loadMemberProfile(user);
      if (!active) return;
      if (result.errorType === "SESSION_EXPIRED") {
        setMessage({ text: "登入狀態已失效，將返回訂購頁。", type: "error" });
        setEditing(false);
        if (!logoutTimerRef.current) logoutTimerRef.current = window.setTimeout(() => signOut(), 3000);
        return;
      }
      if (result.error || !result.data) {
        setMessage({ text: `讀取會員資料失敗：${result.error?.message || "請稍後再試"}`, type: "error" });
        return;
      }

      const profile = result.data;
      const nextForm = {
        full_name: profile.full_name || "",
        account: profile.account || "",
        real_phone: profile.real_phone || "",
      };
      setProfileSnapshot(nextForm);
      setForm(nextForm);
      const complete = hasCompletedMemberProfile(profile);
      setProfilePersisted(complete);
      setEditing(!complete);
      setMessage(complete ? { text: "", type: "" } : { text: "請完成姓名與手機後開始訂購。", type: "error" });

      const { data: binding, error: bindingError } = await loadLineBinding(user.id);
      if (!active) return;
      if (bindingError) setLineMessage({ text: "讀取 LINE 通知設定失敗。", type: "error" });
      else setLineBinding(binding);
    }

    run();
    return () => {
      active = false;
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    };
  }, [signOut, user]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!editing) return;
    const isFirstProfileSetup = !profilePersisted;
    const nextProfile = {
      full_name: form.full_name.trim(),
      real_phone: normalizePhone(form.real_phone),
    };
    const invalidReason = validateProfile(nextProfile);
    if (invalidReason) {
      setMessage({ text: invalidReason, type: "error" });
      return;
    }

    setMessage({ text: "正在儲存…", type: "" });
    const result = await updateMemberProfile(user, nextProfile);
    if (result.error) {
      setMessage({ text: `儲存失敗：${result.error.message}`, type: "error" });
      return;
    }

    const saved = result.data || { ...form, ...nextProfile };
    const savedForm = {
      full_name: saved.full_name || nextProfile.full_name,
      account: saved.account || form.account,
      real_phone: saved.real_phone || nextProfile.real_phone,
    };
    setProfileSnapshot(savedForm);
    setForm(savedForm);
    setProfilePersisted(true);
    setEditing(false);
    setMessage({ text: "會員資料已儲存。", type: "success" });
    if (isFirstProfileSetup) window.setTimeout(() => navigate("/order", { replace: true }), 700);
  }

  function cancelEdit() {
    if (profileSnapshot) setForm(profileSnapshot);
    setEditing(false);
    setMessage({ text: "", type: "" });
  }

  async function handleNotificationChange(event) {
    const enabled = event.target.checked;
    setLineBusy(true);
    const { data, error } = await updateLineNotifications(enabled);
    setLineBusy(false);
    if (error || !data) {
      setLineMessage({ text: "LINE 通知設定儲存失敗，請稍後再試。", type: "error" });
      return;
    }
    setLineBinding(data);
    setLineMessage({ text: enabled ? "已開啟 LINE 訂單通知。" : "已關閉 LINE 訂單通知。", type: "success" });
  }

  return (
    <MemberLayout
      title={profilePersisted ? "會員資料" : "完成會員資料"}
      subtitle={profilePersisted ? "使用 LINE 登入並管理訂單通知。" : "只要填寫姓名與手機，即可開始下單。"}
      active="profile"
      pageClassName="member-profile-page"
    >
      <section className="profile-page-section" id="profileCard" aria-label="會員資料">
        <header className="profile-summary-band">
          <div className="profile-identity">
            <div className="profile-avatar" aria-hidden="true">{profileInitial}</div>
            <div>
              <p className="section-eyebrow">LINE MEMBER</p>
              <div className="profile-title-row">
                <h2>{form.full_name || "LINE 會員"}</h2>
                {profileReady ? <span className="profile-verified"><BadgeCheck size={15} />已完成</span> : null}
              </div>
              <p className="profile-account">LINE 登入會員</p>
            </div>
          </div>
          <div className="profile-summary-actions">
            {editing ? (
              <button type="button" className="ghost profile-action-button" onClick={cancelEdit}><X size={17} />取消</button>
            ) : (
              <button type="button" className="primary profile-action-button" onClick={() => setEditing(true)}><Pencil size={17} />編輯資料</button>
            )}
          </div>
        </header>

        <form className="profile-content-grid" onSubmit={handleSubmit}>
          <section className="profile-details-section" aria-labelledby="profileDetailsTitle">
            <div className="profile-section-heading">
              <div className="profile-section-icon"><UserRound size={20} /></div>
              <div>
                <p className="section-eyebrow">PERSONAL DETAILS</p>
                <h3 id="profileDetailsTitle">基本資料</h3>
                <p>姓名與手機僅用於建立訂單與聯絡取貨。</p>
              </div>
            </div>
            <div className="profile-field-grid">
              <label className="profile-field">
                <span><UserRound size={16} />姓名</span>
                <input className="profile-input" type="text" required readOnly={!editing} value={form.full_name} onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))} />
              </label>
              <label className="profile-field">
                <span><Phone size={16} />手機</span>
                <input className="profile-input" type="tel" required readOnly={!editing} value={form.real_phone} onChange={(event) => setForm((current) => ({ ...current, real_phone: event.target.value }))} />
              </label>
            </div>
            <div className={`profile-save-row${editing ? "" : " hidden"}`}>
              <button type="submit" className="primary profile-action-button"><Save size={17} />{profilePersisted ? "儲存變更" : "完成會員資料"}</button>
            </div>
            <FormMessage text={message.text} type={message.type} />
          </section>

          <aside className="profile-security-section" aria-labelledby="profileSecurityTitle">
            <div className="profile-section-icon security"><ShieldCheck size={20} /></div>
            <p className="section-eyebrow">LINE ACCOUNT</p>
            <h3 id="profileSecurityTitle">LINE 登入</h3>
            <p>此帳號使用 LINE 驗證，不需要 Email、密碼或綁定碼。</p>
            <div className="profile-line-section">
              <div className="profile-section-icon line"><BellRing size={20} /></div>
              <p className="section-eyebrow">ORDER NOTIFICATIONS</p>
              <h3>LINE 訂單通知</h3>
              {lineBinding ? (
                lineBinding.blocked_at ? <p>目前無法傳送通知；請重新加入官方帳號後，再使用 LINE 登入一次。</p> : (
                  <label className="profile-line-toggle">
                    <input type="checkbox" checked={Boolean(lineBinding.notifications_enabled)} disabled={lineBusy} onChange={handleNotificationChange} />
                    <span>接收個人訂單與快閃熱食通知</span>
                  </label>
                )
              ) : <p>LINE 綁定處理中，完成後即可接收個人訂單通知。</p>}
              <FormMessage text={lineMessage.text} type={lineMessage.type} />
            </div>
          </aside>
        </form>
      </section>
    </MemberLayout>
  );
}
