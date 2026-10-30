import {
  validateApiEnvironment
} from "../validation/env.validation.js";
import type { ApiEnvironmentSource, ValidatedApiEnvironment } from "../types/index.js";

export const readApiEnvironment = (
  source: ApiEnvironmentSource = process.env
): ValidatedApiEnvironment => validateApiEnvironment({
  NODE_ENV: source.NODE_ENV,
  API_HOST: source.API_HOST,
  API_PORT: source.API_PORT,
  WEB_ORIGIN: source.WEB_ORIGIN,
  MONGODB_URI: source.MONGODB_URI,
  BETTER_AUTH_URL: source.BETTER_AUTH_URL,
  BETTER_AUTH_SECRET: source.BETTER_AUTH_SECRET,
  GOOGLE_CLIENT_ID: source.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: source.GOOGLE_CLIENT_SECRET,
  LOG_LEVEL: source.LOG_LEVEL,
  ...(source.CLOUDINARY_CLOUD_NAME !== undefined
    ? { CLOUDINARY_CLOUD_NAME: source.CLOUDINARY_CLOUD_NAME }
    : {}),
  ...(source.CLOUDINARY_API_KEY !== undefined
    ? { CLOUDINARY_API_KEY: source.CLOUDINARY_API_KEY }
    : {}),
  ...(source.CLOUDINARY_API_SECRET !== undefined
    ? { CLOUDINARY_API_SECRET: source.CLOUDINARY_API_SECRET }
    : {}),
  ...(source.OTEL_EXPORTER_OTLP_ENDPOINT !== undefined
    ? { OTEL_EXPORTER_OTLP_ENDPOINT: source.OTEL_EXPORTER_OTLP_ENDPOINT }
    : {}),
  ...(source.OTEL_EXPORTER_OTLP_HEADERS !== undefined
    ? { OTEL_EXPORTER_OTLP_HEADERS: source.OTEL_EXPORTER_OTLP_HEADERS }
    : {}),
  ...(source.OTEL_SERVICE_NAME !== undefined
    ? { OTEL_SERVICE_NAME: source.OTEL_SERVICE_NAME }
    : {})
});
