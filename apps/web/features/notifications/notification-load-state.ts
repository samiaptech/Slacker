export const shouldApplyNotificationLoad = (
  requestId: number,
  latestRequestId: number,
  requestRevision: number,
  currentRevision: number
): boolean => requestId === latestRequestId && requestRevision === currentRevision;
