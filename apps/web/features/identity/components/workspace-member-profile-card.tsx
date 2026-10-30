import type { ReactElement } from "react";
import Link from "next/link";
import type { Route } from "next";
import { BadgeCheck, CalendarDays, Mail, ShieldCheck, UserRound } from "lucide-react";
import { Button } from "@workspace/ui";
import { UserAvatar } from "./user-avatar";
import type { WorkspaceMemberProfileView } from "../types";

type WorkspaceMemberProfileCardProps = Readonly<{
  member: WorkspaceMemberProfileView;
  isCurrentUser: boolean;
}>;

const formatJoinDate = (value: string): string =>
  new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(new Date(value));

export const WorkspaceMemberProfileCard = ({ member, isCurrentUser }: WorkspaceMemberProfileCardProps): ReactElement => {
  const displayName = member.name ?? "Workspace member";

  return (
    <section aria-label={`${displayName} profile`} className="overflow-hidden rounded-3xl border border-[#e3e9e3] bg-white shadow-sm shadow-[#173b3a]/5">
      <header className="relative isolate overflow-hidden bg-[#173b3a] px-6 pb-7 pt-8 text-white sm:px-9 sm:pt-10">
        <div aria-hidden="true" className="absolute -right-10 -top-24 -z-10 size-64 rounded-full border-[30px] border-white/[0.05]" />
        <div aria-hidden="true" className="absolute -bottom-24 right-24 -z-10 size-48 rounded-full bg-[#b8e3d1]/10 blur-2xl" />
        <div className="flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <UserAvatar className="size-24 shrink-0 rounded-[1.75rem] border border-white/20 bg-[#b8e3d1] text-3xl font-semibold text-[#173b3a] shadow-lg shadow-black/10" image={member.image} name={displayName} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#b8e3d1]">Workspace profile</p>
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight" id="member-profile-title">{displayName}</h1>
            <p className="mt-1 text-sm text-white/70">{member.title || "A member of the workspace"}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-xs font-medium text-white/90">
                {member.role === "admin" ? <ShieldCheck aria-hidden="true" className="size-3.5" /> : <UserRound aria-hidden="true" className="size-3.5" />}
                {member.role === "admin" ? "Workspace admin" : "Workspace member"}
              </span>
              {isCurrentUser ? <span className="inline-flex items-center gap-1.5 rounded-full bg-[#b8e3d1] px-3 py-1.5 text-xs font-semibold text-[#173b3a]">Your profile</span> : null}
            </div>
          </div>
          {isCurrentUser ? <Button asChild className="shrink-0 rounded-xl bg-white text-[#173b3a] hover:bg-[#eaf5ef]"><Link href={"/profile" as Route}>Edit profile</Link></Button> : null}
        </div>
      </header>

      <div className="grid gap-3 p-5 sm:grid-cols-2 sm:p-7">
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-[#e8ece7] bg-[#fbfcfa] p-4">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#edf4ef] text-[#507b68]"><BadgeCheck className="size-5" /></span>
          <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Role or title</p><p className="mt-1 break-words text-sm font-medium text-foreground">{member.title || "Not shared"}</p></div>
        </div>
        <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-[#e8ece7] bg-[#fbfcfa] p-4">
          <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#edf4ef] text-[#507b68]"><CalendarDays className="size-5" /></span>
          <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Member since</p><p className="mt-1 text-sm font-medium text-foreground">{formatJoinDate(member.joinedAt)}</p></div>
        </div>
        {member.email ? (
          <div className="flex min-w-0 items-start gap-3 rounded-2xl border border-[#e8ece7] bg-[#fbfcfa] p-4 sm:col-span-2">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#edf4ef] text-[#507b68]"><Mail className="size-5" /></span>
            <div className="min-w-0"><p className="text-xs font-medium text-muted-foreground">Email address</p><a className="mt-1 block break-all text-sm font-medium text-foreground underline-offset-4 hover:text-primary hover:underline" href={`mailto:${member.email}`}>{member.email}</a></div>
          </div>
        ) : null}
      </div>
    </section>
  );
};
