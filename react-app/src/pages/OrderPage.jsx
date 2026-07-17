import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import FormMessage from "../components/FormMessage";
import FavoriteToggleButton from "../components/FavoriteToggleButton";
import MemberLayout from "../components/MemberLayout";
import MemberAuthPanel from "../components/MemberAuthPanel";
import OrderItemRow from "../components/OrderItemRow";
import StatusBadge from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";
import { configOk } from "../lib/config";
import { memberSupabase } from "../lib/supabase";
import { deleteFavoriteItem, loadFavoriteItems, saveFavoriteItem } from "../services/favoriteService";
import { loadMemberOrdersForHints, invokeFunction } from "../services/orderService";
import { loadMemberProfile } from "../services/profileService";
import { loadActivePopularProducts } from "../services/popularProductService";
import { loadOrderingSchedule } from "../services/scheduleService";
import { formatCurrency, formatPriceRange } from "../utils/format";
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
  const { loading: authLoading, user, session, signOut } = useAuth();
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
  const [popularProducts, setPopularProducts] = useState([]);
  const [popularProductsLoading, setPopularProductsLoading] = useState(true);
  const [popularProductsError, setPopularProductsError] = useState("");
  const [popularSearch, setPopularSearch] = useState("");
  const [popularCategory, setPopularCategory] = useState("全部");
  const [favoriteItems, setFavoriteItems] = useState([]);
  const [favoriteBusyKeys, setFavoriteBusyKeys] = useState([]);
  const draftHydratedForUserId = useRef("");
  const idempotencyKeyRef = useRef("");
  const logoutTimerRef = useRef(null);

  const orderAmounts = calculateOrderAmounts(items);
  const isOpen = isWithinSchedule(schedule);
  const filledItemCount = items.filter((item) => item.product_name.trim()).length;
  const controlsDisabled = authLoading || !user || formLocked || profileLoading || isSubmitting;
  const popularCategories = useMemo(
    () => ["全部", ...Array.from(new Set(popularProducts.map((product) => product.category).filter(Boolean)))],
    [popularProducts]
  );
  const filteredPopularProducts = useMemo(() => {
    const query = popularSearch.trim().toLowerCase();
    return popularProducts.filter((product) => {
      const matchesCategory = popularCategory === "全部" || product.category === popularCategory;
      const matchesQuery =
        !query ||
        product.display_name.toLowerCase().includes(query) ||
        product.category.toLowerCase().includes(query);
      return matchesCategory && matchesQuery;
    });
  }, [popularCategory, popularProducts, popularSearch]);
  const favoriteItemMap = useMemo(() => {
    const map = {};
    favoriteItems.forEach((favorite) => {
      map[normalizeProductName(favorite.product_name)] = favorite;
    });
    return map;
  }, [favoriteItems]);
  const catalogQuantities = useMemo(() => {
    const quantities = {};
    items.forEach((item) => {
      if (item.catalog_product_id) {
        quantities[item.catalog_product_id] = (quantities[item.catalog_product_id] || 0) + Math.max(1, Number(item.quantity) || 1);
      }
    });
    return quantities;
  }, [items]);

  useEffect(() => {
    let active = true;

    async function run() {
      if (!user) {
        setProfile(null);
        setLastPriceMap({});
        setProfileLoading(false);
        setFormLocked(true);
        setDeliveryLocation("");
        setNote("");
        setItems([createEmptyOrderItem()]);
        setMessage({ text: "", type: "" });
        setIsSubmitting(false);
        draftHydratedForUserId.current = "";
        resetIdempotencyKey();
        return;
      }

      setProfileLoading(true);
      setFormLocked(true);
      const result = await loadMemberProfile(user);
      if (!active) {
        return;
      }

      if (result.errorType === "SESSION_EXPIRED") {
        setProfile(null);
        setLastPriceMap({});
        setProfileLoading(false);
        setFormLocked(true);
        setMessage({ text: "登入已過期，系統將自動登出並回到訪客模式。", type: "error" });
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
      if (!user?.id) {
        setFavoriteItems([]);
        setFavoriteBusyKeys([]);
        return;
      }

      const { data, error } = await loadFavoriteItems(user.id);
      if (!active) {
        return;
      }
      if (error) {
        setFavoriteItems([]);
        setMessage({ text: error.message || "常用商品載入失敗。", type: "error" });
        return;
      }
      setFavoriteItems(data || []);
    }

    run();
    return () => {
      active = false;
    };
  }, [user?.id]);

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
    let active = true;
    async function run() {
      setPopularProductsLoading(true);
      const { data, error } = await loadActivePopularProducts();
      if (!active) {
        return;
      }
      setPopularProducts(error ? [] : data || []);
      setPopularProductsError(error ? error.message || "熱門商品載入失敗。" : "");
      setPopularProductsLoading(false);
    }
    run();
    return () => {
      active = false;
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

  async function handleToggleFavorite(favorite) {
    const productName = String(favorite?.product_name || "").trim();
    const unitPrice = Math.max(0, Math.floor(Number(favorite?.unit_price) || 0));
    const key = normalizeProductName(productName);

    if (!user?.id) {
      setMessage({ text: "登入後即可收藏常用商品。", type: "error" });
      document.getElementById("memberAuthPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (!productName || unitPrice <= 0) {
      setMessage({ text: "請先填寫商品名稱與有效價格後再收藏。", type: "error" });
      return;
    }
    if (!key || favoriteBusyKeys.includes(key)) {
      return;
    }

    setFavoriteBusyKeys((current) => [...current, key]);
    const existing = favoriteItemMap[key];
    const result = existing
      ? await deleteFavoriteItem(existing.id)
      : await saveFavoriteItem(user.id, {
          product_name: productName,
          unit_price: unitPrice,
          note: favorite?.note || "",
        });

    if (result.error) {
      setMessage({ text: result.error.message || "收藏更新失敗。", type: "error" });
    } else if (existing) {
      setFavoriteItems((current) => current.filter((item) => item.id !== existing.id));
      setMessage({ text: `已從常用商品移除「${productName}」。`, type: "success" });
    } else if (result.data) {
      setFavoriteItems((current) => [
        result.data,
        ...current.filter((item) => normalizeProductName(item.product_name) !== key),
      ]);
      setMessage({ text: `已將「${productName}」加入常用商品。`, type: "success" });
    }

    setFavoriteBusyKeys((current) => current.filter((busyKey) => busyKey !== key));
  }

  function canChangePopularProduct() {
    if (!user) {
      setMessage({ text: "登入後即可把熱門商品加入訂單。", type: "error" });
      document.getElementById("memberAuthPanel")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return false;
    }
    if (profileLoading) {
      setMessage({ text: "會員資料載入中，請稍候。", type: "error" });
      return false;
    }
    if (!profile?.persisted) {
      setMessage({ text: "請先完成會員資料，再加入熱門商品。", type: "error" });
      return false;
    }
    if (isSubmitting) {
      return false;
    }

    return true;
  }

  function handleSetPopularProductQuantity(product, nextQuantity) {
    if (!canChangePopularProduct()) {
      return;
    }

    const quantity = Math.max(0, Math.floor(Number(nextQuantity) || 0));

    setItems((current) => {
      const existingIndex = current.findIndex(
        (item) => item.catalog_product_id === product.id
      );

      if (quantity === 0) {
        const nextItems = current.filter((item) => item.catalog_product_id !== product.id);
        return nextItems.length ? nextItems : [createEmptyOrderItem()];
      }

      if (existingIndex >= 0) {
        return current.map((item, index) =>
          index === existingIndex
            ? { ...item, quantity, catalog_unavailable: false }
            : item
        );
      }

      const catalogItem = {
        id: createUuid(),
        product_name: product.display_name,
        unit_price: Number(product.unit_price || 0),
        quantity,
        catalog_product_id: product.id,
        catalog_unavailable: false,
      };
      const hasOnlyEmptyRow =
        current.length === 1 && !normalizeOrderItem(current[0]);
      return hasOnlyEmptyRow ? [catalogItem] : [...current, catalogItem];
    });
    resetIdempotencyKey();
    setMessage({
      text: quantity > 0
        ? `「${product.display_name}」數量已更新為 ${quantity}。`
        : `已從採買清單移除「${product.display_name}」。`,
      type: "success",
    });
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

    if (items.some((item) => item.catalog_unavailable)) {
      setMessage({ text: "請先移除已下架的熱門商品。", type: "error" });
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
      if (error.code === "CATALOG_PRICE_CHANGED" && error.items.length) {
        const updates = new Map(error.items.map((item) => [item.id, item]));
        setItems((current) =>
          current.map((item) => {
            const update = updates.get(item.catalog_product_id);
            return update
              ? {
                  ...item,
                  product_name: update.display_name || update.product_name,
                  unit_price: Number(update.unit_price || 0),
                  catalog_unavailable: false,
                }
              : item;
          })
        );
        resetIdempotencyKey();
        setMessage({ text: "熱門商品價格已更新，請重新確認總額後再次送單。", type: "error" });
        setIsSubmitting(false);
        return;
      }

      if (error.code === "CATALOG_UNAVAILABLE") {
        const unavailableIds = new Set(error.productIds);
        setItems((current) =>
          current.map((item) =>
            unavailableIds.has(item.catalog_product_id)
              ? { ...item, catalog_unavailable: true }
              : item
          )
        );
        resetIdempotencyKey();
        setMessage({ text: "部分熱門商品已下架，請移除標示品項後再送單。", type: "error" });
        setIsSubmitting(false);
        return;
      }

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
    const acceptedItems = Array.isArray(data?.order_items) ? data.order_items : normalizedItems;
    const serverItemsTotal = Number(data?.items_total);
    const serverShippingAmount = Number(data?.shipping_amount);
    const serverTotalAmount = Number(data?.total_amount);
    savePaymentPreview({
      order_id: data?.order_id || "",
      items_total: Number.isFinite(serverItemsTotal) ? serverItemsTotal : previewAmounts.itemsTotal,
      shipping_amount: Number.isFinite(serverShippingAmount)
        ? serverShippingAmount
        : previewAmounts.shippingAmount,
      total_amount: Number.isFinite(serverTotalAmount)
        ? serverTotalAmount
        : previewAmounts.finalTotalAmount,
      delivery_location: deliveryLocation,
      created_at: new Date().toISOString(),
      note: note.trim(),
      order_items: acceptedItems,
      status: data?.status || (previewAmounts.needsDeposit ? "pending_deposit" : "open"),
    });
    setMessage({ text: "送出成功，正在前往付款頁...", type: "success" });
    setIsSubmitting(false);
    navigate("/payment", { replace: true });
  }

  return (
    <MemberLayout
      title="Costco 代購填單"
      subtitle="把想買的商品、預估單價與數量一次整理好，我們會依開放時段協助採買。"
      active="order"
      pageClassName={user ? "order-page" : "order-page guest-order-page"}
    >
      <section className="order-shopping-hero" aria-label="代購流程">
        <div className="shopping-hero-copy">
          <span className="eyebrow">Costco Group Buy</span>
          <h2>像逛賣場一樣填單，送出前先看清楚總額。</h2>
          <p>適合大量採買、宿舍交貨與常用商品回購。填完商品後，右側摘要會即時更新預估小計、運費與總金額。</p>
        </div>
        <div className="shopping-steps" aria-label="訂購步驟">
          <div className="shopping-step">
            <span>1</span>
            <strong>選交貨點</strong>
            <small>先確認取貨位置</small>
          </div>
          <div className="shopping-step">
            <span>2</span>
            <strong>加商品</strong>
            <small>填名稱、單價、數量</small>
          </div>
          <div className="shopping-step">
            <span>3</span>
            <strong>送出付款</strong>
            <small>系統保留草稿</small>
          </div>
        </div>
      </section>
      <section className="popular-catalog" aria-labelledby="popularCatalogTitle">
        <div className="popular-catalog-head">
          <div>
            <span className="eyebrow">Popular Picks</span>
            <h2 id="popularCatalogTitle">熱門商品</h2>
            <p>直接加入採買清單，名稱與代購預估價由管理員維護。</p>
          </div>
          <label className="popular-search-field">
            <span>搜尋商品</span>
            <input
              type="search"
              value={popularSearch}
              placeholder="搜尋名稱、規格或分類"
              onChange={(event) => setPopularSearch(event.target.value)}
            />
          </label>
        </div>

        {popularCategories.length > 1 ? (
          <div className="popular-category-tabs" role="group" aria-label="商品分類">
            {popularCategories.map((category) => (
              <button
                key={category}
                type="button"
                className={popularCategory === category ? "active" : ""}
                aria-pressed={popularCategory === category}
                onClick={() => setPopularCategory(category)}
              >
                {category}
              </button>
            ))}
          </div>
        ) : null}

        {popularProductsLoading ? (
          <div className="popular-catalog-state">熱門商品載入中...</div>
        ) : popularProductsError ? (
          <div className="popular-catalog-state error">{popularProductsError}</div>
        ) : !popularProducts.length ? (
          <div className="popular-catalog-state">
            <strong>熱門商品正在整理中</strong>
            <span>目前仍可在下方手動輸入想購買的商品。</span>
          </div>
        ) : !filteredPopularProducts.length ? (
          <div className="popular-catalog-state">
            <strong>找不到符合條件的商品</strong>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                setPopularSearch("");
                setPopularCategory("全部");
              }}
            >
              清除搜尋
            </button>
          </div>
        ) : (
          <div
            className="popular-product-grid"
            role="region"
            aria-label="熱門商品，可左右滑動瀏覽"
            tabIndex="0"
          >
            {filteredPopularProducts.map((product) => {
              const selectedQuantity = catalogQuantities[product.id] || 0;
              const favoriteKey = normalizeProductName(product.display_name);
              return (
                <article key={product.id} className="popular-product-card">
                  <div className="popular-product-image">
                    <img
                      src={product.image_url}
                      alt={product.display_name}
                      loading="lazy"
                      decoding="async"
                    />
                    <FavoriteToggleButton
                      active={Boolean(favoriteItemMap[favoriteKey])}
                      busy={favoriteBusyKeys.includes(favoriteKey)}
                      disabled={isSubmitting}
                      label={product.display_name}
                      className="popular-favorite-button"
                      onClick={() =>
                        handleToggleFavorite({
                          product_name: product.display_name,
                          unit_price: product.unit_price,
                        })
                      }
                    />
                    <span>{product.category}</span>
                  </div>
                  <div className="popular-product-body">
                    <div>
                      <h3>{product.product_name}</h3>
                      {product.specification ? <p>{product.specification}</p> : null}
                    </div>
                    <div className="popular-product-price">
                      <span>
                        {product.unit_price_min !== null &&
                        product.unit_price_min !== undefined &&
                        Number(product.unit_price_min) < Number(product.unit_price)
                          ? "代購價範圍"
                          : "代購價"}
                      </span>
                      <strong>{formatPriceRange(product.unit_price_min, product.unit_price)}</strong>
                    </div>
                    <div className="popular-quantity-control" aria-label={`${product.product_name}數量`}>
                      <button
                        type="button"
                        disabled={popularProductsLoading || isSubmitting || selectedQuantity <= 0}
                        onClick={() => handleSetPopularProductQuantity(product, selectedQuantity - 1)}
                        aria-label={`減少${product.product_name}數量`}
                      >
                        −
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={selectedQuantity}
                        disabled={popularProductsLoading || isSubmitting}
                        onChange={(event) => handleSetPopularProductQuantity(product, event.target.value)}
                        aria-label={`${product.product_name}數量，輸入 0 可移除`}
                      />
                      <button
                        type="button"
                        disabled={popularProductsLoading || isSubmitting}
                        onClick={() => handleSetPopularProductQuantity(product, selectedQuantity + 1)}
                        aria-label={`增加${product.product_name}數量`}
                      >
                        +
                      </button>
                    </div>
                    {product.costco_url ? (
                      <a
                        href={product.costco_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="popular-costco-link"
                      >
                        前往 Costco 官網查看商品資訊
                      </a>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
      <div className="order-workspace">
        <section className="card workspace-form" id="orderFormCard">
          <form id="orderForm" onSubmit={handleSubmit}>
            <div className="order-form-head">
              <div>
                <span className="eyebrow">Shopping List</span>
                <h2>本次採買清單</h2>
              </div>
              <div className="order-form-count">
                <strong>{filledItemCount}</strong>
                <span>項商品</span>
              </div>
            </div>
            {authLoading ? (
              <div className="order-lock-banner">正在確認登入狀態...</div>
            ) : !user ? (
              <div className="order-lock-banner guest">
                <strong>登入後即可開始填單</strong>
                <span>你可以先瀏覽流程與費用欄位，登入後表單會在這一頁直接開放。</span>
                <a href="#memberAuthPanel">前往登入 / 註冊</a>
              </div>
            ) : profileLoading ? (
              <div className="order-lock-banner">正在驗證會員資料...</div>
            ) : formLocked ? (
              <div className="order-lock-banner warning">
                <strong>請先完成會員資料</strong>
                <span>儲存姓名、帳號、電話與 Email 後即可送出訂單。</span>
                <Link to="/profile">前往會員資料</Link>
              </div>
            ) : null}

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

            <div className="grid delivery-location-grid">
              <label className="field delivery-location-field">
                <span>運送地址</span>
                <select
                  value={deliveryLocation}
                  required
                  disabled={controlsDisabled}
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
                disabled={controlsDisabled}
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
                  disabled={controlsDisabled}
                  favoriteBusy={favoriteBusyKeys.includes(normalizeProductName(item.product_name))}
                  isFavorite={Boolean(favoriteItemMap[normalizeProductName(item.product_name)])}
                  lastPrice={lastPriceMap[normalizeProductName(item.product_name)]}
                  onChange={handleItemChange}
                  onRemove={() => removeItem(item.id)}
                  onToggleFavorite={() =>
                    handleToggleFavorite({
                      product_name: item.product_name,
                      unit_price: item.unit_price,
                    })
                  }
                />
              ))}
            </div>

            <label className="field full">
              <span>備註</span>
              <textarea
                rows="3"
                placeholder="例如：無辣、請放門口"
                value={note}
                disabled={controlsDisabled}
                onChange={(event) => {
                  setNote(event.target.value);
                  if (!isSubmitting) {
                    resetIdempotencyKey();
                  }
                }}
              />
            </label>

            <div className="total-row">
              <div className="order-total-summary">
                <div className="order-total-line">
                  <span className="total-label">商品小計</span>
                  <span>{formatCurrency(orderAmounts.itemsTotal)}</span>
                </div>
                <div className="order-total-line">
                  <span className="total-label">運費</span>
                  <span>{formatCurrency(orderAmounts.shippingAmount)}</span>
                </div>
                <div>
                  <span className="total-label">最終總金額</span>
                  <span className="total-amount">{formatCurrency(orderAmounts.finalTotalAmount)}</span>
                </div>
              </div>
              <button
                type="submit"
                className="primary"
                disabled={controlsDisabled}
              >
                送出訂單
              </button>
            </div>
            <FormMessage text={message.text} type={message.type} />
          </form>
        </section>
        <aside
          className={`cart-summary-panel${user ? "" : " guest-auth-panel"}`}
          aria-label={user ? "訂單摘要" : "會員登入"}
        >
          {user ? (
            <div className="summary-card">
            <div className="summary-head">
              <div>
                <span className="eyebrow">Cart Summary</span>
                <h2>訂單摘要</h2>
              </div>
              <StatusBadge kind={isOpen ? "open" : "closed"}>
                {schedule ? (isOpen ? "可送單" : "未開放") : "載入中"}
              </StatusBadge>
            </div>
            <div className="summary-delivery">
              <span>交貨點</span>
              <strong>{deliveryLocation || "尚未選擇"}</strong>
            </div>
            <div className="summary-lines">
              <div>
                <span>商品項目</span>
                <strong>{filledItemCount} 項</strong>
              </div>
              <div>
                <span>商品小計</span>
                <strong>{formatCurrency(orderAmounts.itemsTotal)}</strong>
              </div>
              <div>
                <span>運費</span>
                <strong>{formatCurrency(orderAmounts.shippingAmount)}</strong>
              </div>
            </div>
            <div className="summary-total">
              <span>預估總金額</span>
              <strong>{formatCurrency(orderAmounts.finalTotalAmount)}</strong>
            </div>
            <button
              type="submit"
              form="orderForm"
              className="primary summary-submit"
              disabled={controlsDisabled}
            >
              送出訂單
            </button>
            <p className="summary-note">實際採買金額可能因現場價格、缺貨或替代商品調整。</p>
            </div>
          ) : authLoading ? (
            <div className="member-auth-loading">正在確認登入狀態...</div>
          ) : (
            <MemberAuthPanel />
          )}
        </aside>
      </div>
    </MemberLayout>
  );
}
