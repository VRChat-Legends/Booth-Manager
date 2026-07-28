import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

export const STANDEE_DEFAULTS = Object.freeze({
  thickness: 0.012,
  height: 1.8,
  bevel: 0.002,
  accuracy: "medium",
  optimization: "medium",
  maxVertices: 1500,
  threshold: 0.5,
  addStand: true,
  standWidth: 0.35,
  standAngle: 15,
  standHinge: 0.72,
  standOffsetX: 0,
  texturedCardboard: true
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function generateStandee(imageData, rawOptions = {}) {
  const options = normalizeOptions(rawOptions);
  const { width, height, data } = imageData;
  const { mask, source } = buildMask(data, width, height, options.threshold);
  const cleaned = keepSignificantComponents(mask, width, height);
  const loops = traceLoops(cleaned, width, height)
    .filter((loop) => loop.length >= 3 && Math.abs(polygonArea(loop)) >= 4);
  if (!loops.length) {
    throw new Error("No subject found. Use a transparent PNG or an image with a simple background.");
  }

  let regions = classifyLoops(loops);
  if (!regions.length) throw new Error("The subject outline could not be classified.");

  const accuracyScale = { low: 1 / 150, medium: 1 / 320, high: 1 / 650 }[options.accuracy];
  const optimizationScale = { low: 0.62, medium: 1, high: 1.8 }[options.optimization];
  let epsilon = Math.max(0.35, Math.min(width, height) * accuracyScale * optimizationScale);
  const reserve = options.addStand ? 120 : 0;
  const pointBudget = Math.max(12, Math.floor((options.maxVertices - reserve) / (options.bevel > 0 ? 17 : 8)));

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const simplified = regions.map((region) => ({
      outer: simplifyClosed(region.outer, epsilon),
      holes: region.holes.map((hole) => simplifyClosed(hole, epsilon)).filter((hole) => hole.length >= 3)
    })).filter((region) => region.outer.length >= 3);
    const points = simplified.reduce(
      (total, region) => total + region.outer.length + region.holes.reduce((sum, hole) => sum + hole.length, 0),
      0
    );
    regions = simplified;
    if (points <= pointBudget) break;
    epsilon *= 1.28;
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const region of regions) {
    for (const [x, y] of region.outer) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  const pixelHeight = Math.max(1, maxY - minY);
  const scale = options.height / pixelHeight;
  const centerX = (minX + maxX) / 2;
  const worldRegions = regions.map((region) => ({
    outer: region.outer.map(([x, y]) => [(x - centerX) * scale, (maxY - y) * scale]),
    holes: region.holes.map((hole) => hole.map(([x, y]) => [(x - centerX) * scale, (maxY - y) * scale]))
  }));

  const model = {
    imageWidth: width,
    imageHeight: height,
    centerX,
    maxY,
    scale,
    regions: worldRegions,
    options,
    source,
    width: (maxX - minX) * scale,
    height: options.height
  };

  const preview = createStandeeObject(model);
  let vertices = 0;
  let triangles = 0;
  preview.traverse((object) => {
    if (!object.isMesh || !object.geometry) return;
    const position = object.geometry.getAttribute("position");
    const count = object.geometry.index?.count || position?.count || 0;
    vertices += position?.count || 0;
    triangles += Math.floor(count / 3);
  });
  disposeObject3D(preview);

  const outlinePoints = worldRegions.reduce(
    (total, region) => total + region.outer.length + region.holes.reduce((sum, hole) => sum + hole.length, 0),
    0
  );
  model.stats = {
    vertices,
    triangles,
    outlinePoints,
    holes: worldRegions.reduce((total, region) => total + region.holes.length, 0),
    regions: worldRegions.length,
    width: model.width,
    height: model.height,
    depth: options.thickness + options.bevel * 2,
    source
  };
  return model;
}

export function createStandeeObject(model, sources = {}) {
  const group = new THREE.Group();
  group.name = "Legends_Alley_Standee";

  const frontTexture = makeTexture(sources.front, false);
  const backTexture = makeTexture(sources.back, false);
  const cardboardTexture = model.options.texturedCardboard ? makeTexture(sources.cardboard, true) : null;
  const wireframe = sources.wireframe === true;
  const frontMaterial = new THREE.MeshStandardMaterial({
    name: "standee_front",
    color: 0xffffff,
    map: frontTexture,
    roughness: 0.82,
    metalness: 0,
    transparent: true,
    alphaTest: 0.01,
    wireframe
  });
  const cardboardMaterial = new THREE.MeshStandardMaterial({
    name: "standee_cardboard",
    color: 0xb88752,
    map: cardboardTexture,
    roughness: 0.96,
    metalness: 0,
    wireframe
  });
  const backMaterial = backTexture
    ? new THREE.MeshStandardMaterial({
        name: "standee_back",
        color: 0xffffff,
        map: backTexture,
        roughness: 0.88,
        metalness: 0,
        wireframe
      })
    : cardboardMaterial;
  const materials = [frontMaterial, cardboardMaterial, backMaterial];

  const uvGenerator = makeUvGenerator(model);
  const bevel = Math.min(model.options.bevel, model.options.thickness * 0.35);
  for (const region of model.regions) {
    const shape = new THREE.Shape(region.outer.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const hole of region.holes) {
      shape.holes.push(new THREE.Path(hole.map(([x, y]) => new THREE.Vector2(x, y))));
    }
    let geometry = new THREE.ExtrudeGeometry(shape, {
      curveSegments: 1,
      steps: 1,
      depth: model.options.thickness,
      bevelEnabled: bevel > 0.00001,
      bevelThickness: bevel,
      bevelSize: bevel,
      bevelSegments: bevel > 0.00001 ? 1 : 0,
      UVGenerator: uvGenerator
    });
    geometry.translate(0, 0, -model.options.thickness / 2);
    geometry = mergeVertices(geometry, 1e-5);
    assignMaterialGroups(geometry, !!backTexture);
    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = "Standee_Cutout";
    group.add(mesh);
  }

  if (model.options.addStand) addSupportStand(group, model, cardboardMaterial);
  group.userData.standeeStats = model.stats || null;
  return group;
}

export function createCardboardCanvas(size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  context.fillStyle = "#b88752";
  context.fillRect(0, 0, size, size);

  let seed = 0x1a11e7;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0xffffffff;
  };
  for (let index = 0; index < size * 4; index += 1) {
    context.fillStyle = random() > 0.48 ? "rgba(255,235,190,0.09)" : "rgba(75,42,20,0.08)";
    context.fillRect(random() * size, random() * size, 1 + random() * 5, 0.4 + random());
  }
  return canvas;
}

export function disposeObject3D(root) {
  const textures = new Set();
  const materials = new Set();
  root?.traverse((object) => {
    object.geometry?.dispose?.();
    const list = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of list) {
      if (!material || materials.has(material)) continue;
      materials.add(material);
      if (material.map) textures.add(material.map);
      material.dispose?.();
    }
  });
  for (const texture of textures) texture.dispose?.();
}

function normalizeOptions(raw) {
  return {
    thickness: clamp(Number(raw.thickness) || STANDEE_DEFAULTS.thickness, 0.002, 0.08),
    height: clamp(Number(raw.height) || STANDEE_DEFAULTS.height, 0.2, 4),
    bevel: clamp(Number(raw.bevel) || 0, 0, 0.008),
    accuracy: ["low", "medium", "high"].includes(raw.accuracy) ? raw.accuracy : STANDEE_DEFAULTS.accuracy,
    optimization: ["low", "medium", "high"].includes(raw.optimization) ? raw.optimization : STANDEE_DEFAULTS.optimization,
    maxVertices: clamp(Math.round(Number(raw.maxVertices) || STANDEE_DEFAULTS.maxVertices), 300, 8000),
    threshold: clamp(Number(raw.threshold) || STANDEE_DEFAULTS.threshold, 0.05, 0.95),
    addStand: raw.addStand !== false,
    standWidth: clamp(Number(raw.standWidth) || STANDEE_DEFAULTS.standWidth, 0.1, 0.9),
    standAngle: clamp(Number(raw.standAngle) || STANDEE_DEFAULTS.standAngle, 5, 40),
    standHinge: clamp(Number(raw.standHinge) || STANDEE_DEFAULTS.standHinge, 0.3, 0.92),
    standOffsetX: clamp(Number(raw.standOffsetX) || 0, -0.35, 0.35),
    texturedCardboard: raw.texturedCardboard !== false
  };
}

function makeTexture(source, repeat) {
  if (!source) return null;
  const texture = new THREE.Texture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.anisotropy = 4;
  if (repeat) {
    texture.wrapS = THREE.MirroredRepeatWrapping;
    texture.wrapT = THREE.MirroredRepeatWrapping;
    texture.repeat.set(3, 3);
  }
  return texture;
}

function makeUvGenerator(model) {
  const cap = (vertices, index) => {
    const x = vertices[index * 3];
    const y = vertices[index * 3 + 1];
    const pixelX = x / model.scale + model.centerX;
    const pixelY = model.maxY - y / model.scale;
    return new THREE.Vector2(
      clamp(pixelX / model.imageWidth, 0, 1),
      clamp(1 - pixelY / model.imageHeight, 0, 1)
    );
  };
  const side = (vertices, index) => new THREE.Vector2(
    (vertices[index * 3] + vertices[index * 3 + 1]) * 2,
    vertices[index * 3 + 2] * 8
  );
  return {
    generateTopUV(_geometry, vertices, a, b, c) {
      return [cap(vertices, a), cap(vertices, b), cap(vertices, c)];
    },
    generateSideWallUV(_geometry, vertices, a, b, c, d) {
      return [side(vertices, a), side(vertices, b), side(vertices, c), side(vertices, d)];
    }
  };
}

function assignMaterialGroups(geometry, hasBackTexture) {
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const indices = geometry.index;
  const count = indices?.count || geometry.getAttribute("position").count;
  const vertexAt = (index) => indices ? indices.getX(index) : index;
  geometry.clearGroups();
  let runStart = 0;
  let runMaterial = -1;
  for (let index = 0; index < count; index += 3) {
    const z = normals.getZ(vertexAt(index)) + normals.getZ(vertexAt(index + 1)) + normals.getZ(vertexAt(index + 2));
    const material = z > 2.95 ? 0 : z < -2.95 && hasBackTexture ? 2 : 1;
    if (runMaterial === -1) runMaterial = material;
    if (material !== runMaterial) {
      geometry.addGroup(runStart, index - runStart, runMaterial);
      runStart = index;
      runMaterial = material;
    }
  }
  if (runMaterial !== -1) geometry.addGroup(runStart, count - runStart, runMaterial);
}

function addSupportStand(group, model, material) {
  const options = model.options;
  const hingeY = options.height * options.standHinge;
  const intervals = solidIntervalsAt(model.regions, hingeY);
  let center = model.width * options.standOffsetX;
  let width = clamp(model.width * options.standWidth, 0.08, model.width * 0.9);
  if (intervals.length) {
    const interval = intervals.reduce((best, item) => item[1] - item[0] > best[1] - best[0] ? item : best);
    width = Math.min(width, (interval[1] - interval[0]) * 0.88);
    center = clamp(center, interval[0] + width / 2, interval[1] - width / 2);
  }

  const angle = THREE.MathUtils.degToRad(options.standAngle);
  const length = hingeY / Math.cos(angle);
  const depthAtGround = Math.sin(angle) * length;
  const railWidth = clamp(width * 0.16, 0.018, 0.055);
  const railDepth = Math.max(options.thickness * 0.72, 0.006);
  const backZ = -options.thickness / 2 - Math.sin(angle) * length / 2;
  const addBox = (name, dimensions, position, rotationX = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...dimensions), material);
    mesh.name = name;
    mesh.position.set(...position);
    mesh.rotation.x = rotationX;
    group.add(mesh);
  };
  addBox("Stand_Hinge", [width, railWidth, railDepth], [center, hingeY - railWidth / 2, -options.thickness / 2 - railDepth / 2]);
  addBox("Stand_Left_Rail", [railWidth, length, railDepth], [center - width / 2 + railWidth / 2, hingeY / 2, backZ], angle);
  addBox("Stand_Right_Rail", [railWidth, length, railDepth], [center + width / 2 - railWidth / 2, hingeY / 2, backZ], angle);
  addBox("Stand_Lower_Tab", [width, railWidth, railDepth], [center, Math.max(railWidth, hingeY * 0.16), -options.thickness / 2 - depthAtGround * 0.84], angle);
  addBox(
    "Stand_Foot",
    [width * 1.12, Math.max(0.025, options.thickness * 2), Math.max(0.12, depthAtGround * 0.24)],
    [center, Math.max(0.012, options.thickness), -options.thickness / 2 - depthAtGround]
  );
}

function solidIntervalsAt(regions, y) {
  const intersections = [];
  const cross = (loop) => {
    for (let index = 0; index < loop.length; index += 1) {
      const [ax, ay] = loop[index];
      const [bx, by] = loop[(index + 1) % loop.length];
      if ((ay <= y && by > y) || (by <= y && ay > y)) {
        intersections.push(ax + ((y - ay) / (by - ay)) * (bx - ax));
      }
    }
  };
  for (const region of regions) {
    cross(region.outer);
    for (const hole of region.holes) cross(hole);
  }
  intersections.sort((a, b) => a - b);
  const intervals = [];
  for (let index = 0; index + 1 < intersections.length; index += 2) {
    intervals.push([intersections[index], intersections[index + 1]]);
  }
  return intervals;
}

function buildMask(data, width, height, threshold) {
  const mask = new Uint8Array(width * height);
  let alphaMin = 255;
  let alphaMax = 0;
  for (let index = 3; index < data.length; index += 4) {
    alphaMin = Math.min(alphaMin, data[index]);
    alphaMax = Math.max(alphaMax, data[index]);
  }
  if (alphaMin < 245 && alphaMax > 16) {
    const cutoff = threshold * 255;
    for (let index = 0; index < mask.length; index += 1) mask[index] = data[index * 4 + 3] >= cutoff ? 1 : 0;
    return { mask, source: "alpha channel" };
  }

  const sampleSize = Math.max(2, Math.floor(Math.min(width, height) * 0.035));
  const samples = [];
  for (const [originX, originY] of [[0, 0], [width - sampleSize, 0], [0, height - sampleSize], [width - sampleSize, height - sampleSize]]) {
    for (let y = originY; y < originY + sampleSize; y += 1) {
      for (let x = originX; x < originX + sampleSize; x += 1) {
        const offset = (y * width + x) * 4;
        samples.push([data[offset], data[offset + 1], data[offset + 2]]);
      }
    }
  }
  const background = [0, 1, 2].map((channel) => {
    const values = samples.map((sample) => sample[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] || 0;
  });
  const distances = new Float32Array(mask.length);
  let maxDistance = 1;
  for (let index = 0; index < mask.length; index += 1) {
    const red = data[index * 4] - background[0];
    const green = data[index * 4 + 1] - background[1];
    const blue = data[index * 4 + 2] - background[2];
    const distance = Math.hypot(red, green, blue);
    distances[index] = distance;
    maxDistance = Math.max(maxDistance, distance);
  }
  const histogram = new Uint32Array(256);
  for (const distance of distances) histogram[Math.min(255, Math.floor(distance / maxDistance * 255))] += 1;
  const otsu = otsuThreshold(histogram, mask.length) / 255 * maxDistance;
  const cutoff = otsu * (0.55 + threshold * 0.9);
  for (let index = 0; index < mask.length; index += 1) mask[index] = distances[index] > cutoff ? 1 : 0;
  return { mask, source: "background keyed" };
}

function otsuThreshold(histogram, total) {
  let weightedTotal = 0;
  for (let index = 0; index < histogram.length; index += 1) weightedTotal += index * histogram[index];
  let backgroundWeight = 0;
  let backgroundSum = 0;
  let bestVariance = -1;
  let best = 127;
  for (let threshold = 0; threshold < histogram.length; threshold += 1) {
    backgroundWeight += histogram[threshold];
    if (!backgroundWeight) continue;
    const foregroundWeight = total - backgroundWeight;
    if (!foregroundWeight) break;
    backgroundSum += threshold * histogram[threshold];
    const backgroundMean = backgroundSum / backgroundWeight;
    const foregroundMean = (weightedTotal - backgroundSum) / foregroundWeight;
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2;
    if (variance > bestVariance) {
      bestVariance = variance;
      best = threshold;
    }
  }
  return best;
}

function keepSignificantComponents(mask, width, height) {
  const labels = new Int32Array(mask.length).fill(-1);
  const queue = new Int32Array(mask.length);
  const sizes = [];
  let label = 0;
  for (let start = 0; start < mask.length; start += 1) {
    if (!mask[start] || labels[start] !== -1) continue;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    labels[start] = label;
    let size = 0;
    while (head < tail) {
      const current = queue[head++];
      size += 1;
      const x = current % width;
      const y = Math.floor(current / width);
      const neighbors = [];
      if (x > 0) neighbors.push(current - 1);
      if (x < width - 1) neighbors.push(current + 1);
      if (y > 0) neighbors.push(current - width);
      if (y < height - 1) neighbors.push(current + width);
      for (const next of neighbors) {
        if (mask[next] && labels[next] === -1) {
          labels[next] = label;
          queue[tail++] = next;
        }
      }
    }
    sizes[label] = size;
    label += 1;
  }
  const largest = Math.max(0, ...sizes);
  const minimum = Math.max(8, largest * 0.001);
  const output = new Uint8Array(mask.length);
  for (let index = 0; index < output.length; index += 1) {
    output[index] = labels[index] >= 0 && sizes[labels[index]] >= minimum ? 1 : 0;
  }
  return output;
}

function traceLoops(mask, width, height) {
  const edges = new Map();
  const at = (x, y) => x >= 0 && x < width && y >= 0 && y < height ? mask[y * width + x] : 0;
  const add = (x1, y1, x2, y2) => {
    const key = `${x1},${y1}`;
    if (!edges.has(key)) edges.set(key, []);
    edges.get(key).push([x2, y2]);
  };
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!at(x, y)) continue;
      if (!at(x, y - 1)) add(x, y, x + 1, y);
      if (!at(x + 1, y)) add(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) add(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) add(x, y + 1, x, y);
    }
  }

  const loops = [];
  while (edges.size) {
    const [startKey, candidates] = edges.entries().next().value;
    const start = startKey.split(",").map(Number);
    let previous = start;
    let current = candidates.shift();
    if (!candidates.length) edges.delete(startKey);
    const loop = [start];
    let closed = false;
    let guard = width * height * 8;
    while (guard-- > 0) {
      if (current[0] === start[0] && current[1] === start[1]) {
        closed = true;
        break;
      }
      loop.push(current);
      const key = `${current[0]},${current[1]}`;
      const choices = edges.get(key);
      if (!choices?.length) break;
      let choiceIndex = 0;
      if (choices.length > 1) {
        const dx = current[0] - previous[0];
        const dy = current[1] - previous[1];
        let bestTurn = -Infinity;
        for (let index = 0; index < choices.length; index += 1) {
          const nextX = choices[index][0] - current[0];
          const nextY = choices[index][1] - current[1];
          const turn = Math.atan2(dx * nextY - dy * nextX, dx * nextX + dy * nextY);
          if (turn > bestTurn) {
            bestTurn = turn;
            choiceIndex = index;
          }
        }
      }
      const next = choices.splice(choiceIndex, 1)[0];
      if (!choices.length) edges.delete(key);
      previous = current;
      current = next;
    }
    if (closed && loop.length >= 3) loops.push(collapseCollinear(loop));
  }
  return loops;
}

function classifyLoops(loops) {
  const nodes = loops
    .map((loop) => ({ loop, area: Math.abs(polygonArea(loop)), parent: -1, depth: 0 }))
    .sort((a, b) => b.area - a.area);
  for (let index = 0; index < nodes.length; index += 1) {
    let parent = -1;
    let parentArea = Infinity;
    const point = nodes[index].loop[0];
    for (let candidate = 0; candidate < index; candidate += 1) {
      if (nodes[candidate].area < parentArea && pointInPolygon(point, nodes[candidate].loop)) {
        parent = candidate;
        parentArea = nodes[candidate].area;
      }
    }
    nodes[index].parent = parent;
    nodes[index].depth = parent >= 0 ? nodes[parent].depth + 1 : 0;
  }
  const regions = [];
  const regionByNode = new Map();
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].depth % 2 === 0) {
      const region = { outer: nodes[index].loop, holes: [] };
      regions.push(region);
      regionByNode.set(index, region);
    }
  }
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].depth % 2 === 0) continue;
    let parent = nodes[index].parent;
    while (parent >= 0 && !regionByNode.has(parent)) parent = nodes[parent].parent;
    regionByNode.get(parent)?.holes.push(nodes[index].loop);
  }
  return regions;
}

function polygonArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    const [x2, y2] = points[(index + 1) % points.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

function pointInPolygon([x, y], polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current++) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    if ((currentY > y) !== (previousY > y)
      && x < (previousX - currentX) * (y - currentY) / (previousY - currentY) + currentX) {
      inside = !inside;
    }
  }
  return inside;
}

function collapseCollinear(points) {
  const output = [];
  for (let index = 0; index < points.length; index += 1) {
    const previous = points[(index - 1 + points.length) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const cross = (current[0] - previous[0]) * (next[1] - current[1])
      - (current[1] - previous[1]) * (next[0] - current[0]);
    if (Math.abs(cross) > 1e-8) output.push(current);
  }
  return output.length >= 3 ? output : points;
}

function simplifyClosed(points, epsilon) {
  if (points.length <= 4) return points.slice();
  const center = points.reduce((sum, point) => [sum[0] + point[0], sum[1] + point[1]], [0, 0]);
  center[0] /= points.length;
  center[1] /= points.length;
  let start = 0;
  let farthest = -1;
  for (let index = 0; index < points.length; index += 1) {
    const distance = (points[index][0] - center[0]) ** 2 + (points[index][1] - center[1]) ** 2;
    if (distance > farthest) {
      farthest = distance;
      start = index;
    }
  }
  let end = start;
  let longest = -1;
  for (let index = 0; index < points.length; index += 1) {
    const distance = (points[index][0] - points[start][0]) ** 2 + (points[index][1] - points[start][1]) ** 2;
    if (distance > longest) {
      longest = distance;
      end = index;
    }
  }

  const arc = (from, to) => {
    const output = [points[from]];
    let index = from;
    while (index !== to && output.length <= points.length + 1) {
      index = (index + 1) % points.length;
      output.push(points[index]);
    }
    return output;
  };
  const firstArc = rdp(arc(start, end), epsilon);
  const secondArc = rdp(arc(end, start), epsilon);
  const simplified = firstArc.slice(0, -1).concat(secondArc.slice(0, -1));
  return simplified.length >= 3 ? simplified : points.slice();
}

function rdp(points, epsilon) {
  if (points.length < 3) return points.slice();
  const first = points[0];
  const last = points[points.length - 1];
  const dx = last[0] - first[0];
  const dy = last[1] - first[1];
  const length = Math.hypot(dx, dy) || 1;
  let maxDistance = 0;
  let split = -1;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = Math.abs(dy * points[index][0] - dx * points[index][1] + last[0] * first[1] - last[1] * first[0]) / length;
    if (distance > maxDistance) {
      maxDistance = distance;
      split = index;
    }
  }
  if (maxDistance <= epsilon || split < 0) return [first, last];
  const left = rdp(points.slice(0, split + 1), epsilon);
  const right = rdp(points.slice(split), epsilon);
  return left.slice(0, -1).concat(right);
}