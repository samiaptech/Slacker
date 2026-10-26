import type { ReactElement } from "react";
import { Button } from "@workspace/ui";
import type { MessageDeliveryState } from "./pending-message";

type MessageDeliveryIndicatorProps = Readonly<{
  state?: MessageDeliveryState | undefined;
  retryDisabled?: boolean;
  onRetry: () => void;
}>;

export const MessageDeliveryIndicator = ({
  state,
  retryDisabled = false,
  onRetry
}: MessageDeliveryIndicatorProps): ReactElement | null => {
  if (!state) return null;
  if (state === "sending") {
    return <span className="text-xs text-muted-foreground" role="status">Sending…</span>;
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-destructive" role="group" aria-label="Message not sent">
      Not sent
      <Button aria-label="Retry sending message" className="h-6 px-1.5 text-xs" disabled={retryDisabled} onClick={onRetry} type="button" variant="ghost">
        Retry
      </Button>
    </span>
  );
};
