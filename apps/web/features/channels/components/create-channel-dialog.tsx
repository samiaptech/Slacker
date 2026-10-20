"use client";

import { useRef, useState, type FormEvent, type ReactElement } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea
} from "@workspace/ui";
import { submitChannelCreation, type CreateChannelFormErrors } from "../types";
import { useWorkspaceContext } from "@/features/workspace-foundation/public";

type CreateChannelDialogProps = Readonly<{ apiBaseUrl: string }>;

export const ChannelCreateDialog = ({ apiBaseUrl }: CreateChannelDialogProps): ReactElement => {
  const { activeWorkspace } = useWorkspaceContext();
  const router = useRouter();
  const idempotencyKey = useRef<string | null>(null);
  const submitting = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [fieldErrors, setFieldErrors] = useState<CreateChannelFormErrors>({});
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const clearErrors = (): void => {
    setFieldErrors({});
    setErrorMessage(null);
    idempotencyKey.current = null;
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (submitting.current) return;
    const values = { name, description, visibility };
    setErrorMessage(null);
    submitting.current = true;
    try {
      const result = await submitChannelCreation({
        apiBaseUrl,
        workspaceId: activeWorkspace.id,
        values,
        getIdempotencyKey: () => idempotencyKey.current ??= crypto.randomUUID(),
        fetchChannel: fetch,
        onSubmittingChange: setIsSubmitting
      });
      if (result.kind === "invalid") {
        setFieldErrors(result.fieldErrors);
        return;
      }
      if (result.kind === "error") {
        setFieldErrors(result.fieldErrors);
        setErrorMessage(result.message);
        return;
      }
      setFieldErrors({});
      setIsOpen(false);
      router.push(`/channels/${encodeURIComponent(result.response.channel.id)}` as Route);
    } finally {
      submitting.current = false;
    }
  };

  const updateName = (value: string): void => {
    setName(value);
    clearErrors();
  };

  const updateDescription = (value: string): void => {
    setDescription(value);
    clearErrors();
  };

  return (
    <Dialog onOpenChange={(open) => { if (!isSubmitting) setIsOpen(open); }} open={isOpen}>
      <DialogTrigger asChild>
        <Button className="mt-4" type="button">Create channel</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create a channel</DialogTitle>
          <DialogDescription>Choose a name and visibility for a new workspace channel.</DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <div className="space-y-2">
            <Label htmlFor="channel-name">Name</Label>
            <Input
              aria-describedby={fieldErrors.name ? "channel-name-error" : "channel-name-help"}
              aria-invalid={Boolean(fieldErrors.name)}
              autoComplete="off"
              disabled={isSubmitting}
              id="channel-name"
              maxLength={80}
              onChange={(event) => updateName(event.currentTarget.value)}
              required
              value={name}
            />
            {fieldErrors.name ? (
              <p className="text-sm text-destructive" id="channel-name-error">{fieldErrors.name}</p>
            ) : (
              <p className="text-sm text-muted-foreground" id="channel-name-help">
                Letters, numbers, hyphens, and underscores. Names are normalized to lowercase.
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-visibility">Visibility</Label>
            <Select
              disabled={isSubmitting}
              onValueChange={(value) => {
                if (value !== "public" && value !== "private") return;
                setVisibility(value);
                clearErrors();
              }}
              value={visibility}
            >
              <SelectTrigger aria-label="Visibility" id="channel-visibility">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public — discoverable by workspace members</SelectItem>
                <SelectItem value="private">Private — members must be invited</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="channel-description">Description <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Textarea
              aria-describedby={fieldErrors.description ? "channel-description-error" : "channel-description-help"}
              aria-invalid={Boolean(fieldErrors.description)}
              disabled={isSubmitting}
              id="channel-description"
              maxLength={500}
              onChange={(event) => updateDescription(event.currentTarget.value)}
              rows={3}
              value={description}
            />
            {fieldErrors.description ? (
              <p className="text-sm text-destructive" id="channel-description-error">{fieldErrors.description}</p>
            ) : (
              <p className="text-sm text-muted-foreground" id="channel-description-help">Up to 500 characters.</p>
            )}
          </div>
          {errorMessage ? <p className="text-sm text-destructive" role="alert">{errorMessage}</p> : null}
          <DialogFooter>
            <Button disabled={isSubmitting} onClick={() => setIsOpen(false)} type="button" variant="outline">
              Cancel
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? "Creating…" : "Create channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
