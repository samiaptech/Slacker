import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";
import { Crown, Globe2, Hash, LockKeyhole, Users } from "lucide-react";
import { Button } from "@workspace/ui";
import { UserAvatar } from "@/features/identity/public";
import { Skeleton } from "@workspace/ui/primitives";

export type ChannelProfileMemberView = Readonly<{
  id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  image: string | null;
  role: "admin" | "member";
}>;

type ChannelProfileContentProps = Readonly<{
  channelName: string;
  description: string | null;
  visibility: "public" | "private";
  members: readonly ChannelProfileMemberView[];
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  notificationSettings?: ReactNode;
  channelActions?: ReactNode;
}>;

const getChannelTitle = (channelName: string): string =>
  channelName.toLowerCase() === "general" ? "A place for all of us." : `#${channelName}`;

const getDescription = (channelName: string, description: string | null): string => {
  if (description) return description;
  return channelName.toLowerCase() === "general"
    ? "Team updates, thoughtful questions, and the occasional very good dog."
    : "A shared space for this team’s conversations.";
};

export const ChannelProfileContent = ({
  channelName,
  description,
  visibility,
  members,
  isLoading,
  errorMessage,
  onRetry,
  notificationSettings,
  channelActions
}: ChannelProfileContentProps) => (
  <div className="flex flex-col bg-transparent">
    <header className="border-b border-[#e6e9e2] px-5 py-4">
      <h2 className="text-sm font-semibold text-[#283b33]">About this channel</h2>
    </header>
    <section className="border-b border-[#e6e9e2] px-5 py-6">
      <span aria-hidden="true" className="flex size-10 items-center justify-center rounded-xl bg-[#e9f0e8] text-[#466653]">
        {visibility === "public" ? <Hash className="size-5" /> : <LockKeyhole className="size-5" />}
      </span>
      <h3 className="mt-3 break-words text-base font-semibold text-[#293a32]">{getChannelTitle(channelName)}</h3>
      <p className="mt-2 whitespace-pre-wrap break-words text-[13px] leading-[1.55] text-[#77817b]">
        {getDescription(channelName, description)}
      </p>
      <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-[#7c857e]">
        {visibility === "public" ? <Globe2 aria-hidden="true" className="size-3.5" /> : <LockKeyhole aria-hidden="true" className="size-3.5" />}
        {visibility === "public" ? "Public channel · Everyone’s welcome" : "Private channel"}
      </span>
    </section>
    {notificationSettings}
    <section className="flex flex-col px-4 py-5">
      <h3 className="flex items-center gap-1.5 px-1 text-[11px] font-semibold uppercase tracking-wide text-[#7d867f]">
        <Users aria-hidden="true" className="size-3.5" /> Members · {!isLoading && !errorMessage ? members.length : "—"}
      </h3>
      {isLoading ? (
        <ul aria-label="Loading channel members" className="mt-3 space-y-3" role="status">
          {Array.from({ length: 4 }, (_, index) => <li className="flex items-center gap-3" key={index}><Skeleton className="size-9 rounded-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-28" /><Skeleton className="h-2.5 w-16" /></div></li>)}
        </ul>
      ) : errorMessage ? (
        <div className="mt-3 space-y-2"><p className="text-xs text-destructive" role="alert">{errorMessage}</p><Button onClick={onRetry} size="sm" type="button" variant="outline">Retry</Button></div>
      ) : members.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">No members to show yet.</p>
      ) : (
        <ul aria-label="Channel members" className="mt-3 space-y-0.5">
          {members.map((member) => {
            const name = member.name ?? "Workspace member";
            return (
              <li key={member.id}>
                <Link className="group flex items-center gap-2.5 rounded-lg px-1.5 py-2 transition-colors hover:bg-[#e9eee7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" href={`/members/${encodeURIComponent(member.id)}` as Route}>
                  <UserAvatar className="size-9 shrink-0 bg-[#e8eee8] text-xs font-semibold text-[#486653]" image={member.image} name={member.name ?? member.email ?? "Workspace member"} />
                  <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-[#2e3c35]">{name}</span><span className="block truncate text-[11px] text-[#879089]">{member.title || (member.role === "admin" ? "Workspace admin" : "Member")}</span></span>
                  {member.role === "admin" ? <Crown aria-label="Workspace admin" className="size-3.5 shrink-0 text-[#a59b70]" /> : null}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
    {channelActions}
  </div>
);
