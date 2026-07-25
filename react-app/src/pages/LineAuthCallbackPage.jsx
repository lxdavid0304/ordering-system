import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { configOk } from "../lib/config";
import { memberSupabase } from "../lib/supabase";

function readOAuthError() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return (
    search.get("error_description") ||
    hash.get("error_description") ||
    search.get("error") ||
    hash.get("error") ||
    ""
  );
}

export default function LineAuthCallbackPage() {
  const navigate = useNavigate();
  const [message, setMessage] = useState("正在完成 LINE 登入...");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let timeoutId;

    async function finishLogin() {
      const oauthError = readOAuthError();
      if (oauthError) {
        setError(`LINE 登入未完成：${oauthError}`);
        return;
      }

      if (!configOk || !memberSupabase) {
        setError("訂購系統尚未完成登入服務設定，請聯絡管理員。");
        return;
      }

      const complete = async (session) => {
        if (!active || !session) {
          return;
        }
        setMessage("LINE 登入完成，正在前往會員資料...");
        navigate("/profile", { replace: true });
      };

      const { data, error: sessionError } = await memberSupabase.auth.getSession();
      if (sessionError) {
        setError(`LINE 登入失敗：${sessionError.message}`);
        return;
      }
      if (data.session) {
        await complete(data.session);
        return;
      }

      const { data: listener } = memberSupabase.auth.onAuthStateChange((_event, nextSession) => {
        complete(nextSession);
      });

      timeoutId = window.setTimeout(() => {
        if (active) {
          listener.subscription.unsubscribe();
          setError("未能完成 LINE 登入。請重新按一次「使用 LINE 登入」；若仍失敗，請將此頁訊息提供給管理員。");
        }
      }, 10000);

      return () => listener.subscription.unsubscribe();
    }

    let unsubscribe;
    finishLogin().then((cleanup) => {
      unsubscribe = cleanup;
    });

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
      unsubscribe?.();
    };
  }, [navigate]);

  return (
    <main className="page">
      <section className="card member-auth-loading" aria-live="polite">
        <h1>{error ? "LINE 登入未完成" : "正在登入"}</h1>
        <p className={error ? "form-message error" : "muted"}>{error || message}</p>
        {error ? (
          <Link className="primary" to="/order">
            返回登入頁
          </Link>
        ) : null}
      </section>
    </main>
  );
}
