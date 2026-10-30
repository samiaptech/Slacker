# TeamNest --- Grafana Dashboard Visualization Requirements

**Document purpose:** Define what TeamNest should visualize in Grafana,
which metrics should be collected, how dashboards should be organized,
and what implementation considerations matter.

**Project:** TeamNest --- a team collaboration and workspace platform\
**Application:** https://slacker-qdqs.vercel.app/\
**Core capabilities:** Workspaces, workspace roles, invitations,
channels, group conversations, direct messages, threaded replies, and
real-time communication using Socket.IO.

------------------------------------------------------------------------

## 1. Objectives

Grafana should provide a clear operational view of TeamNest so the team
can answer:

1.  Is the application available and healthy?
2.  Are APIs responding quickly and reliably?
3.  Are Socket.IO connections stable?
4.  Are real-time events being processed and acknowledged correctly?
5.  Are workspace, channel, invitation, and messaging workflows
    succeeding?
6.  Is MongoDB healthy and performing well?
7.  Are errors, resource constraints, or unusual traffic patterns
    developing?

The dashboards must show actual collected telemetry. Do not display
invented, hard-coded, or simulated production values.

## 2. Recommended observability architecture

Use the following logical flow:

``` text
TeamNest application
  ├── HTTP/API instrumentation
  ├── Socket.IO instrumentation
  ├── Business-event instrumentation
  ├── MongoDB/client instrumentation
  └── Logs and distributed traces
          |
          v
  OpenTelemetry SDK / Prometheus client
          |
          v
  Telemetry collection and storage
  ├── Prometheus-compatible metrics backend
  ├── Loki (logs, optional)
  └── Tempo (traces, optional)
          |
          v
       Grafana
  ├── Dashboards
  ├── Alert rules
  └── Notifications
```

### Recommended tools

  -----------------------------------------------------------------------
  Tool                                Responsibility
  ----------------------------------- -----------------------------------
  Grafana                             Dashboards, exploration, alerting

  Prometheus-compatible backend       Store and query metrics

  `prom-client`                       Expose application metrics in
                                      Prometheus format, where
                                      appropriate

  OpenTelemetry                       Instrumentation and export of
                                      metrics and traces

  Loki                                Centralized application logs

  Tempo                               Distributed traces

  MongoDB monitoring/exporter         Database and deployment-level
                                      metrics
  -----------------------------------------------------------------------

Start with metrics and the core dashboards. Add centralized logs and
distributed tracing after the initial metrics pipeline is reliable.

## 3. Dashboard organization

Create a Grafana folder named **TeamNest Production Monitoring**.

Create these dashboards:

1.  Application Overview
2.  API Performance
3.  Socket.IO & Real-Time Operations
4.  Workspace & Product Activity
5.  Messaging & Conversation Activity
6.  MongoDB & Data Layer
7.  Errors, Reliability & Alerts
8.  Infrastructure & Runtime

The following sections define the panels and metrics for each dashboard.

------------------------------------------------------------------------

# 4. Dashboard 01 --- Application Overview

**Purpose:** Give an at-a-glance view of TeamNest's current operational
health.

### Panels

  -----------------------------------------------------------------------------------------------
  Panel                   What to visualize       Suggested metric
  ----------------------- ----------------------- -----------------------------------------------
  Application             Whether health checks   `teamnest_healthcheck_success`
  availability            succeed

  HTTP request rate       Incoming requests per   `rate(teamnest_http_requests_total[5m])`
                          second

  HTTP error rate         Percentage of requests  Derived from HTTP request counters
                          returning 5xx

  API P95 latency         95th-percentile request HTTP duration histogram
                          duration

  Active Socket.IO        Currently connected     `teamnest_socket_connections_active`
  connections             clients

  Messages processed      Messages processed per  `rate(teamnest_messages_processed_total[5m])`
                          second

  Database availability   Whether the database is `teamnest_mongodb_up`
                          reachable

  Process uptime          Application process     `process_uptime_seconds`
                          uptime
  -----------------------------------------------------------------------------------------------

### Suggested layout

-   Top row: availability, request rate, error rate, active sockets.
-   Middle row: P95 latency, message processing rate.
-   Bottom row: database health and runtime health.

### Questions this dashboard should answer

-   Is TeamNest healthy right now?
-   Has the error rate increased?
-   Are APIs becoming slower?
-   Are real-time connections dropping?
-   Is the database available?

------------------------------------------------------------------------

# 5. Dashboard 02 --- API Performance

**Purpose:** Monitor every HTTP API without creating a separate
dashboard for every endpoint.

### Panels

  Panel                          What to visualize
  ------------------------------ --------------------------------------------------
  Total requests                 Total HTTP requests over the selected time range
  Requests per second            Request throughput over time
  Requests by route              Traffic grouped by normalized route
  Requests by method             GET, POST, PATCH, DELETE, etc.
  Response status distribution   2xx, 3xx, 4xx, and 5xx responses
  Error rate                     4xx and 5xx rates, displayed separately
  Average latency                Average API response duration
  P50 latency                    Median API response duration
  P95 latency                    95th-percentile API response duration
  P99 latency                    99th-percentile API response duration
  Slowest routes                 Routes with the highest latency
  Failed requests by route       Routes producing the most errors

### API route groups to monitor

Use the actual route names in the TeamNest codebase. Group them by
feature:

  Feature               Example operations
  --------------------- --------------------------------------------
  Authentication        Sign-in, sign-out, session refresh
  Workspaces            Create, read, update, archive
  Members               List, add, remove, update role
  Invitations           Create, resend, accept, revoke
  Channels              Create, list, update, archive, join
  Group conversations   Create, read, update membership
  Direct messages       Open conversation, send and fetch messages
  Messages              Send, edit, delete, fetch history
  Threads               Create reply, fetch replies

### Important implementation notes

-   Use a common HTTP instrumentation middleware.
-   Record method, normalized route template, and status code.
-   Do not use raw URLs containing IDs as metric labels.
-   Do not use user IDs, email addresses, message IDs, or workspace IDs
    as Prometheus labels.
-   Record request duration with a histogram so percentiles can be
    calculated.
-   Exclude or separately classify health-check and metrics endpoints if
    they distort application traffic measurements.

------------------------------------------------------------------------

# 6. Dashboard 03 --- Socket.IO & Real-Time Operations

**Purpose:** Understand the health, scale, and reliability of TeamNest's
real-time communication layer.

### Connection panels

  -----------------------------------------------------------------------------------------------
  Panel                   What to visualize       Suggested metric
  ----------------------- ----------------------- -----------------------------------------------
  Active connections      Current connected       `teamnest_socket_connections_active`
                          sockets

  Connection rate         New connections per     `teamnest_socket_connections_total`
                          second

  Disconnection rate      Disconnections per      `teamnest_socket_disconnections_total`
                          second

  Connection outcomes     Successful and failed   `teamnest_socket_connection_attempts_total`
                          connection attempts

  Reconnection activity   Reconnection attempts,  `teamnest_socket_reconnections_total`
                          if tracked by the
                          application

  Connection duration     Distribution of socket  `teamnest_socket_connection_duration_seconds`
                          connection lifetimes
  -----------------------------------------------------------------------------------------------

### Event panels

  ------------------------------------------------------------------------------------------
  Panel                   What to visualize       Suggested metric
  ----------------------- ----------------------- ------------------------------------------
  Incoming events         Events received per     `teamnest_socket_events_received_total`
                          second

  Outgoing events         Events emitted per      `teamnest_socket_events_emitted_total`
                          second

  Event processing        Time spent processing   `teamnest_socket_event_duration_seconds`
  duration                an event

  Event failures          Failed event handlers   `teamnest_socket_event_failures_total`
                          or operations

  Acknowledgement rate    Events acknowledged by  `teamnest_socket_acknowledgements_total`
                          clients, where
                          acknowledgements are
                          implemented

  Acknowledgement latency Time from event         `teamnest_socket_ack_duration_seconds`
                          emission to
                          acknowledgement

  Active rooms            Number of active        `teamnest_socket_rooms_active`
                          Socket.IO rooms, if
                          reliably measurable
  ------------------------------------------------------------------------------------------

### Event categories

Instrument the real event names in the codebase and group them into
bounded categories, such as:

-   Workspace membership events
-   Channel join/leave events
-   Channel message events
-   Group conversation events
-   Direct-message events
-   Thread reply events
-   Typing indicator events
-   Presence events, if implemented

Do not assume these exact event names exist. Inspect the actual
Socket.IO event contracts first.

### Critical delivery distinction

An event being emitted by the server does not prove that every recipient
received, processed, or read it.

If delivery guarantees matter, implement explicit acknowledgement or
application-level delivery tracking. Visualize each stage separately
where supported:

1.  Message accepted by the API.
2.  Message persisted successfully.
3.  Socket event emitted.
4.  Recipient acknowledgement received.
5.  Message read, only if read receipts are implemented.

Do not label an emitted event as a delivered or read message.

### Socket.IO operational considerations

-   Track active connections using correct connect/disconnect lifecycle
    handling.
-   Instrument outgoing events at the application's event-publishing
    boundary.
-   Track handler failures and processing duration.
-   Avoid high-cardinality labels such as socket ID, user ID, room ID,
    or workspace ID.
-   If Socket.IO runs across multiple instances, use an appropriate
    shared adapter and aggregate metrics across instances.
-   Monitor reconnect spikes and abnormal connection churn.

------------------------------------------------------------------------

# 7. Dashboard 04 --- Workspace & Product Activity

**Purpose:** Understand how workspace-related features are being used
and whether their core workflows succeed.

These are business/product metrics, not infrastructure metrics.

### Panels

  ----------------------------------------------------------------------------------------------
  Panel                   What to visualize       Suggested metric
  ----------------------- ----------------------- ----------------------------------------------
  Workspaces created      Successful workspace    `teamnest_workspaces_created_total`
                          creation count

  Workspace creation      Failed workspace        `teamnest_workspace_creation_failures_total`
  failures                creation operations

  Active workspaces       Workspaces active in a  Derived from a clearly defined activity source
                          defined time window

  Members added           Successful member       `teamnest_members_added_total`
                          additions

  Member removals         Successful member       `teamnest_members_removed_total`
                          removals

  Invitations created     Invitations             `teamnest_invitations_created_total`
                          successfully created

  Invitations accepted    Invitations             `teamnest_invitations_accepted_total`
                          successfully accepted

  Invitation failures     Failed invitation       `teamnest_invitation_failures_total`
                          operations

  Invitation acceptance   Accepted invitations    Derived metric
  rate                    divided by eligible
                          invitations

  Channels created        Successful channel      `teamnest_channels_created_total`
                          creation count

  Channel operations      Successful and failed   Feature operation counters
                          channel operations
  ----------------------------------------------------------------------------------------------

### Definitions must be explicit

Before implementing these panels, define:

-   What qualifies as an active workspace?
-   What qualifies as an active member?
-   Which invitation states count as accepted, expired, revoked, or
    pending?
-   Does channel creation count only after database persistence
    succeeds?
-   Are archived workspaces included in totals?

Do not infer unique active users from a counter of requests. Use an
appropriate event or analytics data source for unique-user calculations.

------------------------------------------------------------------------

# 8. Dashboard 05 --- Messaging & Conversation Activity

**Purpose:** Monitor the messaging experience across channels, group
conversations, direct messages, and threads.

### Panels

  ------------------------------------------------------------------------------------------------
  Panel                   What to visualize       Suggested metric
  ----------------------- ----------------------- ------------------------------------------------
  Messages accepted       Messages accepted for   `teamnest_messages_accepted_total`
                          processing

  Messages persisted      Messages successfully   `teamnest_messages_persisted_total`
                          saved

  Messages rejected       Messages rejected by    `teamnest_messages_rejected_total`
                          validation or
                          authorization

  Message processing      Unexpected message      `teamnest_message_processing_failures_total`
  failures                processing failures

  Channel messages        Channel messages        `teamnest_channel_messages_total`
                          successfully persisted

  Group messages          Group conversation      `teamnest_group_messages_total`
                          messages persisted

  Direct messages         Direct messages         `teamnest_direct_messages_total`
                          successfully persisted

  Thread replies          Thread replies          `teamnest_thread_replies_total`
                          successfully persisted

  Message processing      Time to process and     `teamnest_message_processing_duration_seconds`
  latency                 persist a message

  Message volume          Messages per second or  Derived from message counters
                          minute
  ------------------------------------------------------------------------------------------------

### Suggested comparisons

-   Channel messages versus direct messages.
-   Group messages versus direct messages.
-   Thread replies over time.
-   Accepted messages versus persisted messages.
-   Message processing failures over time.

### Data correctness

Count a message as persisted only after the database operation succeeds.
If the application uses a queue or asynchronous processing, distinguish
accepted, queued, processed, and failed stages.

Do not collect message contents or private conversation data as metric
labels or log fields.

------------------------------------------------------------------------

# 9. Dashboard 06 --- MongoDB & Data Layer

**Purpose:** Identify database bottlenecks that affect API performance
and real-time workflows.

### Panels

  -----------------------------------------------------------------------
  Panel                               What to visualize
  ----------------------------------- -----------------------------------
  Database availability               Database connection and health
                                      status

  Active connections                  Current database connections

  Connection pool usage               Used and available pool connections

  Query operation rate                Reads and writes per second

  Query latency                       Query duration distribution

  Slow queries                        Slow operation count and samples
                                      from approved diagnostic logs

  Failed operations                   Failed database operations

  Timeout count                       Database operation timeouts

  Replication health                  Replica-set status and lag, where
                                      applicable

  Storage usage                       Database storage utilization

  Index performance                   Index usage and relevant index
                                      statistics
  -----------------------------------------------------------------------

Use MongoDB's supported monitoring facilities or an exporter/integration
appropriate to the MongoDB deployment. Application-level instrumentation
should separately measure the duration and outcome of important
repository/database operations.

Never expose database credentials or connection strings in Grafana.

------------------------------------------------------------------------

# 10. Dashboard 07 --- Errors, Reliability & Alerts

**Purpose:** Detect incidents early and help engineers investigate them.

### Panels

-   HTTP 5xx errors over time.
-   HTTP 4xx errors over time.
-   API failures grouped by normalized route.
-   Socket connection failures.
-   Socket event handler failures.
-   Message persistence failures.
-   Invitation workflow failures.
-   Database timeouts.
-   Unhandled exceptions.
-   Process restarts.
-   Alert history.

### Suggested alert rules

  -----------------------------------------------------------------------
  Alert                   Example condition       Severity
  ----------------------- ----------------------- -----------------------
  High API error rate     5xx rate exceeds 5% for Critical
                          5 minutes, with a
                          minimum traffic
                          threshold

  High API latency        P95 exceeds the agreed  Warning
                          SLO for 5 minutes

  Database unavailable    Health check fails for  Critical
                          1 minute

  Socket connection drop  Unexpected connection   Warning
                          drop rate exceeds
                          baseline

  Message processing      Failure rate exceeds    Critical
  failures                agreed threshold

  High event-loop delay   Delay exceeds the       Warning
                          agreed runtime
                          threshold

  High memory usage       Sustained memory usage  Warning
                          exceeds the service
                          limit
  -----------------------------------------------------------------------

These are starting examples, not universal production thresholds. Tune
them using observed traffic, service objectives, and alert-noise
testing.

Every alert should have:

-   A clear name.
-   A meaningful description.
-   A severity.
-   A threshold and evaluation window.
-   A notification destination.
-   A runbook or investigation instructions.
-   A recovery condition.

------------------------------------------------------------------------

# 11. Dashboard 08 --- Infrastructure & Runtime

**Purpose:** Monitor the resources and runtime behavior of the
application servers.

### Node.js panels

-   Process CPU usage.
-   Process memory usage.
-   Heap used and heap available.
-   Event-loop delay.
-   Garbage-collection activity and duration, where instrumented.
-   Process uptime.
-   Active handles/resources, where useful.

### Host/container panels

Where the deployment exposes these measurements:

-   CPU utilization.
-   Memory utilization.
-   Disk usage.
-   Network throughput.
-   Container restarts.
-   Instance count.
-   Instance health.

For serverless deployments, use the platform's available function
metrics and logs. Do not assume that host-level CPU, disk, or process
metrics are available from a serverless function.

------------------------------------------------------------------------

# 12. Metric naming and label conventions

Use a consistent metric namespace:

``` text
teamnest_<domain>_<measurement>_<unit>
```

Examples:

``` text
teamnest_http_requests_total
teamnest_http_request_duration_seconds
teamnest_socket_connections_active
teamnest_socket_events_received_total
teamnest_messages_persisted_total
teamnest_message_processing_duration_seconds
teamnest_invitations_accepted_total
```

### Safe, bounded labels

Examples:

-   `method`: GET, POST, PATCH, DELETE
-   `route`: normalized route template
-   `status_code`: 200, 400, 500
-   `feature`: workspace, channel, message, invitation
-   `operation`: create, update, delete, send
-   `outcome`: success, failure
-   `event_type`: a bounded, approved event category

### Avoid high-cardinality or sensitive labels

Never use these as ordinary Prometheus labels:

-   User ID
-   Email address
-   Workspace ID
-   Channel ID
-   Message ID
-   Socket ID
-   Raw URL or query string
-   Message content
-   Authentication token
-   Session ID

Use structured logs or traces with suitable access controls when
individual-request investigation is needed. Apply redaction and
retention policies.

------------------------------------------------------------------------

# 13. Vercel and Socket.IO deployment considerations

TeamNest's public website is hosted at:

https://slacker-qdqs.vercel.app/

Before selecting the production metrics collection method, inspect the
actual deployment topology.

Confirm:

1.  Where the Express/API backend runs.
2.  Where the Socket.IO server runs.
3.  Whether APIs execute as Vercel Functions or on a persistent Node.js
    server.
4.  Whether Socket.IO runs on the same server or a separate service.
5.  Whether there are multiple application instances.
6.  Which metrics and telemetry export methods are supported by the
    hosting environment.

### If the backend is serverless

-   Do not assume an in-memory metrics registry is globally shared.
-   Do not assume a Prometheus scraper can reliably scrape every
    ephemeral function instance.
-   Prefer a supported telemetry export path, such as OpenTelemetry to a
    collector or managed telemetry backend.
-   Use platform-provided function metrics where available.
-   Avoid relying on process-local counters for durable business totals.

### If the backend is a persistent Node.js service

-   A Prometheus scrape endpoint can be appropriate.
-   Configure Prometheus to scrape the service.
-   Aggregate metrics across instances.
-   Secure the metrics endpoint.
-   Use a shared Socket.IO adapter when multi-instance communication
    requires it.

### If Socket.IO runs separately

Instrument the Socket.IO service independently and identify it with a
bounded service label, such as:

``` text
service="teamnest-socket"
```

Do not assume that the website's Vercel deployment and the Socket.IO
service have the same runtime or scaling behavior.

------------------------------------------------------------------------

# 14. Refresh intervals and dashboard behavior

Suggested starting configuration:

  -----------------------------------------------------------------------
  Setting                             Starting value
  ----------------------------------- -----------------------------------
  Metrics collection interval         10--15 seconds, if supported by the
                                      backend

  Grafana dashboard refresh           10--30 seconds

  API latency window                  5 minutes

  Error-rate window                   5 minutes

  Long-term activity view             24 hours / 7 days / 30 days

  Alert evaluation                    Based on severity and metric
                                      stability
  -----------------------------------------------------------------------

A dashboard refreshing every 10 seconds does not mean the underlying
metrics are instantaneous. Collection interval, export delay, backend
ingestion, and query windows all affect freshness.

------------------------------------------------------------------------

# 15. Implementation acceptance criteria

The observability implementation is complete only when the following
conditions are satisfied.

## Instrumentation

-   [ ] A centralized observability module exists.
-   [ ] HTTP request count and duration are recorded.
-   [ ] HTTP metrics use normalized route labels.
-   [ ] Socket.IO connection and disconnection metrics are recorded.
-   [ ] Incoming and outgoing Socket.IO events are measured.
-   [ ] Socket event processing failures are measured.
-   [ ] Message accepted and message persisted stages are
    distinguishable.
-   [ ] Workspace, invitation, channel, and conversation business events
    are measured.
-   [ ] Database health and important operation performance are
    measured.
-   [ ] Sensitive data and unbounded identifiers are excluded from
    metric labels.

## Collection and storage

-   [ ] The selected metrics backend receives TeamNest metrics.
-   [ ] Metrics remain available across application instances as
    required.
-   [ ] The collection method is compatible with the actual hosting
    runtime.
-   [ ] Metrics endpoints and telemetry credentials are secured.
-   [ ] Missing telemetry is visible rather than silently represented as
    zero.

## Grafana

-   [ ] All required dashboards are created.
-   [ ] Panels use real TeamNest telemetry.
-   [ ] Dashboard time ranges and refresh intervals are configured.
-   [ ] API latency percentiles are displayed correctly.
-   [ ] Socket connection and event activity are visible.
-   [ ] Business activity metrics have documented definitions.
-   [ ] Database and runtime health are visible where supported.
-   [ ] Alert rules are tested.
-   [ ] Dashboard permissions are appropriate.

## Validation

-   [ ] A test API request increments the expected request counter.
-   [ ] A deliberately failing test request increments the appropriate
    error metric.
-   [ ] A Socket.IO connection increases the active connection gauge.
-   [ ] Disconnecting the test socket decreases the gauge.
-   [ ] A test message increments the correct accepted/persisted
    metrics.
-   [ ] A failed message operation increments the failure metric.
-   [ ] Grafana displays the changes within the expected collection
    delay.
-   [ ] Metrics are checked across multiple instances if the deployment
    uses them.

------------------------------------------------------------------------

# 16. Recommended implementation priority

Do not attempt to build every dashboard in one implementation pass.

  -----------------------------------------------------------------------
  Priority                Work                    Expected outcome
  ----------------------- ----------------------- -----------------------
  P0                      Inspect deployment and  Correct telemetry
                          runtime topology        architecture

  P0                      Build centralized       Consistent
                          observability module    instrumentation

  P0                      HTTP API metrics        API performance
                                                  visibility

  P0                      Socket.IO metrics       Real-time connection
                                                  and event visibility

  P1                      Message and business    Product activity
                          workflow metrics        visibility

  P1                      MongoDB monitoring      Database health
                                                  visibility

  P1                      Application Overview    Unified operational
                          dashboard               view

  P1                      API and Real-Time       Detailed service
                          dashboards              monitoring

  P2                      Logs and distributed    Deeper incident
                          traces                  investigation

  P2                      Advanced alerts and     Proactive reliability
                          SLOs                    management
  -----------------------------------------------------------------------

## 17. Instructions for the implementation agent

When implementing this specification:

1.  Inspect the existing TeamNest repository before changing code.
2.  Identify the actual API routes, Socket.IO event contracts, database
    repositories, deployment configuration, and runtime topology.
3.  Do not invent routes, events, services, or metric values.
4.  Preserve existing module boundaries and low-coupling architecture.
5.  Keep observability infrastructure independent from business logic.
6.  Use a shared instrumentation interface rather than importing
    monitoring internals into every feature.
7.  Avoid duplicate instrumentation and double-counting.
8.  Ensure metric labels are bounded and contain no personal or
    confidential data.
9.  Do not log message bodies, authentication tokens, session secrets,
    or private conversation content.
10. Make telemetry export failures non-fatal to normal application
    requests, while ensuring those failures remain observable through an
    appropriate fallback.
11. Do not claim that a message was delivered or read unless the
    application has implemented and verified that stage.
12. Do not expose unauthenticated metrics endpoints to the public
    internet.
13. Add automated tests for metric increments, durations, error cases,
    and Socket.IO lifecycle behavior.
14. Document metric definitions, units, labels, and dashboard queries.
15. Validate the finished dashboards against real test traffic before
    marking the work complete.

## 18. Final expected result

The completed Grafana setup should let the TeamNest engineering team
understand, from one monitoring environment:

-   Whether TeamNest is available.
-   Whether APIs are fast and reliable.
-   How many Socket.IO clients are connected.
-   Whether real-time events are being processed and acknowledged.
-   How workspace, invitation, channel, group, DM, and thread workflows
    are performing.
-   Whether messages are accepted and persisted successfully.
-   Whether MongoDB is healthy.
-   Whether runtime resources are under pressure.
-   Which failures require investigation.

**Core principle:** Grafana visualizes telemetry; TeamNest must generate
accurate telemetry first. The dashboards are only trustworthy when every
metric has a clear definition, a correct instrumentation point, and a
tested collection path.
