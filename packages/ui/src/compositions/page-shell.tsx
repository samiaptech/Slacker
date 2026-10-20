import * as React from "react";
import { cn } from "../utilities/index.js";

type PageShellProps = Readonly<{
  children: React.ReactNode;
  className?: string;
  width?: "standard" | "narrow";
}>;

const widths: Readonly<Record<NonNullable<PageShellProps["width"]>, string>> = {
  standard: "max-w-5xl",
  narrow: "max-w-3xl"
};

export const PageShell = ({ children, className, width = "standard" }: PageShellProps): React.ReactElement => (
  <main className={cn("mx-auto flex min-h-screen w-full flex-col px-6 py-10 sm:px-10 sm:py-16", widths[width], className)}>
    {children}
  </main>
);
