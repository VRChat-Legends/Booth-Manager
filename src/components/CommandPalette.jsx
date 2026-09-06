import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowRight, Search, X } from "lucide-react";
import ModalPortal from "./ModalPortal.jsx";

export default function CommandPalette({ items, onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const inputRef = useRef(null);
  const closeRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();
  const filtered = useMemo(() => items.filter((item) => `${item.label} ${item.keywords || ""}`.toLowerCase().includes(query.trim().toLowerCase())), [items, query]);
  const index = Math.min(selected, Math.max(0, filtered.length - 1));

  useEffect(() => {
    const previous = document.activeElement;
    inputRef.current?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, []);
  useEffect(() => { listRef.current?.children[index]?.scrollIntoView({ block: "nearest" }); }, [index]);

  const navigate = (item) => { if (item) { onNavigate(item.id); onClose(); } };
  const onKeyDown = (event) => {
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(filtered.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + filtered.length) % filtered.length : 0);
    }
    if (event.key === "Enter" && event.target === inputRef.current) { event.preventDefault(); navigate(filtered[index]); }
    if (event.key === "Tab") {
      event.preventDefault();
      (document.activeElement === inputRef.current ? closeRef : inputRef).current?.focus();
    }
  };

  return <ModalPortal><div className="command-scrim" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Jump to a page or tool" onKeyDown={onKeyDown}><div className="command-input"><Search size={20} /><input ref={inputRef} type="search" role="combobox" aria-label="Find a page or tool" aria-expanded="true" aria-controls={listId} aria-activedescendant={filtered.length ? `${listId}-${index}` : undefined} autoComplete="off" placeholder="Where would you like to go?" value={query} onChange={(event) => { setQuery(event.target.value); setSelected(0); }} /><button ref={closeRef} className="icon-button ghost" aria-label="Close quick navigation" onClick={onClose}><X size={17} /></button></div><div className="command-section-label">PAGES & TOOLS</div><ul id={listId} ref={listRef} role="listbox" aria-label="Matching pages" className="command-results">{filtered.map((item, itemIndex) => <li id={`${listId}-${itemIndex}`} key={item.id} role="option" aria-selected={index === itemIndex} className={index === itemIndex ? "selected" : ""} onMouseEnter={() => setSelected(itemIndex)} onClick={() => navigate(item)}><item.Icon size={18} /><span>{item.label}</span><ArrowRight size={15} /></li>)}</ul>{!filtered.length && <p className="command-no-results">No matching tools. Try "analytics", "QR", or "backups".</p>}<footer><span><kbd>Up</kbd><kbd>Down</kbd> to choose</span><span><kbd>Enter</kbd> to open</span><span><kbd>Esc</kbd> to close</span></footer></section></div></ModalPortal>;
}