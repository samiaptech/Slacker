import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "../../app/(app)/page";

test("renders the workspace landing content inside the shared application layout", () => {
  const markup = renderToStaticMarkup(<HomePage />);
  assert.match(markup, /id="channel-home-title">Select a channel/);
  assert.match(markup, /Choose a channel or member from the sidebar/);
});
