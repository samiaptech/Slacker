import test from "node:test";
import assert from "node:assert/strict";
import { getOtlpSignalUrl, parseOtlpHeaders } from "../headers.js";

void test("parses percent-encoded Grafana authorization headers including base64 padding", () => {
  assert.deepEqual(parseOtlpHeaders("Authorization=Basic%20YWJjZA%3D%3D"), {
    Authorization: "Basic YWJjZA=="
  });
});

void test("rejects malformed, empty, and line-break-injected OTLP headers", () => {
  assert.throws(() => parseOtlpHeaders("Authorization"));
  assert.throws(() => parseOtlpHeaders("=empty-name"));
  assert.throws(() => parseOtlpHeaders("Authorization=bad%0d%0aInjected%3A%20yes"));
});

void test("adds the signal path to the configured Grafana OTLP base endpoint", () => {
  assert.equal(
    getOtlpSignalUrl("https://otlp-gateway.example.net/otlp/"),
    "https://otlp-gateway.example.net/otlp/v1/metrics"
  );
  assert.equal(
    getOtlpSignalUrl("https://otlp-gateway.example.net/otlp"),
    "https://otlp-gateway.example.net/otlp/v1/metrics"
  );
});
