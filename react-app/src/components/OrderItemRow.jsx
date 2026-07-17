import { Trash2 } from "lucide-react";
import FavoriteToggleButton from "./FavoriteToggleButton";
import { formatCurrency } from "../utils/format";

export default function OrderItemRow({
  item,
  disabled,
  favoriteBusy,
  isFavorite,
  lastPrice,
  onChange,
  onRemove,
  onToggleFavorite,
}) {
  const lineTotal = Math.max(0, Number(item.unit_price || 0)) * Math.max(0, Number(item.quantity || 0));
  const hintText = lastPrice ? `上次單價：${formatCurrency(lastPrice)}` : "";
  const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));

  function updateQuantity(nextQuantity) {
    onChange({
      ...item,
      quantity: Math.max(1, Math.floor(Number(nextQuantity) || 1)),
    });
  }

  return (
    <div className={`item-row${item.catalog_product_id ? " catalog-item-row" : ""}${item.catalog_unavailable ? " unavailable" : ""}`}>
      <label className="item-field item-name-field">
        <span>
          商品名稱
          {item.catalog_product_id ? <small className="catalog-lock-label">熱門商品</small> : null}
        </span>
        <input
          type="text"
          className="item-name"
          placeholder="例：Kirkland 衛生紙、雞胸肉、牛奶"
          value={item.product_name}
          required
          disabled={disabled || Boolean(item.catalog_product_id)}
          onChange={(event) => onChange({ ...item, product_name: event.target.value })}
        />
      </label>
      <div className="item-price-wrap">
        <label className="item-field">
          <span>預估單價</span>
          <input
            type="number"
            className="item-price"
            min="0"
            step="1"
            value={item.unit_price}
            required
            disabled={disabled || Boolean(item.catalog_product_id)}
            onChange={(event) =>
              onChange({
                ...item,
                unit_price: Math.max(0, Math.floor(Number(event.target.value) || 0)),
              })
            }
          />
        </label>
        <span className="item-hint">{hintText}</span>
      </div>
      <label className="item-field">
        <span>數量</span>
        <div className="qty-stepper">
          <button
            type="button"
            className="qty-btn"
            disabled={disabled || quantity <= 1}
            onClick={() => updateQuantity(quantity - 1)}
            aria-label="減少數量"
          >
            -
          </button>
          <input
            type="number"
            className="item-qty"
            min="1"
            step="1"
            value={item.quantity}
            required
            disabled={disabled}
            onChange={(event) => updateQuantity(event.target.value)}
          />
          <button
            type="button"
            className="qty-btn"
            disabled={disabled}
            onClick={() => updateQuantity(quantity + 1)}
            aria-label="增加數量"
          >
            +
          </button>
        </div>
      </label>
      <div className="item-line-total">
        <span>小計</span>
        <strong>{formatCurrency(lineTotal)}</strong>
      </div>
      <div className="item-row-actions">
        <FavoriteToggleButton
          active={isFavorite}
          busy={favoriteBusy}
          disabled={disabled || !item.product_name.trim() || Number(item.unit_price) <= 0}
          label={item.product_name || "目前商品"}
          className="item-favorite-button"
          onClick={onToggleFavorite}
        />
        <button type="button" className="icon" title="刪除商品" aria-label="刪除商品" disabled={disabled} onClick={onRemove}>
          <Trash2 size={17} aria-hidden="true" />
        </button>
      </div>
      {item.catalog_unavailable ? (
        <div className="catalog-item-warning">此熱門商品已下架，請移除後再送單。</div>
      ) : null}
    </div>
  );
}
