// Small, safe markdown renderer: everything is emitted as React nodes, raw
// HTML in the source text stays plain text, so nothing can inject markup.
import { useEffect, useState } from "react";
import * as api from "./api.js";

const INLINE_TOKEN = /(\*\*[^*]+\*\*|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\))/g;

function renderInline(text, keyBase) {
  const parts = [];
  let last = 0;
  let match;
  let key = 0;
  INLINE_TOKEN.lastIndex = 0;
  while ((match = INLINE_TOKEN.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={`${keyBase}-${key++}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(<code key={`${keyBase}-${key++}`}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("*")) {
      parts.push(<em key={`${keyBase}-${key++}`}>{token.slice(1, -1)}</em>);
    } else {
      const link = /^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/.exec(token);
      if (link) {
        const href = link[2];
        parts.push(
          <a
            key={`${keyBase}-${key++}`}
            href={href}
            onClick={(event) => { event.preventDefault(); api.openExternal(href); }}
          >
            {link[1]}
          </a>
        );
      } else {
        parts.push(token);
      }
    }
    last = match.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : [text];
}

/** Renders a constrained markdown subset (headings, lists, quotes, code
 * blocks, bold/italic/code/links) without ever emitting raw HTML. */
export function MarkdownView({ text }) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  let key = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (/^```/.test(line)) {
      const buffer = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        buffer.push(lines[index]);
        index += 1;
      }
      index += 1; // closing fence
      blocks.push(<pre key={key++} className="md-code">{buffer.join("\n")}</pre>);
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = ["h2", "h3", "h4"][heading[1].length - 1];
      blocks.push(<Tag key={key++} className="md-heading">{renderInline(heading[2], key)}</Tag>);
      index += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,})\s*$/.test(line)) {
      blocks.push(<hr key={key++} className="md-hr" />);
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buffer = [];
      while (index < lines.length && /^>\s?/.test(lines[index])) {
        buffer.push(lines[index].replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push(<blockquote key={key++} className="md-quote">{renderInline(buffer.join(" "), key)}</blockquote>);
      continue;
    }

    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items = [];
      while (index < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*([-*]|\d+\.)\s+/, ""));
        index += 1;
      }
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={key++} className="md-list">
          {items.map((item, itemIndex) => <li key={itemIndex}>{renderInline(item, `${key}-${itemIndex}`)}</li>)}
        </List>
      );
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const buffer = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,3}\s|>|```|\s*([-*]|\d+\.)\s|-{3,}\s*$)/.test(lines[index])) {
      buffer.push(lines[index]);
      index += 1;
    }
    blocks.push(
      <p key={key++} className="md-paragraph">
        {buffer.flatMap((part, partIndex) => {
          const rendered = renderInline(part, `${key}-${partIndex}`);
          return partIndex < buffer.length - 1 ? [...rendered, <br key={`br-${key}-${partIndex}`} />] : rendered;
        })}
      </p>
    );
  }

  return <div className="markdown">{blocks}</div>;
}

/** Auth-protected media element for broadcast assets (images and video). */
export function BroadcastMedia({ asset }) {
  const [url, setUrl] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let disposed = false;
    api.alleyImageUrl(`/api/broadcasts/assets/${asset.id}`)
      .then((objectUrl) => { if (!disposed) objectUrl ? setUrl(objectUrl) : setFailed(true); })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, [asset.id]);
  if (failed) return null;
  if (!url) return <div className="skeleton" style={{ height: 120 }} />;
  if (asset.kind === "video") return <video src={url} controls preload="metadata" />;
  if (asset.kind === "audio") return <audio src={url} controls preload="metadata" />;
  return <img src={url} alt={asset.name} />;
}
