export const apiMode = import.meta.env.VITE_DATA_MODE !== "demo";
export const appConfig = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "http://localhost:3001",
  donationJarUrl: import.meta.env.VITE_DONATION_JAR_URL || "",
  cognito: {
    authority: import.meta.env.VITE_COGNITO_AUTHORITY || "",
    clientId: import.meta.env.VITE_COGNITO_CLIENT_ID || "",
    redirectUri:
      import.meta.env.VITE_COGNITO_REDIRECT_URI || `${window.location.origin}/auth/callback`,
    logoutUri: import.meta.env.VITE_COGNITO_LOGOUT_URI || window.location.origin,
  },
} as const;

export const isCognitoConfigured = Boolean(
  appConfig.cognito.authority && appConfig.cognito.clientId,
);
