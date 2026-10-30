import { z } from "zod";
import type { ValidatedApiEnvironment } from "../types/index.js";

const otlpHeadersSchema = z.string().min(1).refine((value) =>
  value.split(",").every((pair) => {
    const separator = pair.indexOf("=");
    if (separator <= 0) return false;
    const name = pair.slice(0, separator).trim();
    try {
      const decodedValue = decodeURIComponent(pair.slice(separator + 1).trim());
      return /^[!#$%&'*+-.^_`|~0-9A-Za-z]+$/.test(name) && !/[\r\n]/.test(decodedValue);
    } catch {
      return false;
    }
  }), "OTLP headers must be valid comma-separated key=value pairs.");

export const apiEnvironmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]),
  API_HOST: z.string().min(1),
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  WEB_ORIGIN: z.url(),
  MONGODB_URI: z.string().min(1),
  BETTER_AUTH_URL: z.url(),
  BETTER_AUTH_SECRET: z.string().min(32),
  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]),
  CLOUDINARY_CLOUD_NAME: z.string().min(1).optional(),
  CLOUDINARY_API_KEY: z.string().min(1).optional(),
  CLOUDINARY_API_SECRET: z.string().min(1).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.url().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: otlpHeadersSchema.optional(),
  OTEL_SERVICE_NAME: z.string().trim().min(1).max(128).optional()
}).superRefine((environment, context) => {
  const configured = [
    environment.CLOUDINARY_CLOUD_NAME,
    environment.CLOUDINARY_API_KEY,
    environment.CLOUDINARY_API_SECRET
  ].filter((value) => value !== undefined).length;
  if (configured !== 0 && configured !== 3) {
    context.addIssue({
      code: "custom",
      message: "Cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET together."
    });
  }
  const otelConfigured = [
    environment.OTEL_EXPORTER_OTLP_ENDPOINT,
    environment.OTEL_EXPORTER_OTLP_HEADERS
  ].filter((value) => value !== undefined).length;
  if (otelConfigured !== 0 && otelConfigured !== 2) {
    context.addIssue({
      code: "custom",
      message: "OTLP telemetry requires OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS together."
    });
  }
  let endpoint: URL | null = null;
  if (environment.OTEL_EXPORTER_OTLP_ENDPOINT) {
    try {
      endpoint = new URL(environment.OTEL_EXPORTER_OTLP_ENDPOINT);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
        message: "OTLP endpoint must be a valid absolute URL."
      });
    }
  }
  if (endpoint && (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)) {
    context.addIssue({
      code: "custom",
      path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      message: "OTLP endpoint credentials, query strings, and fragments must be configured separately."
    });
  }
  if (environment.NODE_ENV === "production" && endpoint && endpoint.protocol !== "https:") {
    context.addIssue({
      code: "custom",
      path: ["OTEL_EXPORTER_OTLP_ENDPOINT"],
      message: "Production OTLP endpoints must use HTTPS."
    });
  }
}) satisfies z.ZodType<ValidatedApiEnvironment>;

export const validateApiEnvironment = (input: unknown): ValidatedApiEnvironment =>
  Object.freeze(apiEnvironmentSchema.parse(input));
