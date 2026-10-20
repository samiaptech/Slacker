import type { LogLevel } from "@workspace/logging";
import type { ApiEnvironment } from "@workspace/types";

export type ApiEnvironmentSource = Readonly<Record<string, string | undefined>>;

export type ValidatedApiEnvironment = Readonly<{
  NODE_ENV: ApiEnvironment;
  API_HOST: string;
  API_PORT: number;
  WEB_ORIGIN: string;
  MONGODB_URI: string;
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  LOG_LEVEL: LogLevel;
}>;
