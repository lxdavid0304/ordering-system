import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import { useAuth } from "../context/AuthContext";
import { updatePassword } from "../services/authService";

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const { loading, user, signOut } = useAuth();
  const [form, setForm] = useState({
    password: "",
    confirmPassword: "",
  });
  const [message, setMessage] = useState({ text: "", type: "" });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!form.password || !form.confirmPassword) {
      setMessage({ text: "請完整填寫新密碼。", type: "error" });
      return;
    }
    if (form.password.length < 6) {
      setMessage({ text: "新密碼至少 6 碼。", type: "error" });
      return;
    }
    if (form.password !== form.confirmPassword) {
      setMessage({ text: "兩次新密碼不一致。", type: "error" });
      return;
    }

    setSaving(true);
    setMessage({ text: "更新密碼中...", type: "" });

    const { error } = await updatePassword(form.password);
    if (error) {
      setSaving(false);
      setMessage({ text: `更新失敗：${error.message}`, type: "error" });
      return;
    }

    await signOut();
    setSaving(false);
    setMessage({ text: "密碼已更新，請使用新密碼重新登入。", type: "success" });
    window.setTimeout(() => navigate("/", { replace: true }), 1200);
  }

  return (
    <>
      <div className="bg-glow"></div>
      <main className="page app-shell">
        <header className="hero">
          <h1>重設密碼</h1>
          <p className="subtitle">請輸入新密碼，完成後會回到登入頁。</p>
        </header>

        <section className="card member-card">
          {loading ? <p className="muted">驗證重設連結中...</p> : null}
          {!loading && !user ? (
            <div className="stack">
              <FormMessage
                text="重設連結已失效或尚未完成驗證，請重新寄送忘記密碼信。"
                type="error"
              />
              <Link className="ghost profile-link-btn" to="/">
                返回登入頁
              </Link>
            </div>
          ) : null}
          {!loading && user ? (
            <form className="stack auth-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>新密碼</span>
                <input
                  type="password"
                  minLength="6"
                  required
                  value={form.password}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>確認新密碼</span>
                <input
                  type="password"
                  minLength="6"
                  required
                  value={form.confirmPassword}
                  disabled={saving}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, confirmPassword: event.target.value }))
                  }
                />
              </label>
              <div className="actions">
                <button type="submit" className="primary" disabled={saving}>
                  更新密碼
                </button>
                <Link className="ghost profile-link-btn" to="/">
                  返回登入頁
                </Link>
              </div>
              <FormMessage text={message.text} type={message.type} />
            </form>
          ) : null}
        </section>
      </main>
    </>
  );
}
