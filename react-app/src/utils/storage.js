import { normalizeOrderPayload } from "./orders";

export const REORDER_STORAGE_KEY = "member_reorder_payload";
export const PAYMENT_PREVIEW_STORAGE_KEY = "member_payment_preview_v1";

function readJson(storage, key) {
  try {
    const raw = storage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

function writeJson(storage, key, value) {
  storage.setItem(key, JSON.stringify(value));
}

export function getDraftStorageKey(userId) {
  return userId ? `member_order_form_draft_v1:${userId}` : "";
}

export function readOrderDraft(userId) {
  const key = getDraftStorageKey(userId);
  if (!key) {
    return null;
  }
  return normalizeOrderPayload(readJson(localStorage, key));
}

export function saveOrderDraft(userId, draft) {
  const key = getDraftStorageKey(userId);
  if (!key) {
    return;
  }
  const normalized = normalizeOrderPayload(draft);
  const hasContent = Boolean(
    String(normalized?.delivery_location || "").trim() ||
      String(normalized?.note || "").trim() ||
      normalized?.order_items?.length
  );

  if (!hasContent) {
    localStorage.removeItem(key);
    return;
  }

  writeJson(localStorage, key, normalized);
}

export function clearOrderDraft(userId) {
  const key = getDraftStorageKey(userId);
  if (key) {
    localStorage.removeItem(key);
  }
}

export function savePaymentPreview(payload) {
  writeJson(sessionStorage, PAYMENT_PREVIEW_STORAGE_KEY, payload || {});
}

export function readPaymentPreview() {
  return readJson(sessionStorage, PAYMENT_PREVIEW_STORAGE_KEY);
}

export function saveReorderPayload(payload) {
  writeJson(localStorage, REORDER_STORAGE_KEY, payload || {});
}

export function takeReorderPayload() {
  const value = readJson(localStorage, REORDER_STORAGE_KEY);
  localStorage.removeItem(REORDER_STORAGE_KEY);
  return normalizeOrderPayload(value);
}

export function getDeviceId() {
  const storageKey = "order_device_id";
  const existing = localStorage.getItem(storageKey);
  if (existing) {
    return existing;
  }
  const created =
    typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}`;
  localStorage.setItem(storageKey, created);
  return created;
}
