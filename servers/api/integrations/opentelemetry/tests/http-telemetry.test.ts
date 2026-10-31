import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { Attributes } from "@opentelemetry/api";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader
} from "@opentelemetry/sdk-metrics";
import {
  createApiHttpTelemetryMiddleware,
  createApiHttpTelemetryViews,
  getApiHttpAttributes
} from "../http-telemetry.js";

type TestMetricPoint = Readonly<{ attributes: Attributes; value: unknown }>;
type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord =>
  typeof value === "object" && value !== null;

const isNumberArray = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === "number");

const getHistogramBoundaries = (value: unknown): readonly number[] => {
  if (!isRecord(value) || !isRecord(value.buckets) || !isNumberArray(value.buckets.boundaries)) {
    throw new Error("Expected an explicit-bucket histogram value.");
  }
  return value.buckets.boundaries;
};

const getMetricPoints = (
  exporter: InMemoryMetricExporter,
  name: string
): TestMetricPoint[] => {
  const points: TestMetricPoint[] = [];
  for (const resourceMetrics of exporter.getMetrics()) {
    for (const scopeMetrics of resourceMetrics.scopeMetrics) {
      for (const metric of scopeMetrics.metrics) {
        if (metric.descriptor.name === name) points.push(...metric.dataPoints);
      }
    }
  }
  return points;
};

void test("records only the method, Express route template, and response status", () => {
  assert.deepEqual(getApiHttpAttributes({
    method: "GET",
    route: { path: "/channels/:channelId/messages" }
  }, 200), {
    "http.request.method": "GET",
    "http.route": "/channels/:channelId/messages",
    "http.response.status_code": 200
  });
});

void test("uses bounded fallback values for unknown routes and methods", () => {
  assert.deepEqual(getApiHttpAttributes({
    method: "CUSTOM",
    route: undefined
  }, 404), {
    "http.request.method": "_OTHER",
    "http.route": "unmatched",
    "http.response.status_code": 404
  });
});

void test("records failed HTTP requests using only the normalized route template", async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({
    views: createApiHttpTelemetryViews(),
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })]
  });
  const middleware = createApiHttpTelemetryMiddleware(provider.getMeter("http-test"));
  const request = {
    method: "GET",
    route: { path: "/users/:userId" }
  };
  const response = Object.assign(new EventEmitter(), { statusCode: 503 });

  try {
    middleware(request, response, () => undefined);
    response.emit("finish");
    await provider.forceFlush();
    const requestPoints = getMetricPoints(exporter, "teamnest.http.requests");
    assert.equal(requestPoints.length, 1);
    assert.deepEqual(requestPoints[0]?.attributes, {
      "http.request.method": "GET",
      "http.route": "/users/:userId",
      "http.response.status_code": 503
    });
    const durations = getMetricPoints(exporter, "teamnest.http.request.duration");
    assert.ok(durations.length > 0);
    const duration = durations[0]?.value;
    assert.ok(typeof duration === "object" && duration !== null && "count" in duration);
    assert.equal(duration.count, 1);
    assert.deepEqual(getHistogramBoundaries(duration), [
      0.0005, 0.001, 0.0025, 0.005, 0.0075, 0.01, 0.025, 0.05, 0.075, 0.1,
      0.25, 0.5, 0.75, 1, 2.5,
      2.75, 3, 3.25, 3.5, 3.75, 4, 4.25, 4.5, 4.75, 5,
      7.5, 10, 15, 30, 60
    ]);
  } finally {
    await provider.shutdown();
  }
});
