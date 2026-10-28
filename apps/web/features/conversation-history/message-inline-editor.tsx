import type { KeyboardEvent, ReactElement } from "react";

type MessageInlineEditorProps = Readonly<{
  value: string;
  originalText: string;
  isSaving: boolean;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}>;

export const MessageInlineEditor = ({
  value,
  originalText,
  isSaving,
  onChange,
  onCancel,
  onSave
}: MessageInlineEditorProps): ReactElement => {
  const characterCount = Array.from(value).length;
  const canSave = value.trim().length > 0 && value !== originalText && characterCount <= 4_000 && !isSaving;
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Escape" && !isSaving) onCancel();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canSave) {
      event.preventDefault();
      onSave();
    }
  };

  return (
    <div className="mt-2 space-y-2">
      <textarea
        aria-label="Edit message"
        className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
        disabled={isSaving}
        onChange={(event) => {
          const nextValue = event.currentTarget.value;
          if (Array.from(nextValue).length <= 4_000) onChange(nextValue);
        }}
        onKeyDown={onKeyDown}
        rows={3}
        value={value}
      />
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span aria-live="polite">{characterCount}/4,000</span>
        <div className="flex items-center gap-2">
          <button className="text-xs font-medium text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={isSaving} onClick={onCancel} type="button">Cancel</button>
          <button className="rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50" disabled={!canSave} onClick={onSave} type="button">
            {isSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
};
