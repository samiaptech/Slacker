import type { Meter } from "@opentelemetry/api";
import type { SocketIoTelemetry } from "../socket-io/index.js";

type SocketEventDirection = "received" | "emitted";
type ConnectionOutcome = "success" | "failure";

export const getSocketEventCategory = (eventName: string): string => {
  if (eventName.endsWith(":typing")) return "typing";
  if (eventName.startsWith("channel:thread:")) return "thread";
  if (eventName.startsWith("channel:message:")) return "message";
  if (eventName.startsWith("direct-message:")) return "direct_message";
  if (eventName.startsWith("workspace:presence:")) return "presence";
  if (eventName.startsWith("workspace:")) return "workspace";
  if (eventName.startsWith("channel:")) return "channel";
  if (eventName.startsWith("notification:")) return "notification";
  if (eventName === "realtime:error") return "error";
  return "other";
};

export const createSocketIoTelemetry = (meter: Meter): SocketIoTelemetry => {
  let activeConnections = 0;
  const connectionAttempts = meter.createCounter("teamnest.socket.connection.attempts", {
    unit: "{attempt}",
    description: "Authenticated Socket.IO namespace connection outcomes"
  });
  const connections = meter.createCounter("teamnest.socket.connections", {
    unit: "{connection}",
    description: "Authenticated Socket.IO connections opened"
  });
  const disconnections = meter.createCounter("teamnest.socket.disconnections", {
    unit: "{disconnection}",
    description: "Authenticated Socket.IO connections closed"
  });
  const active = meter.createObservableGauge("teamnest.socket.connections.active", {
    unit: "{connection}",
    description: "Currently active authenticated Socket.IO connections"
  });
  const connectionDuration = meter.createHistogram("teamnest.socket.connection.duration", {
    unit: "s",
    description: "Duration of authenticated Socket.IO connections"
  });
  const receivedEvents = meter.createCounter("teamnest.socket.events.received", {
    unit: "{event}",
    description: "Socket.IO events received from clients"
  });
  const emittedEvents = meter.createCounter("teamnest.socket.events.emitted", {
    unit: "{event}",
    description: "Socket.IO per-client event emission attempts"
  });
  const eventFailures = meter.createCounter("teamnest.socket.event.failures", {
    unit: "{failure}",
    description: "Socket.IO event handlers that failed unexpectedly"
  });
  active.addCallback((result) => {
    result.observe(activeConnections);
  });

  return Object.freeze({
    recordConnectionAttempt: (outcome: ConnectionOutcome) => {
      connectionAttempts.add(1, { outcome });
    },
    recordConnectionOpened: () => {
      activeConnections += 1;
      connections.add(1);
    },
    recordConnectionClosed: (durationSeconds: number) => {
      activeConnections = Math.max(0, activeConnections - 1);
      disconnections.add(1);
      connectionDuration.record(durationSeconds);
    },
    recordEvent: (direction: SocketEventDirection, eventName: string) => {
      const attributes = { event_category: getSocketEventCategory(eventName) };
      if (direction === "received") {
        receivedEvents.add(1, attributes);
      } else {
        emittedEvents.add(1, attributes);
      }
    },
    recordEventFailure: (eventName: string) => {
      eventFailures.add(1, { event_category: getSocketEventCategory(eventName) });
    }
  });
};
