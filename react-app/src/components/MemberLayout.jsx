import { useEffect } from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

function navClassName(isActive) {
  return `quick-tab${isActive ? " active" : ""}`;
}

export default function MemberLayout({ title, subtitle, active = "", pageClassName = "", children }) {
  const { signOut } = useAuth();

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
            <nav className="quick-access page-nav" aria-label="會員功能">
              <NavLink to="/order" className={() => navClassName(active === "order")}>
                填單
              </NavLink>
              <NavLink to="/pending-order" className={() => navClassName(active === "pending-order")}>
                進行中訂單
              </NavLink>
              <NavLink to="/history" className={() => navClassName(active === "history")}>
                歷史訂單
              </NavLink>
              <NavLink to="/profile" className={() => navClassName(active === "profile")}>
                會員資料
              </NavLink>
              <button type="button" className="quick-tab" onClick={signOut}>
                登出
              </button>
            </nav>
          </div>
        </header>
        {children}
      </main>
    </>
  );
}
