import "dotenv/config";
import { createLogger } from "@workspace/logging";
import { createApiConfig, readApiEnvironment } from "../config/index.js";
import { apiRuntime } from "../constants/index.js";
import { createMongoDbIntegration } from "../integrations/index.js";
import { createMongoDirectMessageStorage } from "../features/direct-messages/index.js";

const config = createApiConfig(readApiEnvironment());
const logger = createLogger({
  service: apiRuntime.serviceName,
  level: config.logLevel,
  format: config.environment === "production" ? "json" : "pretty"
});
const database = createMongoDbIntegration({ uri: config.mongodbUri, logger });

await database.connect();
try {
  const storage = createMongoDirectMessageStorage(database.getDatabase(), database.withTransaction);
  await storage.initialize();
  logger.info("Direct-message persistence schema and indexes are ready.");
} finally {
  await database.disconnect();
}
