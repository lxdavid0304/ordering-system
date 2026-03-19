import { adminSupabase, memberSupabase } from "../lib/supabase";

function resolveScheduleClient(scope = "member") {
  return scope === "admin" ? adminSupabase : memberSupabase;
}

export async function loadOrderingSchedule(scope = "member") {
  const client = resolveScheduleClient(scope);

  if (!client) {
    return { data: null, error: new Error("請先設定 config.js") };
  }

  return client
    .from("ordering_schedule")
    .select("open_day, open_hour, close_day, close_hour, is_always_open")
    .eq("id", 1)
    .single();
}

export async function saveOrderingSchedule(payload, scope = "admin") {
  const client = resolveScheduleClient(scope);

  if (!client) {
    return { data: null, error: new Error("請先設定 config.js") };
  }

  return client
    .from("ordering_schedule")
    .update({
      ...payload,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("id")
    .maybeSingle();
}
