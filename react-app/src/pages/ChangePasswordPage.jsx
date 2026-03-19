import { useState } from "react";
import { Link } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { updatePassword, verifyPassword } from "../services/authService";

export default function ChangePasswordPage() {
  const { user } = useAuth();
  const [form, setForm] = useState({
    currentPassword: "",
    newPassword: "",
    confirmNewPassword: "",
  });
  const [message, setMessage] = useState({ text: "", type: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.currentPassword || !form.newPassword || !form.confirmNewPassword) {
      setMessage({ text: "請完整填寫所有欄位。", type: "error" });
      return;
    }
    if (form.newPassword.length < 6) {
      setMessage({ text: "新密碼至少 6 碼。", type: "error" });
      return;
    }
    if (form.newPassword !== form.confirmNewPassword) {
      setMessage({ text: "兩次新密碼不一致。", type: "error" });
      return;
    }
    if (form.currentPassword === form.newPassword) {
      setMessage({ text: "新密碼不可與原密碼相同。", type: "error" });
      return;
    }

    setSaving(true);
    setMessage({ text: "驗證原密碼中...", type: "" });

    const { error: verifyError } = await verifyPassword(String(user.email || ""), form.currentPassword);
    if (verifyError) {
      setSaving(false);
      setMessage({ text: "原密碼不正確。", type: "error" });
      return;
    }

    setMessage({ text: "更新密碼中...", type: "" });
    const { error: updateError } = await updatePassword(form.newPassword);
    if (updateError) {
      setSaving(false);
      setMessage({ text: `修改失敗：${updateError.message}`, type: "error" });
      return;
    }

    setForm({
      currentPassword: "",
      newPassword: "",
      confirmNewPassword: "",
    });
    setSaving(false);
    setMessage({ text: "密碼已成功更新。", type: "success" });
  }

  return (
    <MemberLayout title="修改密碼" active="profile">
      <section className="card profile-card" id="changePasswordCard">
        <div className="panel-header">
          <div>
            <h2>密碼安全設定</h2>
            <p className="muted">請先輸入原密碼，再輸入新密碼兩次完成變更。</p>
          </div>
        </div>

        <form className="stack" onSubmit={handleSubmit}>
          <label className="field">
            <span>原密碼</span>
            <input
              type="password"
              minLength="6"
              required
              value={form.currentPassword}
              onChange={(event) =>
                setForm((current) => ({ ...current, currentPassword: event.target.value }))
              }
            />
          </label>
          <label className="field">
            <span>新密碼</span>
            <input
              type="password"
              minLength="6"
              required
              value={form.newPassword}
              onChange={(event) => setForm((current) => ({ ...current, newPassword: event.target.value }))}
            />
          </label>
          <label className="field">
            <span>確認新密碼</span>
            <input
              type="password"
              minLength="6"
              required
              value={form.confirmNewPassword}
              onChange={(event) =>
                setForm((current) => ({ ...current, confirmNewPassword: event.target.value }))
              }
            />
          </label>
          <div className="actions">
            <button type="submit" className="primary" disabled={saving}>
              儲存新密碼
            </button>
            <Link className="ghost profile-link-btn" to="/profile">
              返回會員資料
            </Link>
          </div>
          <FormMessage text={message.text} type={message.type} />
        </form>
      </section>
    </MemberLayout>
  );
}
