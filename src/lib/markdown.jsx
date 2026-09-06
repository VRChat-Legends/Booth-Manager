import { createContext, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";
import rehypeHighlight from "rehype-highlight";
import * as api from "./api.js";
import {
  copyMarkdownText,
  focusMarkdownFragment,
  markdownSanitizeSchema,
  markdownText,
  markdownUrlTransform,
  rehypeMarkdownScope,
  rehypeMarkdownSource,
  rehypeMarkdownText,
  safeMarkdownUrl
} from "./markdownSupport.mjs";
import "../markdown.css";

const MarkdownContext = createContext(null);
const EMPTY_MEMBERS = [];
const REMARK_PLUGINS = [remarkGfm, remarkBreaks];
const REMARK_OPTIONS = { footnoteLabel: "Notes", footnoteBackContent: "Back to reference" };

function containsControl(node) {
  return ["img", "pre", "table", "details", "input"].includes(node?.tagName) || (node?.children || []).some(containsControl);
}

function MarkdownLink({ node, href, children, ...props }) {
  const context = useContext(MarkdownContext);
  const [failedHref, setFailedHref] = useState("");
  const safeHref = safeMarkdownUrl(href);
  if (!safeHref) return <span id={props.id} title="Link unavailable. Use an HTTP, HTTPS or email address.">{children}</span>;
  const local = safeHref.startsWith("#");
  const grouped = containsControl(node);
  const open = async (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.button != null && event.button !== 0 && event.button !== 1) return;
    if (local) {
      focusMarkdownFragment(context?.container.current, safeHref);
      return;
    }
    setFailedHref("");
    try {
      const result = await api.openExternal(safeHref);
      if (result === false || result?.ok === false) setFailedHref(safeHref);
    } catch {
      setFailedHref(safeHref);
    }
  };
  const link = (
    <a
      {...props}
      href={safeHref}
      rel={local ? undefined : "noopener noreferrer"}
      onClick={open}
      onAuxClick={open}
      onDragStart={(event) => event.preventDefault()}
    >{grouped ? (local ? "Go to linked section" : "Open linked page") : children}</a>
  );
  return (
    <>
      {grouped ? <span className="markdown-link-group">{children}{link}</span> : link}
      {failedHref === safeHref && <span className="markdown-link-error" role="status">Link could not be opened. Copy its address to open it manually.</span>}
    </>
  );
}

function ExternalImage({ source, alt, title, id, canPreview }) {
  const [status, setStatus] = useState("idle");
  const description = alt?.trim() || title?.trim() || "External image";
  if (!source) {
    return <span id={id} className="markdown-image-card"><strong>{description}</strong><span>Image unavailable. Only HTTPS image addresses without credentials are allowed.</span></span>;
  }
  const host = new URL(source).host;
  const requested = canPreview && ["loading", "ready"].includes(status);
  return (
    <span id={id} className="markdown-image-card" title={title}>
      <strong>{description}</strong>
      <span className="markdown-image-host">{host}</span>
      <span className="markdown-image-notice">{!canPreview && "Image previews are off. "}Loading or opening this image contacts an external site and shares your IP address.</span>
      {requested && (
        <img
          src={source}
          alt={alt || description}
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => setStatus("ready")}
          onError={() => setStatus("failed")}
        />
      )}
      <span className="markdown-image-actions">
        {canPreview && ["idle", "failed"].includes(status) && (
          <button type="button" onClick={(event) => { event.preventDefault(); event.stopPropagation(); setStatus("loading"); }}>
            {status === "failed" ? "Retry image" : "Load image"}
          </button>
        )}
        <MarkdownLink href={source}>Open image externally</MarkdownLink>
      </span>
      {status === "loading" && canPreview && <span role="status">Loading image...</span>}
      {status === "failed" && canPreview && <span className="markdown-link-error" role="status">Image could not be loaded.</span>}
    </span>
  );
}

function MarkdownImage({ src, alt = "", title = "", id }) {
  const context = useContext(MarkdownContext);
  const source = safeMarkdownUrl(src, { image: true });
  const canPreview = context?.canPreview === true;
  return <ExternalImage key={`${source}:${canPreview}`} source={source} alt={alt} title={title} id={id} canPreview={canPreview} />;
}

function MarkdownCodeBlock({ node, children, ...props }) {
  const [status, setStatus] = useState("");
  const code = node.children.find((child) => child.tagName === "code");
  const content = markdownText(code || node);
  const language = (code?.properties?.className || []).find((name) => name.startsWith("language-"))?.slice(9) || "Code";
  useEffect(() => setStatus(""), [content]);
  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>{language}</span>
        <button
          type="button"
          disabled={status === "copying"}
          onClick={async (event) => {
            const button = event.currentTarget;
            setStatus("copying");
            setStatus(await copyMarkdownText(button, content) ? "copied" : "failed");
          }}
        >{status === "copied" ? "Copied" : "Copy code"}</button>
      </div>
      <pre {...props} tabIndex={0} aria-label={`${language} block`}>{children}</pre>
      <span className="markdown-copy-status" role="status">
        {status === "copied" ? "Code copied." : status === "failed" ? "Copy failed. Select the code and press Ctrl+C." : ""}
      </span>
    </div>
  );
}

function MarkdownTable({ node, children, ...props }) {
  return <div className="markdown-table-scroll" role="region" aria-label="Markdown table" tabIndex={0}><table {...props}>{children}</table></div>;
}

function MarkdownTask({ checked, id, title }) {
  return <input id={id} title={title} type="checkbox" checked={Boolean(checked)} disabled readOnly aria-label={checked ? "Completed task" : "Incomplete task"} />;
}

const MARKDOWN_COMPONENTS = { a: MarkdownLink, img: MarkdownImage, pre: MarkdownCodeBlock, table: MarkdownTable, input: MarkdownTask };

export function MarkdownView({ text, members = EMPTY_MEMBERS, selfName = "", searchQuery = "", showMediaPreviews = true, textOnly = false }) {
  const container = useRef(null);
  const scope = useId();
  const canPreview = showMediaPreviews === true && !textOnly;
  const context = useMemo(() => ({ container, canPreview }), [canPreview]);
  const rehypePlugins = useMemo(() => [
    rehypeMarkdownSource,
    rehypeRaw,
    [rehypeMarkdownText, { members, selfName, searchQuery }],
    [rehypeSanitize, markdownSanitizeSchema],
    [rehypeHighlight, { detect: false, plainText: ["text", "txt", "plain", "plaintext"] }],
    [rehypeMarkdownScope, { scope }]
  ], [members, selfName, searchQuery, scope]);
  return (
    <MarkdownContext.Provider value={context}>
      <div className="markdown-view" ref={container}>
        <ReactMarkdown
          remarkPlugins={REMARK_PLUGINS}
          remarkRehypeOptions={REMARK_OPTIONS}
          rehypePlugins={rehypePlugins}
          components={MARKDOWN_COMPONENTS}
          urlTransform={markdownUrlTransform}
        >{String(text ?? "")}</ReactMarkdown>
      </div>
    </MarkdownContext.Provider>
  );
}

// broadcast assets still use the authenticated bridge
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
