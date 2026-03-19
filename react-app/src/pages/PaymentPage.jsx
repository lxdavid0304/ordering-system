import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import {
  calculateDepositAmount,
  calculateOrderAmounts,
  isTransferRequired,
  normalizeAmount,
} from "../utils/orders";
import { formatCurrency, formatDateTime } from "../utils/format";
import { readPaymentPreview, saveOrderDraft, savePaymentPreview } from "../utils/storage";

export default function PaymentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });

  useEffect(() => {
    const nextPreview = readPaymentPreview();
    if (!nextPreview) {
      setPreview(null);
      setSelectedMethod("");
      setMessage({ text: "找不到剛送出的訂單資料。", type: "error" });
      return;
    }

    const orderAmounts = calculateOrderAmounts(nextPreview.order_items);
    const totalAmount = normalizeAmount(orderAmounts.finalTotalAmount || nextPreview.total_amount);
    const nextMethod = isTransferRequired(totalAmount)
      ? "transfer"
      : nextPreview.payment_method === "cash" || nextPreview.payment_method === "transfer"
        ? nextPreview.payment_method
        : "";

    setPreview({
      ...nextPreview,
      items_total: orderAmounts.itemsTotal,
      shipping_amount: orderAmounts.shippingAmount,
      total_amount: totalAmount,
    });
    setSelectedMethod(nextMethod);
    setMessage({
      text: isTransferRequired(totalAmount)
        ? "此筆訂單最終總金額超過門檻，需先選擇轉帳付款。"
        : "請選擇付款方式後繼續。",
      type: "",
    });
  }, []);

  if (!preview) {
    return (
      <MemberLayout title="付款方式" active="order" pageClassName="payment-page">
        <section className="card payment-card">
          <FormMessage text={message.text} type={message.type} />
        </section>
      </MemberLayout>
    );
  }

  const calculatedAmounts = calculateOrderAmounts(preview.order_items);
  const itemsTotal = normalizeAmount(preview.items_total || calculatedAmounts.itemsTotal);
  const shippingAmount = normalizeAmount(preview.shipping_amount || calculatedAmounts.shippingAmount);
  const totalAmount = normalizeAmount(preview.total_amount || calculatedAmounts.finalTotalAmount);
  const needsDeposit = isTransferRequired(totalAmount);
  const depositAmount = needsDeposit ? calculateDepositAmount(totalAmount) : 0;
  const remainingAmount = Math.max(0, totalAmount - depositAmount);
  const cashAvailable = !needsDeposit;

  function handleMethodSelect(method) {
    if (method === "cash" && !cashAvailable) {
      return;
    }
    setSelectedMethod(method);
  }

  function handleSubmit() {
    if (!selectedMethod) {
      setMessage({ text: "請先選擇付款方式。", type: "error" });
      return;
    }

    const nextPreview = {
      ...preview,
      payment_method: selectedMethod,
      payment_selection_submitted_at: new Date().toISOString(),
    };
    savePaymentPreview(nextPreview);
    navigate("/pending-order", { replace: true });
  }

  function handleReturnToOrder() {
    const draftPayload = {
      delivery_location: preview?.delivery_location || "",
      note: preview?.note || "",
      order_items: Array.isArray(preview?.order_items) ? preview.order_items : [],
    };

    if (user?.id) {
      saveOrderDraft(user.id, draftPayload);
    }
    navigate("/order");
  }

  return (
    <MemberLayout
      title="付款方式"
      subtitle="送單完成後，請確認本次訂單的付款方式與付款規則。"
      active="order"
      pageClassName="payment-page"
    >
      <section className="card payment-card">
        <div className="payment-summary">
          <div className="payment-summary-item">
            <span>訂單編號</span>
            <strong>{preview.order_id || "--"}</strong>
          </div>
          <div className="payment-summary-item">
            <span>送出時間</span>
            <strong>{formatDateTime(preview.created_at)}</strong>
          </div>
          <div className="payment-summary-item">
            <span>運送地點</span>
            <strong>{preview.delivery_location || "--"}</strong>
          </div>
        </div>

        <div className="payment-rule-banner">
          {needsDeposit
            ? "最終總金額超過 300 元，需先支付 50% 訂金，餘額於取餐時補齊。"
            : "最終總金額未超過 300 元，可選擇現金付款或轉帳付款。"}
        </div>

        <div className="payment-amount-panel">
          <div className="payment-amount-row">
            <span>商品總價</span>
            <strong>{formatCurrency(itemsTotal)}</strong>
          </div>
          <div className="payment-amount-row">
            <span>運費</span>
            <strong>{formatCurrency(shippingAmount)}</strong>
          </div>
          <div className="payment-amount-row">
            <span>最終總金額</span>
            <strong>{formatCurrency(totalAmount)}</strong>
          </div>
          <div className="payment-amount-row">
            <span>訂金{needsDeposit ? "（50%）" : ""}</span>
            <strong>{needsDeposit ? formatCurrency(depositAmount) : "無需訂金"}</strong>
          </div>
          {needsDeposit ? (
            <div className="payment-amount-row">
              <span>剩餘金額</span>
              <strong>{formatCurrency(remainingAmount)}</strong>
            </div>
          ) : null}
        </div>

        <div className="payment-method-grid" role="radiogroup" aria-label="付款方式">
          <article
            className={`payment-method-card ${selectedMethod === "cash" ? "active" : "inactive"} ${
              cashAvailable ? "selectable" : "locked"
            }`}
            role="radio"
            aria-checked={selectedMethod === "cash"}
            aria-disabled={!cashAvailable}
            tabIndex={cashAvailable ? 0 : -1}
            onClick={() => handleMethodSelect("cash")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleMethodSelect("cash");
              }
            }}
          >
            <div className="payment-method-head">
              <h2>現金付款</h2>
              <span className={`payment-tag ${selectedMethod === "cash" ? "active" : "muted"}`}>
                {cashAvailable ? "可選" : "不可選"}
              </span>
            </div>
            <p>
              {cashAvailable
                ? "最終總金額 300 元以下可於取餐時以現金付款。"
                : "此筆訂單最終總金額超過 300 元，不能選擇現金付款。"}
            </p>
          </article>

          <article
            className={`payment-method-card ${selectedMethod === "transfer" ? "active" : "inactive"} selectable`}
            role="radio"
            aria-checked={selectedMethod === "transfer"}
            tabIndex={0}
            onClick={() => handleMethodSelect("transfer")}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleMethodSelect("transfer");
              }
            }}
          >
            <div className="payment-method-head">
              <h2>轉帳付款</h2>
              <span className={`payment-tag ${selectedMethod === "transfer" ? "active" : "muted"}`}>
                可選
              </span>
            </div>
            <p>
              {needsDeposit
                ? `本次需先支付訂金 ${formatCurrency(depositAmount)}，剩餘 ${formatCurrency(
                    remainingAmount
                  )} 於取餐時補齊。`
                : "若你希望先轉帳，也可以在此選擇轉帳付款。"}
            </p>
          </article>
        </div>

        <FormMessage text={message.text} type={message.type} />
        <p className="muted">若返回訂單頁補商品，再次送出後會新增一筆新訂單，不會直接修改目前這筆。</p>

        <div className="actions payment-actions">
          <button type="button" className="ghost" onClick={handleReturnToOrder}>
            返回訂單頁面
          </button>
          <button type="button" className="primary" onClick={handleSubmit}>
            確認並查看訂單
          </button>
        </div>
      </section>
    </MemberLayout>
  );
}
