import { memberSupabase } from "../lib/supabase";
import { appConfig } from "../lib/config";
import { normalizeAccount, normalizeEmail } from "../utils/auth";

const AUTH_REQUEST_TIMEOUT_MS = 20000;

function withAuthRequestTimeout(request) {
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error("AUTH_REQUEST_TIMEOUT");
      error.code = "AUTH_REQUEST_TIMEOUT";
      reject(error);
    }, AUTH_REQUEST_TIMEOUT_MS);
  });

  return Promise.race([request, timeout]).finally(() => window.clearTimeout(timeoutId));
}

export async function upsertMemberProfile(userId, profile) {
  if (!memberSupabase || !userId || !profile) {
    return { error: null };
  }

  const payload = {
    user_id: userId,
    full_name: profile.full_name,
    account: profile.account,
    email: profile.email,
    real_phone: profile.real_phone,
    updated_at: new Date().toISOString(),
  };

  const { error } = await memberSupabase.from("member_profiles").upsert(payload, {
    onConflict: "user_id",
  });

  return { error };
}

export async function loginMember(email, password) {
  if (!memberSupabase) {
    return { success: false, error: new Error("請先設定 config.js") };
  }

  const { data, error } = await memberSupabase.auth.signInWithPassword({ email, password });
  return { success: Boolean(data?.session?.user), error };
}

export function getLoginErrorText(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").trim();

  if (code === "email_not_confirmed" || /email.*not confirmed|email.*not verified/i.test(message)) {
    return "此 Email 尚未驗證。請開啟註冊信中的驗證連結後，再回來登入。";
  }
  if (code === "invalid_credentials" || /invalid login credentials/i.test(message)) {
    return "登入失敗，請確認註冊 Email 與密碼。";
  }
  if (code === "user_banned" || /user.*banned/i.test(message)) {
    return "此帳戶目前無法登入，請聯絡管理員。";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "網路連線失敗，請確認網路後再試。";
  }

  return "登入失敗，請稍後再試；若持續發生請聯絡管理員。";
}

export async function loginMemberWithLine(redirectTo) {
  if (!memberSupabase) {
    return { success: false, error: new Error("請先設定 config.js") };
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

export async function registerMember({
  fullName,
  account,
  phone,
  email,
  password,
  emailRedirectTo,
}) {
  if (!memberSupabase) {
    return { success: false, error: new Error("請先設定 config.js") };
  }

  const normalizedAccount = normalizeAccount(account);
  const normalizedEmail = normalizeEmail(email);

  let data;
  let error;
  try {
    ({ data, error } = await withAuthRequestTimeout(memberSupabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        emailRedirectTo,
        data: {
          full_name: fullName,
          account: normalizedAccount,
          real_phone: phone,
          contact_email: normalizedEmail,
        },
      },
    })));
  } catch (requestError) {
    return { success: false, error: requestError };
  }

  if (error) {
    return { success: false, error };
  }

  // Without a session the email still needs confirmation. The database trigger
  // creates member_profiles, while an anonymous upsert would be rejected by RLS.
  if (data?.user && data?.session) {
    let profileError;
    try {
      ({ error: profileError } = await withAuthRequestTimeout(upsertMemberProfile(data.user.id, {
        full_name: fullName,
        account: normalizedAccount,
        email: normalizedEmail,
        real_phone: phone,
      })));
    } catch (requestError) {
      return { success: false, error: requestError };
    }

    if (profileError) {
      return { success: false, error: profileError };
    }
  }

  if (data?.session) {
    void memberSupabase.auth.signOut();
  }

  return {
    success: true,
    error: null,
    requiresEmailConfirmation: !data?.session,
  };
}

export function getRegistrationErrorText(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").trim();

  if (code === "auth_request_timeout" || message === "AUTH_REQUEST_TIMEOUT") {
    return "註冊服務暫時沒有回應，請稍後再試。若已收到驗證信，請先完成驗證後再登入。";
  }

  if (
    error?.status === 429 ||
    code === "over_email_send_rate_limit" ||
    /email.*rate limit|rate limit.*email/i.test(message)
  ) {
    return "驗證信寄送次數已達目前上限，請稍後再試；刪除帳號不會重設此限制。";
  }
  if (code === "user_already_exists" || /already registered|user already exists/i.test(message)) {
    return "此 Email 已經註冊，請直接登入或使用忘記密碼。";
  }
  if (/database error saving new user|failed to save new user/i.test(message)) {
    return "會員帳號、手機或 Email 已被使用，請更換資料後再試。";
  }
  if (/member_profiles_account_key|account.*duplicate/i.test(message)) {
    return "此帳號已被使用，請更換帳號。";
  }
  if (/member_profiles_real_phone_key|phone.*duplicate/i.test(message)) {
    return "此手機號碼已被使用，請直接登入原帳號。";
  }
  if (/member_profiles_email_key|email.*duplicate/i.test(message)) {
    return "此 Email 已經註冊，請直接登入或使用忘記密碼。";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "無法連線到會員服務，請稍後再試。";
  }

  return "註冊失敗，請稍後再試；若持續發生請聯絡管理員。";
}

export function getLineLoginErrorText(error) {
  const code = String(error?.code || "").toLowerCase();
  const message = String(error?.message || "").trim();

  if (code === "line_login_not_configured") {
    return "LINE 登入尚未完成設定。";
  }
  if (code === "custom_provider_not_found" || /custom.*provider.*not found|provider.*disabled/i.test(message)) {
    return "LINE 登入服務尚未啟用，請稍後再試。";
  }
  if (/failed to fetch|network/i.test(message)) {
    return "無法連線到 LINE 登入服務，請稍後再試。";
  }

  return "LINE 登入失敗，請稍後再試。";
}

export async function verifyPassword(email, password) {
  if (!memberSupabase) {
    return { error: new Error("請先設定 config.js") };
  }
  return memberSupabase.auth.signInWithPassword({ email, password });
}

export async function updatePassword(password) {
  if (!memberSupabase) {
    return { error: new Error("請先設定 config.js") };
  }
  return memberSupabase.auth.updateUser({ password });
}

export async function requestPasswordReset(email, redirectTo) {
  if (!memberSupabase) {
    return { error: new Error("請先設定 config.js") };
  }

  return memberSupabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo,
  });
}
