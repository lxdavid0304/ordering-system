import { memberSupabase } from "../lib/supabase";

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

  const { data, error } = await memberSupabase.auth.signUp({
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
  });

  if (error) {
    return { success: false, error };
  }

  // Without a session the email still needs confirmation. The database trigger
  // creates member_profiles, while an anonymous upsert would be rejected by RLS.
  if (data?.user && data?.session) {
    const { error: profileError } = await upsertMemberProfile(data.user.id, {
      full_name: fullName,
      account: normalizedAccount,
      email: normalizedEmail,
      real_phone: phone,
    });

    if (profileError) {
      return { success: false, error: profileError };
    }
  }

  if (data?.session) {
    await memberSupabase.auth.signOut();
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
