export type MessageDeleteFailure = Readonly<{
  deletionCommitted: boolean;
  message: string;
}>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export const getMessageDeleteFailure = async (response: Response): Promise<MessageDeleteFailure> => {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  const code = isRecord(payload) && isRecord(payload.error) && typeof payload.error.code === "string"
    ? payload.error.code
    : null;
  if (code === "message_delete_cleanup_failed") {
    return Object.freeze({
      deletionCommitted: true,
      message: "The message was deleted, but an attached file could not be cleaned up."
    });
  }
  return Object.freeze({
    deletionCommitted: false,
    message: response.status === 401
      ? "Your session expired. Sign in again to delete this message."
      : response.status === 403
        ? "You no longer have permission to delete this message."
        : response.status === 404
          ? "This message is no longer available."
          : "The message could not be deleted. Please try again."
  });
};
