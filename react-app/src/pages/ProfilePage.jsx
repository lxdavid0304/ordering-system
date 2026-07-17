import { useEffect, useRef, useState } from "react";
import { AtSign, BadgeCheck, KeyRound, Mail, Pencil, Phone, Save, ShieldCheck, UserRound, X } from "lucide-react";
import { Link } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { loadMemberProfile, updateMemberProfile } from "../services/profileService";
import { looksLikeEmail, normalizeAccount, normalizePhone } from "../utils/auth";

function validateProfile(profile) {
  if (!profile.full_name || !profile.account || !profile.real_phone || !profile.email) {
    return "請完整填寫所有欄位。";
  }
  if (!/^[a-z0-9]{6,30}$/.test(profile.account)) {
    return "會員帳號需為 6-30 位英文小寫或數字。";
  }
  if (profile.real_phone.length < 8 || profile.real_phone.length > 20) {
    return "請輸入有效手機號碼。";
  }
  if (!looksLikeEmail(profile.email)) {
    return "請輸入有效郵箱。";
  }
  return "";
}

export default function ProfilePage() {
  const { user, signOut } = useAuth();
  const [editing, setEditing] = useState(false);
  const [profileSnapshot, setProfileSnapshot] = useState(null);
  const logoutTimerRef = useRef(null);
  const [form, setForm] = useState({
    full_name: "",
    account: "",
    real_phone: "",
    email: "",
  });
  const [message, setMessage] = useState({ text: "", type: "" });
  const profileReady = Boolean(profileSnapshot && profileSnapshot.full_name && profileSnapshot.account);
  const profileInitial = (form.full_name || form.account || "?").trim().slice(0, 1).toUpperCase();

  useEffect(() => {
    let active = true;

    async function run() {
      const result = await loadMemberProfile(user);
      if (!active) {
        return;
      }

      if (result.errorType === "SESSION_EXPIRED") {
        setMessage({ text: "登入已過期，系統將自動登出並返回登入頁。", type: "error" });
        setEditing(false);
        if (!logoutTimerRef.current) {
          logoutTimerRef.current = window.setTimeout(() => {
            signOut();
          }, 3000);
        }
        return;
      }

      if (result.error) {
        setMessage({ text: `會員資料載入失敗：${result.error.message}`, type: "error" });
        setEditing(false);
        return;
      }

      const profile = result.data;
      if (!profile) {
        setMessage({ text: "會員資料載入失敗。", type: "error" });
        setEditing(false);
        return;
      }

      const nextForm = {
        full_name: profile.full_name || "",
        account: profile.account || "",
        real_phone: profile.real_phone || "",
        email: profile.email || user?.email || "",
      };
      setProfileSnapshot(nextForm);
      setForm(nextForm);
      setEditing(!profile.persisted);
      setMessage(
        profile.persisted
          ? { text: "", type: "" }
          : { text: "請確認會員資料後按一次儲存，以完成會員資料建立。", type: "error" }
      );
    }

    run();
    return () => {
      active = false;
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };
  }, [signOut, user]);

  async function handleSubmit(event) {
    event.preventDefault();
    if (!editing) {
      return;
    }

    const nextProfile = {
      full_name: form.full_name.trim(),
      account: normalizeAccount(form.account),
      real_phone: normalizePhone(form.real_phone),
      email: form.email.trim().toLowerCase(),
    };

    const invalidReason = validateProfile(nextProfile);
    if (invalidReason) {
      setMessage({ text: invalidReason, type: "error" });
      return;
    }

    setMessage({ text: "儲存中...", type: "" });
    const result = await updateMemberProfile(user, nextProfile);
    if (result.error) {
      setMessage({ text: `更新失敗：${result.error.message}`, type: "error" });
      return;
    }

    setProfileSnapshot(nextProfile);
    setForm(nextProfile);
    setEditing(false);
    setMessage({
      text: result.emailChanged
        ? "資料已更新，請到新郵箱收驗證信完成變更。"
        : "會員資料已更新。",
      type: "success",
    });
  }

  function cancelEdit() {
    if (profileSnapshot) {
      setForm(profileSnapshot);
    }
    setEditing(false);
    setMessage({ text: "", type: "" });
  }

  return (
    <MemberLayout title="會員資料" subtitle="管理聯絡資料與帳戶安全設定。" active="profile" pageClassName="member-profile-page">
      <section className="profile-page-section" id="profileCard" aria-label="會員資料">
        <header className="profile-summary-band">
          <div className="profile-identity">
            <div className="profile-avatar" aria-hidden="true">{profileInitial}</div>
            <div>
              <p className="section-eyebrow">MEMBER PROFILE</p>
              <div className="profile-title-row">
                <h2>{form.full_name || "會員資料"}</h2>
                {profileReady ? <span className="profile-verified"><BadgeCheck size={15} />資料已完成</span> : null}
              </div>
              <p className="profile-account">@{form.account || "尚未設定帳號"}</p>
            </div>
          </div>
          <div className="profile-summary-actions">
            {editing ? (
              <button type="button" className="ghost profile-action-button" onClick={cancelEdit}>
                <X size={17} />
                取消
              </button>
            ) : (
              <button type="button" className="primary profile-action-button" onClick={() => setEditing(true)}>
                <Pencil size={17} />
                編輯資料
              </button>
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
                <p>此資料會用於訂單聯絡與交貨確認。</p>
              </div>
            </div>

            <div className="profile-field-grid">
              <label className="profile-field">
                <span><UserRound size={16} />姓名</span>
                <input
                  className="profile-input"
                  type="text"
                  required
                  readOnly={!editing}
                  value={form.full_name}
                  onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
                />
              </label>
              <label className="profile-field">
                <span><AtSign size={16} />會員帳號</span>
                <input
                  className="profile-input"
                  type="text"
                  required
                  readOnly={!editing}
                  value={form.account}
                  onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
                />
              </label>
              <label className="profile-field">
                <span><Phone size={16} />手機號碼</span>
                <input
                  className="profile-input"
                  type="tel"
                  required
                  readOnly={!editing}
                  value={form.real_phone}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, real_phone: event.target.value }))
                  }
                />
              </label>
              <label className="profile-field profile-field-wide">
                <span><Mail size={16} />Email</span>
                <input
                  className="profile-input"
                  type="email"
                  required
                  readOnly={!editing}
                  value={form.email}
                  onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))}
                />
              </label>
            </div>

            <div className={`profile-save-row${editing ? "" : " hidden"}`}>
              <button type="submit" className="primary profile-action-button">
                <Save size={17} />
                儲存變更
              </button>
              <span>變更 Email 後，需至新信箱完成驗證。</span>
            </div>
            <FormMessage text={message.text} type={message.type} />
          </section>

          <aside className="profile-security-section" aria-labelledby="profileSecurityTitle">
            <div className="profile-section-icon security"><ShieldCheck size={20} /></div>
            <p className="section-eyebrow">ACCOUNT SECURITY</p>
            <h3 id="profileSecurityTitle">帳戶安全</h3>
            <p>定期更新密碼，確保你的訂單與會員資料安全。</p>
            <Link className="ghost profile-security-link" to="/change-password">
              <KeyRound size={18} />
              修改登入密碼
            </Link>
          </aside>
        </form>
      </section>
    </MemberLayout>
  );
}
