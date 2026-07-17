export function formatCurrency(value) {
  return Number(value || 0).toLocaleString("zh-TW");
}

export function formatPriceRange(minValue, maxValue) {
  const maxPrice = Math.max(0, Number(maxValue) || 0);
  const hasMinimum = minValue !== null && minValue !== undefined && minValue !== "";
  const minPrice = hasMinimum ? Math.max(0, Number(minValue) || 0) : null;

  if (minPrice !== null && minPrice < maxPrice) {
    return `${formatCurrency(minPrice)}–${formatCurrency(maxPrice)}`;
  }
  return formatCurrency(maxPrice);
}

export function formatDateTime(value) {
  if (!value) {
    return "--";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "--";
  }
  return parsed.toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
  });
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
