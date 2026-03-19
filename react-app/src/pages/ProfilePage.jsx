import { useEffect, useRef, useState } from "react";
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
    <MemberLayout title="會員資料" active="profile">
      <section className="card profile-card" id="profileCard">
        <div className="panel-header">
          <div>
            <h2>個人資料</h2>
            <p className="muted">可編輯姓名、會員帳號、手機號碼與郵箱。</p>
          </div>
          <div className="actions profile-actions">
            <button type="button" className={`ghost${editing ? " hidden" : ""}`} onClick={() => setEditing(true)}>
              編輯資料
            </button>
            <button type="button" className={`ghost${editing ? "" : " hidden"}`} onClick={cancelEdit}>
              取消
            </button>
            <Link className="ghost profile-link-btn" to="/change-password">
              修改密碼
            </Link>
          </div>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <div className="member-profile-card profile-editable">
            <label className="member-profile-row">
              <span className="member-profile-label">姓名</span>
              <input
                className="profile-input"
                type="text"
                required
                readOnly={!editing}
                value={form.full_name}
                onChange={(event) => setForm((current) => ({ ...current, full_name: event.target.value }))}
              />
            </label>
            <label className="member-profile-row">
              <span className="member-profile-label">會員帳號</span>
              <input
                className="profile-input"
                type="text"
                required
                readOnly={!editing}
                value={form.account}
                onChange={(event) => setForm((current) => ({ ...current, account: event.target.value }))}
              />
            </label>
            <label className="member-profile-row">
              <span className="member-profile-label">手機號碼</span>
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
            <label className="member-profile-row">
              <span className="member-profile-label">郵箱</span>
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

          <div className="actions">
            <button type="submit" className={`primary${editing ? "" : " hidden"}`}>
              儲存變更
            </button>
          </div>
          <FormMessage text={message.text} type={message.type} />
        </form>
      </section>
    </MemberLayout>
  );
}
