export type ChatAttachmentRecord = Readonly<{
  id: string;
  name: string;
  mimeType: string;
  size: number;
  publicId: string;
  resourceType: "image" | "raw";
  format: string;
}>;
