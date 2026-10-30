import test from "node:test";
import assert from "node:assert/strict";
import {
  AggregationTemporality,
  InMemoryMetricExporter,
  MeterProvider,
  PeriodicExportingMetricReader
} from "@opentelemetry/sdk-metrics";
import type { Attributes } from "@opentelemetry/api";
import { createSocketIoTelemetry, getSocketEventCategory } from "../socket-telemetry.js";

type TestMetricPoint = Readonly<{ attributes: Attributes; value: unknown }>;

void test("maps actual realtime event names to a bounded category set", () => {
  assert.equal(getSocketEventCategory("channel:thread:reply:new"), "thread");
  assert.equal(getSocketEventCategory("channel:message:new"), "message");
  assert.equal(getSocketEventCategory("direct-message:updated"), "direct_message");
  assert.equal(getSocketEventCategory("workspace:presence:changed"), "presence");
  assert.equal(getSocketEventCategory("channel:typing"), "typing");
  assert.equal(getSocketEventCategory("channel:subscribe"), "channel");
  assert.equal(getSocketEventCategory("workspace:subscribe"), "workspace");
  assert.equal(getSocketEventCategory("notification:new"), "notification");
  assert.equal(getSocketEventCategory("realtime:error"), "error");
  assert.equal(getSocketEventCategory("unrecognized:identifier"), "other");
});

void test("records socket lifecycle, categorized events, and unexpected failures", async () => {
  const exporter = new InMemoryMetricExporter(AggregationTemporality.CUMULATIVE);
  const provider = new MeterProvider({
    readers: [new PeriodicExportingMetricReader({ exporter, exportIntervalMillis: 60_000 })]
  });
  const telemetry = createSocketIoTelemetry(provider.getMeter("socket-test"));
  telemetry.recordConnectionAttempt("failure");
  telemetry.recordConnectionOpened();
  telemetry.recordEvent("received", "channel:subscribe");
  telemetry.recordEvent("emitted", "channel:thread:reply:new");
  telemetry.recordEventFailure("channel:subscribe");
  await provider.forceFlush();

  const getPoints = (name: string): TestMetricPoint[] => {
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
  assert.equal(getPoints("teamnest.socket.connections.active")[0]?.value, 1);
  assert.equal(getPoints("teamnest.socket.connections")[0]?.value, 1);
  assert.equal(getPoints("teamnest.socket.connection.attempts")[0]?.attributes.outcome, "failure");
  assert.equal(getPoints("teamnest.socket.events.received")[0]?.attributes.event_category, "channel");
  assert.equal(getPoints("teamnest.socket.events.emitted")[0]?.attributes.event_category, "thread");
  assert.equal(getPoints("teamnest.socket.event.failures")[0]?.attributes.event_category, "channel");

  telemetry.recordConnectionClosed(1.25);
  await provider.forceFlush();
  assert.equal(getPoints("teamnest.socket.connections.active").slice(-1)[0]?.value, 0);
  assert.equal(getPoints("teamnest.socket.disconnections")[0]?.value, 1);
  const connectionDurations = getPoints("teamnest.socket.connection.duration");
  assert.ok(connectionDurations.length > 0);
  const duration = connectionDurations[0]?.value;
  assert.ok(typeof duration === "object" && duration !== null && "count" in duration);
  assert.equal(duration.count, 1);
  assert.ok("sum" in duration);
  assert.equal(duration.sum, 1.25);
  await provider.shutdown();
});
