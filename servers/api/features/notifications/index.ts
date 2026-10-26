export {
  NOTIFICATIONS_COLLECTION,
  NOTIFICATIONS_COLLECTION_VALIDATOR,
  NOTIFICATIONS_INDEXES
} from "./model.js";
export type {
  NotificationDocument,
  NotificationRecord,
  NotificationResource,
  NotificationType
} from "./model.js";
export { createMongoNotificationStorage } from "./mongo-storage.js";
export { createNotificationService, isNotificationStorageUnavailable } from "./service.js";
export { createNotificationRealtime } from "./realtime.js";
export type { NotificationRealtimePublisher, NotificationService } from "./service.js";
export { createNotificationRoutes } from "./routes.js";
