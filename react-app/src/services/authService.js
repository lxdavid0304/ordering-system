import { memberSupabase } from "../lib/supabase";
import { appConfig } from "../lib/config";

export async function loginMemberWithLine(redirectTo) {
  if (!memberSupabase) {
    return { success: false, error: new Error("系統設定尚未完成") };
  }
  if (!appConfig.LINE_LOGIN_ENABLED) {
    const error = new Error("LINE_LOGIN_NOT_CONFIGURED");
    error.code = "LINE_LOGIN_NOT_CONFIGURED";
    return { success: false, error };
  }

  const { error } = await memberSupabase.auth.signInWithOAuth({
    provider: appConfig.LINE_AUTH_PROVIDER,
    options: { redirectTo },
  });

  return { success: !error, error };
}

export function isLineMemberSession(session) {
  const user = session?.user;
  const appMetadata = user?.app_metadata || {};
  const providers = [
    appMetadata.provider,
    ...(Array.isArray(appMetadata.providers) ? appMetadata.providers : []),
    ...(Array.isArray(user?.identities) ? user.identities.map((identity) => identity?.provider) : []),
  ];

  return providers.some((provider) => provider === appConfig.LINE_AUTH_PROVIDER || provider === "custom:line" || provider === "line");
}

export function getLineLoginErrorText(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").trim();

  if (code === "line_login_not_configured") {
    return "LINE 登入尚未完成設定，請聯絡管理員。";
  }
  if (code === "custom_provider_not_found" || /custom.*provider.*not found|provider.*disabled/i.test(message)) {
    return "LINE 登入服務暫時不可用，請稍後再試。";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "網路連線異常，請確認網路後再試一次。";
  }

  return "LINE 登入沒有完成，請稍後再試。";
}
