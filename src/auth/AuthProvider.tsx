import { apiMode } from "../config";
import { api } from "../services/apiClient";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type { AuthIdentity } from "./session";
import { DevelopmentAuthAdapter, type AuthIdentity, type DevelopmentRegistration } from "./session";
export interface AuthAdapter {
  restore(): AuthIdentity | null | Promise<AuthIdentity | null>;
  signIn(identity: AuthIdentity): Promise<AuthIdentity>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
}

class LocalAuthAdapter implements AuthAdapter {
  private readonly key = "lifetime:auth-session";
  restore() {
    try {
      return JSON.parse(sessionStorage.getItem(this.key) || "null") as AuthIdentity | null;
    } catch {
      return null;
    }
  }
  async signIn(identity: AuthIdentity) {
    sessionStorage.setItem(this.key, JSON.stringify(identity));
    return identity;
  }
  async signOut() {
    sessionStorage.removeItem(this.key);
  }
  async getAccessToken() {
    return null;
  }
}

interface AuthContextValue {
  user: AuthIdentity | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  signInLocal(identity: AuthIdentity): Promise<void>;
  registerLocal(input: DevelopmentRegistration): Promise<void>;
  signOut(): Promise<void>;
  getAccessToken(): Promise<string | null>;
}

const adapter = apiMode ? new DevelopmentAuthAdapter(api, sessionStorage) : new LocalAuthAdapter();
const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthIdentity | null>(null);
  const [isLoading, setLoading] = useState(true);
  const [restoreError, setRestoreError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setRestoreError("");
    Promise.resolve(adapter.restore())
      .then((identity) => {
        if (live) setUser(identity);
      })
      .catch((error) => {
        if (live)
          setRestoreError(error instanceof Error ? error.message : "Не вдалося відновити сесію.");
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isAuthenticated: Boolean(user),
      isLoading,
      async signInLocal(identity) {
        setUser(await adapter.signIn(identity));
      },
      async registerLocal(input) {
        setUser(
          await (apiMode
            ? (adapter as DevelopmentAuthAdapter).register(input)
            : adapter.signIn({ ...input, isAdmin: false })),
        );
      },
      async signOut() {
        try {
          await adapter.signOut();
        } finally {
          setUser(null);
        }
      },
      getAccessToken: () => adapter.getAccessToken(),
    }),
    [user, isLoading],
  );
  if (restoreError)
    return (
      <div className="page">
        <p role="alert">{restoreError}</p>
        <button className="button" onClick={() => setAttempt((n) => n + 1)}>
          Повторити
        </button>
        <button
          className="button"
          onClick={() => {
            sessionStorage.removeItem("lifetime:auth-session");
            setRestoreError("");
            setUser(null);
          }}
        >
          Повернутися до входу
        </button>
      </div>
    );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthProvider missing");
  return context;
}

export function ProtectedRoute({
  children,
  fallback,
}: {
  children: ReactNode;
  fallback: ReactNode;
}) {
  const { isAuthenticated } = useAuth();
  return isAuthenticated ? children : fallback;
}
