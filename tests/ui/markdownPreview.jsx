import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles.css";

if (!["localhost", "127.0.0.1"].includes(location.hostname) || window.boothApi) {
  throw new Error("Open this fixture in the local desktop browser preview, not the signed in app.");
}

const fixture = window.__markdownFixture = { external: [], errors: [] };
window.addEventListener("error", (event) => fixture.errors.push(event.message));
window.addEventListener("unhandledrejection", (event) => fixture.errors.push(String(event.reason)));
window.boothApi = { openExternal: async (url) => { fixture.external.push(url); return { ok: true }; } };
const { MarkdownView } = await import("../../src/lib/markdown.jsx");
const members = [{ name: "Ada" }, { name: "Ada Lovelace" }, { name: "A[1]" }];
const sample = [
  "# Markdown desktop preview", "Hello **@Ada**, ask @Ada Lovelace or @A[1]. Search treats `a+b.*` literally.",
  "## Nested lists", "3. Ordered outer item\n   1. Inner item\n      - Third level\n      - Another item\n4. Next item",
  "- [x] Checked task\n- [ ] Open task", "### Table", "| Person | Status | Count |\n| :--- | :---: | ---: |\n| @Ada | **Ready** | 42 |\n| Avery | ~~Old~~ New | 7 |",
  "#### Code", "```js\nconst person = '@Ada';\nconst markup = '<b>not HTML</b>';\nconsole.log(person, markup);\n```",
  "```unknown-language\n@Ada stays plain here\n```", "##### Links", "[Reference link][site], https://example.com/auto and <team@example.com>.",
  "[Jump to images](#images) or read a note[^one]. The note repeats here[^one].", "[site]: https://example.com/reference",
  "###### More formatting", "> A quote for @Ada\n>\n> Nested **formatting** and ~~strike~~.", "First line\nSecond line", "---",
  "## Images", "![Stage plan](https://markdown-fixture.invalid/plan.png)",
  "[![Linked poster](https://markdown-fixture.invalid/poster.png)](https://example.com/poster)",
  "![Blocked local image](booth-local://private/image.png)", "![Blocked data image](data:image/png;base64,AAAA)",
  "## Safe HTML", '<span style="color:red" onclick="alert(1)">@Ada stays plain in HTML</span> and **@Ada gets a mention**.',
  '<details><summary>Harmless disclosure</summary><p>This HTML is sanitized.</p></details>',
  '<script>window.__markdownExecuted = true</script>', '<iframe src="https://markdown-fixture.invalid/frame"></iframe>',
  '<form action="https://markdown-fixture.invalid/form"><input name="secret"></form>',
  '<img src="file:///C:/secret.png" onerror="window.__markdownExecuted = true" alt="Blocked file image">',
  '<a href="javascript:alert(1)">Blocked script link</a> <a href="https://user:password@example.com">Blocked credentials</a>',
  "[^one]: A note for @Ada. Its return links stay inside this preview."
].join("\n\n");

function Preview() {
  const [searchQuery, setSearchQuery] = useState("Ada");
  const [showMediaPreviews, setShowMediaPreviews] = useState(true);
  const [textOnly, setTextOnly] = useState(false);
  const [text, setText] = useState(sample);
  return (
    <main style={{ padding: 24, maxWidth: 1500, margin: "auto", minWidth: 850, height: "100vh", overflow: "auto" }}>
      <h1>Markdown desktop fixture</h1>
      <p>Links are recorded without opening the browser. Image samples use a reserved test host and should not request anything before Load image is selected.</p>
      <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 20 }}>
        <label>Search <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /></label>
        <label><input type="checkbox" checked={showMediaPreviews} onChange={(event) => setShowMediaPreviews(event.target.checked)} /> Show image previews</label>
        <label><input type="checkbox" checked={textOnly} onChange={(event) => setTextOnly(event.target.checked)} /> Text only</label>
      </div>
      <details style={{ marginBottom: 20 }}>
        <summary>Edit sample Markdown</summary>
        <textarea aria-label="Sample Markdown" value={text} onChange={(event) => setText(event.target.value)} style={{ width: "100%", height: 260, fontFamily: "Consolas, monospace" }} />
      </details>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 20 }}>
        {["First message", "Second message"].map((label) => (
          <section key={label} aria-label={label} style={{ minWidth: 0, padding: 18, border: "1px solid #ffffff19", borderRadius: 4, background: "#1a1521", fontSize: 14, lineHeight: 1.65 }}>
            <MarkdownView text={text} members={members} selfName="Ada" searchQuery={searchQuery} showMediaPreviews={showMediaPreviews} textOnly={textOnly} />
          </section>
        ))}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);