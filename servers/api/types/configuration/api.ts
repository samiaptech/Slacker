import type { LogLevel } from "@workspace/logging";
import type { ApiEnvironment } from "@workspace/types";

export type ApiConfig = Readonly<{
  environment: ApiEnvironment;
  host: string;
  port: number;
  webOrigin: string;
  mongodbUri: string;
  betterAuthUrl: string;
  betterAuthSecret: string;
  googleClientId: string;
  googleClientSecret: string;
  logLevel: LogLevel;
  cloudinary?: Readonly<{ cloudName: string; apiKey: string; apiSecret: string }>;
  telemetry?: Readonly<{
    endpoint: string;
    headers: string;
    serviceName: string;
  }>;
}>;
