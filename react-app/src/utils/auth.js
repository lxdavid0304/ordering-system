export function normalizePhone(value) {
  return String(value || "").trim().replace(/[^\d+]/g, "");
}

export function normalizeAccount(value) {
  return String(value || "").trim().toLowerCase();
}

export function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

export function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}
