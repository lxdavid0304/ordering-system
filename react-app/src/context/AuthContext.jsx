import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { adminSupabase, memberSupabase } from "../lib/supabase";

const MemberAuthContext = createContext(null);
const AdminAuthContext = createContext(null);

function ScopedAuthProvider({ children, client, context, errorLabel }) {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

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

  const value = useMemo(
    () => ({
      session,
      user: session?.user || null,
      loading,
      signOut,
      supabase: client,
    }),
    [client, loading, session, signOut]
  );

  const Context = context;
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function AuthProvider({ children }) {
  return (
    <ScopedAuthProvider client={memberSupabase} context={MemberAuthContext} errorLabel="AuthContext">
      {children}
    </ScopedAuthProvider>
  );
}

export function AdminAuthProvider({ children }) {
  return (
    <ScopedAuthProvider
      client={adminSupabase}
      context={AdminAuthContext}
      errorLabel="AdminAuthContext"
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

export function useAdminAuth() {
  const context = useContext(AdminAuthContext);
  if (!context) {
    throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  }
  return context;
}
