"use client";

import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

export const createAuthenticationClient = (baseURL: string) => createAuthClient({
  baseURL,
  fetchOptions: { credentials: "include" },
  plugins: [inferAdditionalFields({
    user: {
      title: { type: "string", required: false }
    }
  })]
});
