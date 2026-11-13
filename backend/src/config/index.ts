import "dotenv/config";
const cognitoEnv = {
  region: process.env.COGNITO_REGION,
  userPoolId: process.env.COGNITO_USER_POOL_ID,
  clientId: process.env.COGNITO_CLIENT_ID,
};
const cognitoSet = Object.values(cognitoEnv).filter(Boolean).length;
if (cognitoSet > 0 && cognitoSet < 3)
  throw new Error("Incomplete Cognito config: set COGNITO_REGION, COGNITO_USER_POOL_ID and COGNITO_CLIENT_ID together");
export const config = {
  cognito:
    cognitoEnv.region && cognitoEnv.userPoolId && cognitoEnv.clientId
      ? { region: cognitoEnv.region, userPoolId: cognitoEnv.userPoolId, clientId: cognitoEnv.clientId }
      : null,
  env: process.env.NODE_ENV || "production",
  port: Number(process.env.PORT || 3001),
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173",
  devIdentity: process.env.DEV_IDENTITY_ENABLED === "true",
  uploadDir: process.env.UPLOAD_DIR || "./local-uploads",
  adminEmail: process.env.ADMIN_EMAIL || "admin@lifetime.local",
};
if (config.devIdentity && config.env !== "development" && config.env !== "test") {
  throw new Error("Development identity is forbidden outside development/test");
}
