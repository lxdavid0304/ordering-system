import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function navClassName(isActive) {
  return `quick-tab${isActive ? " active" : ""}`;
}

export default function MemberLayout({ title, subtitle, active = "", pageClassName = "", children }) {
  const { adminLoading, isAdmin, loading, signOut, user } = useAuth();

  useEffect(() => {
    document.title = `${title} | 訂購系統`;
  }, [title]);

  return (
    <>
      <div className="bg-glow"></div>
      <main className={`page order-page app-shell ${pageClassName}`.trim()}>
        <header className="hero">
          <div className="hero-topbar">
            <div>
              <h1>{title}</h1>
              {subtitle ? <p className="subtitle">{subtitle}</p> : null}
            </div>
            {user ? (
              <nav className="quick-access page-nav" aria-label="會員功能">
                <NavLink to="/order" className={() => navClassName(active === "order")}>
                  填單
                </NavLink>
                <NavLink to="/pending-order" className={() => navClassName(active === "pending-order")}>
                  進行中訂單
                </NavLink>
                <NavLink to="/history" className={() => navClassName(active === "history")}>
                  訂單紀錄
                </NavLink>
                <NavLink to="/favorites" className={() => navClassName(active === "favorites")}>
                  常用商品
                </NavLink>
                <NavLink to="/profile" className={() => navClassName(active === "profile")}>
                  會員資料
                </NavLink>
                {!adminLoading && isAdmin ? (
                  <NavLink to="/admin" className={() => navClassName(false)}>
                    管理系統
                  </NavLink>
                ) : null}
                <button type="button" className="quick-tab" onClick={signOut}>
                  登出
                </button>
              </nav>
            ) : (
              <nav className="quick-access page-nav guest-page-nav" aria-label="訪客功能">
                <span className="guest-nav-status">{loading ? "確認登入狀態中" : "訪客瀏覽"}</span>
                <a className="quick-tab active" href="#memberAuthPanel">
                  登入 / 註冊
                </a>
              </nav>
            )}
          </div>
        </header>
        {children}
      </main>
    </>
  );
}
