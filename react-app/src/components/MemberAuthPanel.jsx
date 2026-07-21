import { useEffect, useState } from "react";
import FormMessage from "./FormMessage";
import { configOk } from "../lib/config";
import {
  getRegistrationErrorText,
  loginMember,
  registerMember,
  requestPasswordReset,
} from "../services/authService";
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

function getAuthRequestErrorText(error, fallbackText) {
  const raw = String(error?.message || "").trim();
  if (/failed to fetch|network/i.test(raw)) {
    return "無法連線到會員服務，請稍後再試。";
  }
  return raw || fallbackText;
}

export default function MemberAuthPanel() {
  const [activeTab, setActiveTab] = useState("login");
  const [showReset, setShowReset] = useState(false);
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState(defaultRegisterForm);
  const [resetEmail, setResetEmail] = useState("");
  const [loginMessage, setLoginMessage] = useState({ text: "", type: "" });
  const [registerMessage, setRegisterMessage] = useState({ text: "", type: "" });
  const [resetMessage, setResetMessage] = useState({ text: "", type: "" });
  const [busyAction, setBusyAction] = useState("");

  const busy = Boolean(busyAction);

  useEffect(() => {
    setRegisterMessage({ text: "", type: "" });
  }, [
    registerForm.fullName,
    registerForm.account,
    registerForm.phone,
    registerForm.email,
    registerForm.password,
    registerForm.passwordConfirm,
  ]);

  function switchTab(nextTab) {
    if (busy) {
      return;
    }
    setActiveTab(nextTab);
    setShowReset(false);
  }

  async function handleLoginSubmit(event) {
    event.preventDefault();
    if (!configOk) {
      setLoginMessage({ text: "會員服務尚未完成設定。", type: "error" });
      return;
    }

    const email = normalizeEmail(loginForm.email);
    if (!looksLikeEmail(email) || !loginForm.password) {
      setLoginMessage({ text: "請輸入註冊 Email 與密碼。", type: "error" });
      return;
    }

    setBusyAction("login");
    setLoginMessage({ text: "登入中...", type: "" });
    const result = await loginMember(email, loginForm.password);
    if (!result.success) {
      setLoginMessage({
        text: "登入失敗，請確認 Email 與密碼。",
        type: "error",
      });
      setBusyAction("");
      return;
    }

    setLoginMessage({ text: "登入成功，正在開啟訂購功能...", type: "success" });
    setBusyAction("");
  }

  async function handleRegisterSubmit(event) {
    event.preventDefault();
    if (!configOk) {
      setRegisterMessage({ text: "會員服務尚未完成設定。", type: "error" });
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

    if (Object.values(payload).some((value) => !value)) {
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

    setBusyAction("register");
    setRegisterMessage({ text: "建立會員中...", type: "" });
    const result = await registerMember({
      fullName: payload.fullName,
      account: payload.account,
      phone: payload.phone,
      email: payload.email,
      password: payload.password,
      emailRedirectTo: `${window.location.origin}/order`,
    });

    if (!result.success) {
      setRegisterMessage({ text: getRegistrationErrorText(result.error), type: "error" });
      setBusyAction("");
      return;
    }

    setRegisterForm(defaultRegisterForm);
    setLoginForm({ email: payload.email, password: "" });
    setRegisterMessage({ text: "", type: "" });
    setLoginMessage({
      text: result.requiresEmailConfirmation
        ? "註冊完成，請先到 Email 點擊驗證連結，再回來登入。"
        : "註冊成功，請使用新帳號登入。",
      type: "success",
    });
    setActiveTab("login");
    setBusyAction("");
  }

  async function handleResetSubmit(event) {
    event.preventDefault();
    if (!configOk) {
      setResetMessage({ text: "會員服務尚未完成設定。", type: "error" });
      return;
    }

    const email = normalizeEmail(resetEmail);
    if (!looksLikeEmail(email)) {
      setResetMessage({ text: "請輸入註冊時使用的 Email。", type: "error" });
      return;
    }

    setBusyAction("reset");
    setResetMessage({ text: "重設信寄送中...", type: "" });
    const redirectTo = `${window.location.origin}/reset-password`;
    const { error } = await requestPasswordReset(email, redirectTo);
    if (error) {
      setResetMessage({
        text: `寄送失敗：${getAuthRequestErrorText(error, "請稍後再試。")}`,
        type: "error",
      });
      setBusyAction("");
      return;
    }

    setResetMessage({
      text: "如果此 Email 已註冊，系統會寄出密碼重設信。",
      type: "success",
    });
    setBusyAction("");
  }

  return (
    <div className="member-auth-card" id="memberAuthPanel">
      <div className="member-auth-head">
        <span className="eyebrow">Member Access</span>
        <h2>登入後開始填單</h2>
        <p>登入會員即可保存草稿、查看進度與快速回購。</p>
      </div>

      <div className="member-auth-tabs" role="tablist" aria-label="會員功能">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "login"}
          className={activeTab === "login" ? "active" : ""}
          disabled={busy}
          onClick={() => switchTab("login")}
        >
          登入
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === "register"}
          className={activeTab === "register" ? "active" : ""}
          disabled={busy}
          onClick={() => switchTab("register")}
        >
          註冊
        </button>
      </div>

      {activeTab === "login" ? (
        <div className="member-auth-panel" role="tabpanel">
          <form className="stack" onSubmit={handleLoginSubmit}>
            <label className="field">
              <span>註冊 Email</span>
              <input
                type="email"
                autoComplete="email"
                value={loginForm.email}
                placeholder="輸入註冊 Email"
                disabled={busy}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>密碼</span>
              <input
                type="password"
                autoComplete="current-password"
                value={loginForm.password}
                placeholder="輸入密碼"
                disabled={busy}
                onChange={(event) =>
                  setLoginForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>
            <button type="submit" className="primary member-auth-submit" disabled={busy}>
              {busyAction === "login" ? "登入中..." : "登入並開始填單"}
            </button>
            <FormMessage text={loginMessage.text} type={loginMessage.type} />
          </form>

          <button
            type="button"
            className="member-auth-text-btn"
            disabled={busy}
            aria-expanded={showReset}
            onClick={() => setShowReset((current) => !current)}
          >
            忘記密碼
          </button>

          {showReset ? (
            <form className="stack member-auth-reset" onSubmit={handleResetSubmit}>
              <label className="field">
                <span>註冊 Email</span>
                <input
                  type="email"
                  autoComplete="email"
                  value={resetEmail}
                  placeholder="you@example.com"
                  disabled={busy}
                  onChange={(event) => setResetEmail(event.target.value)}
                />
              </label>
              <button type="submit" className="ghost" disabled={busy}>
                {busyAction === "reset" ? "寄送中..." : "寄送密碼重設信"}
              </button>
              <FormMessage text={resetMessage.text} type={resetMessage.type} />
            </form>
          ) : null}
        </div>
      ) : (
        <form className="stack member-auth-panel" role="tabpanel" onSubmit={handleRegisterSubmit}>
          <div className="member-auth-register-grid">
            <label className="field">
              <span>姓名</span>
              <input
                type="text"
                autoComplete="name"
                value={registerForm.fullName}
                placeholder="王小明"
                disabled={busy}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, fullName: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>帳號</span>
              <input
                type="text"
                autoComplete="username"
                value={registerForm.account}
                placeholder="6-30 位英文或數字"
                disabled={busy}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, account: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>手機號碼</span>
              <input
                type="tel"
                autoComplete="tel"
                value={registerForm.phone}
                placeholder="09xxxxxxxx"
                disabled={busy}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, phone: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                autoComplete="email"
                value={registerForm.email}
                placeholder="you@example.com"
                disabled={busy}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, email: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>密碼</span>
              <input
                type="password"
                autoComplete="new-password"
                value={registerForm.password}
                placeholder="至少 6 碼"
                disabled={busy}
                onChange={(event) =>
                  setRegisterForm((current) => ({ ...current, password: event.target.value }))
                }
              />
            </label>
            <label className="field">
              <span>確認密碼</span>
              <input
                type="password"
                autoComplete="new-password"
                value={registerForm.passwordConfirm}
                placeholder="再次輸入密碼"
                disabled={busy}
                onChange={(event) =>
                  setRegisterForm((current) => ({
                    ...current,
                    passwordConfirm: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <button type="submit" className="primary member-auth-submit" disabled={busy}>
            {busyAction === "register" ? "建立會員中..." : "建立會員帳號"}
          </button>
          <FormMessage text={registerMessage.text} type={registerMessage.type} />
        </form>
      )}

      <div className="member-auth-benefits" aria-label="會員功能">
        <span>草稿自動保存</span>
        <span>訂單進度追蹤</span>
        <span>常用商品回購</span>
      </div>
    </div>
  );
}
