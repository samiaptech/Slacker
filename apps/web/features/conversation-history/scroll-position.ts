export type HistoryScrollAnchor = Readonly<{
  messageId: string;
  messageTop: number;
  scrollTop: number;
  scrollHeight: number;
}>;

export const getRestoredHistoryScrollTop = (
  anchor: HistoryScrollAnchor,
  currentMessageTop: number | null,
  currentScrollHeight: number
): number => anchor.scrollTop + (
  currentMessageTop === null
    ? currentScrollHeight - anchor.scrollHeight
    : currentMessageTop - anchor.messageTop
);

export const captureHistoryScrollAnchor = (container: HTMLElement): HistoryScrollAnchor | null => {
  const containerTop = container.getBoundingClientRect().top;
  const message = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
    .find((item) => item.getBoundingClientRect().bottom > containerTop);
  const messageId = message?.dataset.messageId;
  if (!message || !messageId) return null;
  return {
    messageId,
    messageTop: message.getBoundingClientRect().top,
    scrollTop: container.scrollTop,
    scrollHeight: container.scrollHeight
  };
};

export const restoreHistoryScrollAnchor = (
  container: HTMLElement,
  anchor: HistoryScrollAnchor
): void => {
  const message = Array.from(container.querySelectorAll<HTMLElement>("[data-message-id]"))
    .find((item) => item.dataset.messageId === anchor.messageId);
  container.scrollTop = getRestoredHistoryScrollTop(
    anchor,
    message?.getBoundingClientRect().top ?? null,
    container.scrollHeight
  );
};
