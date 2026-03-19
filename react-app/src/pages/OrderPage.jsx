import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import OrderItemRow from "../components/OrderItemRow";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { configOk } from "../lib/config";
import { memberSupabase } from "../lib/supabase";
import { loadMemberOrdersForHints, invokeFunction } from "../services/orderService";
import { loadMemberProfile } from "../services/profileService";
import { loadOrderingSchedule } from "../services/scheduleService";
import { formatCurrency } from "../utils/format";
import {
  buildLastPriceMap,
  calculateOrderAmounts,
  createEmptyOrderItem,
  createUuid,
  normalizeOrderItem,
  normalizeProductName,
} from "../utils/orders";
import {
  clearOrderDraft,
  getDeviceId,
  readOrderDraft,
  saveOrderDraft,
  savePaymentPreview,
  takeReorderPayload,
} from "../utils/storage";
import { formatSchedule, isWithinSchedule } from "../utils/schedule";

const deliveryLocations = ["明德樓", "據德樓", "蘊德樓", "機車停車場"];

export default function OrderPage() {
  const navigate = useNavigate();
  const { user, session, signOut } = useAuth();
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [note, setNote] = useState("");
  const [items, setItems] = useState([createEmptyOrderItem()]);
  const [schedule, setSchedule] = useState(null);
  const [message, setMessage] = useState({ text: "", type: "" });
  const [lastPriceMap, setLastPriceMap] = useState({});
  const [profile, setProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [formLocked, setFormLocked] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const draftHydratedForUserId = useRef("");
  const idempotencyKeyRef = useRef("");
  const logoutTimerRef = useRef(null);

  const orderAmounts = calculateOrderAmounts(items);
  const totalAmount = orderAmounts.itemsTotal;
  const isOpen = isWithinSchedule(schedule);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!user) {
        return;
      }

      setProfileLoading(true);
      const result = await loadMemberProfile(user);
      if (!active) {
        return;
      }

      if (result.errorType === "SESSION_EXPIRED") {
        setProfile(null);
        setLastPriceMap({});
        setProfileLoading(false);
        setFormLocked(true);
        setMessage({ text: "登入已過期，系統將自動登出並返回登入頁。", type: "error" });
        if (!logoutTimerRef.current) {
          logoutTimerRef.current = window.setTimeout(() => {
            signOut();
          }, 3000);
        }
        return;
      }

      if (result.error) {
        setProfile(null);
        setLastPriceMap({});
        setProfileLoading(false);
        setFormLocked(true);
        setMessage({ text: `會員資料載入失敗：${result.error.message}`, type: "error" });
        return;
      }

      const loadedProfile = result.data;

      setProfile(loadedProfile);
      setProfileLoading(false);
      setFormLocked(!loadedProfile?.persisted);

      if (!loadedProfile?.persisted) {
        setMessage({ text: "請先到會員資料頁確認並儲存會員資料後才能送單。", type: "error" });
        return;
      }

      const { data } = await loadMemberOrdersForHints(user.id);
      if (!active) {
        return;
      }
      setLastPriceMap(buildLastPriceMap(data || []));
      setMessage({ text: "", type: "" });
    }

    run();
    return () => {
      active = false;
      if (logoutTimerRef.current) {
        clearTimeout(logoutTimerRef.current);
        logoutTimerRef.current = null;
      }
    };
  }, [signOut, user]);

  useEffect(() => {
    let active = true;

    async function run() {
      const { data } = await loadOrderingSchedule();
      if (active) {
        setSchedule(data || null);
      }
    }

    run();
    const timer = setInterval(run, 60000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!user?.id || !profile || draftHydratedForUserId.current === user.id) {
      return;
    }

    const draft = readOrderDraft(user.id);
    if (draft) {
      setDeliveryLocation(draft.delivery_location || "");
      setNote(draft.note || "");
      setItems(
        draft.order_items.length
          ? draft.order_items.map((item) => ({ id: createUuid(), ...item }))
          : [createEmptyOrderItem()]
      );
    }

    const reorderPayload = takeReorderPayload();
    if (reorderPayload) {
      setDeliveryLocation((current) => current || reorderPayload.delivery_location || "");
      setNote((current) => current || reorderPayload.note || "");
      setItems((current) => {
        const merged = [
          ...current.filter((item) => normalizeOrderItem(item)),
          ...reorderPayload.order_items.map((item) => ({
            id: createUuid(),
            ...item,
          })),
        ];
        return merged.length ? merged : [createEmptyOrderItem()];
      });
      setMessage({ text: "已加入重新下單商品，請確認後送出。", type: "success" });
    }

    draftHydratedForUserId.current = user.id;
  }, [profile, user]);

  useEffect(() => {
    if (!user?.id || profileLoading) {
      return;
    }

    saveOrderDraft(user.id, {
      delivery_location: deliveryLocation,
      note,
      order_items: items.map((item) => normalizeOrderItem(item)).filter(Boolean),
    });
  }, [deliveryLocation, items, note, profileLoading, user]);

  function getIdempotencyKey() {
    if (!idempotencyKeyRef.current) {
      idempotencyKeyRef.current = createUuid();
    }
    return idempotencyKeyRef.current;
  }

  function resetIdempotencyKey() {
    idempotencyKeyRef.current = "";
  }

  function handleItemChange(nextItem) {
    const normalizedName = normalizeProductName(nextItem.product_name);
    const hintedPrice = lastPriceMap[normalizedName];
    const nextValue =
      hintedPrice && (!Number(nextItem.unit_price) || Number(nextItem.unit_price) <= 0)
        ? { ...nextItem, unit_price: hintedPrice }
        : nextItem;

    setItems((current) =>
      current.map((item) => (item.id === nextItem.id ? nextValue : item))
    );

    if (!isSubmitting) {
      resetIdempotencyKey();
    }
  }

  function addItem() {
    setItems((current) => [...current, createEmptyOrderItem()]);
    if (!isSubmitting) {
      resetIdempotencyKey();
    }
  }

  function removeItem(itemId) {
    setItems((current) => {
      const nextItems = current.filter((item) => item.id !== itemId);
      return nextItems.length ? nextItems : [createEmptyOrderItem()];
    });
    if (!isSubmitting) {
      resetIdempotencyKey();
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!configOk) {
      setMessage({ text: "請先設定 react-app/public/config.js", type: "error" });
      return;
    }

    if (!profile?.persisted) {
      setMessage({ text: "請先登入並完成會員資料。", type: "error" });
      setFormLocked(true);
      return;
    }

    if (!isWithinSchedule(schedule)) {
      setMessage({ text: "目前不在開放時段。", type: "error" });
      return;
    }

    const normalizedItems = items.map((item) => normalizeOrderItem(item)).filter(Boolean);
    const previewAmounts = calculateOrderAmounts(normalizedItems);
    if (!deliveryLocation) {
      setMessage({ text: "請先選擇運送地址。", type: "error" });
      return;
    }
    if (!normalizedItems.length) {
      setMessage({ text: "請至少新增一項商品。", type: "error" });
      return;
    }

    setIsSubmitting(true);
    setMessage({ text: "送出中...", type: "" });

    const { data: sessionData, error: sessionError } = await memberSupabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token || session?.access_token || "";
    if (sessionError || !accessToken) {
      setMessage({ text: "登入狀態失效，請重新登入。", type: "error" });
      setIsSubmitting(false);
      return;
    }

    const { data, error } = await invokeFunction("create-order", {
      delivery_location: deliveryLocation,
      note: note.trim(),
      items: normalizedItems,
      device_id: getDeviceId(),
      idempotency_key: getIdempotencyKey(),
      access_token: accessToken,
    });

    if (error) {
      setMessage({
        text: `送出失敗：${
          error.status === 401
            ? "登入狀態失效，請重新登入。"
            : error.status === 403 && !profile?.persisted
            ? "請先到會員資料頁按一次儲存，建立會員資料後再送單。"
            : error.message
        }`,
        type: "error",
      });
      setIsSubmitting(false);
      return;
    }

    resetIdempotencyKey();
    clearOrderDraft(user.id);
    savePaymentPreview({
      order_id: data?.order_id || "",
      items_total: previewAmounts.itemsTotal,
      shipping_amount: previewAmounts.shippingAmount,
      total_amount: previewAmounts.finalTotalAmount,
      delivery_location: deliveryLocation,
      created_at: new Date().toISOString(),
      note: note.trim(),
      order_items: normalizedItems,
      status: previewAmounts.needsDeposit ? "pending_deposit" : "open",
    });
    setMessage({ text: "送出成功，正在前往付款頁...", type: "success" });
    setIsSubmitting(false);
    navigate("/payment", { replace: true });
  }

  return (
    <MemberLayout title="訂購單" active="order" pageClassName="order-page">
      <div className="order-workspace">
        <section className="card workspace-form" id="orderFormCard">
          <form id="orderForm" onSubmit={handleSubmit}>
            <FormMessage
              text={formLocked && !profileLoading ? "請先完成會員資料。" : profileLoading ? "正在驗證會員資料..." : ""}
              type="error"
              id="orderLockMessage"
            />

            <div className="status-card compact form-schedule-card" id="scheduleCard">
              <div className="status-left">
                <span className="status-label">目前狀態</span>
                <StatusBadge kind={isOpen ? "open" : "closed"}>
                  {schedule ? (isOpen ? "Open" : "Closed") : "載入中"}
                </StatusBadge>
              </div>
              <div className="status-right">
                <div className="status-title">開放時段</div>
                <div className="status-detail">{schedule ? formatSchedule(schedule) : "載入中..."}</div>
                <div className="status-note">關閉時間視為該小時 59 分。</div>
              </div>
            </div>

            <div className="grid">
              <label className="field">
                <span>運送地址</span>
                <select
                  value={deliveryLocation}
                  required
                  disabled={formLocked || profileLoading || isSubmitting}
                  onChange={(event) => {
                    setDeliveryLocation(event.target.value);
                    if (!isSubmitting) {
                      resetIdempotencyKey();
                    }
                  }}
                >
                  <option value="">請選擇</option>
                  {deliveryLocations.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="section-title">
              <h2>商品清單</h2>
              <button
                type="button"
                className="ghost"
                disabled={formLocked || profileLoading || isSubmitting}
                onClick={addItem}
              >
                + 新增商品
              </button>
            </div>
            <div className="item-header">
              <span>商品名稱</span>
              <span>單價</span>
              <span>數量</span>
              <span>小計</span>
              <span></span>
            </div>
            <div id="itemList" className="item-list">
              {items.map((item) => (
                <OrderItemRow
                  key={item.id}
                  item={item}
                  disabled={formLocked || profileLoading || isSubmitting}
                  lastPrice={lastPriceMap[normalizeProductName(item.product_name)]}
                  onChange={handleItemChange}
                  onRemove={() => removeItem(item.id)}
                />
              ))}
            </div>

            <label className="field full">
              <span>備註</span>
              <textarea
                rows="3"
                placeholder="例如：無辣、請放門口"
                value={note}
                disabled={formLocked || profileLoading || isSubmitting}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (!isSubmitting) {
                    resetIdempotencyKey();
                  }
                }}
              />
            </label>

            <div className="total-row">
              <div>
                <span className="total-label">總金額</span>
                <span className="total-amount">{formatCurrency(totalAmount)}</span>
              </div>
              <button
                type="submit"
                className="primary"
                disabled={formLocked || profileLoading || isSubmitting}
              >
                送出訂單
              </button>
            </div>
            <FormMessage text={message.text} type={message.type} />
          </form>
        </section>
      </div>
    </MemberLayout>
  );
}
