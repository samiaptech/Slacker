import type { ReactElement } from "react";
import { Activity } from "lucide-react";
import { PageHeader, PageShell } from "@workspace/ui";
import { ApiBoundary } from "./api-boundary";
import { RuntimeFoundation } from "./runtime-foundation";

type WorkspaceFoundationProps = Readonly<{
  apiBaseUrl: string;
}>;

export const WorkspaceFoundation = ({ apiBaseUrl }: WorkspaceFoundationProps): ReactElement => (
  <PageShell>
    <PageHeader
      description="Web and API runtimes are configured as separate workspace units and ready for the first vertical slice."
      eyebrow="Workspace ready"
      icon={<Activity aria-hidden="true" className="size-5" />}
      title="The application foundation is running."
    />
    <RuntimeFoundation />
    <ApiBoundary baseUrl={apiBaseUrl} />
  </PageShell>
);
