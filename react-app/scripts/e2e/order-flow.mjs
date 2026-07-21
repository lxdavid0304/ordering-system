import { createClient } from "@supabase/supabase-js";

const PASSWORD = "E2eOrderFlow!2026";

function requiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`缺少環境變數 ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function unwrap(result, action) {
  if (result.error) throw new Error(`${action}：${result.error.message}`);
  return result.data;
}

function createSuffix() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function createTestUser(service, suffix, role) {
  const email = `e2e-${role}-${suffix}@example.invalid`;
  const result = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  const user = unwrap(result, `建立${role}測試帳號`);
  return { id: user.user.id, email };
}

async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const session = unwrap(
    await client.auth.signInWithPassword({ email, password: PASSWORD }),
    "登入測試帳號"
  );
  assert(session.session?.access_token, "測試帳號沒有取得登入權杖");
  return { client, token: session.session.access_token };
}

async function createOrder({ url, anonKey, memberToken, suffix, unitPrice, paymentMethod }) {
  const response = await fetch(`${url}/functions/v1/create-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: anonKey,
      Authorization: `Bearer ${memberToken}`,
    },
    body: JSON.stringify({
      access_token: memberToken,
      delivery_location: "測試交貨點",
      note: "e2e automated order flow",
      device_id: `e2e-device-${suffix}`,
      idempotency_key: `e2e-order-${suffix}`,
      payment_method: paymentMethod,
      items: [{ product_name: "E2E 測試商品", unit_price: unitPrice, quantity: 1 }],
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`建立訂單失敗 (${response.status})：${body.error || JSON.stringify(body)}`);
  }
  return body;
}

async function verifyQueuedStatus(service, orderId, status) {
  const jobs = unwrap(
    await service
      .from("line_notification_jobs")
      .select("payload")
      .eq("order_id", orderId),
    "讀取 LINE 通知佇列"
  );
  assert(
    jobs.some((job) => job.payload?.to_status === status),
    `LINE 通知佇列未包含狀態 ${status}`
  );
}

async function verifyNotificationWorker(adminClient, service, orderId) {
  const { error } = await adminClient.functions.invoke("line-notify", {
    body: { order_id: orderId },
  });
  if (error) throw new Error(`執行 LINE 通知工作者：${error.message}`);

  const jobs = unwrap(
    await service
      .from("line_notification_jobs")
      .select("status")
      .eq("order_id", orderId),
    "確認 LINE 通知處理結果"
  );
  assert(jobs.length > 0 && jobs.every((job) => job.status === "skipped"), "LINE 工作未安全略過未綁定帳號");
}

async function loadOrder(service, orderId) {
  return unwrap(
    await service
      .from("orders")
      .select("id, status, total_amount, quoted_total_amount, shipping_amount, profit_amount, deposit_paid_amount, balance_paid_amount, selected_payment_method, fulfilled_at")
      .eq("id", orderId)
      .single(),
    "讀取測試訂單"
  );
}

async function advanceStatus(adminClient, orderId, status) {
  return unwrap(
    await adminClient.rpc("admin_update_order", {
      p_order_id: orderId,
      p_status: status,
      p_admin_note: "E2E flow verification",
      p_reason: null,
    }),
    `更新訂單為 ${status}`
  );
}

async function markReadyForPickup(adminClient, orderId, finalTotal) {
  return unwrap(
    await adminClient.rpc("admin_mark_order_ready_for_pickup", {
      p_order_id: orderId,
      p_final_total_amount: finalTotal,
      p_reason: "E2E actual checkout adjustment",
    }),
    "確認實際總額並設為待取貨"
  );
}

async function savePayment(adminClient, orderId, phase, amount) {
  return unwrap(
    await adminClient.rpc("admin_save_order_payment", {
      p_order_id: orderId,
      p_phase: phase,
      p_amount: amount,
      p_method: "transfer",
      p_paid_at: new Date().toISOString(),
      p_review_complete: true,
    }),
    `儲存${phase === "deposit" ? "訂金" : "尾款"}`
  );
}

export async function runOrderFlow({ label, unitPrice, finalTotal, expectedInitialStatus, paymentMethod }) {
  const url = requiredEnv("E2E_SUPABASE_URL").replace(/\/$/, "");
  const anonKey = requiredEnv("E2E_SUPABASE_ANON_KEY");
  const serviceRoleKey = requiredEnv("E2E_SUPABASE_SERVICE_ROLE_KEY");
  if (!url.includes("localhost") && process.env.E2E_ALLOW_REMOTE !== "true") {
    throw new Error("遠端測試會建立暫時帳號；請明確設定 E2E_ALLOW_REMOTE=true 才能執行。");
  }

  const service = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const suffix = createSuffix();
  let member;
  let admin;

  try {
    member = await createTestUser(service, suffix, "member");
    admin = await createTestUser(service, suffix, "admin");
    unwrap(
      await service.from("member_profiles").upsert({
        user_id: member.id,
        full_name: "E2E 測試會員",
        account: `e2e${suffix}`.slice(0, 30),
        email: member.email,
        real_phone: `09${suffix.replace(/[^0-9]/g, "").padEnd(8, "0").slice(0, 8)}`,
      }),
      "建立測試會員資料"
    );
    unwrap(
      await service.from("admin_users").insert({ user_id: admin.id, note: "E2E temporary admin" }),
      "設定測試管理員權限"
    );

    const { token: memberToken } = await signIn(url, anonKey, member.email);
    const { client: adminClient } = await signIn(url, anonKey, admin.email);
    const created = await createOrder({
      url,
      anonKey,
      memberToken,
      suffix,
      unitPrice,
      paymentMethod,
    });

    const total = unitPrice + 20;
    assert(created.total_amount === total, `${label}：訂單總額應為 ${total}`);
    assert(created.shipping_amount === 20, `${label}：手動商品運費應為 20`);
    assert(created.status === expectedInitialStatus, `${label}：初始狀態不正確`);

    let order = await loadOrder(service, created.order_id);
    assert(order.selected_payment_method === paymentMethod, `${label}：付款方式未儲存`);
    await verifyQueuedStatus(service, order.id, expectedInitialStatus);

    if (expectedInitialStatus === "pending_deposit") {
      const deposit = Math.ceil(total * 0.5);
      const afterDeposit = await savePayment(adminClient, order.id, "deposit", deposit);
      assert(afterDeposit.status === "open", `${label}：收到訂金後應進入採買進行中`);
      await verifyQueuedStatus(service, order.id, "open");
      order = await loadOrder(service, order.id);
      assert(order.deposit_paid_amount === deposit, `${label}：訂金金額未正確儲存`);
    }

    const ready = await markReadyForPickup(adminClient, order.id, finalTotal);
    assert(ready.status === "ready_pickup", `${label}：商品買好後應進入待取貨`);
    await verifyQueuedStatus(service, order.id, "ready_pickup");

    order = await loadOrder(service, order.id);
    assert(order.total_amount === finalTotal, `${label}：實際總額未正確儲存`);
    assert(order.quoted_total_amount === total, `${label}：原預估總額未正確保留`);
    assert(order.profit_amount === 20 + finalTotal - total, `${label}：運費收益未依金額調整`);
    const balance = order.total_amount - order.deposit_paid_amount;
    const completed = await savePayment(adminClient, order.id, "balance", balance);
    assert(completed.status === "fulfilled", `${label}：收齊款項後應自動完成`);
    await verifyQueuedStatus(service, order.id, "fulfilled");

    order = await loadOrder(service, order.id);
    assert(order.balance_paid_amount === balance, `${label}：尾款金額未正確儲存`);
    assert(order.fulfilled_at, `${label}：完成訂單未寫入 fulfilled_at`);
    await verifyNotificationWorker(adminClient, service, order.id);
    console.log(`PASS ${label}：${order.id}，總額 ${order.total_amount}`);
  } finally {
    if (member?.id) await service.auth.admin.deleteUser(member.id);
    if (admin?.id) await service.auth.admin.deleteUser(admin.id);
  }
}
