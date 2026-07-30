// Shared drag-and-drop plumbing. Electron removed File.path, so dropped File
// objects resolve to absolute paths through webUtils in the preload
// (api.pathForFile) and then flow through the exact same main-process
// validation the file pickers use.
import { useCallback, useRef, useState } from "react";
import { ImagePlus, UploadCloud } from "lucide-react";
import * as api from "../lib/api.js";

function hasFiles(dragEvent) {
  const types = dragEvent.dataTransfer?.types;
  return types ? Array.from(types).includes("Files") : false;
}

/** Drag state + handlers for a drop target. Spread `bind` onto the container
 * and render something with `dragOver`. onPaths receives absolute paths. */
export function useFileDrop({ onPaths, disabled = false }) {
  const [dragOver, setDragOver] = useState(false);
  const depthRef = useRef(0);

  const onDragEnter = useCallback((dragEvent) => {
    if (disabled || !hasFiles(dragEvent)) return;
    dragEvent.preventDefault();
    depthRef.current += 1;
    setDragOver(true);
  }, [disabled]);

  const onDragOver = useCallback((dragEvent) => {
    if (disabled || !hasFiles(dragEvent)) return;
    dragEvent.preventDefault();
    dragEvent.dataTransfer.dropEffect = "copy";
  }, [disabled]);

  const onDragLeave = useCallback((dragEvent) => {
    if (disabled || !hasFiles(dragEvent)) return;
    depthRef.current = Math.max(0, depthRef.current - 1);
    if (depthRef.current === 0) setDragOver(false);
  }, [disabled]);

  const onDrop = useCallback((dragEvent) => {
    if (disabled || !hasFiles(dragEvent)) return;
    dragEvent.preventDefault();
    depthRef.current = 0;
    setDragOver(false);
    const paths = Array.from(dragEvent.dataTransfer.files || [])
      .map((file) => api.pathForFile(file))
      .filter(Boolean);
    if (paths.length) onPaths(paths);
  }, [disabled, onPaths]);

  return { dragOver, bind: { onDragEnter, onDragOver, onDragLeave, onDrop } };
}

/** Full-surface dashed overlay shown while dragging files over a drop zone. */
export function DropOverlay({ active, label = "Drop files to attach" }) {
  if (!active) return null;
  return (
    <div className="drop-overlay">
      <div className="drop-overlay-inner">
        <UploadCloud size={26} />
        <strong>{label}</strong>
      </div>
    </div>
  );
}

/** Wraps a logo/image control: dropping an image reads it through the main
 * process and hands back { path, name, dataBase64 }, same shape as the
 * image picker, so pages reuse their existing upload code. */
export function ImageDropWell({ onImageFile, onError, disabled = false, children }) {
  const drop = useFileDrop({
    disabled,
    onPaths: async (paths) => {
      const result = await api.readImageFile(paths[0]);
      if (result.ok && result.files?.[0]) onImageFile(result.files[0]);
      else if (onError) onError(result.error || "That file is not a usable image.");
    }
  });
  return (
    <div className={`image-drop-well${drop.dragOver ? " drag-over" : ""}${disabled ? " disabled" : ""}`} {...drop.bind}>
      {children}
      {drop.dragOver && (
        <span className="image-drop-hint"><ImagePlus size={14} /> Drop image</span>
      )}
    </div>
  );
}
