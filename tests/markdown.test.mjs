import test from "node:test";
import assert from "node:assert/strict";
import {
  captureMarkdownSource,
  copyMarkdownText,
  decorateMarkdownTree,
  focusMarkdownFragment,
  markdownFragment,
  markdownSanitizeSchema,
  markdownText,
  markdownUrlTransform,
  rehypeMarkdownScope,
  rehypeMarkdownSource,
  rehypeMarkdownText,
  safeMarkdownUrl,
  scopeMarkdownTree
} from "../src/lib/markdownSupport.mjs";

const text = (value, start, end) => ({ type: "text", value, ...position(start, end) });
const element = (tagName, children = [], properties = {}, start, end) => ({ type: "element", tagName, properties, children, ...position(start, end) });
const root = (...children) => ({ type: "root", children });
const raw = (value, start, end) => ({ type: "raw", value, ...position(start, end) });
const members = Object.freeze([Object.freeze({ name: "Ada" }), Object.freeze({ name: "Ada Lovelace" }), Object.freeze({ name: "A[1]" })]);

function position(start, end) {
  return start === undefined ? {} : { position: { start: { offset: start }, end: { offset: end } } };
}

function nodes(tree, predicate) {
  return [tree, ...(tree.children || []).flatMap((child) => nodes(child, () => true))].filter(predicate);
}

const mentions = (tree) => nodes(tree, (node) => node.properties?.className?.includes("mention"));
const marks = (tree) => nodes(tree, (node) => node.tagName === "mark");

test("links allow normalized HTTP, HTTPS, local fragments and conservative email addresses", () => {
  assert.equal(safeMarkdownUrl("https://EXAMPLE.com/a?q=hello#top"), "https://example.com/a?q=hello#top");
  assert.equal(safeMarkdownUrl("http://example.com"), "http://example.com/");
  assert.equal(safeMarkdownUrl("https://example.com/a b"), "https://example.com/a%20b");
  assert.equal(safeMarkdownUrl("#note%20one"), "#note%20one");
  assert.equal(safeMarkdownUrl("mailto:team@example.com"), "mailto:team@example.com");
  assert.equal(safeMarkdownUrl("mailto:one@example.com,two@example.com?subject=Hello&body=Review%20please"), "mailto:one@example.com,two@example.com?subject=Hello&body=Review%20please");
});

test("links reject executable schemes, local paths, credentials and control characters", () => {
  const rejected = [
    "javascript:alert(1)", "JaVaScRiPt:alert(1)", "java\nscript:alert(1)", "data:text/html,hello",
    "file:///C:/Windows/win.ini", "C:\\Windows\\win.ini", "C:/Windows/win.ini", "../secrets.txt", "/private/file",
    "//example.com/x", "\\\\example.com\\file", "vcc://vpm/addRepo", "booth-local://file/one", "blob:https://example.com/id",
    "ftp://example.com", "https:example.com", "https:///example.com", "https:////example.com",
    "https://user:password@example.com", "https://user@example.com", "https://@example.com", "https:////@example.com",
    "https://user%40example.com@other.example", "https://example.com\\@other.example", "https://example.com/%0aheader",
    "https://example.com/%0D%0Aheader", "https://example.com/\u0000", "\thttps://example.com", "https://example.com/\u0085",
    "mailto://user@example.com", "mailto:user:password@example.com", "mailto:team@example.com?attachment=file:///secret",
    "mailto:team@example.com?bcc=other@example.com", "mailto:team@example.com?subject=Hi%0d%0aBcc:other@example.com",
    "mailto:team@example.com?body=Line%0aTwo", "mailto:bad%zz@example.com", "mailto:team@example.com#fragment", "#", "#bad%zz"
  ];
  for (const value of rejected) assert.equal(safeMarkdownUrl(value), "", value);
  for (const value of [undefined, null, false, 3, {}, [], new URL("https://example.com")]) assert.equal(safeMarkdownUrl(value), "");
});

test("image sources are HTTPS only even when a scheme is valid for links", () => {
  assert.equal(safeMarkdownUrl("https://example.com/image.png", { image: true }), "https://example.com/image.png");
  for (const value of ["http://example.com/image.png", "mailto:team@example.com", "#note", "//example.com/image.png",
    "/image.png", "data:image/png;base64,AA==", "blob:https://example.com/image", "file:///image.png",
    "booth-local://image", "vcc://image", "javascript:alert(1)", "https://user:pass@example.com/image.png"]) {
    assert.equal(safeMarkdownUrl(value, { image: true }), "", value);
    assert.equal(markdownUrlTransform(value, "src"), "", value);
  }
  assert.equal(markdownUrlTransform("http://example.com", "href"), "http://example.com/");
});

test("fragment decoding fails closed without interpreting selectors", () => {
  assert.equal(markdownFragment("#a%20b"), "a b");
  assert.equal(markdownFragment('#a%22%5D%20%5Bid%3D%22other'), 'a"] [id="other');
  for (const value of ["", "#", "#%", "#%00", "#%0a", "https://example.com/#one", null]) assert.equal(markdownFragment(value), "");
});

test("decorations retain text, literal searches and longest member names", () => {
  const body = "Hello @Ada Lovelace and @A[1], a+b.* a+b.*";
  const tree = root(element("p", [text(body)]));
  decorateMarkdownTree(tree, { members, selfName: "ada lovelace", searchQuery: "a+b.*" });
  assert.equal(markdownText(tree), body);
  assert.deepEqual(mentions(tree).map(markdownText), ["@Ada Lovelace", "@A[1]"]);
  assert.deepEqual(mentions(tree)[0].properties.className, ["mention", "self"]);
  assert.deepEqual(marks(tree).map(markdownText), ["a+b.*", "a+b.*"]);
  assert.deepEqual(members.map((member) => member.name), ["Ada", "Ada Lovelace", "A[1]"]);
});

test("searches can cross a mention boundary within one parsed text node", () => {
  const tree = root(element("p", [text("hello @Ada, okay")]));
  decorateMarkdownTree(tree, { members, selfName: "Ada", searchQuery: "lo @Ad" });
  assert.equal(markdownText(tree), "hello @Ada, okay");
  assert.equal(marks(tree).map(markdownText).join(""), "lo @Ad");
  assert.equal(mentions(tree).length, 1);
  assert.equal(markdownText(mentions(tree)[0]), "@Ada");
});

test("code and URL attributes never become mention or search markup", () => {
  const props = Object.freeze({ href: "https://example.com/@Ada", title: "@Ada" });
  const inline = element("code", [text("@Ada")]);
  const fenced = element("pre", [element("code", [text("const name = '@Ada';\n")], { className: ["language-js"] })]);
  const keyboard = element("kbd", [text("@Ada")]);
  const tree = root(element("p", [inline, keyboard, element("a", [text("Ask @Ada")], props)]), fenced);
  const before = JSON.stringify([inline, fenced, keyboard]);
  decorateMarkdownTree(tree, { members, selfName: "Ada", searchQuery: "Ada" });
  assert.equal(JSON.stringify([inline, fenced, keyboard]), before);
  assert.deepEqual(props, { href: "https://example.com/@Ada", title: "@Ada" });
  assert.equal(mentions(tree).length, 1);
  assert.equal(marks(tree).length, 1);
});

test("inline HTML excludes its own content but not surrounding Markdown", () => {
  const source = captureMarkdownSource(root(element("p", [raw("<span>", 0, 6), text("@Ada", 6, 10), raw("</span>", 10, 17), text(" @Ada", 17, 22)], {}, 0, 22)));
  const html = element("span", [text("@Ada", 6, 10)], {}, 0, 17);
  const tree = root(element("p", [html, text(" @Ada", 17, 22)], {}, 0, 22));
  decorateMarkdownTree(tree, { members, searchQuery: "Ada" }, source);
  assert.deepEqual(html.children, [text("@Ada", 6, 10)]);
  assert.equal(mentions(tree).length, 1);
  assert.equal(marks(tree).length, 1);
});

test("HTML source ranges protect text moved by HTML table parsing", () => {
  const source = captureMarkdownSource(root(raw("<table>@Ada</table>", 0, 18), element("p", [text("@Ada", 20, 24)], {}, 20, 24)));
  const displaced = text("@Ada", 7, 11);
  const tree = root(displaced, element("table", [], {}, 0, 18), element("p", [text("@Ada", 20, 24)], {}, 20, 24));
  decorateMarkdownTree(tree, { members, searchQuery: "Ada" }, source);
  assert.strictEqual(tree.children[0], displaced);
  assert.equal(mentions(tree).length, 1);
  assert.equal(marks(tree).length, 1);
});

test("raw nodes and generated footnote controls are not decorated", () => {
  const html = raw('<b title="@Ada">@Ada</b>', 0, 24);
  const reference = element("a", [text("1")], { href: "#fn-one", dataFootnoteRef: "" });
  const back = element("a", [text("Back to reference")], { dataFootnoteBackref: "" });
  const tree = root(html, reference, back, element("p", [text("@Ada 1")]));
  decorateMarkdownTree(tree, { members, searchQuery: "1" });
  assert.strictEqual(tree.children[0], html);
  assert.deepEqual(reference.children, [text("1")]);
  assert.deepEqual(back.children, [text("Back to reference")]);
});

function footnoteTree() {
  return root(
    element("a", [text("1")], { id: "markdown-source-user-content-fnref-one", href: "#user-content-fn-one", ariaDescribedBy: ["footnote-label"] }),
    element("h2", [text("Notes")], { id: "markdown-source-footnote-label" }),
    element("li", [text("A note"), element("a", [text("Back")], { href: "#user-content-fnref-one" })], { id: "markdown-source-user-content-fn-one" })
  );
}

test("footnotes, back references and accessible labels are scoped per instance", () => {
  const first = scopeMarkdownTree(footnoteTree(), "first");
  const second = scopeMarkdownTree(footnoteTree(), "second");
  const firstIds = nodes(first, (node) => node.properties?.id).map((node) => node.properties.id);
  const secondIds = nodes(second, (node) => node.properties?.id).map((node) => node.properties.id);
  assert.equal(new Set([...firstIds, ...secondIds]).size, 6);
  assert.equal(first.children[0].properties.href, `#${first.children[2].properties.id}`);
  assert.equal(first.children[2].children[1].properties.href, `#${first.children[0].properties.id}`);
  assert.deepEqual(first.children[0].properties.ariaDescribedBy, [first.children[1].properties.id]);
});

test("heading links are local and source IDs cannot clobber document globals", () => {
  const tree = root(
    element("h1", [text("Hello World")]), element("h2", [text("Hello World")]),
    element("a", [text("Second")], { href: "#hello-world-1" }),
    element("p", [text("A")], { id: "markdown-source-location", name: "location" }),
    element("p", [text("B")], { id: "markdown-source-location" }),
    element("a", [text("Inside")], { href: "#location" }),
    element("a", [text("Outside")], { href: "#application-shell", ariaDescribedBy: ["application-shell"] })
  );
  scopeMarkdownTree(tree, ":r1:");
  const ids = nodes(tree, (node) => node.properties?.id).map((node) => node.properties.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => /^markdown-r1-\d+$/.test(id)));
  assert.equal(tree.children[2].properties.href, `#${tree.children[1].properties.id}`);
  assert.equal(tree.children[5].properties.href, `#${tree.children[3].properties.id}`);
  assert.equal(tree.children[3].properties.name, undefined);
  assert.equal(tree.children[6].properties.href, undefined);
  assert.equal(tree.children[6].properties.ariaDescribedBy, undefined);
});

test("the final AST guard removes relative URLs, image source sets and image credentials", () => {
  const tree = root(element("a", [], { href: "/private/file" }), element("img", [], { src: "https://u:p@example.com/x", srcSet: "https://other.example/x 2x" }),
    element("img", [], { src: "https://example.com/image.png", alt: "Preview" }));
  scopeMarkdownTree(tree, "guard");
  assert.equal(tree.children[0].properties.href, undefined);
  assert.equal(tree.children[1].properties.src, undefined);
  assert.equal(tree.children[1].properties.srcSet, undefined);
  assert.equal(tree.children[2].properties.src, "https://example.com/image.png");
});

test("the sanitizer schema permits disabled tasks but no active HTML or authored CSS", () => {
  assert.deepEqual(markdownSanitizeSchema.required.input, { type: "checkbox", disabled: true });
  for (const tag of ["script", "iframe", "form", "style", "svg", "math", "video", "audio", "object", "embed", "template"]) {
    assert.equal(markdownSanitizeSchema.tagNames.includes(tag), false, tag);
    assert.equal(markdownSanitizeSchema.strip.includes(tag), true, tag);
  }
  for (const attributes of Object.values(markdownSanitizeSchema.attributes)) {
    for (const attribute of attributes) {
      const name = Array.isArray(attribute) ? attribute[0] : attribute;
      assert.equal(/^(?:on|style$|srcSet$|srcDoc$|formAction$|target$|download$)/i.test(name), false, name);
    }
  }
});

test("fragment navigation only searches the supplied Markdown container", () => {
  const calls = [];
  const attributes = new Map();
  const target = {
    id: "markdown-one-1", scrollIntoView: (value) => calls.push(["scroll", value]),
    focus: (value) => calls.push(["focus", value]), hasAttribute: (key) => attributes.has(key),
    setAttribute: (key, value) => attributes.set(key, value), removeAttribute: (key) => attributes.delete(key),
    addEventListener: (type, callback, options) => calls.push([type, callback, options])
  };
  const container = { querySelectorAll: (selector) => { assert.equal(selector, "[id]"); return [target]; } };
  assert.equal(focusMarkdownFragment(container, "#markdown-two-1"), false);
  assert.equal(calls.length, 0);
  assert.equal(focusMarkdownFragment(container, "#markdown-one-1"), true);
  assert.equal(attributes.get("tabindex"), "-1");
  assert.deepEqual(calls.find(([type]) => type === "focus")[1], { preventScroll: true });
  calls.find(([type]) => type === "blur")[1]();
  assert.equal(attributes.has("tabindex"), false);
});

test("copying uses the element's window clipboard and preserves code whitespace", async () => {
  const copied = [];
  const clipboard = { async writeText(value) { assert.strictEqual(this, clipboard); copied.push(value); } };
  const ownerDocument = { defaultView: { navigator: { clipboard } } };
  const value = "  const person = '@Ada';\n\n";
  assert.equal(await copyMarkdownText({ ownerDocument }, value), true);
  assert.deepEqual(copied, [value]);
  assert.equal(await copyMarkdownText(null, value), false);
});

function clipboardDocument(copyResult = true) {
  const events = [];
  const range = {};
  const field = {
    style: {}, setAttribute: (key, value) => events.push([key, value]),
    focus: () => events.push("field focus"), select: () => events.push("select"), remove: () => events.push("remove")
  };
  const selection = { rangeCount: 1, getRangeAt: () => ({ cloneRange: () => range }), removeAllRanges: () => events.push("clear selection"), addRange: (value) => { assert.strictEqual(value, range); events.push("restore selection"); } };
  return {
    events, field,
    doc: {
      defaultView: { navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } } },
      activeElement: { focus: () => events.push("restore focus") }, getSelection: () => selection,
      createElement: (name) => { assert.equal(name, "textarea"); return field; },
      body: { appendChild: (value) => { assert.strictEqual(value, field); events.push("append"); } },
      execCommand: (command) => { assert.equal(command, "copy"); events.push("copy"); return copyResult; }
    }
  };
}

test("clipboard fallback stays in the owning document and restores focus and selection", async () => {
  const { doc, events, field } = clipboardDocument();
  assert.equal(await copyMarkdownText({ ownerDocument: doc }, "code\n"), true);
  assert.equal(field.value, "code\n");
  assert.equal(field.readOnly, true);
  assert.deepEqual(events.slice(-7), ["field focus", "select", "copy", "remove", "restore focus", "clear selection", "restore selection"]);
});

test("clipboard fallback follows adoption into a child document during an async failure", async () => {
  const child = clipboardDocument(false);
  const target = { ownerDocument: { defaultView: { navigator: { clipboard: { writeText: async () => { target.ownerDocument = child.doc; throw new Error("moved"); } } } } } };
  assert.equal(await copyMarkdownText(target, "code"), false);
  assert.equal(child.events.includes("copy"), true);
  assert.equal(child.events.includes("remove"), true);
});

let renderer;
async function renderParsedMarkdown(source, options = {}) {
  renderer ||= Promise.all([import("react"), import("react-dom/server"), import("react-markdown"), import("remark-gfm"),
    import("remark-breaks"), import("rehype-raw"), import("rehype-sanitize"), import("rehype-highlight")]);
  const [react, dom, markdown, gfm, breaks, html, sanitize, highlight] = await renderer;
  return dom.renderToStaticMarkup(react.createElement(markdown.default, {
    remarkPlugins: [gfm.default, breaks.default],
    remarkRehypeOptions: { footnoteLabel: "Notes", footnoteBackContent: "Back to reference" },
    rehypePlugins: [rehypeMarkdownSource, html.default, [rehypeMarkdownText, options], [sanitize.default, markdownSanitizeSchema],
      [highlight.default, { detect: false, plainText: ["text", "txt", "plain", "plaintext"] }], [rehypeMarkdownScope, { scope: "parser" }]],
    urlTransform: markdownUrlTransform,
    children: source
  }));
}

test("CommonMark and GFM parse headings, nested lists, tasks, tables, references, breaks and footnotes", async () => {
  const source = [
    ...Array.from({ length: 6 }, (_, index) => `${"#".repeat(index + 1)} Heading ${index + 1}\n`),
    "Setext heading\n==============\n", "3. outer\n   1. inner\n      - nested\n", "- [x] done\n- [ ] todo\n",
    "| Name | Result |\n| :--- | ---: |\n| Ada | **Ready** |\n", "~~obsolete~~ and *emphasis*\n",
    "[Reference][site] and https://example.com/auto and <team@example.com>\n", "[site]: https://example.com/reference\n",
    "> A quote\n>\n> With another paragraph\n", "first line\nsecond line\n", "Note[^one]. Again[^one].\n", "[^one]: A footnote for @Ada.\n"
  ].join("\n");
  const result = await renderParsedMarkdown(source, { members });
  for (let level = 1; level <= 6; level += 1) assert.match(result, new RegExp(`<h${level}[^>]*>Heading ${level}</h${level}>`));
  for (const fragment of ['<ol start="3">', "<table>", "<thead>", "<tbody>", "<del>obsolete</del>", "<em>emphasis</em>",
    'href="https://example.com/reference"', 'href="https://example.com/auto"', 'href="mailto:team@example.com"',
    "<blockquote>", "first line<br", "data-footnote-ref", "Back to reference", 'class="mention"']) assert.ok(result.includes(fragment), fragment);
  assert.match(result, /<li>outer\s*<ol>[\s\S]*<li>inner\s*<ul>/);
  assert.match(result, /<input[^>]+type="checkbox"[^>]+disabled/);
  assert.equal((result.match(/data-footnote-ref=""/g) || []).length, 2);
  const ids = [...result.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  const fragments = [...result.matchAll(/ href="#([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(fragments.length >= 4);
  assert.ok(fragments.every((id) => ids.includes(id)));
});

test("fenced syntax highlighting survives sanitization and unknown languages stay readable", async () => {
  const result = await renderParsedMarkdown("```js\nconst person = '@Ada';\n```\n\n```not-a-language\n@Ada\n```\n\n`@Ada`", { members, searchQuery: "Ada" });
  assert.ok(result.includes("hljs-keyword"));
  assert.ok(result.includes("language-js"));
  assert.ok(result.includes("language-not-a-language"));
  assert.equal(result.includes('class="mention'), false);
  assert.equal(result.includes("message-search-match"), false);
  assert.ok(result.includes("@Ada"));
});

test("HTML is sanitized and only Markdown text gets mention and search decoration", async () => {
  const source = [
    '<span title="@Ada" onclick="alert(1)" style="color:red">@Ada</span> **@Ada** and `@Ada`',
    '<script>window.bad = true</script>', '<iframe src="https://example.com">frame</iframe>',
    '<form action="https://example.com"><input name="token" value="secret"></form>',
    '<img src="file:///C:/secret.png" srcset="https://example.com/a.png 2x" onerror="alert(1)" alt="Blocked image">',
    '<a href="javascript:alert(1)">blocked</a> <a href="https://u:p@example.com">credentials</a>',
    '<a href="&#x6a;avascript:alert(1)">encoded</a> <a href="/private/file">relative</a>',
    '<div class="message-actions" style="position:fixed"><strong>Harmless HTML</strong></div>',
    '<svg><a href="https://example.com">svg</a></svg>'
  ].join("\n\n");
  const result = await renderParsedMarkdown(source, { members, selfName: "Ada", searchQuery: "Ada" });
  assert.doesNotMatch(result, /<(?:script|iframe|form|svg)\b|\son\w+=|\sstyle=|\ssrcset=|\shref=|file:\/\/\/|window\.bad/);
  assert.ok(result.includes('<span title="@Ada">@Ada</span>'));
  assert.ok(result.includes('<strong>Harmless HTML</strong>'));
  assert.equal((result.match(/class="mention self"/g) || []).length, 1);
  assert.equal((result.match(/class="message-search-match"/g) || []).length, 1);
  assert.ok(result.includes('<code>@Ada</code>'));
});