import { createClient } from "@supabase/supabase-js";
import { appConfig, configOk } from "./config";

const MEMBER_AUTH_STORAGE_KEY = "ordering-system-member-auth";

function createScopedClient(storageKey, detectSessionInUrl = false) {
  if (!configOk) {
    return null;
  }

  return createClient(appConfig.SUPABASE_URL, appConfig.SUPABASE_ANON_KEY, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      storageKey,
      detectSessionInUrl,
      // LINE may hand the user between its app and web view. The implicit
      // callback keeps the returned session in the URL fragment, so it does
      // not depend on a PKCE verifier surviving that handoff.
      flowType: "implicit",
    },
  });
}

export const memberSupabase = createScopedClient(MEMBER_AUTH_STORAGE_KEY, true);
export const adminSupabase = memberSupabase;

export const supabase = memberSupabase;
