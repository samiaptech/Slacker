# Operational Observability

The API exports OpenTelemetry metrics to Grafana Cloud over OTLP/HTTP. Export is disabled
unless both `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS` are configured.
`OTEL_SERVICE_NAME` optionally names the service and defaults to `teamnest-api`.

## Grafana Cloud setup

1. Create or open a Grafana Cloud stack, create the **TeamNest Production Monitoring**
   folder, and use its OpenTelemetry/OTLP connection setup to obtain the OTLP base endpoint
   and authorization header.
2. Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the OTLP base URL, typically ending in `/otlp`.
   Set `OTEL_EXPORTER_OTLP_HEADERS` to its comma-separated `key=value` header string.
   URL-encode spaces and other special characters in header values. The API appends
   `/v1/metrics`.
3. Configure both values as deployment secrets/environment variables (for example, in
   Vercel Production and Preview). Do not commit credentials or paste them into source files.
4. Set `OTEL_SERVICE_NAME=teamnest-api`, redeploy, and check Grafana Cloud Explore for
   metrics. Production endpoints must use HTTPS.
5. Import [api-overview.json](./grafana/api-overview.json) and select the Prometheus-
   compatible metrics datasource when prompted.

## Current instrumentation

HTTP counters and duration histograms record method, normalized Express route template, and
response status. Unknown routes use the fixed `unmatched` value. Socket.IO instrumentation
records namespace connection outcomes, active connections, connection duration, client
events received, per-client server event emission attempts, and unexpected handler failures.
Event labels use bounded categories based on the actual realtime contract. Emitted events do
not prove client receipt, acknowledgement, or reading.

| Metric | Unit | Bounded attributes |
| --- | --- | --- |
| `teamnest.http.requests` | `{request}` | `http.request.method`, `http.route`, `http.response.status_code` |
| `teamnest.http.request.duration` | seconds | Same HTTP attributes; histogram |
| `teamnest.socket.connection.attempts` | `{attempt}` | `outcome=success\|failure` |
| `teamnest.socket.connections` | `{connection}` | None |
| `teamnest.socket.disconnections` | `{disconnection}` | None |
| `teamnest.socket.connections.active` | `{connection}` | Observable per-instance gauge |
| `teamnest.socket.connection.duration` | seconds | Histogram |
| `teamnest.socket.events.received` | `{event}` | `event_category` |
| `teamnest.socket.events.emitted` | `{event}` | `event_category` |
| `teamnest.socket.event.failures` | `{failure}` | `event_category` |

Metrics do not include raw URLs, query strings, request headers/bodies, message contents,
user/workspace/channel/message IDs, socket IDs, or client IPs. Each API process gets a
distinct OpenTelemetry `service.instance.id` resource attribute so Grafana can aggregate
across serverless instances without merging their cumulative counters.

The API exports every 15 seconds. Export errors are logged and do not block normal HTTP or
Socket.IO operations. OTLP export is opt-in and uses the same validated endpoint/header pair.
The existing application logs are not exported. Workspace/business activity, message
processing stages, MongoDB health/latency, and host/runtime metrics are not instrumented yet;
the dashboard intentionally does not display placeholder values for them.

HTTP request duration is measured in seconds and uses explicit histogram boundaries from
0.5 ms through 60 seconds, with 250 ms increments from 2.5 through 5 seconds. The boundaries
are configured in the API's OpenTelemetry view; they intentionally do not use the SDK's
default numeric boundaries, which would make the first bucket five seconds wide for a
seconds-valued instrument.

The dashboard derives request throughput and 4xx/5xx rates from the HTTP counter. Its
latency panel derives p90, p95, and p99 separately for each normalized HTTP route from the
duration histogram. A companion panel shows the request count by route for the selected
dashboard range to make low-sample percentiles easier to recognize. Socket panels show active connections,
success/failure connection attempt rate, bounded incoming/outgoing event-category rates, and
unexpected handler-failure rates. No acknowledgement or delivery metric is shown because the
current realtime contract does not implement client delivery acknowledgements.

## Deployment constraints and scope

The current deployment packages Express and Socket.IO in the API's Vercel function entry
point. Socket.IO uses a MongoDB adapter for cross-instance broadcasts. A process-local
active-connection gauge is exported with an instance resource identity and must be summed
across instances in Grafana. Vercel may freeze or terminate instances before a periodic
export, so direct OTLP is a quickstart, not a durable delivery guarantee. Validate telemetry
in the deployed Grafana stack before relying on alerts or business totals. For a more
reliable pipeline, place Grafana Alloy or another OpenTelemetry Collector between the API
and Grafana Cloud.

This is the initial metrics phase. Product/business instrumentation and MongoDB monitoring
come next; centralized logs, distributed traces, and advanced alerts remain later phases.
Grafana Cloud plan/trial limits and retention apply.

Provider-specific telemetry transport belongs to
`servers/api/integrations/opentelemetry/`; deployment setup and dashboards belong here.
