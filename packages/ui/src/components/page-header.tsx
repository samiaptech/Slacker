import * as React from "react";

type PageHeaderProps = Readonly<{
  description: string;
  eyebrow: string;
  icon: React.ReactNode;
  title: string;
}>;

export const PageHeader = ({ description, eyebrow, icon, title }: PageHeaderProps): React.ReactElement => (
  <header className="border-b border-border pb-8">
    <div className="mb-5 flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
      {icon}
    </div>
    <p className="mb-2 text-sm font-semibold text-foreground">{eyebrow}</p>
    <h1 className="max-w-2xl text-3xl font-semibold text-foreground sm:text-4xl">{title}</h1>
    <p className="mt-4 max-w-2xl text-base leading-7 text-muted-foreground">{description}</p>
  </header>
);
