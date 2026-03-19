const runtimeConfig =
  typeof window !== "undefined" && window.APP_CONFIG && typeof window.APP_CONFIG === "object"
    ? window.APP_CONFIG
    : {};

export const appConfig = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || runtimeConfig.SUPABASE_URL || "",
  SUPABASE_ANON_KEY:
    import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.SUPABASE_ANON_KEY || "",
  ADMIN_DEFAULT_EMAIL:
    import.meta.env.VITE_ADMIN_DEFAULT_EMAIL || runtimeConfig.ADMIN_DEFAULT_EMAIL || "",
};

export const configOk = Boolean(appConfig.SUPABASE_URL && appConfig.SUPABASE_ANON_KEY);
