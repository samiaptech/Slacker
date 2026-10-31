import { randomUUID } from "node:crypto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { ExportResultCode } from "@opentelemetry/core";
import {
  MeterProvider,
  PeriodicExportingMetricReader,
  type PushMetricExporter
} from "@opentelemetry/sdk-metrics";
import { resourceFromAttributes } from "@opentelemetry/resources";
import type { RequestHandler } from "express";
import type { Logger } from "@workspace/logging";
import type { SocketIoTelemetry } from "../socket-io/index.js";
import { createApiHttpTelemetryMiddleware, createApiHttpTelemetryViews } from "./http-telemetry.js";
import { createSocketIoTelemetry } from "./socket-telemetry.js";
import { getOtlpSignalUrl, parseOtlpHeaders } from "./headers.js";

export type OpenTelemetryConfiguration = Readonly<{
  endpoint: string;
  headers: string;
  serviceName: string;
}>;

export type OpenTelemetryIntegration = Readonly<{
  middleware?: RequestHandler;
  socketIo: SocketIoTelemetry;
  shutdown: () => Promise<void>;
}>;

const disabledSocketTelemetry: SocketIoTelemetry = Object.freeze({
  recordConnectionAttempt: () => undefined,
  recordConnectionOpened: () => undefined,
  recordConnectionClosed: () => undefined,
  recordEvent: () => undefined,
  recordEventFailure: () => undefined
});

export const createOpenTelemetryIntegration = (
  configuration: OpenTelemetryConfiguration | undefined,
  logger: Logger
): OpenTelemetryIntegration => {
  if (!configuration) {
    return Object.freeze({
      socketIo: disabledSocketTelemetry,
      shutdown: () => Promise.resolve()
    });
  }

  const headers = parseOtlpHeaders(configuration.headers);
  const metricExporter = new OTLPMetricExporter({
    url: getOtlpSignalUrl(configuration.endpoint),
    headers
  });
  const loggedMetricExporter: PushMetricExporter = {
    export: (metrics, callback) => {
      metricExporter.export(metrics, (result) => {
        if (result.code !== ExportResultCode.SUCCESS) {
          logger.error("OpenTelemetry metrics export failed.", {
            code: result.code,
            error: "The metrics exporter returned an unsuccessful result."
          });
        }
        callback(result);
      });
    },
    forceFlush: () => metricExporter.forceFlush(),
    shutdown: () => metricExporter.shutdown()
  };
  const metricReader = new PeriodicExportingMetricReader({
    exporter: loggedMetricExporter,
    exportIntervalMillis: 15_000
  });
  const meterProvider = new MeterProvider({
    resource: resourceFromAttributes({
      "service.name": configuration.serviceName,
      "service.instance.id": randomUUID()
    }),
    views: createApiHttpTelemetryViews(),
    readers: [metricReader]
  });
  const meter = meterProvider.getMeter("teamnest-api");

  return Object.freeze({
    middleware: createApiHttpTelemetryMiddleware(meter),
    socketIo: createSocketIoTelemetry(meter),
    shutdown: async () => {
      try {
        await meterProvider.shutdown();
      } catch (error: unknown) {
        logger.error("OpenTelemetry metrics shutdown failed.", {
          error: error instanceof Error ? error.message : "Unknown telemetry shutdown error."
        });
        throw error;
      }
    }
  });
};
