import { useEffect, useState } from "react";
import { Banknote, Check, Landmark, MapPin, ReceiptText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { memberSupabase } from "../lib/supabase";
import {
  calculateDepositAmount,
  calculateOrderAmounts,
  isTransferRequired,
  normalizeAmount,
} from "../utils/orders";
import { formatCurrency, formatDateTime } from "../utils/format";
import { clearOrderDraft, readPaymentPreview, saveOrderDraft, savePaymentPreview } from "../utils/storage";
import { invokeFunction, setOrderPaymentMethod } from "../services/orderService";

export default function PaymentPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [preview, setPreview] = useState(null);
  const [selectedMethod, setSelectedMethod] = useState("");
  const [message, setMessage] = useState({ text: "", type: "" });
  const [saving, setSaving] = useState(false);

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
    setMessage({ text: "", type: "" });
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
  const transferAmount = needsDeposit ? depositAmount : totalAmount;
  const displayedDueAmount = selectedMethod === "cash" ? totalAmount : selectedMethod === "transfer" ? transferAmount : 0;
  const displayedDueLabel = selectedMethod === "cash"
    ? "取餐應付"
    : selectedMethod === "transfer"
      ? "本次轉帳金額"
      : "請選擇付款方式";
  const shortOrderId = String(preview.order_id || "").slice(0, 8);

  function handleMethodSelect(method) {
    if (method === "cash" && !cashAvailable) {
      return;
    }
    setSelectedMethod(method);
  }

  async function handleSubmit() {
    if (!selectedMethod) {
      setMessage({ text: "請先選擇付款方式。", type: "error" });
      return;
    }

    setSaving(true);
    if (!preview.order_id) {
      setMessage({ text: "正在建立訂單並儲存付款方式...", type: "" });
      const { data: sessionData, error: sessionError } = await memberSupabase.auth.getSession();
      const accessToken = sessionData?.session?.access_token || "";
      if (sessionError || !accessToken) {
        setSaving(false);
        setMessage({ text: "登入狀態已失效，請重新登入後再確認付款方式。", type: "error" });
        return;
      }

      const idempotencyKey = preview.idempotency_key || crypto.randomUUID();
      const { data, error } = await invokeFunction("create-order", {
        delivery_location: preview.delivery_location,
        note: preview.note || "",
        items: Array.isArray(preview.order_items) ? preview.order_items : [],
        device_id: preview.device_id || "payment-page",
        idempotency_key: idempotencyKey,
        payment_method: selectedMethod,
        access_token: accessToken,
      });

      if (error || !data?.order_id) {
        setSaving(false);
        setMessage({
          text:
            error?.code === "CATALOG_PRICE_CHANGED"
              ? "商品價格已更新，請回填單頁重新確認後再送出。"
              : error?.code === "CATALOG_UNAVAILABLE"
                ? "部分商品已下架，請回填單頁調整商品後再送出。"
                : `訂單建立失敗：${error?.message || "請稍後再試。"}`,
          type: "error",
        });
        return;
      }

      savePaymentPreview({
        ...preview,
        order_id: data.order_id,
        idempotency_key: idempotencyKey,
        payment_method: selectedMethod,
        payment_selection_submitted_at: new Date().toISOString(),
      });
      if (user?.id) {
        clearOrderDraft(user.id);
      }
      setSaving(false);
      navigate("/pending-order", { replace: true });
      return;
    }
    setMessage({ text: "正在儲存付款方式...", type: "" });
    const { error } = await setOrderPaymentMethod(preview.order_id, selectedMethod);
    if (error) {
      setSaving(false);
      setMessage({
        text: String(error.message || "").includes("member_set_order_payment_method")
          ? "付款功能尚未完成資料庫更新，請聯絡管理員。"
          : `付款方式儲存失敗：${error.message || "請稍後再試"}`,
        type: "error",
      });
      return;
    }

    const nextPreview = {
      ...preview,
      payment_method: selectedMethod,
      payment_selection_submitted_at: new Date().toISOString(),
    };
    savePaymentPreview(nextPreview);
    setSaving(false);
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
      <section className="payment-checkout">
        <div className="payment-order-strip" aria-label="本次訂單資訊">
          <div className="payment-order-primary">
            <ReceiptText size={17} aria-hidden="true" />
            <span>訂單編號</span>
            <strong title={preview.order_id || ""}>#{shortOrderId || "--"}</strong>
            <time>{formatDateTime(preview.created_at)}</time>
          </div>
          <div>
            <MapPin size={17} aria-hidden="true" />
            <span>交貨地點</span>
            <strong>{preview.delivery_location || "--"}</strong>
          </div>
        </div>

        <div className="payment-checkout-grid">
          <div className="payment-method-column">
            <header className="payment-section-head">
              <span>PAYMENT METHOD</span>
              <h2>選擇付款方式</h2>
              <p>請確認本次付款方式，送出後可在進行中訂單查看處理狀態。</p>
            </header>

            <div className="payment-method-list" role="radiogroup" aria-label="付款方式">
              <label
                className={`payment-method-choice ${selectedMethod === "cash" ? "active" : ""} ${
                  cashAvailable ? "selectable" : "locked"
                }`}
              >
                <input
                  type="radio"
                  name="payment-method"
                  value="cash"
                  checked={selectedMethod === "cash"}
                  disabled={!cashAvailable}
                  onChange={() => handleMethodSelect("cash")}
                />
                <span className="payment-choice-icon"><Banknote size={21} aria-hidden="true" /></span>
                <span className="payment-choice-copy">
                  <span className="payment-choice-title">
                    <strong>現金付款</strong>
                    <small>{cashAvailable ? "取餐支付" : "不適用"}</small>
                  </span>
                  <span className="payment-choice-description">
                    {cashAvailable
                      ? `${formatCurrency(totalAmount)} 元`
                      : "超過 300 元需先付訂金"}
                  </span>
                </span>
                <span className="payment-choice-check" aria-hidden="true">
                  {selectedMethod === "cash" ? <Check size={16} /> : null}
                </span>
              </label>

              <label className={`payment-method-choice selectable ${selectedMethod === "transfer" ? "active" : ""}`}>
                <input
                  type="radio"
                  name="payment-method"
                  value="transfer"
                  checked={selectedMethod === "transfer"}
                  onChange={() => handleMethodSelect("transfer")}
                />
                <span className="payment-choice-icon"><Landmark size={21} aria-hidden="true" /></span>
                <span className="payment-choice-copy">
                  <span className="payment-choice-title">
                    <strong>轉帳付款</strong>
                    <small>事先支付</small>
                  </span>
                  <span className="payment-choice-description">
                    {needsDeposit
                      ? `先付 ${formatCurrency(depositAmount)} · 取餐補 ${formatCurrency(remainingAmount)}`
                      : `轉帳 ${formatCurrency(totalAmount)} 元`}
                  </span>
                </span>
                <span className="payment-choice-check" aria-hidden="true">
                  {selectedMethod === "transfer" ? <Check size={16} /> : null}
                </span>
              </label>
            </div>

            <div className="payment-rule-note">
              <strong>付款規則</strong>
              <p>
                {needsDeposit
                  ? "訂單總金額超過 300 元，需先支付 50% 訂金，剩餘款項於取餐時補齊。"
                  : "訂單總金額未超過 300 元，可選擇現金或轉帳付款。"}
              </p>
            </div>

            <FormMessage text={message.text} type={message.type} />
            <p className="payment-order-warning">
              返回填單後再次送出會建立新訂單，不會修改目前這筆訂單。
            </p>
          </div>

          <aside className="payment-receipt" aria-label="付款摘要">
            <header>
              <span>ORDER SUMMARY</span>
              <h2>付款摘要</h2>
            </header>
            <div className="payment-receipt-rows">
              <div><span>商品總價</span><strong>{formatCurrency(itemsTotal)}</strong></div>
              <div><span>運費</span><strong>{formatCurrency(shippingAmount)}</strong></div>
              <div className="payment-receipt-total"><span>訂單總額</span><strong>{formatCurrency(totalAmount)}</strong></div>
              {needsDeposit ? (
                <div><span>取餐補款</span><strong>{formatCurrency(remainingAmount)}</strong></div>
              ) : null}
            </div>
            <div className="payment-due-block">
              <span>{displayedDueLabel}</span>
              <strong>{formatCurrency(displayedDueAmount)}</strong>
              <small>
                {selectedMethod === "cash"
                  ? "取餐時支付"
                  : selectedMethod === "transfer"
                    ? "確認付款方式後等待管理員核對"
                    : "選擇後將顯示本次付款金額"}
              </small>
            </div>
            <div className="payment-selected-method">
              <span>付款方式</span>
              <strong>{selectedMethod === "cash" ? "現金付款" : selectedMethod === "transfer" ? "轉帳付款" : "尚未選擇"}</strong>
            </div>
            <button type="button" className="primary payment-confirm-btn" disabled={saving || !selectedMethod} onClick={handleSubmit}>
              {saving ? "儲存中..." : "確認付款方式"}
            </button>
            <button type="button" className="ghost payment-return-btn" onClick={handleReturnToOrder}>
              返回填單
            </button>
          </aside>
        </div>

        <div className="payment-mobile-bar">
          <span><small>{displayedDueLabel}</small><strong>{formatCurrency(displayedDueAmount)}</strong></span>
          <button type="button" className="primary" disabled={saving || !selectedMethod} onClick={handleSubmit}>
            {saving ? "儲存中..." : "確認付款方式"}
          </button>
        </div>
      </section>
    </MemberLayout>
  );
}
