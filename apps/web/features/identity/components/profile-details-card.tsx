import type { FormEvent, ReactElement } from "react";
import { PencilLine, UserRound } from "lucide-react";
import { Button, Input, Label } from "@workspace/ui";

type ProfileDetailsCardProps = Readonly<{
  appName: string;
  currentName: string;
  currentTitle: string | null;
  name: string;
  title: string;
  isEditing: boolean;
  isSaving: boolean;
  message: string | null;
  onEdit: () => void;
  onCancel: () => void;
  onNameChange: (value: string) => void;
  onTitleChange: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
}>;

export const ProfileDetailsCard = ({
  appName, currentName, currentTitle, name, title, isEditing, isSaving, message,
  onEdit, onCancel, onNameChange, onTitleChange, onSave
}: ProfileDetailsCardProps): ReactElement => (
  <section aria-labelledby="profile-details-title" className="rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-7">
    <div className="mb-6 flex items-start justify-between gap-3">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground"><UserRound aria-hidden="true" className="size-5" /></span>
        <div>
          <h2 className="text-lg font-semibold text-foreground" id="profile-details-title">Your details</h2>
          <p className="mt-1 text-sm text-muted-foreground">Choose how teammates see you across {appName}.</p>
        </div>
      </div>
      {!isEditing ? (
        <Button className="shrink-0 rounded-xl" onClick={onEdit} type="button" variant="outline">
          <PencilLine aria-hidden="true" className="mr-2 size-4" /> Edit details
        </Button>
      ) : null}
    </div>
    {isEditing ? (
      <form className="space-y-5" onSubmit={onSave}>
        <div className="space-y-2">
          <Label htmlFor="profile-name">Display name</Label>
          <Input autoComplete="name" className="h-11 rounded-xl bg-background" id="profile-name" maxLength={80} onChange={(event) => onNameChange(event.currentTarget.value)} required value={name} />
          <p className="text-xs text-muted-foreground">This is the name shown next to your messages.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="profile-title-field">Role or title <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input autoComplete="organization-title" className="h-11 rounded-xl bg-background" id="profile-title-field" maxLength={80} onChange={(event) => onTitleChange(event.currentTarget.value)} placeholder="e.g. Product Designer" value={title} />
        </div>
        <div className="flex flex-wrap items-center gap-3 border-t border-border pt-5">
          <Button className="rounded-xl px-5" disabled={isSaving || (name.trim() === currentName && title.trim() === (currentTitle ?? ""))} type="submit">
            {isSaving ? "Saving changes…" : "Save changes"}
          </Button>
          <Button disabled={isSaving} onClick={onCancel} type="button" variant="ghost">Cancel</Button>
          {message ? <p className="text-sm text-destructive" role="alert">{message}</p> : null}
        </div>
      </form>
    ) : (
      <div className="grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
        <div><p className="text-xs font-medium text-muted-foreground">Display name</p><p className="mt-1 break-words text-sm font-medium text-foreground">{currentName}</p></div>
        <div><p className="text-xs font-medium text-muted-foreground">Role or title</p><p className="mt-1 break-words text-sm font-medium text-foreground">{currentTitle || "Not added"}</p></div>
        {message ? <p className="text-sm text-emerald-700" role="status">{message}</p> : null}
      </div>
    )}
  </section>
);
