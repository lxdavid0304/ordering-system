import { memberSupabase } from "../lib/supabase";

export async function ensureLineMemberBinding() {
  if (!memberSupabase) return { data: null, error: new Error("系統設定尚未完成") };
  const { data, error } = await memberSupabase.rpc("bind_current_line_member");
  return { data: Array.isArray(data) ? data[0] || null : data, error };
}

export async function loadLineBinding(userId) {
  if (!memberSupabase || !userId) return { data: null, error: null };
  return memberSupabase
    .from("member_line_bindings")
    .select("user_id, notifications_enabled, linked_at, blocked_at")
    .eq("user_id", userId)
    .maybeSingle();
}

export async function updateLineNotifications(enabled) {
  if (!memberSupabase) return { data: null, error: new Error("系統設定尚未完成") };
  return memberSupabase
    .from("member_line_bindings")
    .update({ notifications_enabled: Boolean(enabled) })
    .select("user_id, notifications_enabled, linked_at, blocked_at")
    .maybeSingle();
}
