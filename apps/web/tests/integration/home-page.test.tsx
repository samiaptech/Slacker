import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "../../app/(public)/page";

test("renders the accessible workspace loading shell with API configuration", () => {
  const previousApiUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
  process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.example.test";
  try {
    const markup = renderToStaticMarkup(<HomePage />);
    assert.match(markup, /aria-label="Loading your workspace"/);
    assert.match(markup, /workspace-loading-skeleton/);
  } finally {
    if (previousApiUrl === undefined) delete process.env.NEXT_PUBLIC_API_BASE_URL;
    else process.env.NEXT_PUBLIC_API_BASE_URL = previousApiUrl;
  }
});
