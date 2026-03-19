import { memberSupabase } from "../lib/supabase";

function buildFallbackProfile(user) {
  return {
    user_id: user.id,
    full_name: String(user.user_metadata?.full_name || ""),
    account: String(user.user_metadata?.account || ""),
    email: String(user.user_metadata?.contact_email || user.email || ""),
    real_phone: String(user.user_metadata?.real_phone || ""),
    persisted: false,
  };
}

export async function loadMemberProfile(user) {
  if (!memberSupabase || !user?.id) {
    return {
      data: null,
      error: new Error("登入狀態失效"),
      errorType: "SESSION_EXPIRED",
    };
  }

  const {
    data: { session },
    error: sessionError,
  } = await memberSupabase.auth.getSession();

  if (sessionError || !session) {
    return {
      data: null,
      error: sessionError || new Error("登入已過期，請重新登入"),
      errorType: "SESSION_EXPIRED",
    };
  }

  const { data, error } = await memberSupabase
    .from("member_profiles")
    .select("user_id, full_name, account, email, real_phone")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!error && data) {
    return {
      data: {
        ...data,
        persisted: true,
      },
      error: null,
      errorType: null,
    };
  }

  if (!error) {
    return {
      data: buildFallbackProfile(user),
      error: null,
      errorType: null,
    };
  }

  return {
    data: null,
    error,
    errorType: error.code === "PGRST116" ? "PROFILE_NOT_FOUND" : "PROFILE_LOAD_FAILED",
  };
}

export async function updateMemberProfile(user, profile) {
  if (!memberSupabase || !user?.id) {
    return { error: new Error("登入狀態失效") };
  }

  const currentAuthEmail = String(user.email || "").toLowerCase();
  const emailChanged = profile.email !== currentAuthEmail;
  const authPayload = {
    data: {
      full_name: profile.full_name,
      account: profile.account,
      real_phone: profile.real_phone,
      contact_email: profile.email,
    },
  };

  if (emailChanged) {
    authPayload.email = profile.email;
  }

  const { error: authError } = await memberSupabase.auth.updateUser(authPayload);
  if (authError) {
    return { error: authError };
  }

  const { error: profileError } = await memberSupabase.from("member_profiles").upsert(
    {
      user_id: user.id,
      full_name: profile.full_name,
      account: profile.account,
      email: profile.email,
      real_phone: profile.real_phone,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (profileError) {
    return { error: profileError };
  }

  return { error: null, emailChanged };
}
