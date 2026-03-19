import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ children, redirectTo = "/" }) {
  const { loading, user: memberUser } = useAuth();

  if (loading) {
    return (
      <>
        <div className="bg-glow"></div>
        <main className="page">
          <section className="card">
            <p className="muted">登入狀態驗證中...</p>
          </section>
        </main>
      </>
    );
  }

  if (!memberUser) {
    return <Navigate to={redirectTo} replace />;
  }

  return children;
}
