import { useEffect, useMemo, useRef, useState } from "react";
import { Package, Plus, Search, ShoppingCart, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import FavoriteToggleButton from "../components/FavoriteToggleButton";
import FormMessage from "../components/FormMessage";
import MemberLayout from "../components/MemberLayout";
import { useAuth } from "../context/AuthContext";
import { deleteFavoriteItem, loadFavoriteItems, saveFavoriteItem } from "../services/favoriteService";
import { loadActivePopularProducts } from "../services/popularProductService";
import { formatCurrency } from "../utils/format";
import { normalizeProductName } from "../utils/orders";
import { saveReorderPayload } from "../utils/storage";

const emptyForm = {
  product_name: "",
  unit_price: 0,
  note: "",
};

export default function FavoritesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const closeButtonRef = useRef(null);
  const [favorites, setFavorites] = useState([]);
  const [popularProducts, setPopularProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [searchText, setSearchText] = useState("");
  const [quantities, setQuantities] = useState({});
  const [message, setMessage] = useState({ text: "", type: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");
  const [formOpen, setFormOpen] = useState(false);

  const popularProductMap = useMemo(() => {
    const map = {};
    popularProducts.forEach((product) => {
      map[normalizeProductName(product.display_name)] = product;
    });
    return map;
  }, [popularProducts]);

  const visibleFavorites = useMemo(() => {
    const query = searchText.trim().toLowerCase();
    if (!query) {
      return favorites;
    }
    return favorites.filter((favorite) => {
      const product = popularProductMap[normalizeProductName(favorite.product_name)];
      return [favorite.product_name, favorite.note, product?.category]
        .some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [favorites, popularProductMap, searchText]);

  async function refreshFavorites() {
    if (!user?.id) {
      setFavorites([]);
      setPopularProducts([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [favoriteResult, productResult] = await Promise.all([
      loadFavoriteItems(user.id),
      loadActivePopularProducts(),
    ]);
    if (favoriteResult.error) {
      setFavorites([]);
      setMessage({ text: favoriteResult.error.message || "常用商品讀取失敗。", type: "error" });
      setLoading(false);
      return;
    }

    setFavorites(favoriteResult.data || []);
    setPopularProducts(productResult.error ? [] : productResult.data || []);
    setMessage({ text: "", type: "" });
    setLoading(false);
  }

  useEffect(() => {
    refreshFavorites();
  }, [user?.id]);

  useEffect(() => {
    if (!formOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        setFormOpen(false);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [formOpen]);

  async function handleSubmit(event) {
    event.preventDefault();

    if (!user?.id) {
      setMessage({ text: "登入狀態失效，請重新登入。", type: "error" });
      return;
    }

    setSaving(true);
    const { data, error } = await saveFavoriteItem(user.id, form);
    if (error) {
      setMessage({ text: error.message || "儲存失敗。", type: "error" });
      setSaving(false);
      return;
    }

    const key = normalizeProductName(data.product_name);
    setFavorites((current) => [
      data,
      ...current.filter((favorite) => normalizeProductName(favorite.product_name) !== key),
    ]);
    setForm(emptyForm);
    setFormOpen(false);
    setMessage({ text: `已收藏「${data.product_name}」。`, type: "success" });
    setSaving(false);
  }

  async function handleDelete(favorite) {
    setDeletingId(favorite.id);
    const { error } = await deleteFavoriteItem(favorite.id);
    if (error) {
      setMessage({ text: error.message || "移除收藏失敗。", type: "error" });
      setDeletingId("");
      return;
    }

    setFavorites((current) => current.filter((item) => item.id !== favorite.id));
    setMessage({ text: `已移除「${favorite.product_name}」。`, type: "success" });
    setDeletingId("");
  }

  function updateQuantity(favoriteId, nextQuantity) {
    setQuantities((current) => ({
      ...current,
      [favoriteId]: Math.max(1, Math.floor(Number(nextQuantity) || 1)),
    }));
  }

  function handleUseFavorite(favorite) {
    const product = popularProductMap[normalizeProductName(favorite.product_name)];
    const quantity = quantities[favorite.id] || 1;
    saveReorderPayload({
      delivery_location: "",
      note: favorite.note || "",
      order_items: [
        {
          product_name: product?.display_name || favorite.product_name || "",
          unit_price: Number(product?.unit_price ?? favorite.unit_price ?? 0),
          quantity,
          ...(product?.id ? { catalog_product_id: product.id } : {}),
        },
      ],
    });
    navigate("/order");
  }

  return (
    <MemberLayout
      title="常用商品"
      subtitle="收藏常買商品，調整數量後快速加入本次採買清單。"
      active="favorites"
    >
      <section className="favorites-page-section">
        <header className="favorites-toolbar">
          <div>
            <span className="eyebrow">Saved Items</span>
            <h2>我的常用商品</h2>
            <p>{favorites.length} 項收藏</p>
          </div>
          <div className="favorites-toolbar-actions">
            <label className="favorites-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                placeholder="搜尋收藏商品"
                aria-label="搜尋收藏商品"
                onChange={(event) => setSearchText(event.target.value)}
              />
            </label>
            <button type="button" className="primary favorites-add-button" onClick={() => setFormOpen(true)}>
              <Plus size={17} aria-hidden="true" />
              新增自訂商品
            </button>
          </div>
        </header>

        <FormMessage text={message.text} type={message.type} />

        {loading ? <div className="favorites-state">常用商品載入中...</div> : null}
        {!loading && !favorites.length ? (
          <div className="favorites-state">
            <Package size={28} aria-hidden="true" />
            <strong>目前沒有收藏商品</strong>
            <span>可從首頁熱門商品或已填寫商品列點擊愛心收藏。</span>
          </div>
        ) : null}
        {!loading && favorites.length && !visibleFavorites.length ? (
          <div className="favorites-state">
            <strong>找不到符合搜尋條件的商品</strong>
            <button type="button" className="ghost" onClick={() => setSearchText("")}>清除搜尋</button>
          </div>
        ) : null}

        <div className="favorites-product-grid">
          {visibleFavorites.map((favorite) => {
            const product = popularProductMap[normalizeProductName(favorite.product_name)];
            const unitPrice = Number(product?.unit_price ?? favorite.unit_price ?? 0);
            const quantity = quantities[favorite.id] || 1;
            return (
              <article key={favorite.id} className="favorites-product-card">
                <div className="favorites-product-media">
                  {product?.image_url ? (
                    <img src={product.image_url} alt="" loading="lazy" decoding="async" />
                  ) : (
                    <Package size={34} aria-hidden="true" />
                  )}
                  <FavoriteToggleButton
                    active
                    busy={deletingId === favorite.id}
                    label={favorite.product_name}
                    onClick={() => handleDelete(favorite)}
                  />
                </div>
                <div className="favorites-product-body">
                  <div>
                    {product?.category ? <span className="favorites-product-category">{product.category}</span> : null}
                    <h3>{favorite.product_name}</h3>
                    {favorite.note ? <p>{favorite.note}</p> : null}
                  </div>
                  <div className="favorites-product-price">
                    <span>{product ? "最新代購價" : "預估單價"}</span>
                    <strong>{formatCurrency(unitPrice)}</strong>
                  </div>
                  <div className="favorites-product-actions">
                    <div className="favorites-quantity" aria-label={`${favorite.product_name}數量`}>
                      <button type="button" disabled={quantity <= 1} onClick={() => updateQuantity(favorite.id, quantity - 1)} aria-label="減少數量">−</button>
                      <input type="number" min="1" value={quantity} onChange={(event) => updateQuantity(favorite.id, event.target.value)} aria-label={`${favorite.product_name}數量`} />
                      <button type="button" onClick={() => updateQuantity(favorite.id, quantity + 1)} aria-label="增加數量">+</button>
                    </div>
                    <button type="button" className="primary favorites-use-button" onClick={() => handleUseFavorite(favorite)}>
                      <ShoppingCart size={16} aria-hidden="true" />
                      加入填單
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {formOpen ? (
        <div className="favorite-drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setFormOpen(false)}>
          <aside className="favorite-form-drawer" role="dialog" aria-modal="true" aria-labelledby="favoriteFormTitle">
            <header>
              <div>
                <span>Custom Item</span>
                <h2 id="favoriteFormTitle">新增自訂商品</h2>
              </div>
              <button ref={closeButtonRef} type="button" className="favorite-drawer-close" aria-label="關閉新增商品" title="關閉" onClick={() => setFormOpen(false)}>
                <X size={20} aria-hidden="true" />
              </button>
            </header>
            <form className="favorite-drawer-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>商品名稱</span>
                <input type="text" value={form.product_name} required disabled={saving} placeholder="例如：雞腿便當" onChange={(event) => setForm((current) => ({ ...current, product_name: event.target.value }))} />
              </label>
              <label className="field">
                <span>預估單價</span>
                <input type="number" min="1" step="1" value={form.unit_price} required disabled={saving} onChange={(event) => setForm((current) => ({ ...current, unit_price: Math.max(0, Math.floor(Number(event.target.value) || 0)) }))} />
              </label>
              <label className="field">
                <span>備註</span>
                <textarea rows="3" value={form.note} disabled={saving} placeholder="例如：不要辣、少飯" onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))} />
              </label>
              <p>同一商品名稱會更新現有收藏，不會重複新增。</p>
              <button type="submit" className="primary" disabled={saving || !form.product_name.trim() || Number(form.unit_price) <= 0}>
                {saving ? "儲存中..." : "儲存常用商品"}
              </button>
            </form>
          </aside>
        </div>
      ) : null}
    </MemberLayout>
  );
}
