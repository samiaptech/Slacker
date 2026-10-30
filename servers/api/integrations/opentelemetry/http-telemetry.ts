import type { Attributes, Meter } from "@opentelemetry/api";
import type { NextFunction, Request } from "express";

const knownMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);
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
