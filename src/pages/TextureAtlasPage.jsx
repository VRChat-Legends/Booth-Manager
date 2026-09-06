import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Boxes, CheckCircle2, Download, FileBox, Grid3X3, Image, Layers3, Merge, RefreshCw, RotateCcw, Upload } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import { DropOverlay, useFileDrop } from "../components/dropZone.jsx";
import Viewer3D from "../components/Viewer3D.jsx";
import { bytesToBase64, exportStandeeObject } from "../lib/standeeExport.js";
import { buildTextureAtlas, createAtlasObject, disposeAtlasResult } from "../lib/textureAtlas.js";
import "../tools-refinements.css";

const DEFAULTS = Object.freeze({ size: 2048, padding: 8, mergeMeshes: true });
const PNG_PREFIX = "data:image/png;base64,";

function safeName(value) {
  return String(value || "model").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "model";
}

function objectResources(object) {
  const resources = new Set();
  object?.traverse((child) => {
    if (!child.isMesh) return;
    if (child.geometry) resources.add(child.geometry);
    for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
      if (material?.map) resources.add(material.map);
      if (material) resources.add(material);
    }
  });
  return resources;
}

function createPreviewObject(result) {
  const object = createAtlasObject(result);
  // the viewer visits shared materials once for each mesh
  for (const resource of objectResources(object)) {
    const dispose = resource.dispose.bind(resource);
    let disposed = false;
    resource.dispose = () => {
      if (disposed) return;
      disposed = true;
      dispose();
    };
  }
  return object;
}

export default function TextureAtlasPage() {
  const [files, setFiles] = useState([]);
  const [settings, setSettings] = useState(DEFAULTS);
  const [revision, setRevision] = useState(0);
  const [build, setBuild] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [packageNotice, setPackageNotice] = useState("");
  const [saving, setSaving] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [viewReset, setViewReset] = useState(0);
  const [actualPixels, setActualPixels] = useState(false);
  const queueRef = useRef(Promise.resolve());
  const requestRef = useRef(null);
  const importRef = useRef(null);
  const saveRef = useRef(null);
  const request = useMemo(() => ({ files, settings, revision }), [files, settings, revision]);
  const objFile = files.find((file) => file.extension === ".obj");
  const mtlFiles = files.filter((file) => file.extension === ".mtl");
  const textureFiles = files.filter((file) => file.dataBase64);
  const currentBuild = build?.request === request ? build : null;
  const phase = importing ? "reading" : objFile ? currentBuild?.phase || "queued" : "idle";
  const result = phase === "ready" ? currentBuild.result : null;
  const generating = phase === "queued" || phase === "building";
  const inputBusy = importing || Boolean(saving);
  const currentFeedback = feedback?.request === request ? feedback : null;

  useLayoutEffect(() => {
    requestRef.current = request;
    return () => { requestRef.current = null; };
  }, [request]);

  useEffect(() => {
    let canceled = false;
    let ownedResult = null;
    setFeedback(null);
    if (!request.files.some((file) => file.extension === ".obj")) {
      setBuild({ request, phase: "idle" });
      return undefined;
    }
    const isCurrent = () => !canceled && requestRef.current === request;
    setBuild({ request, phase: "queued" });
    const timer = window.setTimeout(() => {
      const run = async () => {
        if (!isCurrent()) return;
        setBuild({ request, phase: "building" });
        let candidate = null;
        try {
          candidate = await buildTextureAtlas(request.files, request.settings);
          if (!isCurrent()) return;
          const dataUrl = candidate.canvas.toDataURL("image/png");
          if (!dataUrl.startsWith(PNG_PREFIX) || dataUrl.length <= PNG_PREFIX.length) throw new Error("Could not create the atlas image.");
          const pngBytes = Math.floor((dataUrl.length - PNG_PREFIX.length) * 3 / 4) - (dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0);
          ownedResult = candidate;
          candidate = null;
          setBuild({ request, phase: "ready", result: ownedResult, dataUrl, pngBytes });
        } catch (exception) {
          if (isCurrent()) setBuild({ request, phase: "error", error: String(exception?.message || exception) });
        } finally {
          if (candidate) disposeAtlasResult(candidate);
        }
      };
      queueRef.current = queueRef.current.then(run, run);
    }, 120);
    return () => {
      canceled = true;
      window.clearTimeout(timer);
      if (ownedResult) {
        disposeAtlasResult(ownedResult);
        ownedResult = null;
      }
    };
  }, [request]);

  const loadPackage = useCallback(async (paths) => {
    if (importRef.current || saveRef.current) return;
    const operation = {};
    importRef.current = operation;
    setImporting(true);
    setImportError("");
    setPackageNotice("");
    setFeedback(null);
    const isCurrent = () => importRef.current === operation && Boolean(requestRef.current);
    try {
      const response = paths ? await api.readAtlasPackage(paths) : await api.openAtlasPackage();
      if (!isCurrent()) return;
      if (!response?.ok) {
        if (response?.canceled) {
          setPackageNotice("Package selection canceled. The current package is unchanged.");
          return;
        }
        throw new Error(response?.error || "Could not read that model package.");
      }
      const nextFiles = response.files || [];
      if (nextFiles.filter((file) => file.extension === ".obj").length !== 1) throw new Error("Choose exactly one OBJ model with its MTL files and textures.");
      setFiles(nextFiles);
      setActualPixels(false);
      setAutoRotate(false);
      setViewReset((current) => current + 1);
    } catch (exception) {
      if (isCurrent()) setImportError(`${String(exception?.message || exception)}${requestRef.current.files.length ? " The current package is unchanged." : ""}`);
    } finally {
      if (importRef.current === operation) {
        importRef.current = null;
        if (requestRef.current) setImporting(false);
      }
    }
  }, []);

  const drop = useFileDrop({ disabled: inputBusy, onPaths: loadPackage });

  const viewerSource = useMemo(() => result && ({
    type: "geometry",
    build: () => createPreviewObject(result)
  }), [result]);

  const save = async (format) => {
    if (!result || saveRef.current || importRef.current || requestRef.current !== request) return;
    const operation = { phase: "preparing", canceled: false };
    saveRef.current = operation;
    setSaving({ format, phase: "preparing" });
    setFeedback(null);
    const isOwned = () => saveRef.current === operation && requestRef.current === request;
    const isCurrent = () => isOwned() && !operation.canceled;
    const setPhase = (nextPhase) => {
      operation.phase = nextPhase;
      if (isOwned()) setSaving({ format, phase: nextPhase });
    };
    let object = null;
    try {
      let data;
      if (format === "glb") {
        object = createAtlasObject(result);
        const exported = await exportStandeeObject(object, "glb");
        if (!isCurrent()) return;
        if (!exported.binary || !exported.value?.byteLength) throw new Error("Could not create the GLB model.");
        data = bytesToBase64(exported.value);
      } else {
        data = currentBuild.dataUrl.slice(PNG_PREFIX.length);
      }
      if (!isCurrent()) return;
      setPhase("choosing");
      const picked = await api.saveFileDialog({
        defaultName: format === "glb" ? `${safeName(result.name)}-atlased.glb` : `${safeName(result.name)}-atlas-${result.size}.png`,
        filters: [{ name: format === "glb" ? "glTF binary model" : "PNG texture", extensions: [format] }]
      });
      if (!isCurrent()) return;
      if (!picked?.ok) {
        if (picked?.error) throw new Error(picked.error);
        setFeedback({ request, message: "Save canceled. No file was written." });
        return;
      }
      if (!picked.path) throw new Error("The save dialog did not return a file path.");
      setPhase("writing");
      const write = await api.writeFile(picked.path, data);
      if (!write?.ok) throw new Error(write?.error || "Could not save the file.");
      if (!isOwned()) return;
      setFeedback({ request, message: `Saved to ${picked.path}` });
      try { audio.success(); } catch { /* sound is optional */ }
      Promise.resolve().then(() => api.showInFolder(picked.path)).catch(() => {});
    } catch (exception) {
      if (isCurrent()) setFeedback({ request, error: true, message: String(exception?.message || exception) });
    } finally {
      for (const resource of objectResources(object)) resource.dispose();
      if (saveRef.current === operation) {
        if (isOwned() && operation.canceled) setFeedback({ request, message: "Save canceled. No file was written." });
        saveRef.current = null;
        if (requestRef.current) setSaving(null);
      }
    }
  };

  const cancelSave = () => {
    const operation = saveRef.current;
    if (!operation || operation.phase === "writing") return;
    operation.canceled = true;
    setSaving((current) => current && ({ ...current, phase: "canceling" }));
  };

  const reset = () => {
    if (saveRef.current || importRef.current) return;
    setFiles([]);
    setSettings(DEFAULTS);
    setRevision((current) => current + 1);
    setImportError("");
    setPackageNotice("");
    setFeedback(null);
    setAutoRotate(false);
    setActualPixels(false);
    setViewReset((current) => current + 1);
  };

  const status = phase === "reading" ? "Reading the local model package..."
    : phase === "queued" ? "Latest settings queued. Any earlier build must finish before this one starts."
      : phase === "building" ? "Building the atlas for the current package and settings..."
        : phase === "error" ? "Atlas build failed. Adjust the input or settings, then rebuild."
          : result ? "The preview and exports match the current package and settings." : "Choose a package to start. Source files stay unchanged.";
  const materialReduction = result ? Math.max(0, result.materialCount - 1) : 0;
  const meshReduction = result ? Math.max(0, result.sourceMeshCount - result.outputMeshCount) : 0;

  return (
    <div className="atlas-workspace page drop-zone tools-refined" {...drop.bind}>
      <DropOverlay active={drop.dragOver} label="Drop an OBJ package to build its atlas" />
      <aside className="atlas-controls">
        <div className="atlas-head">
          <div className="section-kicker">Texture Atlas</div>
          <h1>One material. One atlas.</h1>
          <p>Pack an OBJ model's material textures into a single image and rewrite its UVs locally.</p>
        </div>

        <div className="tool-section">
          <div className="tools-section-head"><span className="section-kicker">01 Model package</span><button type="button" className="ghost small" disabled={inputBusy || !files.length} onClick={reset}>Clear package</button></div>
          <button type="button" className={`atlas-import${objFile ? " loaded" : ""}`} onClick={() => loadPackage()} disabled={inputBusy} aria-label={objFile ? `Replace model package ${objFile.name}` : "Choose a local OBJ model package"}>
            {objFile ? <FileBox size={23} aria-hidden="true" /> : <Upload size={23} aria-hidden="true" />}
            <span><strong>{importing ? "Reading package..." : objFile?.name || "Choose OBJ + MTL + textures"}</strong><small>{objFile ? "Click to replace the package" : "Drag the files here or browse from Explorer"}</small></span>
          </button>
          {objFile && (
            <div className="atlas-package-facts">
              <span><FileBox size={13} aria-hidden="true" />1 OBJ</span>
              <span><Layers3 size={13} aria-hidden="true" />{mtlFiles.length} MTL</span>
              <span><Image size={13} aria-hidden="true" />{textureFiles.length} texture files</span>
            </div>
          )}
          <p className="field-note">Supported input: Wavefront OBJ with UVs, MTL files, and PNG, JPEG, or WebP color textures.</p>
          {importError && <div className="errbox" role="alert">{importError}</div>}
          {packageNotice && <p className="field-note" role="status">{packageNotice}</p>}
        </div>

        <div className="tool-section">
          <fieldset className="tools-fields" disabled={inputBusy}>
            <legend className="tools-sr-only">Atlas output settings</legend>
            <div className="tools-section-head"><span className="section-kicker">02 Atlas</span><button type="button" className="ghost small" aria-label="Reset atlas output settings" onClick={() => setSettings(DEFAULTS)}><RotateCcw size={13} aria-hidden="true" />Reset options</button></div>
            <label className="compact-field"><span>Atlas resolution</span>
              <select value={settings.size} onChange={(event) => setSettings({ ...settings, size: Number(event.target.value) })}>
                <option value={512}>512 x 512</option><option value={1024}>1024 x 1024</option><option value={2048}>2048 x 2048</option><option value={4096}>4096 x 4096</option>
              </select>
            </label>
            <label className="compact-field"><span>Tile padding</span>
              <select value={settings.padding} onChange={(event) => setSettings({ ...settings, padding: Number(event.target.value) })}>
                <option value={2}>2 px</option><option value={4}>4 px</option><option value={8}>8 px</option><option value={16}>16 px</option><option value={32}>32 px</option>
              </select>
            </label>
            <label className="atlas-toggle">
              <input type="checkbox" checked={settings.mergeMeshes} onChange={(event) => setSettings({ ...settings, mergeMeshes: event.target.checked })} />
              <span><Merge size={15} aria-hidden="true" /><strong>Merge compatible meshes</strong><small>Uses one output mesh where possible. This does not reduce the triangle count.</small></span>
            </label>
            <button type="button" className="primary atlas-build" disabled={!objFile || generating} onClick={() => setRevision((current) => current + 1)}><RefreshCw size={15} className={generating ? "spin" : ""} aria-hidden="true" />{phase === "queued" ? "Build queued..." : phase === "building" ? "Building atlas..." : "Rebuild atlas"}</button>
            <p className="field-note">Settings rebuild automatically. Earlier results are hidden until the latest build finishes.</p>
          </fieldset>
        </div>

        <div className="tool-section atlas-export" aria-busy={Boolean(saving)}>
          <div className="section-kicker">03 Export</div>
          <button type="button" className="primary" disabled={!result || inputBusy} onClick={() => save("glb")}><Download size={15} aria-hidden="true" />Save GLB</button>
          <button type="button" disabled={!result || inputBusy} onClick={() => save("png")}><Grid3X3 size={15} aria-hidden="true" />Save atlas PNG</button>
          <p className="field-note">All processing stays local. The GLB includes its atlas texture.</p>
          {saving && <div className="tool-save-state">
            <span role="status">{saving.phase === "preparing" ? `Preparing ${saving.format.toUpperCase()}...` : saving.phase === "choosing" ? "Choose a location, or cancel in the save dialog." : saving.phase === "canceling" ? "Cancel requested. Close the save dialog if it is open." : "Writing the file..."}</span>
            <button type="button" className="small" disabled={saving.phase === "writing" || saving.phase === "canceling"} onClick={cancelSave}>Cancel save</button>
          </div>}
          {currentFeedback && <div className={currentFeedback.error ? "errbox tool-feedback" : "tool-feedback"} role={currentFeedback.error ? "alert" : "status"}>{currentFeedback.message}</div>}
        </div>
      </aside>

      <main className="atlas-stage">
        <div className="atlas-stage-head">
          <div><span className="section-kicker">Live output</span><strong>{result ? `${result.name}-atlased.glb` : objFile?.name || "Waiting for a model"}</strong></div>
          {result && <span className="pill teal"><CheckCircle2 size={13} aria-hidden="true" />READY</span>}
        </div>
        <p className="tool-status atlas-build-status" role="status">{status}</p>
        {phase === "error" && <div className="errbox atlas-error" role="alert">{currentBuild.error}</div>}
        <div className="atlas-preview-grid" aria-busy={generating || importing}>
          <section className="atlas-model-preview" aria-label="Model preview">
            {viewerSource ? <>
              <div className="atlas-preview-toolbar">
                <label className="qr-check"><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} /><span>Auto rotate</span></label>
                <button type="button" className="small" onClick={() => setViewReset((current) => current + 1)}><RotateCcw size={13} aria-hidden="true" />Reset view</button>
              </div>
              <Viewer3D key={viewReset} source={viewerSource} autoRotate={autoRotate} inspection viewDirection={[-0.45, -1, -0.1]} frameFactor={2.1} hint="drag to orbit | scroll to zoom | atlased output" />
            </> : <AtlasEmpty phase={phase} />}
          </section>
          <section className="atlas-image-panel" aria-label="Atlas image preview">
            <div className="atlas-panel-head"><span>Generated atlas</span>{result && <small>{result.size} x {result.size}</small>}</div>
            <div className="tools-button-row atlas-image-controls" role="group" aria-label="Atlas image zoom">
              <button type="button" className="small" disabled={!result} aria-pressed={!actualPixels} onClick={() => setActualPixels(false)}>Fit image</button>
              <button type="button" className="small" disabled={!result} aria-pressed={actualPixels} onClick={() => setActualPixels(true)}>Actual pixels</button>
            </div>
            <div className={`atlas-image-wrap tools-checker${actualPixels && result ? " actual-pixels" : ""}`} tabIndex={result ? 0 : undefined} role="region" aria-label="Atlas texture preview, scroll to inspect when viewing actual pixels">
              {result ? <img src={currentBuild.dataUrl} alt={`Generated color atlas for ${result.name}`} style={actualPixels ? { width: result.size, height: result.size } : undefined} /> : <Grid3X3 size={38} aria-hidden="true" />}
            </div>
            <p className="field-note">{actualPixels && result ? "Scroll here to inspect the texture. Use Fit image to see the full atlas." : "The checker pattern indicates transparency."}</p>
          </section>
        </div>
        {result && (
          <>
            <section className="atlas-reduction" aria-labelledby="atlas-reduction-title">
              <h2 id="atlas-reduction-title">Output reduction</h2>
              <div><span>Materials</span><strong>{result.materialCount.toLocaleString()} to 1</strong><small>{materialReduction.toLocaleString()} fewer ({Math.round(materialReduction / result.materialCount * 100)}% reduction)</small></div>
              <div><span>Meshes</span><strong>{result.sourceMeshCount.toLocaleString()} to {result.outputMeshCount.toLocaleString()}</strong><small>{meshReduction.toLocaleString()} fewer ({Math.round(meshReduction / result.sourceMeshCount * 100)}% reduction)</small></div>
              <p className="field-note">Counts come from this build. Geometry is not decimated, and fewer materials do not guarantee a smaller file.</p>
            </section>
            <div className="atlas-stats">
              <div><strong>{result.textureCount.toLocaleString()}</strong><span>Tiles using color textures</span></div>
              <div><strong>{result.triangles.toLocaleString()}</strong><span>Output triangles</span></div>
              <div><strong>{api.formatBytes(currentBuild.pngBytes)}</strong><span>Actual atlas PNG size</span></div>
            </div>
            <details className="atlas-mapping">
              <summary>Material mapping ({result.tiles.length})</summary>
              <div className="atlas-tile-list">{result.tiles.map((tile) => <span key={tile.name}><strong title={tile.name}>{tile.name}</strong><small title={tile.source}>{tile.source}</small></span>)}</div>
            </details>
            <p className="field-note">Only color textures and flat material colors are packed. Inspect tiled UVs and missing textures before export. Normal, roughness and metallic maps are not transferred.</p>
          </>
        )}
      </main>
    </div>
  );
}

function AtlasEmpty({ phase }) {
  const title = phase === "reading" ? "Reading the package" : phase === "queued" ? "Waiting for the latest build" : phase === "building" ? "Building the current atlas" : phase === "error" ? "Build needs attention" : "Import a textured OBJ";
  return <div className="atlas-empty"><Boxes size={38} aria-hidden="true" /><strong>{title}</strong><span>{phase === "idle" ? "The model and texture previews appear here after packing." : phase === "error" ? "No output is available for these inputs. Check the error above and rebuild." : "Earlier output is not shown or exported while a new result is being prepared."}</span></div>;
}
