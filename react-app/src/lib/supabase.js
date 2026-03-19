import { createClient } from "@supabase/supabase-js";
import { appConfig, configOk } from "./config";

const MEMBER_AUTH_STORAGE_KEY = "ordering-system-member-auth";
const ADMIN_AUTH_STORAGE_KEY = "ordering-system-admin-auth";

function isAdminRoute() {
  if (typeof window === "undefined") {
    return false;
  }

  return /^\/admin(?:\/|$)/.test(window.location.pathname);
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

export const memberSupabase = createScopedClient(MEMBER_AUTH_STORAGE_KEY, false);
export const adminSupabase = createScopedClient(ADMIN_AUTH_STORAGE_KEY, isAdminRoute());

export const supabase = memberSupabase;
