import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { configOk } from "../lib/config";
import { memberSupabase } from "../lib/supabase";
import { hasCompletedMemberProfile, loadMemberProfile } from "../services/profileService";
import { ensureLineMemberBinding } from "../services/lineService";
import { isLineMemberSession } from "../services/authService";

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
        if (!isLineMemberSession(session)) {
          setMessage("偵測到舊登入狀態，正在重新以 LINE 驗證…");
          await memberSupabase.auth.signOut({ scope: "local" });
          if (active) navigate("/line-member", { replace: true });
          return;
        }
        setMessage("LINE 登入完成，正在確認會員資料...");

        const bindingResult = await ensureLineMemberBinding();
        if (!active) {
          return;
        }
        if (bindingResult.error) {
          const detail = String(bindingResult.error.code || bindingResult.error.message || "UNKNOWN_ERROR");
          setError(`LINE 會員綁定失敗（${detail}）。`);
          return;
        }

        const profileResult = await loadMemberProfile(session.user);
        if (!active) {
          return;
        }
        if (profileResult.error) {
          setError("LINE 登入完成，但會員資料讀取失敗。請重新登入後再試。");
          return;
        }

        if (hasCompletedMemberProfile(profileResult.data)) {
          setMessage("歡迎回來，正在前往填單頁...");
          navigate("/order", { replace: true });
          return;
        }

        setMessage("首次 LINE 登入，請先完成會員資料...");
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
