import { memberSupabase } from "../lib/supabase";

function buildFallbackProfile(user) {
  return {
    user_id: user.id,
    full_name: String(user.user_metadata?.full_name || user.user_metadata?.name || ""),
    account: String(user.user_metadata?.account || ""),
    email: String(user.user_metadata?.contact_email || user.email || ""),
    real_phone: String(user.user_metadata?.real_phone || ""),
    persisted: false,
  };
}

export function hasCompletedMemberProfile(profile) {
  return Boolean(
    profile?.persisted &&
      String(profile.full_name || "").trim() &&
      String(profile.real_phone || "").trim()
  );
}

export async function loadMemberProfile(user) {
  if (!memberSupabase || !user?.id) {
    return { data: null, error: new Error("登入狀態已失效"), errorType: "SESSION_EXPIRED" };
  }

  const {
    data: { session },
    error: sessionError,
  } = await memberSupabase.auth.getSession();
  if (sessionError || !session) {
    return {
      data: null,
      error: sessionError || new Error("登入狀態已失效"),
      errorType: "SESSION_EXPIRED",
    };
  }

  const { data, error } = await memberSupabase
    .from("member_profiles")
    .select("user_id, full_name, account, email, real_phone")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!error && data) return { data: { ...data, persisted: true }, error: null, errorType: null };
  if (!error) return { data: buildFallbackProfile(user), error: null, errorType: null };
  return {
    data: null,
    error,
    errorType: error.code === "PGRST116" ? "PROFILE_NOT_FOUND" : "PROFILE_LOAD_FAILED",
  };
}

export async function updateMemberProfile(user, profile) {
  if (!memberSupabase || !user?.id) return { error: new Error("登入狀態已失效") };

  const fullName = String(profile.full_name || "").trim();
  const phone = String(profile.real_phone || "").trim();
  // Keep profile completion in one database transaction. Updating Auth user
  // metadata first emits USER_UPDATED, which reloads the profile page and can
  // interrupt the first-time LINE member completion flow.
  const { data, error } = await memberSupabase.rpc("complete_current_line_member_profile", {
    p_full_name: fullName,
    p_real_phone: phone,
  });
  const savedProfile = Array.isArray(data) ? data[0] || null : data;
  return { data: savedProfile, error };
}
