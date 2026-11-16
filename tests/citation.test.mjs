import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRequire } from "node:module";
const { Citation } = createRequire(import.meta.url)("../app/citation.tsx");

test("React renders the approved citation, escapes untrusted titles and drops an unsafe href", () => {
  const source = {
    title: "<script>fake</script>",
    url: "https://www.uicto.edu.ng/admission/procedure",
    published: null,
    reviewed: "2026-11-03",
    session: "2026/2027",
  };
  const render = (url) =>
    renderToStaticMarkup(
      createElement(Citation, { source: { ...source, url } }),
    );
  const html = render(source.url);
  assert.ok(html.includes('href="' + source.url + '"'));
  assert.ok(
    html.includes("Publication date unknown") && html.includes("2026/2027"),
  );
  assert.ok(html.includes("&lt;script&gt;") && !html.includes("<script>"));
  assert.ok(!render("javascript:alert(1)").includes("href="));
});
