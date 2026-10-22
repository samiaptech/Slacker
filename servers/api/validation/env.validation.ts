import { z } from "zod";
import type { ValidatedApiEnvironment } from "../types/index.js";

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
  CLOUDINARY_API_SECRET: z.string().min(1).optional()
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
}) satisfies z.ZodType<ValidatedApiEnvironment>;

export const validateApiEnvironment = (input: unknown): ValidatedApiEnvironment =>
  Object.freeze(apiEnvironmentSchema.parse(input));
