type WebSecurityPolicyOptions = Readonly<{
  apiBaseUrl: string;
  nonce: string;
  production: boolean;
}>;

export const createWebContentSecurityPolicy = ({
  apiBaseUrl,
  nonce,
  production
}: WebSecurityPolicyOptions): string => {
  const apiUrl = new URL(apiBaseUrl);
  const socketUrl = new URL(apiUrl);
  socketUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:";
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}'`,
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob: https://*.googleusercontent.com",
    "font-src 'self' data:",
    `connect-src 'self' ${apiUrl.origin} ${socketUrl.origin}`,
    "media-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    ...(production ? ["upgrade-insecure-requests"] : [])
  ];
  return directives.join("; ");
};
