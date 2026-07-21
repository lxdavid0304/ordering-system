import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import postgres from "https://esm.sh/postgres@3.4.5";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed" }, 405);

  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!token) return response({ error: "Authentication required" }, 401);
  if (!supabaseUrl || !serviceKey) return response({ error: "Server not configured" }, 500);

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  if (userError || !userData.user) return response({ error: "Authentication required" }, 401);

  const { data: admin } = await supabase
    .from("admin_users")
    .select("user_id")
    .eq("user_id", userData.user.id)
    .maybeSingle();
  if (!admin) return response({ error: "Admin required" }, 403);

  let orderId = "";
  try {
    const body = await request.json();
    orderId = typeof body?.order_id === "string" ? body.order_id : "";
  } catch {
    return response({ error: "Invalid request" }, 400);
  }
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) return response({ error: "Invalid order id" }, 400);

  const { data, error } = await supabase
    .from("line_notification_jobs")
    .select("id, status, attempts, payload, error_message, created_at, updated_at, processing_started_at, next_attempt_at, sent_at")
    .eq("order_id", orderId)
    .order("created_at", { ascending: false });
  if (error) return response({ error: "Notification queue unavailable" }, 500);

  const { count: queueTotal } = await supabase
    .from("line_notification_jobs")
    .select("id", { count: "exact", head: true });

  let databaseDiagnostics: Record<string, unknown> = {
    function_config: {
      database_url_configured: Boolean(Deno.env.get("SUPABASE_DB_URL")),
      line_access_token_configured: Boolean(Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN")),
      worker_token_configured: Boolean(Deno.env.get("LINE_NOTIFICATION_WORKER_TOKEN")),
    },
    selected_jobs: (data || []).map((job) => ({
      status: job.status,
      attempts: job.attempts,
      error_message: job.error_message,
      created_at: job.created_at,
      updated_at: job.updated_at,
      processing_started_at: job.processing_started_at,
      next_attempt_at: job.next_attempt_at,
      sent_at: job.sent_at,
    })),
  };
  const databaseUrl = Deno.env.get("SUPABASE_DB_URL");
  if (databaseUrl) {
    try {
      const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5 });
      const [queueStates, triggers] = await Promise.all([
        sql`select status, count(*)::integer as count from public.line_notification_jobs group by status order by status`,
        sql`
          select c.relname as table_name, t.tgname as trigger_name, pg_get_triggerdef(t.oid) as definition
          from pg_trigger t
          join pg_class c on c.oid = t.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('orders', 'line_notification_jobs')
            and not t.tgisinternal
          order by c.relname, t.tgname
        `,
      ]);
      await sql.end({ timeout: 5 });
      databaseDiagnostics = { queue_states: queueStates, triggers };
    } catch (error) {
      databaseDiagnostics = { error: error instanceof Error ? error.message : String(error) };
    }
  }

  const lineToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  if (lineToken) {
    const startedAt = Date.now();
    try {
      const lineResponse = await fetch("https://api.line.me/v2/bot/info", {
        headers: { Authorization: `Bearer ${lineToken}` },
        signal: AbortSignal.timeout(5000),
      });
      databaseDiagnostics.line_api_check = {
        ok: lineResponse.ok,
        status: lineResponse.status,
        latency_ms: Date.now() - startedAt,
      };
    } catch (error) {
      databaseDiagnostics.line_api_check = {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        latency_ms: Date.now() - startedAt,
      };
    }
  }

  return response({ jobs: data || [], queue_total: queueTotal || 0, diagnostics: databaseDiagnostics });
});
