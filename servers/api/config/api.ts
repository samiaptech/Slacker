import type { ApiConfig, ValidatedApiEnvironment } from "../types/index.js";

export const createApiConfig = (environment: ValidatedApiEnvironment): ApiConfig => Object.freeze({
  environment: environment.NODE_ENV,
  host: environment.API_HOST,
  port: environment.API_PORT,
  webOrigin: environment.WEB_ORIGIN,
  mongodbUri: environment.MONGODB_URI,
  betterAuthUrl: environment.BETTER_AUTH_URL,
  betterAuthSecret: environment.BETTER_AUTH_SECRET,
  googleClientId: environment.GOOGLE_CLIENT_ID,
  googleClientSecret: environment.GOOGLE_CLIENT_SECRET,
  logLevel: environment.LOG_LEVEL,
  ...(environment.CLOUDINARY_CLOUD_NAME && environment.CLOUDINARY_API_KEY && environment.CLOUDINARY_API_SECRET
    ? { cloudinary: Object.freeze({
      cloudName: environment.CLOUDINARY_CLOUD_NAME,
      apiKey: environment.CLOUDINARY_API_KEY,
      apiSecret: environment.CLOUDINARY_API_SECRET
    }) }
    : {})
});
