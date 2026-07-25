import { useEffect, useState } from "react";
import LineReturnButton from "../components/LineReturnButton";
import { loadActivePopularProducts } from "../services/popularProductService";
import { formatPriceRange } from "../utils/format";

export default function PopularProductsPage() {
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    loadActivePopularProducts().then(({ data, error: loadError }) => {
      if (!active) {
        return;
      }
      setProducts(loadError ? [] : data || []);
      setError(loadError ? loadError.message || "熱門商品載入失敗。" : "");
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="popular-mini-page">
      <header className="popular-mini-header">
        <span className="popular-mini-brand">Costco 代購</span>
        <LineReturnButton className="popular-mini-back-link" />
      </header>

      <section className="popular-mini-hero" aria-labelledby="popular-mini-title">
        <span>POPULAR PICKS</span>
        <h1 id="popular-mini-title">熱門商品</h1>
        <p>商品與代購預估價格由管理員維護，實際金額以採買完成通知為準。</p>
      </section>

      <section className="popular-mini-content" aria-label="熱門商品清單">
        {loading ? <p className="popular-mini-state">熱門商品載入中...</p> : null}
        {error ? <p className="popular-mini-state error">{error}</p> : null}
        {!loading && !error && !products.length ? (
          <p className="popular-mini-state">目前沒有開團中的熱門商品。</p>
        ) : null}
        {!loading && !error && products.length ? (
          <div className="popular-mini-grid">
            {products.map((product) => (
              <article key={product.id} className="popular-mini-card">
                <img src={product.image_url} alt={product.display_name} loading="lazy" decoding="async" />
                <div>
                  <span>{product.category}</span>
                  <h2>{product.product_name}</h2>
                  {product.specification ? <p>{product.specification}</p> : null}
                  <strong>{formatPriceRange(product.unit_price_min, product.unit_price)}</strong>
                  <small>{product.unit_price_min !== null && Number(product.unit_price_min) < Number(product.unit_price) ? "代購價範圍" : "代購價"}</small>
                </div>
              </article>
            ))}
          </div>
        ) : null}
      </section>

    </main>
  );
}
