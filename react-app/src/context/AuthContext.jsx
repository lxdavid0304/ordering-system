import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { memberSupabase } from "../lib/supabase";

const MemberAuthContext = createContext(null);

function ScopedAuthProvider({ children, client, context, errorLabel, resolveAdminAccess = false }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminLoading, setAdminLoading] = useState(resolveAdminAccess);

  const signOut = useCallback(async () => {
    if (client) {
      await client.auth.signOut();
    }
  }, [client]);

  useEffect(() => {
    if (!client) {
      setSession(null);
      setLoading(false);
      return undefined;
    }

    let active = true;

    client.auth.getSession().then(({ data }) => {
      if (!active) {
        return;
      }

      setSession(data.session || null);
      setLoading(false);
    });

    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession || null);
      setLoading(false);
    });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  useEffect(() => {
    if (!client || !session) {
      return undefined;
    }

    const healthCheck = setInterval(async () => {
      const { data, error } = await client.auth.getSession();

      if (error || !data.session) {
        console.warn(`[${errorLabel}] Session 過期或無效，執行登出`);
        await client.auth.signOut();
      }
    }, 30 * 60 * 1000);

    return () => {
      clearInterval(healthCheck);
    };
  }, [client, errorLabel, session]);

  useEffect(() => {
    if (!resolveAdminAccess) {
      setIsAdmin(false);
      setAdminLoading(false);
      return undefined;
    }

    if (loading) {
      setAdminLoading(true);
      return undefined;
    }

    if (!client || !session?.user?.id) {
      setIsAdmin(false);
      setAdminLoading(false);
      return undefined;
    }

    let active = true;
    setAdminLoading(true);

    client
      .from("admin_users")
      .select("user_id")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) {
          return;
        }
        if (error) {
          console.warn("[AuthContext] 管理員權限檢查失敗", error.message);
        }
        setIsAdmin(Boolean(data) && !error);
        setAdminLoading(false);
      });

    return () => {
      active = false;
    };
  }, [client, loading, resolveAdminAccess, session?.user?.id]);

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      loading,
      isAdmin,
      adminLoading,
      signOut,
      supabase: client,
    }),
    [adminLoading, client, isAdmin, loading, session, signOut]
  );

  const Context = context;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function AuthProvider({ children }) {
  return (
    <ScopedAuthProvider
      client={memberSupabase}
      context={MemberAuthContext}
      errorLabel="AuthContext"
      resolveAdminAccess
    >
      {children}
    </ScopedAuthProvider>
  );
}

export function useAuth() {
  const context = useContext(MemberAuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
