const runtimeConfig =
  typeof window !== "undefined" && window.APP_CONFIG && typeof window.APP_CONFIG === "object"
    ? window.APP_CONFIG
    : {};

export const appConfig = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL || runtimeConfig.SUPABASE_URL || "",
  SUPABASE_ANON_KEY:
    import.meta.env.VITE_SUPABASE_ANON_KEY || runtimeConfig.SUPABASE_ANON_KEY || "",
  LINE_LOGIN_ENABLED:
    import.meta.env.VITE_LINE_LOGIN_ENABLED === "true" || runtimeConfig.LINE_LOGIN_ENABLED === true,
  LINE_AUTH_PROVIDER:
    import.meta.env.VITE_LINE_AUTH_PROVIDER || runtimeConfig.LINE_AUTH_PROVIDER || "custom:line",
};

export const configOk = Boolean(appConfig.SUPABASE_URL && appConfig.SUPABASE_ANON_KEY);
