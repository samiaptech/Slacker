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
import { createApiHttpTelemetryMiddleware, getApiHttpAttributes } from "../http-telemetry.js";

type TestMetricPoint = Readonly<{ attributes: Attributes; value: unknown }>;

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
  } finally {
    await provider.shutdown();
  }
});
