import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { configOk } from "../lib/config";
import { memberSupabase } from "../lib/supabase";
import { getLineLoginErrorText, loginMemberWithLine } from "../services/authService";

export default function LineMemberPage() {
  const [message, setMessage] = useState("正在確認 LINE 會員登入…");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function enter() {
      if (!configOk || !memberSupabase) {
        setError("系統設定尚未完成，請聯絡管理員。");
        return;
      }
      const { data, error: sessionError } = await memberSupabase.auth.getSession();
      if (!active) return;
      if (sessionError) {
        setError("無法確認登入狀態，請稍後再試。");
        return;
      }
      if (data.session) {
        window.location.replace(`${window.location.origin}/auth/callback`);
        return;
      }
      setMessage("正在前往 LINE 登入…");
      const result = await loginMemberWithLine(`${window.location.origin}/auth/callback`);
      if (!result.success && active) setError(getLineLoginErrorText(result.error));
    }
    enter();
    return () => { active = false; };
  }, []);

  return (
    <main className="page">
      <section className="card member-auth-loading" aria-live="polite">
        <h1>{error ? "LINE 會員登入失敗" : "LINE 會員"}</h1>
        <p className={error ? "form-message error" : "muted"}>{error || message}</p>
        {error ? <Link className="primary" to="/order">返回訂購頁</Link> : null}
      </section>
    </main>
  );
}
