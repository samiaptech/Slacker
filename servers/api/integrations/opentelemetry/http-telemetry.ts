import type { Attributes, Meter } from "@opentelemetry/api";
import { AggregationType, type ViewOptions } from "@opentelemetry/sdk-metrics";
import type { NextFunction, Request } from "express";

const knownMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
const requestDurationBoundariesSeconds = [
  0.0005, 0.001, 0.0025, 0.005, 0.0075, 0.01, 0.025, 0.05, 0.075, 0.1,
  0.25, 0.5, 0.75, 1, 2.5,
  2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5,
  7.5, 10, 15, 30, 60
];
type ApiHttpRequest = Readonly<{ method: string; route?: unknown }>;
type ApiHttpTelemetryResponse = Readonly<{
  statusCode: number;
  once: (event: "finish", listener: () => void) => unknown;
}>;
type ApiHttpTelemetryMiddleware = (
  request: Pick<Request, "method" | "route">,
  response: ApiHttpTelemetryResponse,
  next: NextFunction
) => void;

const routeTemplate = (route: unknown): string => {
  if (typeof route !== "object" || route === null || !("path" in route)) return "unmatched";
  return typeof route.path === "string" ? route.path : "unmatched";
};

export const createApiHttpTelemetryViews = (): ViewOptions[] => [{
  instrumentName: "teamnest.http.request.duration",
  aggregation: {
    type: AggregationType.EXPLICIT_BUCKET_HISTOGRAM,
    options: { boundaries: [...requestDurationBoundariesSeconds] }
  }
}];

export const getApiHttpAttributes = (
  request: ApiHttpRequest,
  statusCode: number
): Attributes => Object.freeze({
  "http.request.method": knownMethods.has(request.method) ? request.method : "_OTHER",
  "http.route": routeTemplate(request.route),
  "http.response.status_code": statusCode
});

export const createApiHttpTelemetryMiddleware = (
  meter: Meter
): ApiHttpTelemetryMiddleware => {
  const requestCount = meter.createCounter("teamnest.http.requests", {
    unit: "{request}",
    description: "Completed API HTTP requests"
  });
  const requestDuration = meter.createHistogram("teamnest.http.request.duration", {
    unit: "s",
    description: "API HTTP request duration"
  });
  return (request, response, next): void => {
    const startTime = performance.now();
    response.once("finish", () => {
      const attributes = getApiHttpAttributes(request, response.statusCode);
      const durationSeconds = (performance.now() - startTime) / 1000;
      requestCount.add(1, attributes);
      requestDuration.record(durationSeconds, attributes);
    });
    next();
  };
};
