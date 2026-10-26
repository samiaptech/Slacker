import type { Metadata } from "next";
import { headers } from "next/headers";
import type { ReactElement } from "react";
import { application } from "@/constants/application";
import type { RootLayoutProps } from "@/types";
import "./globals.css";

export const metadata: Metadata = {
  title: application.name,
  description: application.description
};

const RootLayout = async ({ children }: RootLayoutProps): Promise<ReactElement> => {
  // Nonce-based CSP requires request-time HTML so framework scripts get this request's nonce.
  await headers();
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
};

export default RootLayout;
