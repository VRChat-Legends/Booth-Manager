import { useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import {
  AtSign, Bold, Braces, ChevronDown, CircleHelp, Code, File, FolderOpen, Heading2,
  Italic, Link, List, ListOrdered, ListTodo, LoaderCircle, Paperclip, Quote, Send,
  ShieldCheck, Strikethrough, Table2, X
} from "lucide-react";
import * as api from "../lib/api.js";
import { MarkdownView } from "../lib/markdown.jsx";
import { COMPOSER_LIMIT, formatSelection, formattingShortcut } from "../lib/composerFormatting.mjs";
import "../chat-composer.css";

const INLINE_TOOLS = [
  { action: "bold", label: "Bold", icon: Bold, shortcut: "Ctrl+B", keys: "Control+B" },
  { action: "italic", label: "Italic", icon: Italic, shortcut: "Ctrl+I", keys: "Control+I" },
  { action: "strike", label: "Strikethrough", icon: Strikethrough, shortcut: "Ctrl+Shift+X", keys: "Control+Shift+X" },
  { action: "code", label: "Inline code", icon: Code, shortcut: "Ctrl+`", keys: "Control+`" },
  { action: "link", label: "Insert link", icon: Link }
];
const BLOCK_TOOLS = [
  { action: "heading", label: "Heading", icon: Heading2, sample: "##" },
  { action: "bullet", label: "Bullet list", icon: List, sample: "- item" },
  { action: "numbered", label: "Numbered list", icon: ListOrdered, sample: "1. item" },
  { action: "task", label: "Task list", icon: ListTodo, sample: "- [ ]" },
  { action: "quote", label: "Quote", icon: Quote, sample: "> text" },
  { action: "code-block", label: "Code block", icon: Braces, sample: "```" },
  { action: "table", label: "Table", icon: Table2, sample: "| text |" }
];

function inputSelection(input) {
  return { value: input.value, start: input.selectionStart, end: input.selectionEnd, direction: input.selectionDirection || "none", scrollTop: input.scrollTop };
}

function restoreSelection(input, saved, focus = false) {
  if (focus && !input.disabled && !input.hidden) input.focus({ preventScroll: true });
  input.setSelectionRange(saved.start, saved.end, saved.direction);
  input.scrollTop = saved.scrollTop;
}

function useComposerLayout(inputRef, savedSelection) {
  const binding = useRef(null);
  const schedule = useCallback(() => {
    const input = inputRef.current;
    if (!input?.isConnected) return;
    const doc = input.ownerDocument;
    const view = doc.defaultView;
    if (!view) return;
    if (binding.current?.doc !== doc || binding.current?.input !== input) {
      const previous = binding.current;
      previous?.dispose();
      const state = { doc, view, input, frame: null };
      let width = -1;
      const sizes = view.ResizeObserver ? new view.ResizeObserver((entries) => {
        const nextWidth = entries[0]?.contentRect.width;
        if (nextWidth !== width || input.ownerDocument !== doc) { width = nextWidth; schedule(); }
      }) : null;
      // moving the existing node does not run a mount effect again
      const moves = view.MutationObserver ? new view.MutationObserver(() => { if (input.ownerDocument !== doc) schedule(); }) : null;
      state.dispose = () => {
        if (state.frame !== null) view.cancelAnimationFrame(state.frame);
        sizes?.disconnect();
        moves?.disconnect();
        view.removeEventListener("resize", schedule);
      };
      binding.current = state;
      sizes?.observe(input);
      if (doc.documentElement) moves?.observe(doc.documentElement, { childList: true, subtree: true });
      view.addEventListener("resize", schedule);
      if (previous && savedSelection.current.value === input.value) restoreSelection(input, savedSelection.current);
    }
    const state = binding.current;
    if (state.frame !== null) view.cancelAnimationFrame(state.frame);
    state.frame = view.requestAnimationFrame(() => {
      state.frame = null;
      if (binding.current !== state || inputRef.current !== input) return;
      if (input.ownerDocument !== doc) { schedule(); return; }
      if (input.hidden || !input.isConnected) return;
      const scrollTop = input.scrollTop;
      input.style.height = "0px";
      const height = Math.min(150, Math.max(82, input.scrollHeight));
      input.style.height = `${height}px`;
      input.style.overflowY = input.scrollHeight > height ? "auto" : "hidden";
      input.scrollTop = scrollTop;
    });
  }, [inputRef, savedSelection]);
  useLayoutEffect(() => { schedule(); });
  useLayoutEffect(() => () => { binding.current?.dispose(); binding.current = null; }, []);
  return schedule;
}

function closeDisclosure(event) {
  if (event.key !== "Escape" || !event.currentTarget.open) return;
  event.preventDefault();
  event.stopPropagation();
  event.currentTarget.open = false;
  event.currentTarget.querySelector("summary")?.focus({ preventScroll: true });
}

function blurDisclosure(event) {
  if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
}

export default function ChatComposer({
  inputRef, text = "", onChange, onKeyDown, onSend, pendingFiles = [], onRemoveFile,
  onAttachFiles, onAttachFolder, canShareFolders = false, isGlobal = false,
  blocked = false, sending = false, picking = false, roomName = "Team chat", hasLoaded = false,
  preferences = {}, members = [], selfName = "", onHint, mentionSuggestions
}) {
  const input = useRef(null);
  const suggestions = useRef(null);
  const more = useRef(null);
  const help = useRef(null);
  const savedSelection = useRef({ value: text, start: text.length, end: text.length, direction: "none", scrollTop: 0 });
  const pendingSelection = useRef(null);
  const operation = useRef(null);
  const composing = useRef(false);
  const wasSending = useRef(sending);
  const [isComposing, setIsComposing] = useState(false);
  const [preview, setPreview] = useState(false);
  const [feedback, setFeedback] = useState("");
  const id = useId();
  const helpId = `${id}-help`;
  const countId = `${id}-count`;
  const feedbackId = `${id}-feedback`;
  const inputId = `${id}-input`;
  const previewId = `${id}-preview`;
  const disabled = blocked || sending || !hasLoaded;
  const formatDisabled = disabled || preview || isComposing;
  const attachmentDisabled = disabled || picking || pendingFiles.length >= 5;
  const hasFiles = !isGlobal && pendingFiles.length > 0;
  const sendDisabled = disabled || picking || (!text.trim() && !hasFiles) || text.length > COMPOSER_LIMIT;
  const scheduleSize = useComposerLayout(input, savedSelection);
  const setInput = useCallback((node) => {
    input.current = node;
    if (typeof inputRef === "function") inputRef(node);
    else if (inputRef) inputRef.current = node;
  }, [inputRef]);

  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    if (wasSending.current && !sending && !text) {
      pendingSelection.current = { value: "", start: 0, end: 0, direction: "none", scrollTop: 0, focus: true };
      if (preview) setPreview(false);
    }
    wasSending.current = sending;
    const pending = pendingSelection.current;
    if (pending && !preview) {
      if (pending.value === node.value) restoreSelection(node, pending, pending.focus);
      else if (pending.focus && !node.disabled) node.focus({ preventScroll: true });
      pendingSelection.current = null;
    }
    if (!preview) savedSelection.current = inputSelection(node);
    if (formatDisabled && more.current) more.current.open = false;
    const list = !preview && !disabled ? suggestions.current?.querySelector('[role="listbox"]') : null;
    const selected = list?.querySelector('[role="option"][aria-selected="true"]');
    if (list) {
      if (!list.id) list.id = `${id}-mentions`;
      list.querySelectorAll('[role="option"]').forEach((option, index) => {
        if (!option.id || option.id.startsWith(`${id}-mention-option-`)) option.id = `${id}-mention-option-${index}`;
      });
      node.setAttribute("aria-controls", list.id);
      node.setAttribute("aria-autocomplete", "list");
    } else {
      node.removeAttribute("aria-controls");
      node.removeAttribute("aria-autocomplete");
    }
    if (selected) {
      node.setAttribute("aria-activedescendant", selected.id);
    } else node.removeAttribute("aria-activedescendant");
  });

  const notify = (message) => {
    setFeedback(onHint ? "" : message);
    onHint?.(message);
  };
  const remember = () => {
    if (input.current && !operation.current && !preview) savedSelection.current = inputSelection(input.current);
  };
  const preserveMouseSelection = (event) => {
    if (event.button !== 0) return;
    remember();
    event.preventDefault();
  };
  const closeMenus = () => {
    if (more.current) more.current.open = false;
    if (help.current) help.current.open = false;
  };

  const applyFormatting = (action) => {
    const node = input.current;
    if (!node || formatDisabled || composing.current) return;
    scheduleSize();
    const original = inputSelection(node);
    const result = formatSelection(node.value, original.start, original.end, action);
    closeMenus();
    if (result.rejected) { notify(result.message); restoreSelection(node, original, true); return; }
    if (!result.changed) { restoreSelection(node, original, true); return; }
    setFeedback("");
    const saved = { value: result.text, start: result.start, end: result.end, direction: original.direction === "backward" ? "backward" : "forward", scrollTop: original.scrollTop, focus: true };
    const current = { value: result.text, caret: saved.direction === "backward" ? saved.start : saved.end, notified: false };
    operation.current = current;
    pendingSelection.current = saved;
    try {
      node.focus({ preventScroll: true });
      node.setSelectionRange(result.edit.start, result.edit.end);
      try { node.ownerDocument.execCommand?.("insertText", false, result.edit.text); } catch {}
      if (node.value !== result.text) {
        if (node.value === original.value) node.setRangeText(result.edit.text, result.edit.start, result.edit.end, "preserve");
        else node.setRangeText(result.text, 0, node.value.length, "preserve");
      }
      if (!current.notified) { current.notified = true; onChange?.(result.text, current.caret); }
    } finally { operation.current = null; }
    restoreSelection(node, saved, true);
    savedSelection.current = saved;
    scheduleSize();
  };

  const changeInput = (event) => {
    const node = event.currentTarget;
    const current = operation.current;
    if (current) {
      if (!current.notified && node.value === current.value) { current.notified = true; onChange?.(node.value, current.caret); }
      return;
    }
    if (node.value.length > COMPOSER_LIMIT) { notify("Messages can contain up to 1200 characters. Shorten the draft and try again."); return; }
    savedSelection.current = inputSelection(node);
    pendingSelection.current = null;
    closeMenus();
    setFeedback("");
    onChange?.(node.value, node.selectionStart);
    scheduleSize();
  };
  const changeView = (next, event) => {
    if (composing.current) return;
    closeMenus();
    if (next) { remember(); event.currentTarget.focus({ preventScroll: true }); }
    else pendingSelection.current = { ...savedSelection.current, focus: true };
    setPreview(next);
    if (!next && !preview && input.current) restoreSelection(input.current, savedSelection.current, true);
  };

  return (
    <div className="chat-composer" aria-busy={sending || picking} onFocusCapture={scheduleSize}>
      <div className="chat-composer-editor" data-disabled={disabled || undefined}>
        <div className="chat-composer-toolbar">
          <div className="chat-composer-tools" role="group" aria-label="Markdown formatting">
            {INLINE_TOOLS.map(({ action, label, icon: Icon, shortcut, keys }) => (
              <button key={action} type="button" className="chat-composer-tool" aria-label={label} aria-keyshortcuts={keys} title={shortcut ? `${label} (${shortcut})` : label} disabled={formatDisabled} onMouseDown={preserveMouseSelection} onClick={() => applyFormatting(action)}>
                <Icon size={16} aria-hidden="true" />
              </button>
            ))}
            <span className="chat-composer-divider" aria-hidden="true" />
            <details className="chat-composer-disclosure" ref={more} onKeyDown={closeDisclosure} onBlur={blurDisclosure}>
              <summary className="chat-composer-more" aria-label="More formatting" aria-disabled={formatDisabled} tabIndex={formatDisabled ? -1 : 0} title="Lists, headings, quotes, code blocks and tables" onMouseDown={(event) => { if (formatDisabled) event.preventDefault(); else remember(); }} onClick={(event) => { if (formatDisabled) event.preventDefault(); if (help.current) help.current.open = false; }}>
                More<ChevronDown size={13} aria-hidden="true" />
              </summary>
              <div className="chat-composer-popover chat-composer-block-tools" role="group" aria-label="Additional Markdown formatting">
                {BLOCK_TOOLS.map(({ action, label, icon: Icon, sample }) => (
                  <button key={action} type="button" disabled={formatDisabled} onMouseDown={preserveMouseSelection} onClick={() => applyFormatting(action)}>
                    <Icon size={15} aria-hidden="true" /><span>{label}</span><code>{sample}</code>
                  </button>
                ))}
              </div>
            </details>
          </div>
          <div className="chat-composer-views" role="group" aria-label="Composer view">
            <button type="button" aria-pressed={!preview} aria-controls={inputId} disabled={isComposing} onMouseDown={preserveMouseSelection} onClick={(event) => changeView(false, event)}>Write</button>
            <button type="button" aria-pressed={preview} aria-controls={previewId} disabled={isComposing} onMouseDown={preserveMouseSelection} onClick={(event) => changeView(true, event)}>Preview</button>
          </div>
        </div>

        <div className="chat-composer-body">
          <div className="chat-composer-mentions" ref={suggestions} hidden={preview || disabled}>{mentionSuggestions}</div>
          <textarea
            ref={setInput}
            id={inputId}
            className="chat-composer-input"
            aria-label={`Message ${roomName}`}
            aria-describedby={`${helpId} ${countId} ${feedbackId}`}
            aria-invalid={text.length > COMPOSER_LIMIT || undefined}
            maxLength={COMPOSER_LIMIT}
            rows={3}
            spellCheck
            hidden={preview}
            disabled={disabled}
            placeholder={disabled ? hasLoaded ? sending ? "Sending message..." : "This room is locked" : "Waiting for the conversation..." : `Message ${roomName}`}
            value={text}
            onChange={changeInput}
            onSelect={remember}
            onBlur={remember}
            onFocus={() => { remember(); closeMenus(); scheduleSize(); }}
            onMouseDown={closeMenus}
            onCompositionStart={() => { composing.current = true; setIsComposing(true); }}
            onCompositionEnd={() => { composing.current = false; setIsComposing(false); remember(); scheduleSize(); }}
            onPaste={(event) => {
              if (composing.current) return;
              const node = event.currentTarget;
              const value = event.clipboardData.getData("text/plain").replace(/\r\n?/g, "\n");
              if (node.value.length - (node.selectionEnd - node.selectionStart) + value.length > COMPOSER_LIMIT) {
                event.preventDefault();
                notify("Pasting this text would exceed the 1200 character limit. Shorten it and try again.");
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") closeMenus();
              const action = formattingShortcut(event);
              if (action && !composing.current && !formatDisabled) {
                event.preventDefault();
                event.stopPropagation();
                applyFormatting(action);
              } else onKeyDown?.(event);
            }}
          />
          <div id={previewId} className="chat-composer-preview" hidden={!preview} role="region" aria-label="Message preview" tabIndex={0}>
            {preview && (text.trim() ? <MarkdownView text={text} members={members} selfName={selfName} showMediaPreviews={preferences.showMediaPreviews !== false} textOnly={isGlobal} /> : <p className="chat-composer-placeholder">Nothing to preview yet. Switch to Write to start a message.</p>)}
          </div>
        </div>

        {hasFiles && (
          <ul className="chat-composer-files" aria-label="Pending attachments">
            {pendingFiles.map((item) => (
              <li key={item.id} title={item.name}>
                {item.entries || item.kind === "folder" ? <FolderOpen size={14} aria-hidden="true" /> : <File size={14} aria-hidden="true" />}
                <strong>{item.name}</strong><small>{api.formatBytes(item.size)}</small>
                <button type="button" disabled={sending} title={`Remove ${item.name}`} aria-label={`Remove ${item.name}`} onClick={() => onRemoveFile?.(item.id)}><X size={13} aria-hidden="true" /></button>
              </li>
            ))}
          </ul>
        )}

        <div className="chat-composer-actions">
          {!isGlobal && (
            <div className="chat-composer-attachments" role="group" aria-label="Add attachments">
              <button type="button" title="Attach local files" aria-label="Attach local files" disabled={attachmentDisabled} onClick={() => onAttachFiles?.()}><Paperclip size={15} aria-hidden="true" /><span>Attach files</span></button>
              {canShareFolders && <button type="button" title="Share a folder" aria-label="Share a folder" disabled={attachmentDisabled} onClick={() => onAttachFolder?.()}><FolderOpen size={15} aria-hidden="true" /><span>Folder</span></button>}
              {picking && <span className="chat-composer-picking" role="status"><LoaderCircle className="spin" size={13} aria-hidden="true" />Choosing files...</span>}
            </div>
          )}
          <details className="chat-composer-disclosure chat-composer-help" ref={help} onKeyDown={closeDisclosure} onBlur={blurDisclosure}>
            <summary aria-label="Markdown help" title="Markdown help" onClick={() => { if (more.current) more.current.open = false; }}><CircleHelp size={15} aria-hidden="true" /></summary>
            <div className="chat-composer-popover chat-composer-guide">
              <strong>Markdown shortcuts</strong>
              <div className="chat-composer-guide-grid">
                <span>Bold</span><code>**text**</code><kbd>Ctrl+B</kbd>
                <span>Italic</span><code>*text*</code><kbd>Ctrl+I</kbd>
                <span>Strike</span><code>~~text~~</code><kbd>Ctrl+Shift+X</kbd>
                <span>Code</span><code>{"`code`"}</code><kbd>{"Ctrl+`"}</kbd>
                <span>Link</span><code>[text](url)</code><span>Toolbar</span>
              </div>
              <p>More has headings, lists, tasks, quotes, code blocks and tables. Select several lines to format them together.</p>
              <p>For a table, the first selected line becomes the header. Tabs separate columns.</p>
              <p>Replace the selected address after inserting a link. Ctrl+K stays available for app navigation.</p>
              <p>{isGlobal ? "The global lounge does not load inline images or share files." : "External images stay unloaded until you choose to load one."}</p>
            </div>
          </details>
          <span className="chat-composer-count" id={countId} data-limit={text.length >= COMPOSER_LIMIT ? "full" : text.length >= COMPOSER_LIMIT - 100 ? "near" : undefined} aria-label={`${text.length} of 1200 characters`}>{text.length}/1200</span>
          <button type="button" className="chat-composer-send" title="Send message" aria-label="Send message" disabled={sendDisabled} aria-busy={sending} onClick={() => onSend?.()}>
            {sending ? <LoaderCircle className="spin" size={15} aria-hidden="true" /> : <Send size={15} aria-hidden="true" />}<span>{sending ? "Sending" : "Send"}</span>
          </button>
        </div>
      </div>
      <div className="chat-composer-meta" id={helpId}>
        <span>{isGlobal ? <><ShieldCheck size={12} aria-hidden="true" />Text only, no peer connections</> : <><AtSign size={12} aria-hidden="true" />Mention a member with @</>}</span>
        <span>{preferences.sendShortcut === "mod-enter" ? "Ctrl+Enter to send" : "Enter to send"} / Shift+Enter for a new line</span>
      </div>
      <p className="chat-composer-feedback" id={feedbackId} role="status" aria-live="polite" aria-atomic="true">{feedback}</p>
    </div>
  );
}