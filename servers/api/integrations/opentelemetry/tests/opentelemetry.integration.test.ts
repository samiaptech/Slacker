import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import express from "express";
import type { Logger } from "@workspace/logging";
import { createOpenTelemetryIntegration } from "../opentelemetry.integration.js";

const createTestLogger = (errors: Record<string, unknown>[]): Logger => ({
  info: () => undefined,
  warn: () => undefined,
  error: (_message, context) => {
    if (context) errors.push(context);
  }
});

void test("exports HTTP and Socket.IO metrics, but no traces, over authenticated OTLP/HTTP", async () => {
  const exports: Readonly<{ path: string; authorization: string | undefined; bytes: number }>[] = [];
  const receiver = createHttpServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      exports.push({
        path: request.url ?? "",
        authorization: request.headers.authorization,
        bytes: chunks.reduce((total, chunk) => total + chunk.length, 0)
      });
      response.writeHead(200).end();
    });
  });
  receiver.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => receiver.once("listening", resolve));
  const receiverAddress = receiver.address();
  assert.ok(receiverAddress && typeof receiverAddress === "object");

  const loggerErrors: Record<string, unknown>[] = [];
  const telemetry = createOpenTelemetryIntegration({
    endpoint: `http://127.0.0.1:${String(receiverAddress.port)}/otlp`,
    headers: "Authorization=Bearer%20test-token",
    serviceName: "test-api"
  }, createTestLogger(loggerErrors));
  const app = express();
  if (!telemetry.middleware) throw new Error("Configured telemetry middleware is missing.");
  app.use(telemetry.middleware);
  app.get("/health", (_request, response) => response.json({ ok: true }));
  app.get("/failure", (_request, response) => response.sendStatus(503));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress === "object");

  try {
    assert.equal((await fetch(`http://127.0.0.1:${String(serverAddress.port)}/health?private=value`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${String(serverAddress.port)}/failure`)).status, 503);
    telemetry.socketIo.recordConnectionAttempt("failure");
    telemetry.socketIo.recordConnectionOpened();
    telemetry.socketIo.recordEvent("received", "channel:subscribe");
    telemetry.socketIo.recordEvent("emitted", "channel:message:new");
    telemetry.socketIo.recordEventFailure("channel:subscribe");
    telemetry.socketIo.recordConnectionClosed(2.5);
    await telemetry.shutdown();

    assert.deepEqual(exports.map(({ path }) => path), ["/otlp/v1/metrics"]);
    const firstExport = exports[0];
    assert.ok(firstExport);
    assert.ok(firstExport.bytes > 0);
    assert.equal(firstExport.authorization, "Bearer test-token");
    assert.deepEqual(loggerErrors, []);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});

void test("logs OTLP export failures without failing HTTP requests", async () => {
  const receiver = createHttpServer((_request, response) => {
    response.writeHead(503).end();
  });
  receiver.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => receiver.once("listening", resolve));
  const receiverAddress = receiver.address();
  assert.ok(receiverAddress && typeof receiverAddress === "object");

  const loggerErrors: Record<string, unknown>[] = [];
  const telemetry = createOpenTelemetryIntegration({
    endpoint: `http://127.0.0.1:${String(receiverAddress.port)}/otlp`,
    headers: "Authorization=Bearer%20test-token",
    serviceName: "test-api"
  }, createTestLogger(loggerErrors));
  const app = express();
  if (!telemetry.middleware) throw new Error("Configured telemetry middleware is missing.");
  app.use(telemetry.middleware);
  app.get("/health", (_request, response) => response.sendStatus(200));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const serverAddress = server.address();
  assert.ok(serverAddress && typeof serverAddress === "object");

  try {
    assert.equal((await fetch(`http://127.0.0.1:${String(serverAddress.port)}/health`)).status, 200);
    await telemetry.shutdown();
    assert.ok(loggerErrors.some(({ code }) => code !== undefined));
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    await new Promise<void>((resolve, reject) => {
      receiver.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }
});
