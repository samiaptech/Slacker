export type MessageSearchTarget = Readonly<{
  type: "channel" | "direct";
  conversationId: string;
  messageId: string;
  threadRootId?: string;
}>;

export const MESSAGE_SEARCH_TARGET_EVENT = "nutshyll:message-search-target";
const STORAGE_KEY = "nutshyll.pending-message-search-target";
let pendingTarget: MessageSearchTarget | null = null;

export const notifyMessageSearchTarget = (): void => {
  window.dispatchEvent(new Event(MESSAGE_SEARCH_TARGET_EVENT));
};

export const parseMessageSearchTarget = (value: string | null): MessageSearchTarget | null => {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null) return null;
    const target = parsed as Record<string, unknown>;
    if ((target.type !== "channel" && target.type !== "direct")
      || typeof target.conversationId !== "string" || !target.conversationId
      || typeof target.messageId !== "string" || !target.messageId) return null;
    const threadRootId = typeof target.threadRootId === "string" && target.threadRootId
      ? target.threadRootId
      : undefined;
    return Object.freeze({
      type: target.type,
      conversationId: target.conversationId,
      messageId: target.messageId,
      ...(threadRootId ? { threadRootId } : {})
    });
  } catch {
    return null;
  }
};

export const saveMessageSearchTarget = (target: MessageSearchTarget): void => {
  pendingTarget = Object.freeze({ ...target });
  try {
    window.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(target));
  } catch {
    // In-memory navigation still works when browser storage is unavailable.
  }
  notifyMessageSearchTarget();
};

export const takeMessageSearchTarget = (
  type: MessageSearchTarget["type"],
  conversationId: string
): MessageSearchTarget | null => {
  let storedTarget: MessageSearchTarget | null = null;
  try {
    storedTarget = parseMessageSearchTarget(window.sessionStorage?.getItem(STORAGE_KEY) ?? null);
  } catch {
    // The in-memory target remains available if browser storage is unavailable.
  }
  const target = pendingTarget ?? storedTarget;
  if (!target || target.type !== type || target.conversationId !== conversationId) return null;
  pendingTarget = null;
  try {
    window.sessionStorage?.removeItem(STORAGE_KEY);
  } catch {
    // Removing persisted state is best-effort; the in-memory target is consumed.
  }
  return target;
};
