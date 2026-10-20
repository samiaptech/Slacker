export type CreateChannelFormValues = Readonly<{
  name: string;
  description: string;
  visibility: "public" | "private";
}>;

export type CreateChannelFormErrors = Readonly<{
  name?: string;
  description?: string;
}>;

export const validateCreateChannelForm = (values: CreateChannelFormValues): CreateChannelFormErrors => {
  const errors: { name?: string; description?: string } = {};
  const name = values.name.trim();

  if (!name) {
    errors.name = "Enter a channel name.";
  } else if (name.length > 80) {
    errors.name = "Use no more than 80 characters.";
  } else if (!/^[a-z0-9_-]+$/i.test(name)) {
    errors.name = "Use letters, numbers, hyphens, or underscores only.";
  }

  if (values.description.trim().length > 500) {
    errors.description = "Use no more than 500 characters.";
  }

  return Object.freeze(errors);
};
