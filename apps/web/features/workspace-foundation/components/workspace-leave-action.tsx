"use client";

import { useState, type ReactElement } from "react";
import { DoorOpen } from "lucide-react";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@workspace/ui";
import { DropdownMenuItem } from "@workspace/ui/primitives";
import { useWorkspaceContext } from "./workspace-context";

export const WorkspaceLeaveMenuItem = ({ onSelect }: Readonly<{ onSelect: () => void }>): ReactElement => (
  <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onSelect}>
    <DoorOpen aria-hidden="true" /> Leave workspace
  </DropdownMenuItem>
);

export const WorkspaceLeaveDialog = ({
  open,
  onOpenChange
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>): ReactElement => {
  const { activeWorkspace, leaveWorkspace } = useWorkspaceContext();
  const [isLeaving, setIsLeaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const confirmLeave = async (): Promise<void> => {
    setIsLeaving(true);
    setErrorMessage(null);
    try {
      await leaveWorkspace();
      setIsLeaving(false);
      onOpenChange(false);
    } catch (error: unknown) {
      setErrorMessage(error instanceof Error ? error.message : "You could not leave this workspace.");
      setIsLeaving(false);
    }
  };

  return (
      <Dialog onOpenChange={(nextOpen) => { if (!isLeaving) onOpenChange(nextOpen); }} open={open}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Leave {activeWorkspace.name}?</DialogTitle>
            <DialogDescription>You’ll lose access to this workspace until someone invites you again. Your account will remain active.</DialogDescription>
          </DialogHeader>
          {errorMessage ? <p className="text-sm text-destructive" role="alert">{errorMessage}</p> : null}
          <DialogFooter>
            <Button disabled={isLeaving} onClick={() => onOpenChange(false)} type="button" variant="outline">Cancel</Button>
            <Button disabled={isLeaving} onClick={() => void confirmLeave()} type="button" variant="destructive">
              {isLeaving ? "Leaving…" : "Leave workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
  );
};
