export const COMPOSER_LIMIT = 1200;

const INLINE = { bold: ["**", "bold text"], italic: ["*", "italic text"], strike: ["~~", "text"] };
const LIST_PREFIX = /^(?:[-+*]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/;
const LINE_ACTIONS = new Set(["heading", "bullet", "numbered", "task", "quote"]);

function selection(text, start, end) {
  const clamp = (value, fallback) => Number.isFinite(value) ? Math.max(0, Math.min(text.length, Math.trunc(value))) : fallback;
  const first = clamp(start, text.length);
  const last = clamp(end, first);
  return [Math.min(first, last), Math.max(first, last)];
}

function unchanged(text, start, end, message = "") {
  return { text, start, end, changed: false, rejected: Boolean(message), message, edit: null };
}

function finish(text, start, end, nextText, nextStart, nextEnd) {
  if (nextText.length > COMPOSER_LIMIT) {
    return unchanged(text, start, end, "Formatting would exceed the 1200 character limit. Shorten the draft and try again.");
  }
  if (nextText === text) return unchanged(text, start, end);
  let from = 0;
  while (from < text.length && from < nextText.length && text[from] === nextText[from]) from++;
  let oldEnd = text.length;
  let newEnd = nextText.length;
  while (oldEnd > from && newEnd > from && text[oldEnd - 1] === nextText[newEnd - 1]) { oldEnd--; newEnd--; }
  return {
    text: nextText, start: nextStart, end: nextEnd, changed: true, rejected: false, message: "",
    edit: { start: from, end: oldEnd, text: nextText.slice(from, newEnd) }
  };
}

function replace(text, start, end, from, to, value, innerStart = 0, innerEnd = value.length) {
  return finish(text, start, end, text.slice(0, from) + value + text.slice(to), from + innerStart, from + innerEnd);
}

function longestTicks(value) {
  return Math.max(0, ...(value.match(/`+/g) || []).map((run) => run.length));
}

function escaped(text, at) {
  let count = 0;
  while (at > 0 && text[--at] === "\\") count++;
  return count % 2 === 1;
}

function hasEmphasis(value, marker) {
  if (!value.startsWith(marker) || !value.endsWith(marker) || value.length <= marker.length * 2) return false;
  if (escaped(value, value.length - marker.length)) return false;
  if (marker !== "*") return true;
  return /^\*+/.exec(value)[0].length % 2 === 1 && /\*+$/.exec(value)[0].length % 2 === 1;
}

function surroundingEmphasis(text, start, end, marker) {
  if (start < marker.length || text.slice(start - marker.length, start) !== marker || text.slice(end, end + marker.length) !== marker) return false;
  if (escaped(text, start - marker.length) || escaped(text, end)) return false;
  if (marker !== "*") return true;
  return (/\*+$/.exec(text.slice(0, start))?.[0].length || 0) % 2 === 1
    && (/^\*+/.exec(text.slice(end))?.[0].length || 0) % 2 === 1;
}

function emphasis(text, start, end, action) {
  const [marker, placeholder] = INLINE[action];
  const selected = text.slice(start, end);
  if (!selected.includes("\n") && surroundingEmphasis(text, start, end, marker)) {
    return replace(text, start, end, start - marker.length, end + marker.length, selected);
  }
  if (start === end) return replace(text, start, end, start, end, marker + placeholder + marker, marker.length, marker.length + placeholder.length);
  const parts = selected.split(/(\r?\n)/);
  const content = parts.filter((part, index) => index % 2 === 0 && part.trim());
  const remove = content.length > 0 && content.every((part) => hasEmphasis(part.trim(), marker));
  const value = parts.map((part, index) => {
    if (index % 2 || !part.trim()) return part;
    const leading = /^[ \t]*/.exec(part)[0];
    const trailing = /[ \t]*$/.exec(part)[0];
    const body = part.slice(leading.length, part.length - trailing.length);
    const formatted = hasEmphasis(body, marker);
    return leading + (remove ? body.slice(marker.length, -marker.length) : formatted ? body : marker + body + marker) + trailing;
  }).join("");
  if (parts.length > 1) return replace(text, start, end, start, end, value);
  const leading = /^[ \t]*/.exec(selected)[0].length;
  const trailing = /[ \t]*$/.exec(selected)[0].length;
  return replace(text, start, end, start, end, value, leading + (remove ? 0 : marker.length), value.length - trailing - (remove ? 0 : marker.length));
}

function unwrapCode(value) {
  const fence = /^`+/.exec(value)?.[0];
  if (!fence || !value.endsWith(fence) || value.length <= fence.length * 2) return null;
  let body = value.slice(fence.length, -fence.length);
  if (longestTicks(body) >= fence.length) return null;
  if (body.startsWith(" ") && body.endsWith(" ") && body.trim()) body = body.slice(1, -1);
  return body;
}

function wrapCode(value) {
  const fence = "`".repeat(longestTicks(value) + 1);
  const padding = value.startsWith("`") || value.endsWith("`") || (value.startsWith(" ") && value.endsWith(" ") && value.trim()) ? " " : "";
  return { value: fence + padding + value + padding + fence, offset: fence.length + padding.length };
}

function inlineCode(text, start, end) {
  const selected = text.slice(start, end);
  if (!selected.includes("\n")) {
    const left = /(`+)( ?)$/.exec(text.slice(0, start));
    const right = /^( ?)(`+)/.exec(text.slice(end));
    if (left && right && left[1] === right[2] && !escaped(text, start - left[0].length)) {
      const entire = left[0] + selected + right[0];
      if (unwrapCode(entire) === selected) return replace(text, start, end, start - left[0].length, end + right[0].length, selected);
    }
    const unwrapped = unwrapCode(selected);
    if (unwrapped !== null) return replace(text, start, end, start, end, unwrapped);
    const body = selected || "code";
    const wrapped = wrapCode(body);
    return replace(text, start, end, start, end, wrapped.value, wrapped.offset, wrapped.offset + body.length);
  }
  const parts = selected.split(/(\r?\n)/);
  const content = parts.filter((part, index) => index % 2 === 0 && part);
  const remove = content.length > 0 && content.every((part) => unwrapCode(part) !== null);
  const value = parts.map((part, index) => index % 2 || !part ? part : remove ? unwrapCode(part) : unwrapCode(part) !== null ? part : wrapCode(part).value).join("");
  return replace(text, start, end, start, end, value);
}

function lineRange(text, start, end) {
  const from = start === 0 ? 0 : text.lastIndexOf("\n", start - 1) + 1;
  const last = end > start && text[end - 1] === "\n" ? end - 1 : end;
  const newline = text.indexOf("\n", last);
  let to = newline < 0 ? text.length : newline;
  if (to > from && text[to - 1] === "\r") to--;
  return { from, to };
}

function mapPosition(position, edits) {
  let shift = 0;
  for (const edit of edits) {
    if (position < edit.start) break;
    if (position <= edit.end) return edit.start + shift + edit.text.length;
    shift += edit.text.length - (edit.end - edit.start);
  }
  return position + shift;
}

function lineFormatting(text, start, end, action) {
  const { from, to } = lineRange(text, start, end);
  const pieces = text.slice(from, to).split(/(\r?\n)/);
  const rows = [];
  let offset = from;
  const level = /^heading-([1-6])$/.exec(action)?.[1] || "2";
  const heading = action === "heading" || action.startsWith("heading-");
  for (let index = 0; index < pieces.length; index++) {
    const line = pieces[index];
    if (index % 2 === 0 && (line.trim() || pieces.length === 1)) {
      const indent = /^[ \t]*/.exec(line)[0];
      const body = line.slice(indent.length);
      const prefix = (heading ? /^#{1,6}(?:[ \t]+|$)/ : action === "quote" ? /^>[ \t]?/ : LIST_PREFIX).exec(body)?.[0] || "";
      const matches = heading ? prefix.trim() === "#".repeat(Number(level)) : action === "quote" ? Boolean(prefix)
        : action === "task" ? /\[[ xX]\]/.test(prefix) : action === "numbered" ? /^\d+[.)]/.test(prefix) && !/\[[ xX]\]/.test(prefix)
          : /^[-+*]/.test(prefix) && !/\[[ xX]\]/.test(prefix);
      rows.push({ at: offset + indent.length, prefix, matches, empty: !body });
    }
    offset += line.length;
  }
  const remove = rows.length > 0 && rows.every((row) => row.matches);
  const placeholder = heading ? "Heading" : action === "quote" ? "Quote" : action === "task" ? "Task" : "List item";
  const edits = rows.map((row, index) => {
    const prefix = heading ? `${"#".repeat(Number(level))} ` : action === "quote" ? "> " : action === "task" ? "- [ ] " : action === "numbered" ? `${index + 1}. ` : "- ";
    const nextPrefix = remove ? "" : row.matches && action !== "numbered" ? row.prefix : prefix;
    return { start: row.at, end: row.at + row.prefix.length, text: nextPrefix + (row.empty && !remove ? placeholder : "") };
  });
  let next = text;
  for (const edit of [...edits].reverse()) next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  let nextStart = mapPosition(start, edits);
  let nextEnd = mapPosition(end, edits);
  if (rows.length === 1 && rows[0].empty && !remove) {
    nextEnd = rows[0].at + edits[0].text.length;
    nextStart = nextEnd - placeholder.length;
  }
  return finish(text, start, end, next, nextStart, nextEnd);
}

function fencedBody(value) {
  const lines = value.split(/\r?\n/);
  const opening = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[0]);
  if (!opening || lines.length < 3 || (opening[1][0] === "`" && opening[2].includes("`"))) return null;
  const closing = new RegExp(`^ {0,3}${opening[1][0]}{${opening[1].length},}[ \\t]*$`);
  if (!closing.test(lines.at(-1)) || lines.slice(1, -1).some((line) => closing.test(line))) return null;
  const firstBreak = value.indexOf("\n") + 1;
  let lastBreak = value.lastIndexOf("\n");
  if (value[lastBreak - 1] === "\r") lastBreak--;
  return value.slice(firstBreak, lastBreak);
}

function codeBlock(text, start, end) {
  const { from, to } = lineRange(text, start, end);
  const selected = text.slice(from, to);
  const direct = fencedBody(selected);
  if (direct !== null) return replace(text, start, end, from, to, direct);
  if (from > 0 && to < text.length) {
    const previous = from <= 1 ? 0 : text.lastIndexOf("\n", from - 2) + 1;
    const nextStart = to + (text.slice(to, to + 2) === "\r\n" ? 2 : 1);
    const nextBreak = text.indexOf("\n", nextStart);
    let nextEnd = nextBreak < 0 ? text.length : nextBreak;
    if (text[nextEnd - 1] === "\r") nextEnd--;
    if (fencedBody(text.slice(previous, nextEnd)) === selected) return replace(text, start, end, previous, nextEnd, selected);
  }
  const body = selected || "code";
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const fence = "`".repeat(Math.max(3, longestTicks(body) + 1));
  const prefix = fence + newline;
  return replace(text, start, end, from, to, prefix + body + newline + fence, prefix.length, prefix.length + body.length);
}

function link(text, start, end) {
  const selected = text.slice(start, end);
  if (/\r?\n[ \t]*\r?\n/.test(selected)) return unchanged(text, start, end, "Select one paragraph at a time when adding a link.");
  const isAddress = /^(?:https?:\/\/|mailto:)[^\s<>]+$/i.test(selected);
  const label = isAddress ? "link text" : (selected || "link text").replace(/([\\[\]])/g, "\\$1");
  const address = isAddress ? selected.replace(/\\/g, "%5C").replace(/\(/g, "%28").replace(/\)/g, "%29") : "https://example.com";
  const value = `[${label}](${address})`;
  const innerStart = isAddress ? 1 : label.length + 3;
  return replace(text, start, end, start, end, value, innerStart, innerStart + (isAddress ? label.length : address.length));
}

function table(text, start, end) {
  const selected = text.slice(start, end);
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const before = text.slice(0, start);
  const after = text.slice(end);
  const gapBefore = !before || /\r?\n[ \t]*\r?\n$/.test(before) ? "" : before.endsWith("\n") ? newline : newline + newline;
  const gapAfter = !after || /^\r?\n[ \t]*\r?\n/.test(after) ? "" : /^\r?\n/.test(after) ? newline : newline + newline;
  const cell = (value) => value.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
  const rows = selected ? selected.split(/\r?\n/).map((row) => row.split("\t").map(cell)) : [["Column 1", "Column 2"], ["Text", "Text"]];
  const width = Math.max(2, ...rows.map((row) => row.length));
  const rowText = (row) => `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
  const header = rowText(rows[0]);
  const body = [header, rowText(Array(width).fill("---")), ...rows.slice(1).map(rowText)];
  if (rows.length === 1) body.push(rowText(Array(width).fill("Text")));
  const value = gapBefore + body.join(newline) + gapAfter;
  return replace(text, start, end, start, end, value, gapBefore.length + 2, gapBefore.length + 2 + rows[0][0].length);
}

export function formatSelection(value, start, end, action) {
  const text = String(value ?? "");
  [start, end] = selection(text, start, end);
  if (Object.hasOwn(INLINE, action)) return emphasis(text, start, end, action);
  if (action === "code") return inlineCode(text, start, end);
  if (action === "code-block") return codeBlock(text, start, end);
  if (action === "link") return link(text, start, end);
  if (action === "table") return table(text, start, end);
  if (LINE_ACTIONS.has(action) || /^heading-[1-6]$/.test(action)) return lineFormatting(text, start, end, action);
  return unchanged(text, start, end);
}

export function formattingShortcut(event) {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.isComposing || event.nativeEvent?.isComposing || event.keyCode === 229 || event.nativeEvent?.keyCode === 229 || event.repeat) return null;
  const key = String(event.key || "").toLowerCase();
  if (event.shiftKey) return key === "x" ? "strike" : null;
  return key === "b" ? "bold" : key === "i" ? "italic" : key === "`" ? "code" : null;
}