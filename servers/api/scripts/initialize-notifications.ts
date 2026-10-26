import "dotenv/config";
import { createLogger } from "@workspace/logging";
import { createMongoNotificationStorage } from "../features/notifications/index.js";
import { createApiConfig, readApiEnvironment } from "../config/index.js";
import { apiRuntime } from "../constants/index.js";
import { createMongoDbIntegration } from "../integrations/index.js";

const config = createApiConfig(readApiEnvironment());
const logger = createLogger({
  service: apiRuntime.serviceName,
  level: config.logLevel,
  format: config.environment === "production" ? "json" : "pretty"
});
const database = createMongoDbIntegration({ uri: config.mongodbUri, logger });

await database.connect();
try {
  await createMongoNotificationStorage(database.getDatabase()).initialize();
  logger.info("Notification persistence schema and indexes are ready.");
} finally {
  await database.disconnect();
}
