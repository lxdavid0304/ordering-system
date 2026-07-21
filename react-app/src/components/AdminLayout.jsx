import { useEffect, useState } from "react";
import { BarChart3, Clock3, LayoutDashboard, LogOut, Menu, Package, Store, X } from "lucide-react";
import { NavLink, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

const navItems = [
  { to: "/admin", label: "訂單管理", icon: LayoutDashboard, end: true },
  { to: "/admin/reports", label: "營運報表", icon: BarChart3 },
  { to: "/admin/products", label: "熱門商品", icon: Package },
  { to: "/admin/settings", label: "營業設定", icon: Clock3 },
  { to: "/order", label: "返回前台", icon: Store },
];

export default function AdminLayout({ title, subtitle, actions, children }) {
  const { user, signOut } = useAuth();
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  return (
    <div className={`admin-shell${navOpen ? " nav-open" : ""}`}>
      <button
        type="button"
        className="admin-mobile-menu"
        aria-label={navOpen ? "關閉管理選單" : "開啟管理選單"}
        title={navOpen ? "關閉選單" : "開啟選單"}
        onClick={() => setNavOpen((current) => !current)}
      >
        {navOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      <button
        type="button"
        className="admin-nav-backdrop"
        aria-label="關閉管理選單"
        onClick={() => setNavOpen(false)}
      />

      <aside className="admin-sidebar" aria-label="管理系統導覽">
        <div className="admin-brand">
          <span className="admin-brand-mark">C</span>
          <div>
            <strong>代購營運台</strong>
            <span>ADMIN CONSOLE</span>
          </div>
        </div>

        <nav className="admin-nav">
          {navItems.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => `admin-nav-link${isActive ? " active" : ""}`}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="admin-account">
          <div>
            <span>管理者</span>
            <strong>{user?.email || "已登入"}</strong>
          </div>
          <button type="button" onClick={signOut} title="登出管理系統">
            <LogOut size={18} aria-hidden="true" />
            <span>登出</span>
          </button>
        </div>
      </aside>

      <main className="admin-main">
        <header className="admin-topbar">
          <div>
            <span className="admin-topbar-kicker">管理後台</span>
            <h1>{title}</h1>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          {actions ? <div className="admin-topbar-actions">{actions}</div> : null}
        </header>
        <div className="admin-content">{children}</div>
      </main>
    </div>
  );
}
