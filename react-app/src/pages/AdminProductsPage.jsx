import { useEffect, useMemo, useState } from "react";
import AdminLayout from "../components/AdminLayout";
import FormMessage from "../components/FormMessage";
import { useAuth } from "../context/AuthContext";
import { checkAdminAccess } from "../services/adminService";
import {
  deletePopularProduct,
  deletePopularProductImage,
  loadAdminPopularProducts,
  savePopularProduct,
  setPopularProductActive,
  uploadPopularProductImage,
} from "../services/popularProductService";
import { formatPriceRange } from "../utils/format";
import { createUuid } from "../utils/orders";

const emptyForm = {
  id: "",
  product_name: "",
  specification: "",
  category: "其他",
  unit_price_min: "",
  unit_price: 0,
  image_path: "",
  image_url: "",
  costco_url: "",
  is_active: false,
  sort_order: 0,
};

export default function AdminProductsPage() {
  const { user } = useAuth();
  const [verified, setVerified] = useState(false);
  const [products, setProducts] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState("");
  const [imageDimensions, setImageDimensions] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState({ text: "", type: "" });

  const categories = useMemo(
    () => Array.from(new Set(products.map((product) => product.category).filter(Boolean))).sort(),
    [products]
  );

  useEffect(() => {
    document.title = "熱門商品管理 | 訂購系統";
  }, []);

  useEffect(() => {
    if (!user) {
      setVerified(false);
      setProducts([]);
      setLoading(false);
      return;
    }

    let active = true;
    async function verify() {
      setLoading(true);
      const { data, error } = await checkAdminAccess();
      if (!active) {
        return;
      }
      if (error || !data) {
        setVerified(false);
        setMessage({ text: "目前帳號沒有管理員權限。", type: "error" });
        setLoading(false);
        return;
      }
      setVerified(true);
      setMessage({ text: "", type: "" });
    }
    verify();
    return () => {
      active = false;
    };
  }, [user]);

  useEffect(() => {
    if (!verified) {
      return;
    }
    refreshProducts();
  }, [verified]);

  useEffect(() => {
    return () => {
      if (imagePreview.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  async function refreshProducts() {
    setLoading(true);
    const { data, error } = await loadAdminPopularProducts();
    if (error) {
      setProducts([]);
      setMessage({ text: error.message || "熱門商品讀取失敗。", type: "error" });
      setLoading(false);
      return;
    }
    setProducts(data || []);
    setLoading(false);
  }

  function resetForm() {
    setForm(emptyForm);
    setImageFile(null);
    setImagePreview("");
    setImageDimensions(null);
  }

  function handleFileChange(file) {
    setImageFile(file || null);
    setImagePreview(file ? URL.createObjectURL(file) : form.image_url || "");
    setImageDimensions(null);
  }

  function startEdit(product) {
    setForm({ ...product, unit_price_min: product.unit_price_min ?? "" });
    setImageFile(null);
    setImagePreview(product.image_url || "");
    setImageDimensions(null);
    setMessage({ text: "", type: "" });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!imageFile && !form.image_path) {
      setMessage({ text: "請上傳商品圖片。", type: "error" });
      return;
    }

    setSaving(true);
    setMessage({ text: "儲存中...", type: "" });
    const productId = form.id || createUuid();
    let nextImagePath = form.image_path;
    let uploadedImagePath = "";

    if (imageFile) {
      const uploadResult = await uploadPopularProductImage(productId, imageFile);
      if (uploadResult.error) {
        setMessage({ text: uploadResult.error.message || "圖片上傳失敗。", type: "error" });
        setSaving(false);
        return;
      }
      nextImagePath = uploadResult.data.path;
      uploadedImagePath = nextImagePath;
    }

    const { error } = await savePopularProduct({
      ...form,
      id: productId,
      image_path: nextImagePath,
    });

    if (error) {
      if (uploadedImagePath) {
        await deletePopularProductImage(uploadedImagePath);
      }
      setMessage({ text: error.message || "商品儲存失敗。", type: "error" });
      setSaving(false);
      return;
    }

    if (uploadedImagePath && form.image_path && form.image_path !== uploadedImagePath) {
      await deletePopularProductImage(form.image_path);
    }

    resetForm();
    setMessage({ text: "熱門商品已儲存。", type: "success" });
    setSaving(false);
    await refreshProducts();
  }

  async function handleToggle(product) {
    const { error } = await setPopularProductActive(product.id, !product.is_active);
    if (error) {
      setMessage({ text: error.message || "上下架更新失敗。", type: "error" });
      return;
    }
    setMessage({
      text: product.is_active ? "商品已下架。" : "商品已上架。",
      type: "success",
    });
    await refreshProducts();
  }

  async function handleDelete(product) {
    if (!window.confirm(`確定刪除「${product.display_name}」？`)) {
      return;
    }
    const { error } = await deletePopularProduct(product.id);
    if (error) {
      setMessage({ text: error.message || "商品刪除失敗。", type: "error" });
      return;
    }
    await deletePopularProductImage(product.image_path);
    if (form.id === product.id) {
      resetForm();
    }
    setMessage({ text: "商品已刪除。", type: "success" });
    await refreshProducts();
  }

  return (
    <AdminLayout title="熱門商品" subtitle="維護首頁可直接加入訂單的商品、預估價格與圖片。">
      {!verified ? (
        <section className="admin-status-panel admin-products-login">
          <FormMessage
            text={message.text || (loading ? "管理員權限確認中..." : "目前帳號沒有管理員權限。")}
            type={message.type}
          />
        </section>
      ) : (
        <div className="admin-products-workspace">
          <section className="card admin-product-editor">
            <div className="panel-header">
              <div>
                <h2>{form.id ? "編輯商品" : "新增商品"}</h2>
                <p className="muted">商品預設下架，確認內容後再切換為上架。</p>
              </div>
              {form.id ? <button type="button" className="ghost" onClick={resetForm}>取消編輯</button> : null}
            </div>

            <form className="admin-product-form" onSubmit={handleSubmit}>
              <label className="field">
                <span>商品名稱</span>
                <input
                  type="text"
                  value={form.product_name}
                  maxLength="120"
                  required
                  disabled={saving}
                  placeholder="例如：科克蘭衛生紙"
                  onChange={(event) => setForm((current) => ({ ...current, product_name: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>包裝規格</span>
                <input
                  type="text"
                  value={form.specification}
                  maxLength="160"
                  disabled={saving}
                  placeholder="例如：425 張 × 30 捲"
                  onChange={(event) => setForm((current) => ({ ...current, specification: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>Costco 商品連結</span>
                <input
                  type="url"
                  value={form.costco_url || ""}
                  disabled={saving}
                  placeholder="https://www.costco.com.tw/..."
                  onChange={(event) => setForm((current) => ({ ...current, costco_url: event.target.value }))}
                />
                <small className="muted">僅接受 Costco 台灣官網連結，可留空。</small>
              </label>
              <label className="field">
                <span>分類</span>
                <input
                  type="text"
                  value={form.category}
                  maxLength="60"
                  list="popularProductCategories"
                  required
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}
                />
                <datalist id="popularProductCategories">
                  {categories.map((category) => <option key={category} value={category} />)}
                </datalist>
              </label>
              <div className="admin-product-form-row">
                <label className="field">
                  <span>最低預估價（可留空）</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.unit_price_min}
                    disabled={saving}
                    placeholder="固定價商品可留空"
                    onChange={(event) => setForm((current) => ({ ...current, unit_price_min: event.target.value }))}
                  />
                </label>
                <label className="field">
                  <span>最高預估價／固定價</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={form.unit_price}
                    required
                    disabled={saving}
                    onChange={(event) => setForm((current) => ({ ...current, unit_price: event.target.value }))}
                  />
                </label>
              </div>
              <small className="muted">設定範圍時，訂單總額會以最高預估價計算。</small>
              <label className="field">
                <span>排序</span>
                <input
                  type="number"
                  step="1"
                  value={form.sort_order}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, sort_order: event.target.value }))}
                />
              </label>
              <label className="field">
                <span>商品圖片</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={saving}
                  onChange={(event) => handleFileChange(event.target.files?.[0])}
                />
                <small className="muted">JPG、PNG、WebP，最大 5 MB；建議至少 1200 × 900px。</small>
              </label>
              {imagePreview || form.image_url ? (
                <div className="admin-product-image-preview">
                  <img
                    src={imagePreview || form.image_url}
                    alt="商品圖片預覽"
                    onLoad={(event) =>
                      setImageDimensions({
                        width: event.currentTarget.naturalWidth,
                        height: event.currentTarget.naturalHeight,
                      })
                    }
                  />
                </div>
              ) : null}
              {imageDimensions ? (
                <p
                  className={`admin-image-resolution${
                    imageDimensions.width < 1200 || imageDimensions.height < 900 ? " warning" : ""
                  }`}
                >
                  圖片解析度：{imageDimensions.width} × {imageDimensions.height}px
                  {imageDimensions.width < 1200 || imageDimensions.height < 900
                    ? "，建議改用較高解析度圖片。"
                    : "，解析度良好。"}
                </p>
              ) : null}
              <label className="checkbox-inline admin-product-active-field">
                <input
                  type="checkbox"
                  checked={Boolean(form.is_active)}
                  disabled={saving}
                  onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))}
                />
                儲存後立即上架
              </label>
              <button type="submit" className="primary" disabled={saving}>
                {saving ? "儲存中..." : "儲存商品"}
              </button>
            </form>
            <FormMessage text={message.text} type={message.type} />
          </section>

          <section className="card admin-product-list-panel">
            <div className="panel-header">
              <div>
                <h2>商品目錄</h2>
                <p className="muted">共 {products.length} 項，依排序數字由小到大顯示。</p>
              </div>
              <button type="button" className="ghost" disabled={loading} onClick={refreshProducts}>
                {loading ? "更新中..." : "重新整理"}
              </button>
            </div>

            {!loading && !products.length ? (
              <div className="admin-products-empty">尚未建立熱門商品。</div>
            ) : null}
            <div className="admin-product-list">
              {products.map((product) => (
                <article key={product.id} className="admin-product-card">
                  <img src={product.image_url} alt={product.display_name} />
                  <div className="admin-product-card-body">
                    <div className="admin-product-card-title">
                      <div>
                        <span>{product.category}</span>
                        <strong>{product.product_name}</strong>
                        {product.specification ? <small>{product.specification}</small> : null}
                      </div>
                      <span className={`catalog-state ${product.is_active ? "active" : "inactive"}`}>
                        {product.is_active ? "已上架" : "已下架"}
                      </span>
                    </div>
                    <div className="admin-product-card-meta">
                      <strong>{formatPriceRange(product.unit_price_min, product.unit_price)}</strong>
                      <span>排序 {product.sort_order}</span>
                    </div>
                    <div className="admin-product-card-actions">
                      {product.costco_url ? (
                        <a
                          href={product.costco_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ghost admin-link-button"
                        >
                          Costco 官網
                        </a>
                      ) : null}
                      <button type="button" className="ghost" onClick={() => startEdit(product)}>編輯</button>
                      <button type="button" className="ghost" onClick={() => handleToggle(product)}>
                        {product.is_active ? "下架" : "上架"}
                      </button>
                      <button type="button" className="ghost danger" onClick={() => handleDelete(product)}>刪除</button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
    </AdminLayout>
  );
}
