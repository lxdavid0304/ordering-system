import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { configOk } from "../lib/config";
import { loginMember, registerMember } from "../services/authService";
import {
  looksLikeEmail,
  normalizeAccount,
  normalizeEmail,
  normalizePhone,
} from "../utils/auth";

const defaultRegisterForm = {
  fullName: "",
  account: "",
  phone: "",
  email: "",
  password: "",
  passwordConfirm: "",
};

export default function LoginPage() {
  const navigate = useNavigate();
  const { user: memberUser } = useAuth();
  const [activeTab, setActiveTab] = useState("login");
  const [loginForm, setLoginForm] = useState({ loginId: "", password: "" });
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [loginMessage, setLoginMessage] = useState({ text: "", type: "" });
  const [registerMessage, setRegisterMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    if (memberUser) {
      navigate("/order", { replace: true });
    }
  }, [memberUser, navigate]);

  async function handleLoginSubmit(event) {
    event.preventDefault();

    if (!configOk) {
      setLoginMessage({ text: "請先設定 react-app/public/config.js", type: "error" });
      return;
    }

    const loginId = String(loginForm.loginId || "").trim();
    if (!loginId) {
      setLoginMessage({ text: "請輸入帳號或 Email。", type: "error" });
      return;
    }
    if (!loginForm.password) {
      setLoginMessage({ text: "請輸入密碼。", type: "error" });
      return;
    }

    setLoginMessage({ text: "登入中...", type: "" });
    const result = await loginMember(loginId, loginForm.password);
    if (!result.success) {
      setLoginMessage({
        text: looksLikeEmail(loginId)
          ? "登入失敗，請確認 Email 與密碼。"
          : "登入失敗，請確認帳號與密碼；若是舊帳號可改用 Email 登入一次。",
        type: "error",
      });
      return;
    }

    setLoginMessage({ text: "登入成功，跳轉中...", type: "success" });
    navigate("/order", { replace: true });
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();

    if (!configOk) {
      setRegisterMessage({ text: "請先設定 react-app/public/config.js", type: "error" });
      return;
    }

    const payload = {
      fullName: registerForm.fullName.trim(),
      account: normalizeAccount(registerForm.account),
      phone: normalizePhone(registerForm.phone),
      email: normalizeEmail(registerForm.email),
      password: registerForm.password,
      passwordConfirm: registerForm.passwordConfirm,
    };

    if (
      !payload.fullName ||
      !payload.account ||
      !payload.phone ||
      !payload.email ||
      !payload.password ||
      !payload.passwordConfirm
    ) {
      setRegisterMessage({ text: "請完整填寫所有欄位。", type: "error" });
      return;
    }
    if (!/^[a-z0-9]{6,30}$/.test(payload.account)) {
      setRegisterMessage({ text: "帳號需為 6-30 位英文小寫或數字。", type: "error" });
      return;
    }
    if (payload.phone.length < 8 || payload.phone.length > 20) {
      setRegisterMessage({ text: "請輸入有效電話。", type: "error" });
      return;
    }
    if (!looksLikeEmail(payload.email)) {
      setRegisterMessage({ text: "請輸入有效 Email。", type: "error" });
      return;
    }
    if (payload.password.length < 6) {
      setRegisterMessage({ text: "密碼至少 6 碼。", type: "error" });
      return;
    }
    if (payload.password !== payload.passwordConfirm) {
      setRegisterMessage({ text: "兩次密碼不一致。", type: "error" });
      return;
    }

    setRegisterMessage({ text: "註冊中...", type: "" });

    const result = await registerMember({
      fullName: payload.fullName,
      account: payload.account,
      phone: payload.phone,
      email: payload.email,
      password: payload.password,
    });

    if (!result.success) {
      setRegisterMessage({
        text: "註冊失敗，帳號 / Email / 電話可能已存在。",
        type: "error",
      });
      return;
    }

    setRegisterForm({
      ...defaultRegisterForm,
      account: payload.account,
    });
    setRegisterMessage({ text: "註冊成功，請使用帳號與密碼登入。", type: "success" });
    setLoginForm({ loginId: payload.account, password: "" });
    setActiveTab("login");
  }

  return (
    <>
      <div className="bg-glow"></div>
      <main className="page app-shell">
        <header className="hero">
          <h1>會員登入與註冊</h1>
          <p className="subtitle">請先完成註冊，再用帳號或 Email 與密碼登入後進入填單頁面。</p>
        </header>

        <section className="card member-card" id="memberCard">
          <div className="panel-header">
            <div>
              <h2>會員中心</h2>
              <p className="muted">登入成功後才可進入填單系統。</p>
            </div>
              <StatusBadge kind={memberUser ? "open" : "closed"}>
                {memberUser ? "已登入" : "尚未登入"}
              </StatusBadge>
          </div>

          <div className="tab-group">
            <button
              type="button"
              className={`tab${activeTab === "login" ? " active" : ""}`}
              onClick={() => setActiveTab("login")}
            >
              登入
            </button>
            <button
              type="button"
              className={`tab${activeTab === "register" ? " active" : ""}`}
              onClick={() => setActiveTab("register")}
            >
              註冊
            </button>
          </div>

          <div className="auth-panels">
            <form
              className={`stack auth-form${activeTab === "login" ? "" : " hidden"}`}
              onSubmit={handleLoginSubmit}
            >
              <label className="field">
                <span>帳號 / Email</span>
                <input
                  type="text"
                  value={loginForm.loginId}
                  placeholder="請輸入帳號或 Email"
                  required
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, loginId: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>密碼</span>
                <input
                  type="password"
                  value={loginForm.password}
                  required
                  onChange={(event) =>
                    setLoginForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
              <button type="submit" className="primary">
                登入
              </button>
              <FormMessage text={loginMessage.text} type={loginMessage.type} />
            </form>

            <form
              className={`stack auth-form${activeTab === "register" ? "" : " hidden"}`}
              onSubmit={handleRegisterSubmit}
            >
              <label className="field">
                <span>姓名</span>
                <input
                  type="text"
                  value={registerForm.fullName}
                  placeholder="王小明"
                  required
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, fullName: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>帳號</span>
                <input
                  type="text"
                  value={registerForm.account}
                  placeholder="6-30 字元，英文或數字"
                  minLength="6"
                  maxLength="30"
                  required
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, account: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>真實電話</span>
                <input
                  type="tel"
                  value={registerForm.phone}
                  placeholder="09xxxxxxxx"
                  required
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, phone: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={registerForm.email}
                  placeholder="you@example.com"
                  required
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, email: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>密碼</span>
                <input
                  type="password"
                  value={registerForm.password}
                  minLength="6"
                  required
                  onChange={(event) =>
                    setRegisterForm((current) => ({ ...current, password: event.target.value }))
                  }
                />
              </label>
              <label className="field">
                <span>確認密碼</span>
                <input
                  type="password"
                  value={registerForm.passwordConfirm}
                  minLength="6"
                  required
                  onChange={(event) =>
                    setRegisterForm((current) => ({
                      ...current,
                      passwordConfirm: event.target.value,
                    }))
                  }
                />
              </label>
              <button type="submit" className="primary">
                註冊
              </button>
              <FormMessage text={registerMessage.text} type={registerMessage.type} />
            </form>
          </div>
        </section>
      </main>
    </>
  );
}
