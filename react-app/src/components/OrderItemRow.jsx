import { formatCurrency } from "../utils/format";

export default function OrderItemRow({ item, disabled, lastPrice, onChange, onRemove }) {
  const lineTotal = Math.max(0, Number(item.unit_price || 0)) * Math.max(0, Number(item.quantity || 0));
  const hintText = lastPrice ? `上次單價：${formatCurrency(lastPrice)}` : "";

  return (
    <div className="item-row">
      <input
        type="text"
        className="item-name"
        placeholder="商品名稱"
        value={item.product_name}
        required
        disabled={disabled}
        onChange={(event) => onChange({ ...item, product_name: event.target.value })}
      />
      <div className="item-price-wrap">
        <input
          type="number"
          className="item-price"
          min="0"
          step="1"
          value={item.unit_price}
          required
          disabled={disabled}
          onChange={(event) =>
            onChange({
              ...item,
              unit_price: Math.max(0, Math.floor(Number(event.target.value) || 0)),
            })
          }
        />
        <span className="item-hint">{hintText}</span>
      </div>
      <input
        type="number"
        className="item-qty"
        min="1"
        step="1"
        value={item.quantity}
        required
        disabled={disabled}
        onChange={(event) =>
          onChange({
            ...item,
            quantity: Math.max(1, Math.floor(Number(event.target.value) || 1)),
          })
        }
      />
      <div className="item-line-total">{formatCurrency(lineTotal)}</div>
      <button type="button" className="icon" title="刪除" disabled={disabled} onClick={onRemove}>
        ✕
      </button>
    </div>
  );
}
