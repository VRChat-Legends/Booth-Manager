import { messageTextParts } from "./chatMessages.mjs";

const SOURCE_KEY = Symbol("markdownSource");
const CLOBBER_PREFIX = "markdown-source-";
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const ENCODED_CONTROL = /%(?:0[0-9a-f]|1[0-9a-f]|7f)|%c2%[89][0-9a-f]/i;
const CODE_TAGS = new Set(["code", "pre", "kbd", "samp", "script", "style", "textarea"]);

export const markdownSanitizeSchema = {
  tagNames: [
    "a", "abbr", "b", "blockquote", "br", "code", "dd", "del", "details", "div", "dl", "dt", "em",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "input", "ins", "kbd", "li", "mark",
    "ol", "p", "pre", "q", "s", "samp", "section", "span", "strike", "strong", "sub", "summary", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"
  ],
  attributes: {
    "*": ["id", "title"],
    a: ["href", "ariaLabel", "ariaDescribedBy", "dataFootnoteRef", "dataFootnoteBackref", ["className", "data-footnote-backref"]],
    code: [["className", /^language-[a-z0-9_+#.-]+$/i, "no-highlight", "nohighlight"]],
    details: ["open"],
    h2: [["className", "sr-only"]],
    img: ["src", "alt"],
    input: [["type", "checkbox"], "checked", "disabled"],
    li: [["className", "task-list-item"]],
    mark: [["className", "message-search-match"]],
    ol: ["start"],
    section: ["dataFootnotes", ["className", "footnotes"]],
    span: [["className", "mention", "self"]],
    td: [["align", "left", "center", "right"]],
    th: [["align", "left", "center", "right"]],
    ul: [["className", "contains-task-list"]]
  },
  protocols: { href: ["https", "http", "mailto"], src: ["https"] },
  required: { input: { type: "checkbox", disabled: true } },
  clobber: ["id", "name"],
  clobberPrefix: CLOBBER_PREFIX,
  strip: [
    "applet", "audio", "base", "button", "canvas", "embed", "form", "frame", "frameset", "iframe",
    "link", "math", "meta", "noembed", "noframes", "noscript", "object", "option", "picture", "plaintext",
    "script", "select", "source", "style", "svg", "template", "textarea", "title", "track", "video", "xmp"
  ]
};

export function markdownFragment(value) {
  if (typeof value !== "string" || !value.startsWith("#") || value.length < 2) return "";
  try {
    const id = decodeURIComponent(value.slice(1));
    return CONTROL.test(id) ? "" : id;
  } catch {
    return "";
  }
}

export function safeMarkdownUrl(value, { image = false } = {}) {
  if (typeof value !== "string" || CONTROL.test(value) || ENCODED_CONTROL.test(value) || value.includes("\\")) return "";
  const href = value.trim();
  if (!image && href.startsWith("#")) return markdownFragment(href) ? href : "";
  try {
    const url = new URL(href);
    if (/^https?:\/\//i.test(href) && ["http:", "https:"].includes(url.protocol)) {
      const authority = href.slice(href.indexOf("//") + 2).split(/[/?#]/, 1)[0];
      if (!authority || !url.hostname || url.username || url.password || authority.includes("@")) return "";
      return image && url.protocol !== "https:" ? "" : url.href;
    }
    if (image || !/^mailto:/i.test(href) || /^mailto:\//i.test(href) || url.host || url.protocol !== "mailto:" || url.hash) return "";
    const recipients = decodeURIComponent(url.pathname).split(",");
    if (!recipients.length || recipients.some((recipient) => {
      const parts = recipient.split("@");
      return parts.length !== 2 || !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(parts[0])
        || !parts[1].split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
    })) return "";
    for (const [key, content] of url.searchParams) {
      if (!["subject", "body"].includes(key.toLowerCase()) || CONTROL.test(content)) return "";
    }
    return url.href;
  } catch {
    return "";
  }
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children || []) walk(child, visit);
}

function offsetRange(node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && end >= start ? [start, end] : null;
}

function elementKey(node) {
  return `${node.tagName}:${node.position?.start?.offset}`;
}

export function captureMarkdownSource(tree) {
  const elements = new Set();
  const rawRanges = [];
  walk(tree, (node) => {
    if (node.type === "element") elements.add(elementKey(node));
    if (node.type === "raw" || node.type === "html") {
      const range = offsetRange(node);
      if (range) rawRanges.push(range);
    }
  });
  return { elements, rawRanges };
}

function rawRegions(tree, source) {
  const ranges = [...source.rawRanges];
  if (!ranges.length) return ranges;
  // raw tags can move text outside its orginal parent
  walk(tree, (node) => {
    if (node.type !== "element" || source.elements.has(elementKey(node))) return;
    const range = offsetRange(node);
    if (range) ranges.push(range);
  });
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous && range[0] <= previous[1]) previous[1] = Math.max(previous[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

function overlapsRaw(node, ranges) {
  if (!ranges.length) return false;
  const range = offsetRange(node);
  if (!range) return true;
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (ranges[middle][1] <= range[0]) low = middle + 1;
    else high = middle;
  }
  return low < ranges.length && ranges[low][0] < range[1];
}

export function markdownText(node) {
  if (node.type === "text") return node.value;
  return (node.children || []).map(markdownText).join("");
}

export function decorateMarkdownTree(tree, { members = [], selfName = "", searchQuery = "" } = {}, source = captureMarkdownSource(tree)) {
  const regions = rawRegions(tree, source);
  const element = (tagName, className, children) => ({ type: "element", tagName, properties: { className }, children });
  const text = (value) => ({ type: "text", value });
  const visit = (parent, insideRaw = false) => {
    if (CODE_TAGS.has(parent.tagName) || parent.type === "raw" || parent.type === "html") return;
    if (parent.properties?.dataFootnoteRef !== undefined || parent.properties?.dataFootnoteBackref !== undefined) return;
    const raw = insideRaw || (parent.type === "element" && source.rawRanges.length > 0
      && !source.elements.has(elementKey(parent)));
    if (!parent.children || raw) return;
    parent.children = parent.children.flatMap((child) => {
      if (child.type !== "text") {
        visit(child, raw);
        return [child];
      }
      if (overlapsRaw(child, regions)) return [child];
      const segments = messageTextParts(child.value, members, selfName, searchQuery);
      if (!segments.some((segment) => segment.mention || segment.parts.some((part) => part.match))) return [child];
      return segments.flatMap((segment) => {
        const children = segment.parts.map((part) => part.match
          ? element("mark", ["message-search-match"], [text(part.text)]) : text(part.text));
        return segment.mention ? [element("span", segment.self ? ["mention", "self"] : ["mention"], children)] : children;
      });
    });
  };
  visit(tree);
  return tree;
}

export function rehypeMarkdownSource() {
  return (tree, file) => { file.data[SOURCE_KEY] = captureMarkdownSource(tree); };
}

export function rehypeMarkdownText(options) {
  return (tree, file) => decorateMarkdownTree(tree, options, file.data[SOURCE_KEY]);
}

export function scopeMarkdownTree(tree, scope) {
  const prefix = `markdown-${String(scope).replace(/[^a-z0-9_-]/gi, "") || "root"}`;
  const ids = new Map();
  const headings = new Map();
  let count = 0;
  walk(tree, (node) => {
    if (node.type !== "element") return;
    const props = node.properties ||= {};
    let original = typeof props.id === "string" ? props.id : "";
    if (original.startsWith(CLOBBER_PREFIX)) original = original.slice(CLOBBER_PREFIX.length);
    if (!original && /^h[1-6]$/.test(node.tagName)) {
      const base = markdownText(node).normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\s-]/gu, "")
        .trim().replace(/\s+/g, "-") || "section";
      const duplicates = headings.get(base) || 0;
      headings.set(base, duplicates + 1);
      original = duplicates ? `${base}-${duplicates}` : base;
    }
    delete props.name;
    if (!original) return;
    props.id = `${prefix}-${++count}`;
    if (!ids.has(original)) ids.set(original, props.id);
  });
  walk(tree, (node) => {
    if (node.type !== "element") return;
    const props = node.properties;
    if (node.tagName === "a") {
      const safe = safeMarkdownUrl(props.href);
      const target = safe.startsWith("#") ? ids.get(markdownFragment(safe)) : "";
      const href = safe.startsWith("#") ? (target ? `#${target}` : "") : safe;
      if (href) props.href = href;
      else delete props.href;
    }
    if (node.tagName === "img") {
      const src = safeMarkdownUrl(props.src, { image: true });
      if (src) props.src = src;
      else delete props.src;
      delete props.srcSet;
    }
    if (props.ariaDescribedBy) {
      const refs = Array.isArray(props.ariaDescribedBy) ? props.ariaDescribedBy : String(props.ariaDescribedBy).split(/\s+/);
      const scoped = refs.map((id) => ids.get(id)).filter(Boolean);
      if (scoped.length) props.ariaDescribedBy = scoped;
      else delete props.ariaDescribedBy;
    }
  });
  return tree;
}

export function rehypeMarkdownScope({ scope }) {
  return (tree) => scopeMarkdownTree(tree, scope);
}

export function markdownUrlTransform(url, key) {
  return safeMarkdownUrl(url, { image: key === "src" });
}

export function focusMarkdownFragment(container, href) {
  const id = markdownFragment(href);
  if (!container || !id) return false;
  const target = [...container.querySelectorAll("[id]")].find((element) => element.id === id);
  if (!target) return false;
  target.scrollIntoView?.({ block: "nearest", inline: "nearest", behavior: "instant" });
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
    target.addEventListener("blur", () => target.removeAttribute("tabindex"), { once: true });
  }
  target.focus?.({ preventScroll: true });
  return true;
}

export async function copyMarkdownText(element, value) {
  let doc = element?.ownerDocument;
  if (!doc || typeof value !== "string") return false;
  try {
    const clipboard = doc.defaultView?.navigator?.clipboard;
    if (clipboard?.writeText) {
      await clipboard.writeText(value);
      return true;
    }
  } catch {}
  doc = element?.ownerDocument;
  if (!doc?.body || typeof doc.execCommand !== "function") return false;
  const active = doc.activeElement;
  const selection = doc.getSelection?.();
  const ranges = [];
  for (let index = 0; index < (selection?.rangeCount || 0); index += 1) ranges.push(selection.getRangeAt(index).cloneRange());
  const field = doc.createElement("textarea");
  field.value = value;
  field.readOnly = true;
  field.tabIndex = -1;
  field.setAttribute("aria-hidden", "true");
  field.style.cssText = "position:fixed;inset:0 auto auto 0;width:1px;height:1px;opacity:0;pointer-events:none";
  try {
    doc.body.appendChild(field);
    field.focus({ preventScroll: true });
    field.select();
    return Boolean(doc.execCommand("copy"));
  } catch {
    return false;
  } finally {
    field.remove();
    try {
      active?.focus({ preventScroll: true });
      selection?.removeAllRanges();
      for (const range of ranges) selection?.addRange(range);
    } catch {}
  }
}