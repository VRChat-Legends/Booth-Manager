import test from "node:test";
import assert from "node:assert/strict";
import { COMPOSER_LIMIT, formatSelection, formattingShortcut } from "../src/lib/composerFormatting.mjs";

function format(text, start, end, action) {
  const result = formatSelection(text, start, end, action);
  assert.ok(result.start >= 0 && result.start <= result.end && result.end <= result.text.length);
  if (result.changed) {
    assert.equal(result.rejected, false);
    assert.ok(result.text.length <= COMPOSER_LIMIT);
    assert.equal(text.slice(0, result.edit.start) + result.edit.text + text.slice(result.edit.end), result.text);
  } else {
    assert.equal(result.text, text);
    assert.equal(result.edit, null);
  }
  return result;
}

const selected = (result) => result.text.slice(result.start, result.end);
const again = (result, action) => format(result.text, result.start, result.end, action);

test("the composer keeps the existing 1200 character limit", () => {
  assert.equal(COMPOSER_LIMIT, 1200);
});

test("empty inline actions insert selected placeholders", () => {
  for (const [action, value, inner] of [
    ["bold", "**bold text**", "bold text"], ["italic", "*italic text*", "italic text"],
    ["strike", "~~text~~", "text"], ["code", "`code`", "code"]
  ]) {
    const result = format("", 0, 0, action);
    assert.equal(result.text, value);
    assert.equal(selected(result), inner);
    assert.equal(selected(again(result, action)), inner);
  }
});

test("emphasis wraps and toggles the selection without losing its suffix", () => {
  for (const [action, marker] of [["bold", "**"], ["italic", "*"], ["strike", "~~"]]) {
    const source = "say alpha afterwards";
    const result = format(source, 4, 9, action);
    assert.equal(result.text, `say ${marker}alpha${marker} afterwards`);
    assert.equal(selected(result), "alpha");
    const restored = again(result, action);
    assert.equal(restored.text, source);
    assert.equal(restored.start, 4);
    assert.equal(restored.end, 9);
  }
});

test("selecting the delimiters also toggles emphasis off", () => {
  const result = format("one **two** three", 4, 11, "bold");
  assert.equal(result.text, "one two three");
  assert.equal(selected(result), "two");
});

test("italic does not mistake bold for an italic wrapper", () => {
  const inner = format("**two**", 2, 5, "italic");
  assert.equal(inner.text, "***two***");
  assert.equal(again(inner, "italic").text, "**two**");
  assert.equal(format("**two**", 0, 7, "italic").text, "***two***");
  assert.equal(format("***two***", 3, 6, "bold").text, "*two*");
});

test("leading and trailing selection whitespace stays outside emphasis", () => {
  const body = "  hello \t";
  const source = "before" + body + "after";
  const result = format(source, 6, 6 + body.length, "bold");
  assert.equal(result.text, "before  **hello** \tafter");
  assert.equal(selected(result), "hello");
  assert.equal(again(result, "bold").text, source);
});

test("multiline emphasis preserves blank lines and indentation", () => {
  const body = "alpha\n\n  beta ";
  const source = body + "\nlast";
  const result = format(source, 0, body.length, "bold");
  assert.equal(result.text, "**alpha**\n\n  **beta** \nlast");
  assert.equal(again(result, "bold").text, source);
});

test("mixed emphasis does not double an existing wrapper", () => {
  const source = "**one**\ntwo";
  const result = format(source, 0, source.length, "bold");
  assert.equal(result.text, "**one**\n**two**");
  assert.equal(again(result, "bold").text, "one\ntwo");
});

test("blank selections do not produce invalid emphasis", () => {
  const source = " \t\n\n ";
  assert.equal(format(source, 0, source.length, "italic").changed, false);
});

test("insertion at a caret keeps text on both sides", () => {
  const result = format("hello world", 5, 5, "bold");
  assert.equal(result.text, "hello**bold text** world");
  assert.equal(selected(result), "bold text");
});

test("inline code chooses a delimiter longer than embedded backticks", () => {
  const body = "show `x` and ``y``";
  const result = format(body, 0, body.length, "code");
  assert.equal(result.text, "``` " + body + " ```");
  assert.equal(selected(result), body);
  assert.equal(again(result, "code").text, body);
});

test("inline code padding preserves meaningful boundary spaces", () => {
  const body = " padded ";
  const result = format(body, 0, body.length, "code");
  assert.equal(result.text, "`  padded  `");
  assert.equal(selected(result), body);
  assert.equal(again(result, "code").text, body);
});

test("inline code can toggle a selected complete span", () => {
  for (const [source, body] of [["`value`", "value"], ["``one `tick` here``", "one `tick` here"]]) {
    assert.equal(format(source, 0, source.length, "code").text, body);
  }
});

test("multiline inline code formats each line rather than flattening it", () => {
  const source = "a\n\nb";
  const result = format(source, 0, source.length, "code");
  assert.equal(result.text, "`a`\n\n`b`");
  assert.equal(again(result, "code").text, source);
});

test("empty block actions provide selected text to replace", () => {
  for (const [action, value, inner] of [
    ["heading", "## Heading", "Heading"], ["bullet", "- List item", "List item"],
    ["numbered", "1. List item", "List item"], ["task", "- [ ] Task", "Task"],
    ["quote", "> Quote", "Quote"], ["code-block", "```\ncode\n```", "code"]
  ]) {
    const result = format("", 0, 0, action);
    assert.equal(result.text, value);
    assert.equal(selected(result), inner);
    assert.equal(again(result, action).text, inner);
  }
});

test("line tools affect whole touched lines and retain the original selection", () => {
  const source = "one\ntwo\nthree";
  const result = format(source, 1, 5, "bullet");
  assert.equal(result.text, "- one\n- two\nthree");
  assert.equal(result.start, 3);
  assert.equal(result.end, 9);
  const restored = again(result, "bullet");
  assert.equal(restored.text, source);
  assert.equal(restored.start, 1);
  assert.equal(restored.end, 5);
});

test("a selection ending at the next line does not format that line", () => {
  const source = "one\ntwo\nthree";
  const result = format(source, 0, 4, "bullet");
  assert.equal(result.text, "- one\ntwo\nthree");
  assert.equal(again(result, "bullet").text, source);
});

test("numbering skips blank lines and preserves indentation", () => {
  const source = "one\n\n  two\nthree";
  const result = format(source, 0, source.length, "numbered");
  assert.equal(result.text, "1. one\n\n  2. two\n3. three");
  assert.equal(again(result, "numbered").text, source);
});

test("changing list types replaces markers instead of stacking them", () => {
  const source = "* [x] done\n7. next\n+ plain";
  assert.equal(format(source, 0, source.length, "bullet").text, "- done\n- next\n+ plain");
  const numbered = "- one\n9. two\n* three";
  assert.equal(format(numbered, 0, numbered.length, "numbered").text, "1. one\n2. two\n3. three");
});

test("existing checked tasks survive formatting a mixed selection", () => {
  const source = "* [x] done\n2. next";
  const result = format(source, 0, source.length, "task");
  assert.equal(result.text, "* [x] done\n- [ ] next");
  assert.equal(again(result, "task").text, "done\nnext");
});

test("heading levels replace existing heading markers", () => {
  const source = "# one\n### two";
  const result = format(source, 0, source.length, "heading");
  assert.equal(result.text, "## one\n## two");
  assert.equal(again(result, "heading").text, "one\ntwo");
  assert.equal(format("title", 0, 5, "heading-1").text, "# title");
  assert.equal(format("title", 0, 5, "heading-6").text, "###### title");
});

test("quote toggling removes only one level", () => {
  const source = "> > nested\nplain";
  const result = format(source, 0, source.length, "quote");
  assert.equal(result.text, "> > nested\n> plain");
  assert.equal(again(result, "quote").text, "> nested\nplain");
});

test("a caret inside an existing line stays at the same text position", () => {
  const result = format("one\ntwo", 6, 6, "quote");
  assert.equal(result.text, "one\n> two");
  assert.equal(result.start, 8);
  assert.equal(result.end, 8);
});

test("line transforms preserve CRLF and the untouched suffix", () => {
  const source = "one\r\ntwo\r\nlast";
  const result = format(source, 0, 8, "bullet");
  assert.equal(result.text, "- one\r\n- two\r\nlast");
  assert.equal(again(result, "bullet").text, source);
});

test("code blocks expand to whole lines and toggle around their contents", () => {
  const source = "before\nrun()\nafter";
  const result = format(source, 8, 10, "code-block");
  assert.equal(result.text, "before\n```\nrun()\n```\nafter");
  assert.equal(selected(result), "run()");
  assert.equal(again(result, "code-block").text, source);
});

test("code fences cannot collide with selected backtick runs", () => {
  const source = "example\n```\ninside\n````\nend";
  const result = format(source, 0, source.length, "code-block");
  assert.equal(result.text, "`````\n" + source + "\n`````");
  assert.equal(selected(result), source);
  assert.equal(again(result, "code-block").text, source);
});

test("complete code blocks toggle with a language or a longer tilde closing fence", () => {
  const source = "```js\nconst n = 1;\n```";
  assert.equal(format(source, 0, source.length, "code-block").text, "const n = 1;");
  const tilde = "~~~txt\nkeep ``` literal\n~~~~";
  assert.equal(format(tilde, 0, tilde.length, "code-block").text, "keep ``` literal");
});

test("code block selection boundaries leave the next line outside the fence", () => {
  assert.equal(format("one\ntwo", 0, 4, "code-block").text, "```\none\n```\ntwo");
});

test("code blocks preserve CRLF", () => {
  const source = "before\r\ncode\r\nafter";
  const result = format(source, 8, 12, "code-block");
  assert.equal(result.text, "before\r\n```\r\ncode\r\n```\r\nafter");
  assert.equal(again(result, "code-block").text, source);
});

test("links escape the selected label and select the address for editing", () => {
  const source = "before [value] after";
  const result = format(source, 7, 14, "link");
  assert.equal(result.text, "before [\\[value\\]](https://example.com) after");
  assert.equal(selected(result), "https://example.com");
  assert.equal(format("", 0, 0, "link").text, "[link text](https://example.com)");
});

test("selected addresses become destinations with an editable label", () => {
  const address = "https://example.com/a(b)";
  const source = "before " + address + " after";
  const result = format(source, 7, 7 + address.length, "link");
  assert.equal(result.text, "before [link text](https://example.com/a%28b%29) after");
  assert.equal(selected(result), "link text");
});

test("links reject multiple paragraphs without changing any text", () => {
  const source = "one\n\ntwo";
  const result = format(source, 0, source.length, "link");
  assert.equal(result.rejected, true);
  assert.match(result.message, /one paragraph/);
});

test("the table template has a header, delimiter row and editable cells", () => {
  const result = format("", 0, 0, "table");
  assert.equal(result.text, "| Column 1 | Column 2 |\n| --- | --- |\n| Text | Text |");
  assert.equal(selected(result), "Column 1");
});

test("selected tab separated rows become a GFM table", () => {
  const source = "Name\tRole\nAda\tOwner\nBen\tMember";
  const result = format(source, 0, source.length, "table");
  assert.equal(result.text, "| Name | Role |\n| --- | --- |\n| Ada | Owner |\n| Ben | Member |");
  assert.equal(selected(result), "Name");
});

test("table cells escape pipes and backslashes", () => {
  const source = "A|B\tC\\D\none\ttwo";
  assert.equal(format(source, 0, source.length, "table").text, "| A\\|B | C\\\\D |\n| --- | --- |\n| one | two |");
});

test("table insertion separates neighboring paragraphs without dropping them", () => {
  const body = "Name\tRole";
  const result = format("lead" + body + "tail", 4, 4 + body.length, "table");
  assert.equal(result.text, "lead\n\n| Name | Role |\n| --- | --- |\n| Text | Text |\n\ntail");
  const separated = "lead\n\n" + body + "\n\ntail";
  assert.equal(format(separated, 6, 6 + body.length, "table").text, result.text);
});

test("formatting at exactly the limit succeeds and one character over is rejected", () => {
  for (const [action, extra] of [["bold", 4], ["italic", 2], ["strike", 4], ["code", 2], ["code-block", 8]]) {
    const fits = "x".repeat(COMPOSER_LIMIT - extra);
    assert.equal(format(fits, 0, fits.length, action).text.length, COMPOSER_LIMIT);
    const exceeds = fits + "x";
    const result = format(exceeds, 0, exceeds.length, action);
    assert.equal(result.rejected, true, action);
    assert.equal(result.start, 0);
    assert.equal(result.end, exceeds.length);
    assert.match(result.message, /1200 character limit/);
  }
});

test("placeholder insertion respects the boundary without truncation", () => {
  const fits = "x".repeat(1187);
  assert.equal(format(fits, fits.length, fits.length, "bold").text.length, COMPOSER_LIMIT);
  const exceeds = fits + "x";
  assert.equal(format(exceeds, exceeds.length, exceeds.length, "bold").rejected, true);
});

test("format removal still works at the limit", () => {
  const body = "x".repeat(1196);
  const source = "**" + body + "**";
  assert.equal(format(source, 2, source.length - 2, "bold").text, body);
});

test("large list and table expansions are rejected atomically", () => {
  const list = "item\n".repeat(200);
  assert.equal(format(list, 0, list.length, "task").rejected, true);
  const table = "x".repeat(1180) + "suffix";
  const result = format(table, 0, 1180, "table");
  assert.equal(result.rejected, true);
  assert.equal(result.text.endsWith("suffix"), true);
});

test("length uses UTF16 units like the textarea and existing counter", () => {
  const letter = String.fromCodePoint(0x10400);
  const fits = letter.repeat(598);
  const result = format(fits, 0, fits.length, "bold");
  assert.equal(result.text.length, 1200);
  assert.equal(selected(result), fits);
  const exceeds = fits + letter;
  assert.equal(format(exceeds, 0, exceeds.length, "bold").rejected, true);
});

test("selection bounds are clamped and reversed ranges are normalized", () => {
  assert.equal(format("abc", -8, 20, "bold").text, "**abc**");
  assert.equal(format("abc", 2, 1, "bold").text, "a**b**c");
  assert.equal(format("abc", 0.9, 2.9, "bold").text, "**ab**c");
  assert.equal(format("abc", undefined, undefined, "bold").text, "abc**bold text**");
  const unknown = format("abc", 1, 2, "unknown");
  assert.equal(unknown.changed, false);
  assert.equal(unknown.rejected, false);
});

test("formatting keyboard shortcuts leave navigation and sending alone", () => {
  for (const [key, shiftKey, action] of [["b", false, "bold"], ["I", false, "italic"], ["x", true, "strike"], ["`", false, "code"]]) {
    assert.equal(formattingShortcut({ key, shiftKey, ctrlKey: true }), action);
  }
  assert.equal(formattingShortcut({ key: "b", metaKey: true }), "bold");
  for (const event of [
    { key: "k", ctrlKey: true }, { key: "K", ctrlKey: true, shiftKey: true },
    { key: "Enter", ctrlKey: true }, { key: "Enter" }, { key: "Tab" }, { key: "ArrowDown" },
    { key: "b" }, { key: "b", ctrlKey: true, shiftKey: true }, { key: "i", ctrlKey: true, altKey: true }
  ]) assert.equal(formattingShortcut(event), null);
});

test("composition and repeated key events never format", () => {
  for (const guard of [{ isComposing: true }, { nativeEvent: { isComposing: true } }, { keyCode: 229 }, { nativeEvent: { keyCode: 229 } }, { repeat: true }]) {
    assert.equal(formattingShortcut({ key: "b", ctrlKey: true, ...guard }), null);
  }
});