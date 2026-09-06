export const CHAT_WINDOW_NAME = "booth-manager-chat";

export function createChatPopout({ source, container, getHome, bridge = {}, onChange = () => {}, onDock = () => {}, onError = () => {} }) {
  let popup = null;
  let opening = false;
  let disposed = false;
  let stopStyles = null;
  let stopEvents = null;
  const notifyError = (error) => { if (!disposed) onError(error?.message || "Could not open chat in its own window."); };
  const invoke = (method, ...args) => {
    try { return Promise.resolve(bridge[method]?.(...args)); }
    catch (error) { return Promise.reject(error); }
  };
  const move = (target) => {
    const active = container.ownerDocument.activeElement;
    const focus = container.contains(active) ? active : null;
    const scrolls = [container, ...container.querySelectorAll("*")].filter((node) => node.scrollTop || node.scrollLeft)
      .map((node) => [node, node.scrollTop, node.scrollLeft]);
    target.appendChild(container);
    return { focus, restore: () => { for (const [node, top, left] of scrolls) { node.scrollTop = top; node.scrollLeft = left; } } };
  };
  const restoreFocus = (element) => { try { element?.focus({ preventScroll: true }); } catch {} };
  const syncStyles = (target) => {
    const base = target.createElement("base");
    base.href = source.baseURI;
    target.head.appendChild(base);
    let mirrored = [];
    const waiting = new Set();
    const appendStylesheet = (copy) => new Promise((resolve, reject) => {
      const complete = (error) => {
        source.defaultView.clearTimeout(timer);
        copy.removeEventListener("load", loaded);
        copy.removeEventListener("error", failed);
        waiting.delete(cancel);
        if (error) reject(error); else resolve();
      };
      const loaded = () => complete();
      const failed = () => complete(new Error("The chat window could not load its styles. Dock it and try again."));
      const cancel = () => complete();
      const timer = source.defaultView.setTimeout(failed, 8000);
      waiting.add(cancel);
      copy.addEventListener("load", loaded);
      copy.addEventListener("error", failed);
      target.head.appendChild(copy);
      if (copy.sheet) loaded();
    });
    const sync = () => {
      const pending = [];
      const next = [...source.head.querySelectorAll('style, link[rel="stylesheet"]')].map((node) => {
        const copy = node.cloneNode(true);
        if (copy.tagName === "LINK") copy.href = node.href;
        if (copy.tagName === "LINK" && copy.getAttribute("href") && !copy.disabled) pending.push(appendStylesheet(copy));
        else target.head.appendChild(copy);
        return copy;
      });
      for (const node of mirrored) node.remove();
      mirrored = next;
      return Promise.all(pending);
    };
    const ready = sync();
    const observer = new source.defaultView.MutationObserver(() => { sync().catch(notifyError); });
    observer.observe(source.head, { childList: true, subtree: true, characterData: true, attributes: true });
    return { ready, stop: () => { observer.disconnect(); for (const cancel of [...waiting]) cancel(); } };
  };
  const dock = ({ close = true, quiet = false } = {}) => {
    if (!popup && !opening) return;
    const oldWindow = popup;
    popup = null;
    opening = false;
    stopStyles?.(); stopStyles = null;
    stopEvents?.(); stopEvents = null;
    const home = getHome();
    const moved = home ? move(home) : null;
    if (!disposed) {
      onChange({ detached: false, document: source, returnToChat: !quiet });
      if (!quiet) onDock();
    }
    moved?.restore();
    if (close) {
      invoke("finishDock", { quiet }).catch(notifyError);
      if (!bridge.finishDock && oldWindow && !oldWindow.closed) oldWindow.close();
    }
    if (!quiet) restoreFocus(moved?.focus);
  };
  const focus = () => {
    if (!popup || popup.closed) { dock({ close: false }); return; }
    popup.focus();
    invoke("focus").catch(notifyError);
  };
  const open = () => {
    if (disposed || opening) return;
    if (popup && !popup.closed) { focus(); return; }
    opening = true;
    try {
      popup = source.defaultView.open("about:blank", CHAT_WINDOW_NAME, "popup,width=1280,height=840");
      if (!popup || popup.closed) throw new Error("The chat window was blocked or could not be created. Try again.");
      // Reusing a named target can navigate it without asking the native creation handler.
      popup.name = "";
      const target = popup.document;
      target.title = "Team Chat | Booth Manager";
      target.documentElement.lang = source.documentElement.lang || "en";
      target.body.className = "chat-popout-body";
      const styles = syncStyles(target);
      stopStyles = styles.stop;
      const moved = move(target.body);
      const targetWindow = popup;
      const unload = () => dock({ close: false });
      const swallowDrop = (event) => event.preventDefault();
      targetWindow.addEventListener("beforeunload", unload);
      targetWindow.addEventListener("pagehide", unload);
      targetWindow.addEventListener("dragover", swallowDrop);
      targetWindow.addEventListener("drop", swallowDrop);
      stopEvents = () => {
        targetWindow.removeEventListener("beforeunload", unload);
        targetWindow.removeEventListener("pagehide", unload);
        targetWindow.removeEventListener("dragover", swallowDrop);
        targetWindow.removeEventListener("drop", swallowDrop);
      };
      opening = false;
      onChange({ detached: true, document: target });
      styles.ready.then(async () => {
        if (disposed || popup !== targetWindow) return;
        moved.restore();
        const result = await invoke("ready");
        if (disposed || popup !== targetWindow) return;
        if (result?.ok === false) { dock(); notifyError(new Error(result.error)); return; }
        targetWindow.focus();
        restoreFocus(moved.focus || container.querySelector("textarea"));
      }).catch((error) => { if (popup === targetWindow) dock(); notifyError(error); });
    } catch (error) {
      dock({ quiet: true });
      opening = false;
      invoke("abort").catch(() => {});
      notifyError(error);
    }
  };
  const offDock = bridge.onDockRequest?.(() => dock());
  const offState = bridge.onState?.((state) => { if (!state.detached && popup) dock({ close: false }); });
  const sourceUnload = () => dock({ quiet: true });
  source.defaultView.addEventListener("beforeunload", sourceUnload);
  return {
    open, dock, focus,
    dispose() {
      disposed = true;
      offDock?.(); offState?.();
      source.defaultView.removeEventListener("beforeunload", sourceUnload);
      dock({ quiet: true });
    }
  };
}