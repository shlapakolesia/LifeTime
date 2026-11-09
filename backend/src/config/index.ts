import "dotenv/config";
export const config = {
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
