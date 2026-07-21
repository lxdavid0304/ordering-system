import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const LINE_API_BASE = "https://api.line.me/v2/bot/message";

function textResponse(text: string, status = 200) {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

function toBase64(bytes: ArrayBuffer) {
  const values = new Uint8Array(bytes);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary);
}

function sameText(left: string, right: string) {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return mismatch === 0;
}

async function isValidSignature(body: string, signature: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return sameText(toBase64(digest), signature);
}

async function replyMessage(token: string, replyToken: string, message: string) {
  if (!replyToken) return;
  const response = await fetch(`${LINE_API_BASE}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ replyToken, messages: [{ type: "text", text: message }] }),
  });
  if (!response.ok) {
    console.error("LINE reply failed", response.status, await response.text());
  }
}

function getLinkCode(text: string) {
  const match = text.trim().toUpperCase().match(/^綁定\s*([A-F0-9]{12})$/);
  return match?.[1] || "";
}

serve(async (request) => {
  if (request.method !== "POST") return textResponse("Method not allowed", 405);

  const secret = Deno.env.get("LINE_CHANNEL_SECRET");
  const accessToken = Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const rawBody = await request.text();
  const signature = request.headers.get("x-line-signature") || "";

  if (!secret || !accessToken || !supabaseUrl || !serviceKey) {
    console.error("LINE webhook is missing required secrets");
    return textResponse("Server not configured", 500);
  }
  if (!signature || !(await isValidSignature(rawBody, signature, secret))) {
    return textResponse("Invalid signature", 401);
  }

  let payload: { events?: Array<Record<string, unknown>> };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return textResponse("Invalid payload", 400);
  }

  const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  for (const event of payload.events || []) {
    const eventType = String(event.type || "");
    const source = (event.source || {}) as Record<string, unknown>;
    const lineUserId = String(source.userId || "");
    const replyToken = String(event.replyToken || "");

    if (!/^U[0-9a-f]{32}$/.test(lineUserId)) continue;

    if (eventType === "unfollow") {
      await supabase.rpc("mark_line_account_unfollowed", { p_line_user_id: lineUserId });
      continue;
    }

    if (eventType === "follow") {
      await replyMessage(accessToken, replyToken, "歡迎加入。請先登入代購網站，在會員資料取得 12 位綁定碼後，傳送「綁定 綁定碼」即可接收訂單通知。");
      continue;
    }

    if (eventType !== "message") continue;
    const message = (event.message || {}) as Record<string, unknown>;
    if (message.type !== "text") continue;
    const linkCode = getLinkCode(String(message.text || ""));

    if (!linkCode) {
      await replyMessage(accessToken, replyToken, "請到代購網站的會員資料取得綁定碼，再傳送「綁定 綁定碼」。");
      continue;
    }

    const { data, error } = await supabase.rpc("consume_line_link_code", {
      p_code: linkCode,
      p_line_user_id: lineUserId,
    });
    if (error) {
      console.error("Failed to consume LINE link code", error);
      await replyMessage(accessToken, replyToken, "系統暫時無法完成綁定，請稍後再試。");
    } else if (data === "LINKED") {
      await replyMessage(accessToken, replyToken, "LINE 通知已綁定成功。訂單狀態變更時會在這裡通知你。");
    } else if (data === "ALREADY_LINKED") {
      await replyMessage(accessToken, replyToken, "此 LINE 帳號已綁定其他會員。若需協助，請聯絡管理員。");
    } else {
      await replyMessage(accessToken, replyToken, "綁定碼無效或已過期，請回網站取得新的綁定碼。");
    }
  }

  return textResponse("ok");
});
