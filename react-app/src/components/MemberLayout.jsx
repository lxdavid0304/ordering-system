import { useEffect, useState } from "react";
import { Menu, UserRoundPlus } from "lucide-react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function navClassName(isActive) {
  return `quick-tab${isActive ? " active" : ""}`;
}

export default function MemberLayout({ title, subtitle, active = "", pageClassName = "", children }) {
  const { adminLoading, isAdmin, loading, signOut, user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    document.title = `${title} | 訂購系統`;
  }, [title]);

  return (
    <>
      <div className="bg-glow"></div>
      <main className={`page order-page app-shell${menuOpen ? " mobile-menu-open" : ""} ${pageClassName}`.trim()}>
        <header className="hero">
          <div className="hero-topbar">
            <div>
              <h1>{title}</h1>
              {subtitle ? <p className="subtitle">{subtitle}</p> : null}
            </div>
            {user ? (
              <>
                <button
                  type="button"
                  className="mobile-menu-toggle"
                  aria-expanded={menuOpen}
                  aria-controls="member-navigation"
                  onClick={() => setMenuOpen((current) => !current)}
                >
                  <span aria-hidden="true"><Menu size={19} /></span>
                  選單
                </button>
                {menuOpen ? <button type="button" className="mobile-nav-scrim" aria-label="關閉選單" onClick={() => setMenuOpen(false)} /> : null}
                <nav id="member-navigation" className={`quick-access page-nav${menuOpen ? " mobile-open" : ""}`} aria-label="會員功能">
                <NavLink to="/order" className={() => navClassName(active === "order")} onClick={() => setMenuOpen(false)}>
                  填單
                </NavLink>
                <NavLink to="/pending-order" className={() => navClassName(active === "pending-order")} onClick={() => setMenuOpen(false)}>
                  進行中訂單
                </NavLink>
                <NavLink to="/history" className={() => navClassName(active === "history")} onClick={() => setMenuOpen(false)}>
                  訂單紀錄
                </NavLink>
                <NavLink to="/favorites" className={() => navClassName(active === "favorites")} onClick={() => setMenuOpen(false)}>
                  常用商品
                </NavLink>
                <NavLink to="/profile" className={() => navClassName(active === "profile")} onClick={() => setMenuOpen(false)}>
                  會員資料
                </NavLink>
                {!adminLoading && isAdmin ? (
                  <NavLink to="/admin" className={() => navClassName(false)} onClick={() => setMenuOpen(false)}>
                    管理系統
                  </NavLink>
                ) : null}
                <button type="button" className="quick-tab" onClick={() => { setMenuOpen(false); signOut(); }}>
                  登出
                </button>
              </nav>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="mobile-menu-toggle guest-menu-toggle"
                  aria-label="登入或註冊"
                  aria-expanded={menuOpen}
                  aria-controls="memberAuthPanel"
                  onClick={() => setMenuOpen((current) => !current)}
                >
                  <span aria-hidden="true"><UserRoundPlus size={20} /></span>
                  登入
                </button>
                {menuOpen ? <button type="button" className="mobile-nav-scrim" aria-label="關閉登入面板" onClick={() => setMenuOpen(false)} /> : null}
                <nav className="quick-access page-nav guest-page-nav" aria-label="訪客功能">
                  <span className="guest-nav-status">{loading ? "確認登入狀態中" : "訪客瀏覽"}</span>
                  <a className="quick-tab active" href="#memberAuthPanel">
                    登入 / 註冊
                  </a>
                </nav>
              </>
            )}
          </div>
        </header>
        {children}
      </main>
    </>
  );
}
