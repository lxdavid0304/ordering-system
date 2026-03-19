import { adminSupabase, memberSupabase } from "../lib/supabase";
import {
  buildLoginCandidates,
  looksLikeEmail,
  normalizeAccount,
  normalizeEmail,
  rememberAccountEmail,
} from "../utils/auth";

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

export async function loginMember(loginId, password) {
  if (!memberSupabase) {
    return { success: false, error: new Error("請先設定 config.js") };
  }

  const candidates = buildLoginCandidates(loginId);
  let lastError = null;

  for (const email of candidates) {
    const { data, error } = await memberSupabase.auth.signInWithPassword({
      email,
      password,
    });

    if (!error && data?.session?.user) {
      const accountFromMeta = normalizeAccount(
        data.session.user.user_metadata?.account || (!looksLikeEmail(loginId) ? loginId : "")
      );

      if (accountFromMeta) {
        rememberAccountEmail(accountFromMeta, data.session.user.email || email);
      }

      return { success: true, error: null };
    }

    lastError = error;
  }

  return { success: false, error: lastError };
}

export async function registerMember({ fullName, account, phone, email, password }) {
  if (!memberSupabase) {
    return { success: false, error: new Error("請先設定 config.js") };
  }

  const normalizedAccount = normalizeAccount(account);
  const normalizedEmail = normalizeEmail(email);

  const { data, error } = await memberSupabase.auth.signUp({
    email: normalizedEmail,
    password,
    options: {
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

  if (data?.user) {
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

  rememberAccountEmail(normalizedAccount, normalizedEmail);

  if (data?.session) {
    await memberSupabase.auth.signOut();
  }

  return { success: true, error: null };
}

export async function signInAdmin(email, password) {
  if (!adminSupabase) {
    return { error: new Error("請先設定 config.js") };
  }

  return adminSupabase.auth.signInWithPassword({
    email: email.trim(),
    password,
  });
}

export async function signInAdminWithGitHub(redirectTo) {
  if (!adminSupabase) {
    return { error: new Error("請先設定 config.js") };
  }

  return adminSupabase.auth.signInWithOAuth({
    provider: "github",
    options: { redirectTo },
  });
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
