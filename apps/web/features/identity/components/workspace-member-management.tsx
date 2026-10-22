import type { ReactElement } from "react";
import { ShieldCheck, UserRound, UserRoundX } from "lucide-react";
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@workspace/ui";
import type { WorkspaceMemberProfileView } from "../types";

type WorkspaceMemberManagementProps = Readonly<{
  member: WorkspaceMemberProfileView;
  workspaceName: string;
  isSavingRole: boolean;
  isRemovingMember: boolean;
  isRemoveDialogOpen: boolean;
  managementMessage: string | null;
  onRoleChange: (role: "admin" | "member") => void;
  onRemoveDialogChange: (open: boolean) => void;
  onRemove: () => void;
}>;

export const WorkspaceMemberManagement = ({
  member,
  workspaceName,
  isSavingRole,
  isRemovingMember,
  isRemoveDialogOpen,
  managementMessage,
  onRoleChange,
  onRemoveDialogChange,
  onRemove
}: WorkspaceMemberManagementProps): ReactElement => (
  <section aria-labelledby="member-management-title" className="overflow-hidden rounded-3xl border border-[#e3e9e3] bg-white shadow-sm shadow-[#173b3a]/5">
    <header className="flex items-start gap-3 border-b border-[#edf0eb] px-5 py-5 sm:px-7">
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#edf4ef] text-[#507b68]"><ShieldCheck className="size-5" /></span>
      <div>
        <h2 className="font-semibold text-foreground" id="member-management-title">Member access</h2>
        <p className="mt-1 text-sm text-muted-foreground">Manage {member.name ?? "this member"}’s role or workspace access.</p>
      </div>
    </header>
    <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
      <div className="flex items-center gap-3">
        <span aria-hidden="true" className="flex size-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
          {member.role === "admin" ? <ShieldCheck className="size-4" /> : <UserRound className="size-4" />}
        </span>
        <div><p className="text-sm font-medium text-foreground">Workspace role</p><p className="text-xs text-muted-foreground">Controls workspace administration access.</p></div>
      </div>
      <Select
        disabled={isSavingRole || isRemovingMember}
        onValueChange={(value) => { if (value === "admin" || value === "member") onRoleChange(value); }}
        value={member.role}
      >
        <SelectTrigger aria-label="Workspace role" className="w-full sm:w-40"><SelectValue /></SelectTrigger>
        <SelectContent><SelectItem value="member">Member</SelectItem><SelectItem value="admin">Admin</SelectItem></SelectContent>
      </Select>
    </div>
    <div className="flex flex-col gap-3 border-t border-[#edf0eb] p-5 sm:flex-row sm:items-center sm:justify-between sm:px-7">
      <div><p className="text-sm font-medium text-foreground">Remove from workspace</p><p className="mt-1 text-xs text-muted-foreground">They will lose access to {workspaceName} and its channels.</p></div>
      <Button className="w-full sm:w-auto" disabled={isSavingRole || isRemovingMember} onClick={() => onRemoveDialogChange(true)} type="button" variant="destructive">
        <UserRoundX aria-hidden="true" className="mr-2 size-4" />Remove member
      </Button>
    </div>
    {isSavingRole ? <p className="px-5 pb-4 text-sm text-muted-foreground sm:px-7" role="status">Updating role…</p> : null}
    {managementMessage ? <p className="px-5 pb-5 text-sm text-muted-foreground sm:px-7" role="status">{managementMessage}</p> : null}
    <Dialog onOpenChange={(open) => { if (!isRemovingMember) onRemoveDialogChange(open); }} open={isRemoveDialogOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove {member.name ?? "this member"}?</DialogTitle>
          <DialogDescription>They will lose access to {workspaceName} and all its channels. You can invite them again later.</DialogDescription>
        </DialogHeader>
        {managementMessage ? <p className="text-sm text-destructive" role="alert">{managementMessage}</p> : null}
        <DialogFooter>
          <Button disabled={isRemovingMember} onClick={() => onRemoveDialogChange(false)} type="button" variant="outline">Cancel</Button>
          <Button disabled={isRemovingMember} onClick={onRemove} type="button" variant="destructive">{isRemovingMember ? "Removing…" : "Remove member"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </section>
);
