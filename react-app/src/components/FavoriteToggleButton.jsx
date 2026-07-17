import { Heart } from "lucide-react";

export default function FavoriteToggleButton({
  active,
  busy,
  disabled,
  label,
  className = "",
  onClick,
}) {
  const actionLabel = active ? `移除收藏：${label}` : `加入收藏：${label}`;

  return (
    <button
      type="button"
      className={`favorite-toggle-button${active ? " active" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled || busy}
      aria-pressed={active}
      aria-label={actionLabel}
      title={actionLabel}
      onClick={onClick}
    >
      <Heart size={18} fill={active ? "currentColor" : "none"} aria-hidden="true" />
    </button>
  );
}
