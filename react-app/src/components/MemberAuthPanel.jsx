import { useState } from "react";
import { MessageCircle } from "lucide-react";
import FormMessage from "./FormMessage";
import { configOk } from "../lib/config";
import { getLineLoginErrorText, loginMemberWithLine } from "../services/authService";

export default function MemberAuthPanel() {
  const [message, setMessage] = useState({ text: "", type: "" });
  const [busy, setBusy] = useState(false);

  async function handleLineLogin() {
    if (!configOk) {
      setMessage({ text: "系統設定尚未完成，請聯絡管理員。", type: "error" });
      return;
    }

    setBusy(true);
    setMessage({ text: "正在前往 LINE 登入…", type: "" });
    try {
      const result = await loginMemberWithLine(`${window.location.origin}/auth/callback`);
      if (!result.success) {
        setMessage({ text: getLineLoginErrorText(result.error), type: "error" });
      }
    } catch (error) {
      setMessage({ text: getLineLoginErrorText(error), type: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="member-auth-card" id="memberAuthPanel">
      <div className="member-auth-head">
        <span className="eyebrow">LINE MEMBER</span>
        <h2>使用 LINE 開始訂購</h2>
        <p>首次登入只要填寫姓名與手機，即可接收個人訂單與快閃熱食通知。</p>
      </div>

      <div className="member-auth-panel">
        <button type="button" className="member-auth-line-button" disabled={busy} onClick={handleLineLogin}>
          <MessageCircle className="member-auth-line-icon" size={20} aria-hidden="true" />
          {busy ? "正在連線…" : "使用 LINE 登入／綁定會員"}
        </button>
        <p className="member-auth-benefits">
          <span>不用 Email 與密碼</span>
          <span>下單後自動接收 LINE 通知</span>
        </p>
        <FormMessage text={message.text} type={message.type} />
      </div>
    </div>
  );
}
