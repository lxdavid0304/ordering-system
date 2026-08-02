import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import AdminProtectedRoute from "./components/AdminProtectedRoute";
import ProtectedRoute from "./components/ProtectedRoute";
import AdminPage from "./pages/AdminPage";
import AdminProductsPage from "./pages/AdminProductsPage";
import AdminReportsPage from "./pages/AdminReportsPage";
import AdminSettingsPage from "./pages/AdminSettingsPage";
import AdminFlashFoodPage from "./pages/AdminFlashFoodPage";
import FavoritesPage from "./pages/FavoritesPage";
import FlashFoodPage from "./pages/FlashFoodPage";
import HistoryPage from "./pages/HistoryPage";
import LineAuthCallbackPage from "./pages/LineAuthCallbackPage";
import LineMemberPage from "./pages/LineMemberPage";
import OrderPage from "./pages/OrderPage";
import PaymentPage from "./pages/PaymentPage";
import PendingOrderPage from "./pages/PendingOrderPage";
import PopularProductsPage from "./pages/PopularProductsPage";
import ProfilePage from "./pages/ProfilePage";
import RulesPage from "./pages/RulesPage";

const pageTitles = {
  "/order": "Costco 代購填單",
  "/popular": "熱門商品",
  "/rules": "取貨與付款規則",
  "/history": "訂單紀錄",
  "/favorites": "常用商品",
  "/flash-food": "快閃熱食",
  "/profile": "會員資料",
  "/payment": "付款資訊",
  "/pending-order": "進行中訂單",
  "/auth/callback": "LINE 登入",
  "/admin": "後台訂單管理",
  "/admin/products": "熱門商品管理",
  "/admin/reports": "後台報表",
  "/admin/settings": "後台設定",
  "/admin/flash-food": "快閃熱食開團",
};

function RouteTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = `${pageTitles[pathname] || "Costco 代購"}｜訂購系統`;
  }, [pathname]);

  return null;
}

export default function App() {
  return (
    <>
      <RouteTitle />
      <Routes>
      <Route path="/" element={<Navigate to="/order" replace />} />
      <Route path="/order" element={<OrderPage />} />
      <Route path="/auth/callback" element={<LineAuthCallbackPage />} />
      <Route path="/line-member" element={<LineMemberPage />} />
      <Route path="/popular" element={<PopularProductsPage />} />
      <Route path="/rules" element={<RulesPage />} />
      <Route
        path="/history"
        element={
          <ProtectedRoute>
            <HistoryPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/favorites"
        element={
          <ProtectedRoute>
            <FavoritesPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/flash-food"
        element={
          <ProtectedRoute>
            <FlashFoodPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/payment"
        element={
          <ProtectedRoute>
            <PaymentPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/pending-order"
        element={
          <ProtectedRoute>
            <PendingOrderPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminProtectedRoute>
            <AdminPage />
          </AdminProtectedRoute>
        }
      />
      <Route
        path="/admin/products"
        element={
          <AdminProtectedRoute>
            <AdminProductsPage />
          </AdminProtectedRoute>
        }
      />
      <Route
        path="/admin/reports"
        element={
          <AdminProtectedRoute>
            <AdminReportsPage />
          </AdminProtectedRoute>
        }
      />
      <Route
        path="/admin/settings"
        element={
          <AdminProtectedRoute>
            <AdminSettingsPage />
          </AdminProtectedRoute>
        }
      />
      <Route
        path="/admin/flash-food"
        element={
          <AdminProtectedRoute>
            <AdminFlashFoodPage />
          </AdminProtectedRoute>
        }
      />
        <Route path="*" element={<Navigate to="/order" replace />} />
      </Routes>
    </>
  );
}
