"use client";

import { useState, type ReactElement } from "react";
import { EyeOff, MoreHorizontal, PencilLine, Trash2 } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/ui/primitives";

export type MessageDeleteScope = "me" | "everyone";

type MessageActionsProps = Readonly<{
  canDeleteForEveryone: boolean;
  canEdit?: boolean | undefined;
  disabled: boolean;
  onDelete: (scope: MessageDeleteScope) => void;
  onEdit?: (() => void) | undefined;
}>;

export const MessageActions = ({
  canDeleteForEveryone,
  canEdit = false,
  disabled,
  onDelete,
  onEdit
}: MessageActionsProps): ReactElement => {
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label="Message actions"
            className="size-7 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && onEdit ? (
            <DropdownMenuItem onSelect={() => onEdit()}>
              <PencilLine aria-hidden="true" />
              Edit message
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={() => onDelete("me")}>
            <EyeOff aria-hidden="true" />
            Delete for me
          </DropdownMenuItem>
          {canDeleteForEveryone ? (
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setConfirmOpen(true)}>
              <Trash2 aria-hidden="true" />
              Delete for everyone
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog onOpenChange={setConfirmOpen} open={confirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this message for everyone?</DialogTitle>
            <DialogDescription>
              The message will be removed from this conversation for all members. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)} type="button" variant="outline">Cancel</Button>
            <Button
              onClick={() => {
                setConfirmOpen(false);
                onDelete("everyone");
              }}
              type="button"
              variant="destructive"
            >
              Delete for everyone
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
