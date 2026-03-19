const ACCOUNT_EMAIL_MAP_KEY = "member_account_email_map_v1";

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

export function buildAuthEmailFromAccount(account) {
  return `${normalizeAccount(account)}@member.local`;
}

function loadAccountEmailMap() {
  try {
    const raw = localStorage.getItem(ACCOUNT_EMAIL_MAP_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_error) {
    return {};
  }
}

function saveAccountEmailMap(map) {
  localStorage.setItem(ACCOUNT_EMAIL_MAP_KEY, JSON.stringify(map || {}));
}

export function rememberAccountEmail(account, email) {
  const normalizedAccount = normalizeAccount(account);
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedAccount || !normalizedEmail) {
    return;
  }
  const map = loadAccountEmailMap();
  map[normalizedAccount] = normalizedEmail;
  saveAccountEmailMap(map);
}

export function getRememberedEmail(account) {
  const map = loadAccountEmailMap();
  return String(map[normalizeAccount(account)] || "");
}

export function buildLoginCandidates(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return [];
  }
  if (looksLikeEmail(raw)) {
    return [normalizeEmail(raw)];
  }

  const account = normalizeAccount(raw);
  const remembered = getRememberedEmail(account);
  const candidates = [];

  if (remembered) {
    candidates.push(remembered);
  }

  candidates.push(buildAuthEmailFromAccount(account));
  return Array.from(new Set(candidates));
}
