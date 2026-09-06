import { createContext, useContext } from "react";
import { createPortal } from "react-dom";

export const PortalDocumentContext = createContext(null);
export const usePortalDocument = () => useContext(PortalDocumentContext) || document;

export default function ModalPortal({ children }) {
  const owner = usePortalDocument();
  return createPortal(children, owner.body);
}
