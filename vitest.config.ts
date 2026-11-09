import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/auth-flow.test.tsx"],
    environment: "jsdom",
    environmentOptions: { jsdom: { url: "http://localhost:5173/register" } },
    testTimeout: 20000,
  },
});
