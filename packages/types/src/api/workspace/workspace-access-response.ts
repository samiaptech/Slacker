export type WorkspaceAccessResponse = Readonly<{
  workspace: Readonly<{
    id: string;
    name: string;
  }>;
  user: Readonly<{
    id: string;
    name: string;
    title: string | null;
    email: string;
    image: string | null;
  }>;
}>;
