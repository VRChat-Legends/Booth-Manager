import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { ExternalLink, PanelBottomClose } from "lucide-react";
import * as api from "../lib/api.js";
import { createChatPopout } from "../lib/chatPopout.mjs";
import { PortalDocumentContext } from "./ModalPortal.jsx";
import PageBoundary from "./PageBoundary.jsx";
import "../chat-popout.css";

const TeamChatPage = lazy(() => import("../pages/TeamChatPage.jsx"));

export default function ChatDock({ active, allowed, onReturn, ...props }) {
  const home = useRef(null);
  const controls = useRef(null);
  const callbacks = useRef({ onReturn });
  callbacks.current = { onReturn };
  const [container] = useState(() => Object.assign(document.createElement("div"), { className: "chat-portal-root" }));
  const [view, setView] = useState({ detached: false, document });
  const [error, setError] = useState("");
  useLayoutEffect(() => {
    home.current.appendChild(container);
    const controller = createChatPopout({
      source: document, container, getHome: () => home.current,
      bridge: api.chatWindow,
      onChange: (next) => {
        const update = () => { setView(next); if (next.returnToChat) callbacks.current.onReturn(); };
        if (!next.detached && !next.returnToChat) update();
        else flushSync(update);
      },
      onError: setError
    });
    controls.current = controller;
    return () => { controls.current = null; controller.dispose(); container.remove(); };
  }, [container]);
  useEffect(() => { if (!allowed) controls.current?.dock({ quiet: true }); }, [allowed]);
  const open = () => { setError(""); controls.current?.open(); };
  const dock = () => { setError(""); controls.current?.dock(); };
  return <section className="chat-dock" hidden={!active} aria-label="Team chat workspace">
    <div ref={home} className="chat-dock-home" />
    {view.detached && <div className="chat-detached-placeholder">
      <div className="chat-detached-icon"><ExternalLink size={27} /></div>
      <span className="eyebrow">CHAT IS OPEN IN ITS OWN WINDOW</span>
      <h1>Keep your conversation alongside your work.</h1>
      <p>Your room, draft, attachments, and transfers stay in the same session. Closing the chat window brings it back here.</p>
      <div><button type="button" className="primary" onClick={() => controls.current?.focus()}><ExternalLink size={16} />Focus chat window</button><button type="button" onClick={dock}><PanelBottomClose size={16} />Dock chat here</button></div>
    </div>}
    {allowed && (active || view.detached) && createPortal(
      <PortalDocumentContext.Provider value={view.document}>
        <PageBoundary><Suspense fallback={<div className="page-loading" role="status"><div className="spinner" />Opening team chat...</div>}>
          <TeamChatPage {...props} detached={view.detached} onPopOut={open} onDock={dock} windowError={error} />
        </Suspense></PageBoundary>
      </PortalDocumentContext.Provider>, container
    )}
  </section>;
}