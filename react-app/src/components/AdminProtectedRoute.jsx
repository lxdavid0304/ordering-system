import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function AdminProtectedRoute({ children }) {
  const { adminLoading, isAdmin, loading, user } = useAuth();

  if (loading || (user && adminLoading)) {
    return (
      <>
        <div className="bg-glow"></div>
        <main className="page">
          <section className="card">
            <p className="muted">管理員權限驗證中...</p>
          </section>
        </main>
      </>
    );
  }

  if (!user || !isAdmin) {
    return <Navigate to="/order" replace />;
  }

  return children;
}
