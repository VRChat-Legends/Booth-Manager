import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Download, FileImage, FolderOpen, Grid3X3, ImagePlus, RotateCcw, Upload } from "lucide-react";
import * as api from "../lib/api.js";
import * as audio from "../lib/audio.js";
import {
  createCardboardCanvas,
  createStandeeObject,
  disposeObject3D,
  generateStandee,
  STANDEE_DEFAULTS
} from "../lib/standee.js";
import { bytesToBase64, exportStandeeObject } from "../lib/standeeExport.js";
import Viewer3D from "../components/Viewer3D.jsx";

const FORMAT_LABELS = { glb: "GLB", fbx: "FBX", obj: "OBJ", stl: "STL" };

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Could not read that image."));
    image.src = url;
  });
}

function extension(name) {
  const value = String(name || "image.png").toLowerCase().split(".").pop();
  return ["png", "jpg", "jpeg", "webp"].includes(value) ? value : "png";
}

function safeName(name) {
  return String(name || "standee").replace(/\.[^.]+$/, "").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "") || "standee";
}

export default function StandeePage() {
  const [front, setFront] = useState(null);
  const [back, setBack] = useState(null);
  const [params, setParams] = useState({ ...STANDEE_DEFAULTS });
  const [model, setModel] = useState(null);
  const [format, setFormat] = useState("glb");
  const [exportScale, setExportScale] = useState(1);
  const [wireframe, setWireframe] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  const [dragging, setDragging] = useState(false);
  const cardboard = useMemo(() => createCardboardCanvas(), []);
  const rebuildId = useRef(0);

  const toRecord = async (file) => {
    const ext = extension(file.name);
    const dataUrl = file.dataUrl || `data:image/${ext === "jpg" ? "jpeg" : ext};base64,${file.dataBase64}`;
    return { ...file, ext, dataUrl, image: await imageFromUrl(dataUrl) };
  };

  const pickFront = async () => {
    const result = await api.openImageDialog({});
    if (!result.ok) return;
    setFront(await toRecord(result.files[0]));
    setSaved("");
  };

  const pickBack = async () => {
    const result = await api.openImageDialog({});
    if (!result.ok) return;
    setBack(await toRecord(result.files[0]));
    setSaved("");
  };

  const onDrop = async (event) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !file.type.startsWith("image/")) {
      setError("Drop a PNG, JPG, or WebP image.");
      return;
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("Could not read the dropped file."));
      reader.readAsDataURL(file);
    });
    setFront(await toRecord({ name: file.name, dataUrl, dataBase64: dataUrl.split(",")[1] }));
  };

  useEffect(() => {
    if (!front?.image) {
      setModel(null);
      return undefined;
    }
    const request = ++rebuildId.current;
    const timeout = window.setTimeout(() => {
      try {
        setBusy(true);
        const maxDimension = params.accuracy === "high" ? 1600 : params.accuracy === "low" ? 640 : 1100;
        const scale = Math.min(1, maxDimension / Math.max(front.image.naturalWidth, front.image.naturalHeight));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(8, Math.round(front.image.naturalWidth * scale));
        canvas.height = Math.max(8, Math.round(front.image.naturalHeight * scale));
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(front.image, 0, 0, canvas.width, canvas.height);
        const next = generateStandee(context.getImageData(0, 0, canvas.width, canvas.height), params);
        if (request === rebuildId.current) {
          setModel(next);
          setError("");
        }
      } catch (exception) {
        if (request === rebuildId.current) {
          setModel(null);
          setError(String(exception?.message || exception));
        }
      } finally {
        if (request === rebuildId.current) setBusy(false);
      }
    }, 140);
    return () => window.clearTimeout(timeout);
  }, [front, params]);

  const viewerSource = useMemo(() => model && ({
    type: "geometry",
    build: () => createStandeeObject(model, {
      front: front.image,
      back: back?.image,
      cardboard,
      wireframe
    })
  }), [back, cardboard, front, model, wireframe]);

  const set = (key, value) => setParams((current) => ({ ...current, [key]: value }));
  const reset = () => {
    setParams({ ...STANDEE_DEFAULTS });
    setWireframe(false);
    setExportScale(1);
  };

  const exportModel = async () => {
    if (!model || !front) return;
    setBusy(true);
    setError("");
    let object = null;
    try {
      const folder = await api.pickFolder();
      if (!folder.ok) return;
      const name = safeName(front.name);
      object = createStandeeObject(model, { front: front.image, back: back?.image, cardboard });
      object.scale.setScalar(exportScale);
      const exported = await exportStandeeObject(object, format);
      const root = folder.path.replace(/[\\/]$/, "");
      const outputPath = `${root}\\${name}.${format}`;
      if (exported.binary) {
        await api.writeFile(outputPath, bytesToBase64(exported.value));
      } else {
        await api.writeText(outputPath, `mtllib ${name}.mtl\n${exported.value}`);
        const frontName = `${name}-front.${front.ext}`;
        const backName = back ? `${name}-back.${back.ext}` : "";
        const cardboardName = `${name}-cardboard.png`;
        const materialText = [
          "newmtl standee_front", "Kd 1 1 1", `map_Kd ${frontName}`, "",
          "newmtl standee_cardboard", "Kd 0.72 0.53 0.32",
          params.texturedCardboard ? `map_Kd ${cardboardName}` : "", "",
          ...(back ? ["newmtl standee_back", "Kd 1 1 1", `map_Kd ${backName}`, ""] : [])
        ].join("\n");
        await api.writeText(`${root}\\${name}.mtl`, materialText);
        await api.writeFile(`${root}\\${frontName}`, front.dataBase64);
        if (back) await api.writeFile(`${root}\\${backName}`, back.dataBase64);
        if (params.texturedCardboard) {
          await api.writeFile(`${root}\\${cardboardName}`, cardboard.toDataURL("image/png").split(",")[1]);
        }
      }
      setSaved(outputPath);
      audio.success();
      api.showInFolder(outputPath);
    } catch (exception) {
      setError(String(exception?.message || exception));
    } finally {
      if (object) disposeObject3D(object);
      setBusy(false);
    }
  };

  return (
    <div className="standee-workspace page">
      <aside className="standee-controls">
        <div className="tool-section">
          <div className="section-kicker">01 Input</div>
          <div
            className={`image-drop${dragging ? " dragging" : ""}${front ? " loaded" : ""}`}
            onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={pickFront}
          >
            {front ? <img src={front.dataUrl} alt="Standee source" /> : <Upload size={24} />}
            <div>
              <strong>{front ? front.name : "Drop your image here"}</strong>
              <span>{front ? "Click to replace" : "or click to browse, PNG alpha works best"}</span>
            </div>
          </div>
          <Range label="Subject detection" value={`${Math.round(params.threshold * 100)}%`} min={5} max={95} step={1}
            current={params.threshold * 100} onChange={(value) => set("threshold", value / 100)} />
          <div className="input-row">
            <button onClick={pickBack}><ImagePlus size={15} />{back ? "Replace back" : "Optional back image"}</button>
            {back && <button className="icon-button" title="Remove back image" onClick={() => setBack(null)}><RotateCcw size={15} /></button>}
          </div>
        </div>

        <div className="tool-section">
          <div className="section-kicker">02 Model</div>
          <Range label="Cardboard thickness" value={`${Math.round(params.thickness * 1000)} mm`} min={2} max={40} step={1}
            current={params.thickness * 1000} onChange={(value) => set("thickness", value / 1000)} />
          <Range label="Standee height" value={`${params.height.toFixed(2)} m`} min={0.2} max={3} step={0.05}
            current={params.height} onChange={(value) => set("height", value)} />
          <Range label="Edge bevel" value={`${(params.bevel * 1000).toFixed(1)} mm`} min={0} max={6} step={0.5}
            current={params.bevel * 1000} onChange={(value) => set("bevel", value / 1000)} />
          <div className="control-pair">
            <Select label="Outline accuracy" value={params.accuracy} onChange={(value) => set("accuracy", value)} />
            <Select label="Optimization" value={params.optimization} onChange={(value) => set("optimization", value)} />
          </div>
          <Range label="Maximum vertices" value={params.maxVertices.toLocaleString()} min={300} max={8000} step={50}
            current={params.maxVertices} onChange={(value) => set("maxVertices", value)} />
        </div>

        <div className="tool-section">
          <div className="section-kicker">03 Support</div>
          <Toggle label="Add folding support stand" checked={params.addStand} onChange={(value) => set("addStand", value)} />
          <div className={params.addStand ? "" : "disabled-controls"}>
            <Range label="Stand width" value={`${Math.round(params.standWidth * 100)}%`} min={10} max={90} step={5}
              current={params.standWidth * 100} disabled={!params.addStand} onChange={(value) => set("standWidth", value / 100)} />
            <Range label="Stand angle" value={`${params.standAngle} deg`} min={5} max={40} step={1}
              current={params.standAngle} disabled={!params.addStand} onChange={(value) => set("standAngle", value)} />
            <Range label="Hinge height" value={`${Math.round(params.standHinge * 100)}%`} min={30} max={92} step={1}
              current={params.standHinge * 100} disabled={!params.addStand} onChange={(value) => set("standHinge", value / 100)} />
            <Range label="Stand position" value={`${params.standOffsetX >= 0 ? "+" : ""}${Math.round(params.standOffsetX * 100)}%`} min={-35} max={35} step={1}
              current={params.standOffsetX * 100} disabled={!params.addStand} onChange={(value) => set("standOffsetX", value / 100)} />
          </div>
          <Toggle label="Textured kraft cardboard" checked={params.texturedCardboard} onChange={(value) => set("texturedCardboard", value)} />
        </div>

        <div className="tool-section export-section">
          <div className="section-kicker">04 Export</div>
          <div className="format-picker">
            {Object.entries(FORMAT_LABELS).map(([key, label]) => (
              <button key={key} className={format === key ? "active" : ""} onClick={() => setFormat(key)}>{label}</button>
            ))}
          </div>
          <label className="compact-field"><span>Export scale</span>
            <select value={exportScale} onChange={(event) => setExportScale(Number(event.target.value))}>
              <option value={0.01}>x0.01</option>
              <option value={1}>x1, Unity meters</option>
              <option value={100}>x100, Unreal cm</option>
            </select>
          </label>
          <button className="primary export-button" disabled={!model || busy} onClick={exportModel}>
            <Download size={16} />{busy ? "Building..." : `Export ${FORMAT_LABELS[format]}`}
          </button>
          {saved && <div className="export-success"><FolderOpen size={14} />Saved to {saved}</div>}
        </div>

        <div className="standee-credit">
          Workflow inspired by Sketch494&apos;s GPL-3.0 Auto-Standee. Geometry and UI here are an original implementation.
        </div>
      </aside>

      <section className="standee-stage">
        <div className="stage-toolbar">
          <div>
            <strong>Live model</strong>
            <span>{busy ? "Rebuilding outline..." : model ? model.stats.source : "Waiting for an image"}</span>
          </div>
          <button className={wireframe ? "active" : ""} onClick={() => setWireframe((value) => !value)} title="Toggle wireframe">
            <Grid3X3 size={15} />Wireframe
          </button>
          <button onClick={reset} title="Reset model settings"><RotateCcw size={15} />Reset</button>
        </div>
        {viewerSource ? (
          <Viewer3D source={viewerSource} autoRotate={false} hint="drag to orbit, scroll to zoom" style={{ minHeight: 520 }} />
        ) : (
          <div className="standee-empty">
            <div className="empty-model"><Box size={46} /></div>
            <h2>Your standee will appear here</h2>
            <p>Drop a character image into the Input panel to generate a live, game-ready cutout.</p>
            <button className="primary" onClick={pickFront}><FileImage size={16} />Choose image</button>
          </div>
        )}
        {model && (
          <div className="standee-stats">
            <span><strong>{model.stats.triangles.toLocaleString()}</strong> tris</span>
            <span><strong>{model.stats.vertices.toLocaleString()}</strong> generated verts</span>
            <span><strong>{model.stats.outlinePoints.toLocaleString()}</strong> outline points</span>
            <span><strong>{model.stats.holes}</strong> holes</span>
            <span>{model.stats.width.toFixed(2)} x {model.stats.height.toFixed(2)} m</span>
          </div>
        )}
        {error && <div className="stage-error">{error}</div>}
      </section>
    </div>
  );
}

function Range({ label, value, current, min, max, step, disabled, onChange }) {
  return (
    <label className="range-control">
      <span><span>{label}</span><output>{value}</output></span>
      <input type="range" min={min} max={max} step={step} value={current} disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function Select({ label, value, onChange }) {
  return (
    <label className="compact-field"><span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </select>
    </label>
  );
}

function Toggle({ label, checked, onChange }) {
  return (
    <label className="switch-row">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="switch-track"><span /></span>
      <span>{label}</span>
    </label>
  );
}