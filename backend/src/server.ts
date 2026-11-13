import { createApp } from "./app.js";
import { config } from "./config/index.js";
import { db } from "./services/database.js";
import { createCognitoVerifier } from "./services/cognitoVerifier.js";
const verifier = config.cognito ? createCognitoVerifier(config.cognito) : undefined;
if (!verifier && config.env === "production")
  console.warn("Cognito is not configured: every authenticated request will be rejected.");
const server = createApp(verifier).listen(config.port, config.devIdentity ? "127.0.0.1" : "0.0.0.0", () =>
  console.log(
    `LifeTime API listening on ${config.port}; development identity: ${config.devIdentity}`,
  ),
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () =>
    server.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    }),
  );
