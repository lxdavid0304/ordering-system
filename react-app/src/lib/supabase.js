import { createClient } from "@supabase/supabase-js";
import { appConfig, configOk } from "./config";

const MEMBER_AUTH_STORAGE_KEY = "ordering-system-member-auth";

function isPasswordResetRoute() {
  if (typeof window === "undefined") {
    return false;
  }

  return /^\/reset-password(?:\/|$)/.test(window.location.pathname);
}

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
    },
  });
}

export const memberSupabase = createScopedClient(MEMBER_AUTH_STORAGE_KEY, isPasswordResetRoute());
export const adminSupabase = memberSupabase;

export const supabase = memberSupabase;
