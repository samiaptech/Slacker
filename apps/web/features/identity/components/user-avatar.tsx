import type { ReactElement } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/primitives";

type UserAvatarProps = Readonly<{
  name: string;
  image: string | null;
  className: string;
  fallbackClassName?: string;
}>;

const initials = (name: string): string => name.trim().split(/\s+/).slice(0, 2)
  .map((part) => part[0] ?? "").join("").toLocaleUpperCase() || "?";

export const UserAvatar = ({ name, image, className, fallbackClassName }: UserAvatarProps): ReactElement => (
  <Avatar aria-label={`${name} profile picture`} className={className} role="img">
    {image ? <AvatarImage alt="" src={image} /> : null}
    <AvatarFallback className={fallbackClassName}>{initials(name)}</AvatarFallback>
  </Avatar>
);
