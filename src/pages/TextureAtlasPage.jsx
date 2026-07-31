import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes, CheckCircle2, Download, FileBox, FolderOpen, Grid3X3, Image, Layers3, Merge, RefreshCw, Upload } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import { DropOverlay, useFileDrop } from "../components/dropZone.jsx";
import Viewer3D from "../components/Viewer3D.jsx";
import { bytesToBase64, exportStandeeObject } from "../lib/standeeExport.js";
import { buildTextureAtlas, createAtlasObject, disposeAtlasResult } from "../lib/textureAtlas.js";

const DEFAULTS = { size: 2048, padding: 8, mergeMeshes: true };

function safeName(value) {
  return String(value || "model").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "model";
}

export default function TextureAtlasPage() {
  const [files, setFiles] = useState([]);
  const [settings, setSettings] = useState(DEFAULTS);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  useEffect(() => () => disposeAtlasResult(result), [result]);

  const acceptPackage = useCallback((response) => {
    if (!response?.ok) {
      if (!response?.canceled) setError(response?.error || "Could not read that model package.");
      return;
    }
    setFiles(response.files || []);
    setError("");
    setSaved("");
  }, []);

  const browse = async () => acceptPackage(await api.openAtlasPackage());
  const drop = useFileDrop({
    disabled: busy,
    onPaths: async (paths) => acceptPackage(await api.readAtlasPackage(paths))
  });

  const objFile = files.find((file) => file.extension === ".obj");
  const mtlFiles = files.filter((file) => file.extension === ".mtl");
  const textureFiles = files.filter((file) => file.dataBase64);

  const generate = useCallback(async () => {
    if (!objFile) return;
    setBusy(true);
    setError("");
    setSaved("");
    try {
      const next = await buildTextureAtlas(files, settings);
      setResult((current) => {
        disposeAtlasResult(current);
        return next;
      });
      audio.success();
    } catch (exception) {
      setResult((current) => {
        disposeAtlasResult(current);
        return null;
      });
      setError(String(exception?.message || exception));
    } finally {
      setBusy(false);
    }
  }, [files, objFile, settings]);

  useEffect(() => {
    if (!objFile) return undefined;
    const timer = window.setTimeout(generate, 80);
    return () => window.clearTimeout(timer);
  }, [generate, objFile]);

  const viewerSource = useMemo(() => result && ({
    type: "geometry",
    build: () => createAtlasObject(result)
  }), [result]);

  const exportGlb = async () => {
    if (!result) return;
    setBusy(true);
    setError("");
    let object = null;
    try {
      object = createAtlasObject(result);
      const exported = await exportStandeeObject(object, "glb");
      const picked = await api.saveFileDialog({
        defaultName: `${safeName(result.name)}-atlased.glb`,
        filters: [{ name: "glTF binary model", extensions: ["glb"] }]
      });
      if (!picked.ok) return;
      const write = await api.writeFile(picked.path, bytesToBase64(exported.value));
      if (!write.ok) throw new Error(write.error || "Could not save the model.");
      setSaved(picked.path);
      audio.success();
      api.showInFolder(picked.path);
    } catch (exception) {
      setError(String(exception?.message || exception));
    } finally {
      object?.traverse((child) => {
        if (!child.isMesh) return;
        child.geometry?.dispose?.();
        child.material?.map?.dispose?.();
        child.material?.dispose?.();
      });
      setBusy(false);
    }
  };

  const exportPng = async () => {
    if (!result) return;
    const picked = await api.saveFileDialog({
      defaultName: `${safeName(result.name)}-atlas-${result.size}.png`,
      filters: [{ name: "PNG texture", extensions: ["png"] }]
    });
    if (!picked.ok) return;
    const write = await api.writeFile(picked.path, result.canvas.toDataURL("image/png").split(",")[1]);
    if (write.ok) {
      setSaved(picked.path);
      audio.success();
      api.showInFolder(picked.path);
    } else setError(write.error || "Could not save the atlas image.");
  };

  return (
    <div className="atlas-workspace page drop-zone" {...drop.bind}>
      <DropOverlay active={drop.dragOver} label="Drop an OBJ package to build its atlas" />
      <aside className="atlas-controls">
        <div className="atlas-head">
          <div className="section-kicker">Texture Atlas</div>
          <h1>One material. One atlas.</h1>
          <p>Pack an OBJ model's material textures into a single image and rewrite its UVs locally.</p>
        </div>

        <div className="tool-section">
          <div className="section-kicker">01 Model package</div>
          <button className={`atlas-import${objFile ? " loaded" : ""}`} onClick={browse} disabled={busy}>
            {objFile ? <FileBox size={23} /> : <Upload size={23} />}
            <span><strong>{objFile?.name || "Choose OBJ + MTL + textures"}</strong><small>{objFile ? "Click to replace the package" : "Drag the files here or browse from Explorer"}</small></span>
          </button>
          {objFile && (
            <div className="atlas-package-facts">
              <span><FileBox size={13} />1 OBJ</span>
              <span><Layers3 size={13} />{mtlFiles.length} MTL</span>
              <span><Image size={13} />{textureFiles.length} textures</span>
            </div>
          )}
          <p className="field-note">Supported input: Wavefront OBJ with UVs, MTL files, and PNG, JPEG, or WebP color textures.</p>
        </div>

        <div className="tool-section">
          <div className="section-kicker">02 Atlas</div>
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
            <span><Merge size={15} /><strong>Compress into one mesh</strong><small>Collapses all compatible OBJ meshes after the atlas material is applied.</small></span>
          </label>
          <button className="primary atlas-build" disabled={!objFile || busy} onClick={generate}><RefreshCw size={15} className={busy ? "spin" : ""} />{busy ? "Building atlas..." : "Rebuild atlas"}</button>
        </div>

        <div className="tool-section atlas-export">
          <div className="section-kicker">03 Export</div>
          <button className="primary" disabled={!result || busy} onClick={exportGlb}><Download size={15} />Export optimized GLB</button>
          <button disabled={!result || busy} onClick={exportPng}><Grid3X3 size={15} />Export atlas PNG</button>
          {saved && <div className="export-success"><FolderOpen size={14} />Saved to {saved}</div>}
        </div>
      </aside>

      <main className="atlas-stage">
        <div className="atlas-stage-head">
          <div><span className="section-kicker">Live output</span><strong>{result ? `${result.name}-atlased.glb` : "Waiting for a model"}</strong></div>
          {result && <span className="pill teal"><CheckCircle2 size={11} />READY</span>}
        </div>
        <div className="atlas-preview-grid">
          <section className="atlas-model-preview">
            {viewerSource ? <Viewer3D source={viewerSource} autoRotate inspection viewDirection={[-0.45, -1, -0.1]} frameFactor={2.1} hint="drag to orbit | scroll to zoom | atlased output" /> : <AtlasEmpty />}
          </section>
          <section className="atlas-image-panel">
            <div className="atlas-panel-head"><span>Generated atlas</span>{result && <small>{result.size} x {result.size}</small>}</div>
            <div className="atlas-image-wrap">
              {result ? <img src={result.canvas.toDataURL("image/png")} alt="Generated texture atlas" /> : <Grid3X3 size={38} />}
            </div>
          </section>
        </div>
        {result && (
          <div className="atlas-stats">
            <div><strong>{result.materialCount}</strong><span>Materials packed</span></div>
            <div><strong>{result.textureCount}</strong><span>Textures found</span></div>
            <div><strong>{result.sourceMeshCount}</strong><span>Source meshes</span></div>
            <div><strong>{result.outputMeshCount}</strong><span>Output meshes</span></div>
            <div><strong>{result.triangles.toLocaleString()}</strong><span>Triangles</span></div>
          </div>
        )}
        {result && <div className="atlas-tile-list">{result.tiles.map((tile) => <span key={tile.name}><strong>{tile.name}</strong><small>{tile.source}</small></span>)}</div>}
        {error && <div className="errbox atlas-error">{error}</div>}
      </main>
    </div>
  );
}

function AtlasEmpty() {
  return <div className="atlas-empty"><Boxes size={38} /><strong>Import a textured OBJ</strong><span>The optimized model preview appears here after its materials are packed and UVs are rewritten.</span></div>;
}
