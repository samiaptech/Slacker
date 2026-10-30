const headerNamePattern = /^[!#$%&'*+-.^_`|~0-9A-Za-z]+$/;

export const parseOtlpHeaders = (value: string): Readonly<Record<string, string>> => {
  const headers: Record<string, string> = {};
  for (const pair of value.split(",")) {
    const separator = pair.indexOf("=");
    if (separator <= 0) throw new Error("OTLP headers must use comma-separated key=value pairs.");
    const name = pair.slice(0, separator).trim();
    let headerValue: string;
    try {
      headerValue = decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      throw new Error("OTLP header values must use valid percent encoding.");
    }
    if (!headerNamePattern.test(name) || /[\r\n]/.test(headerValue)) {
      throw new Error("OTLP headers contain an invalid name or value.");
    }
    headers[name] = headerValue;
  }
  if (Object.keys(headers).length === 0) {
    throw new Error("At least one OTLP header is required.");
  }
  return Object.freeze(headers);
};

export const getOtlpSignalUrl = (endpoint: string): string => {
  const url = new URL(endpoint);
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/v1/metrics`;
  return url.toString();
};
