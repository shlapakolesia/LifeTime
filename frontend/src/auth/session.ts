export interface AuthIdentity {
  id?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  isAdmin: boolean;
}
export interface DevelopmentRegistration {
  email: string;
  firstName: string;
  lastName: string;
  activeStart: string;
  activeEnd: string;
  timezone: string;
}
interface Session {
  identity: AuthIdentity;
  token: string;
  expiresAt: string;
}
interface Profile {
  id: string;
  email: string;
  accountRole: string;
  profile: { firstName: string; lastName: string };
}
interface SessionResponse {
  user: Profile;
  token: string;
  expiresAt: string;
}
export interface AuthTransport {
  request<T>(path: string, init?: RequestInit): Promise<T>;
}
export const sessionKey = "lifetime:auth-session";
export function readSession(storage: Storage): Session | null {
  try {
    const value = JSON.parse(storage.getItem(sessionKey) || "null");
    return value?.token && value?.identity?.id && Date.parse(value.expiresAt) > Date.now()
      ? value
      : null;
  } catch {
    return null;
  }
}
const identityOf = (user: Profile): AuthIdentity => ({
  id: user.id,
  email: user.email,
  firstName: user.profile.firstName,
  lastName: user.profile.lastName,
  isAdmin: user.accountRole === "admin",
});
/** Local-only transport; Cognito adapter continues to own production OAuth/PKCE. */
export class DevelopmentAuthAdapter {
  constructor(
    private client: AuthTransport,
    private storage: Storage,
  ) {}
  async restore(): Promise<AuthIdentity | null> {
    const session = readSession(this.storage);
    if (!session) {
      this.storage.removeItem(sessionKey);
      return null;
    }
    try {
      const user = await this.client.request<Profile>("/api/profile");
      const identity = identityOf(user);
      if (identity.id !== session.identity.id)
        throw new Error("Сесія не відповідає акаунту. Увійдіть повторно.");
      this.storage.setItem(sessionKey, JSON.stringify({ ...session, identity }));
      return identity;
    } catch (error) {
      if (
        (error as { status?: number }).status === 401 ||
        (error as { status?: number }).status === 403
      )
        this.storage.removeItem(sessionKey);
      throw error;
    }
  }
  private async establish(path: string, input: unknown) {
    const response = await this.client.request<SessionResponse>(path, {
      method: "POST",
      body: JSON.stringify(input),
    });
    const identity = identityOf(response.user);
    this.storage.setItem(
      sessionKey,
      JSON.stringify({
        identity,
        token: response.token,
        expiresAt: response.expiresAt,
      } satisfies Session),
    );
    return identity;
  }
  signIn(input: AuthIdentity) {
    return this.establish("/api/dev-auth/login", { email: input.email });
  }
  register(input: DevelopmentRegistration) {
    return this.establish("/api/dev-auth/register", input);
  }
  async signOut() {
    try {
      await this.client.request("/api/dev-auth/logout", { method: "POST" });
    } catch {
      /* Local sign-out still clears this browser if the server is unreachable. */
    } finally {
      this.storage.removeItem(sessionKey);
    }
  }
  async getAccessToken() {
    return readSession(this.storage)?.token || null;
  }
}

/** Production adapter: Cognito Hosted UI + PKCE; the API account is created on first login. */
export class CognitoAuthAdapter {
  constructor(
    private client: AuthTransport,
    private auth: {
      completeCallback(): Promise<boolean>;
      getTokens(): Promise<{ idToken: string } | null>;
      getAccessToken(): Promise<string | null>;
      clear(): void;
      logout(): Promise<void>;
    },
  ) {}
  private async provision(): Promise<AuthIdentity> {
    const tokens = await this.auth.getTokens();
    if (!tokens) throw new Error("Сесія завершилася. Увійдіть повторно.");
    const user = await this.client.request<Profile>("/api/auth/provision", {
      method: "POST",
      body: JSON.stringify({
        idToken: tokens.idToken,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
    return identityOf(user);
  }
  async restore(): Promise<AuthIdentity | null> {
    if (location.pathname === "/auth/callback") {
      if (!(await this.auth.completeCallback())) return null; // the callback page shows the error
      const identity = await this.provision();
      history.replaceState({}, "", "/dashboard");
      return identity;
    }
    if (!(await this.auth.getTokens())) return null;
    try {
      return identityOf(await this.client.request<Profile>("/api/profile"));
    } catch (error) {
      if ((error as { status?: number }).status !== 401) throw error;
    }
    try {
      return await this.provision(); // valid token, account not created yet
    } catch (error) {
      if ((error as { status?: number }).status === 401) {
        this.auth.clear();
        return null;
      }
      throw error;
    }
  }
  async signIn(_identity: AuthIdentity): Promise<AuthIdentity> {
    throw new Error("Для входу використовуйте Amazon Cognito.");
  }
  signOut() {
    return this.auth.logout();
  }
  getAccessToken() {
    return this.auth.getAccessToken();
  }
}
