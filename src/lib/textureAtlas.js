import * as THREE from "three";
import { OBJLoader } from "three/addons/loaders/OBJLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

function fileBaseName(value) {
  return String(value || "").replace(/\\/g, "/").split("/").pop().toLowerCase();
}

function textureDataUrl(file) {
  return `data:${file.mime || "image/png"};base64,${file.dataBase64}`;
}

function imageFromFile(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Could not decode ${file.name}.`));
    image.src = textureDataUrl(file);
  });
}

function mapReference(value) {
  const trimmed = String(value || "").trim();
  const quoted = trimmed.match(/["']([^"']+)["']\s*$/);
  return quoted ? quoted[1] : trimmed.split(/\s+/).pop() || "";
}

export function parseMtlFiles(files) {
  const materials = new Map();
  for (const file of files.filter((entry) => entry.extension === ".mtl")) {
    let current = null;
    for (const rawLine of String(file.text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const space = line.search(/\s/);
      const command = (space === -1 ? line : line.slice(0, space)).toLowerCase();
      const value = space === -1 ? "" : line.slice(space + 1).trim();
      if (command === "newmtl") {
        current = value;
        if (!materials.has(current)) materials.set(current, { name: current, color: "#ffffff", opacity: 1, map: "" });
        continue;
      }
      if (!current) continue;
      const material = materials.get(current);
      if (command === "kd") {
        const channels = value.split(/\s+/).slice(0, 3).map(Number);
        if (channels.length === 3 && channels.every(Number.isFinite)) {
          material.color = `#${channels.map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, "0")).join("")}`;
        }
      } else if (command === "d") {
        const opacity = Number(value);
        if (Number.isFinite(opacity)) material.opacity = Math.max(0, Math.min(1, opacity));
      } else if (command === "tr") {
        const transparency = Number(value);
        if (Number.isFinite(transparency)) material.opacity = 1 - Math.max(0, Math.min(1, transparency));
      } else if (command === "map_kd") {
        material.map = mapReference(value);
      }
    }
  }
  return materials;
}

function normalizedUv(value) {
  if (value >= 0 && value <= 1) return value;
  return value - Math.floor(value);
}

function drawImageWithPadding(context, image, x, y, width, height, padding) {
  const innerX = x + padding;
  const innerY = y + padding;
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  context.drawImage(image, innerX, innerY, innerWidth, innerHeight);
  if (padding <= 0) return;
  context.drawImage(image, 0, 0, image.naturalWidth, 1, innerX, y, innerWidth, padding);
  context.drawImage(image, 0, image.naturalHeight - 1, image.naturalWidth, 1, innerX, innerY + innerHeight, innerWidth, padding);
  context.drawImage(image, 0, 0, 1, image.naturalHeight, x, innerY, padding, innerHeight);
  context.drawImage(image, image.naturalWidth - 1, 0, 1, image.naturalHeight, innerX + innerWidth, innerY, padding, innerHeight);
  context.drawImage(image, 0, 0, 1, 1, x, y, padding, padding);
  context.drawImage(image, image.naturalWidth - 1, 0, 1, 1, innerX + innerWidth, y, padding, padding);
  context.drawImage(image, 0, image.naturalHeight - 1, 1, 1, x, innerY + innerHeight, padding, padding);
  context.drawImage(image, image.naturalWidth - 1, image.naturalHeight - 1, 1, 1, innerX + innerWidth, innerY + innerHeight, padding, padding);
}

function materialNamesFor(object) {
  const names = [];
  object.traverse((child) => {
    if (!child.isMesh) return;
    for (const [index, material] of (Array.isArray(child.material) ? child.material : [child.material]).entries()) {
      const name = String(material?.name || `material-${index}`);
      if (!names.includes(name)) names.push(name);
    }
  });
  return names;
}

function textureFileFor(files, reference) {
  const base = fileBaseName(reference);
  return files.find((file) => file.dataBase64 && fileBaseName(file.path || file.name) === base) || null;
}

async function buildAtlasCanvas(materialNames, materialDefinitions, files, size, padding) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: true });
  context.clearRect(0, 0, size, size);
  const columns = Math.ceil(Math.sqrt(materialNames.length));
  const rows = Math.ceil(materialNames.length / columns);
  const cellWidth = Math.floor(size / columns);
  const cellHeight = Math.floor(size / rows);
  const tiles = new Map();

  for (const [index, name] of materialNames.entries()) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = column * cellWidth;
    const y = row * cellHeight;
    const width = column === columns - 1 ? size - x : cellWidth;
    const height = row === rows - 1 ? size - y : cellHeight;
    const inset = Math.min(padding, Math.floor(Math.min(width, height) / 4));
    const definition = materialDefinitions.get(name) || { color: "#ffffff", opacity: 1, map: "" };
    const textureFile = definition.map ? textureFileFor(files, definition.map) : null;
    context.clearRect(x, y, width, height);
    if (textureFile) {
      const image = await imageFromFile(textureFile);
      drawImageWithPadding(context, image, x, y, width, height, inset);
    } else {
      context.globalAlpha = definition.opacity ?? 1;
      context.fillStyle = definition.color || "#ffffff";
      context.fillRect(x, y, width, height);
      context.globalAlpha = 1;
    }
    tiles.set(name, {
      name,
      source: textureFile?.name || "Material color",
      u0: (x + inset) / size,
      u1: (x + width - inset) / size,
      v0: 1 - (y + height - inset) / size,
      v1: 1 - (y + inset) / size,
    });
  }
  return { canvas, tiles, columns, rows };
}

function remapMeshGeometry(child, tiles) {
  child.updateWorldMatrix(true, false);
  let geometry = child.geometry.clone();
  if (geometry.index) geometry = geometry.toNonIndexed();
  const uv = geometry.getAttribute("uv");
  if (!uv) {
    geometry.dispose();
    throw new Error(`Mesh ${child.name || "without a name"} has no UV coordinates.`);
  }
  const materials = Array.isArray(child.material) ? child.material : [child.material];
  const groups = geometry.groups.length
    ? geometry.groups
    : [{ start: 0, count: geometry.getAttribute("position").count, materialIndex: 0 }];
  for (const group of groups) {
    const material = materials[group.materialIndex || 0] || materials[0];
    const name = String(material?.name || `material-${group.materialIndex || 0}`);
    const tile = tiles.get(name) || tiles.values().next().value;
    const end = Math.min(uv.count, group.start + group.count);
    for (let vertex = group.start; vertex < end; vertex += 1) {
      const sourceU = normalizedUv(uv.getX(vertex));
      const sourceV = normalizedUv(uv.getY(vertex));
      uv.setXY(vertex, tile.u0 + sourceU * (tile.u1 - tile.u0), tile.v0 + sourceV * (tile.v1 - tile.v0));
    }
  }
  uv.needsUpdate = true;
  geometry.applyMatrix4(child.matrixWorld);
  geometry.clearGroups();
  for (const attribute of Object.keys(geometry.attributes)) {
    if (!["position", "normal", "uv"].includes(attribute)) geometry.deleteAttribute(attribute);
  }
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  return geometry;
}

export async function buildTextureAtlas(files, options = {}) {
  const objFile = files.find((file) => file.extension === ".obj");
  if (!objFile) throw new Error("Choose an OBJ model.");
  const source = new OBJLoader().parse(String(objFile.text || ""));
  source.updateMatrixWorld(true);
  const materialDefinitions = parseMtlFiles(files);
  const materialNames = materialNamesFor(source);
  if (!materialNames.length) throw new Error("No material slots were found in this model.");
  const size = [512, 1024, 2048, 4096].includes(Number(options.size)) ? Number(options.size) : 2048;
  const padding = Math.max(0, Math.min(32, Math.floor(Number(options.padding) || 8)));
  const atlas = await buildAtlasCanvas(materialNames, materialDefinitions, files, size, padding);
  const geometries = [];
  let triangles = 0;
  source.traverse((child) => {
    if (!child.isMesh) return;
    const geometry = remapMeshGeometry(child, atlas.tiles);
    triangles += geometry.getAttribute("position").count / 3;
    geometries.push({ name: child.name || `mesh-${geometries.length + 1}`, geometry });
  });
  if (!geometries.length) throw new Error("No mesh geometry was found in the OBJ file.");

  let outputGeometries = geometries;
  if (options.mergeMeshes === true && geometries.length > 1) {
    const merged = mergeGeometries(geometries.map((entry) => entry.geometry), false);
    if (!merged) throw new Error("These meshes could not be merged because their geometry layouts differ.");
    for (const entry of geometries) entry.geometry.dispose();
    outputGeometries = [{ name: `${objFile.name.replace(/\.obj$/i, "")}-merged`, geometry: merged }];
  }

  return {
    name: objFile.name.replace(/\.obj$/i, "") || "model",
    canvas: atlas.canvas,
    geometries: outputGeometries,
    sourceMeshCount: geometries.length,
    outputMeshCount: outputGeometries.length,
    materialCount: materialNames.length,
    textureCount: [...atlas.tiles.values()].filter((tile) => tile.source !== "Material color").length,
    triangles: Math.round(triangles),
    size,
    padding,
    tiles: [...atlas.tiles.values()].map(({ name, source }) => ({ name, source })),
  };
}

export function createAtlasObject(result) {
  const texture = new THREE.CanvasTexture(result.canvas);
  texture.name = `${result.name}-atlas`;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;
  const material = new THREE.MeshStandardMaterial({
    name: "atlas_material",
    map: texture,
    color: 0xffffff,
    roughness: 0.82,
    metalness: 0,
    side: THREE.DoubleSide,
    transparent: true,
    alphaTest: 0.01,
  });
  const group = new THREE.Group();
  group.name = `${result.name}-atlased`;
  for (const entry of result.geometries) {
    const mesh = new THREE.Mesh(entry.geometry.clone(), material);
    mesh.name = entry.name;
    group.add(mesh);
  }
  return group;
}

export function disposeAtlasResult(result) {
  for (const entry of result?.geometries || []) entry.geometry.dispose();
}
