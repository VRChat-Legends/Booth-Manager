import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import { STLExporter } from "three/addons/exporters/STLExporter.js";
import { FBXExporter } from "@comfyorg/fbx-exporter-three";

function toBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return new Uint8Array(value);
}

export async function exportStandeeObject(object, format) {
  object.updateMatrixWorld(true);
  if (format === "glb") {
    const result = await new GLTFExporter().parseAsync(object, {
      binary: true,
      onlyVisible: true,
      maxTextureSize: 4096
    });
    return { binary: true, value: toBytes(result) };
  }
  if (format === "fbx") {
    const result = await new FBXExporter().parseAsync(object, {
      preset: "unity",
      includeAnimations: false,
      onlyVisible: true
    });
    return { binary: true, value: toBytes(result) };
  }
  if (format === "stl") {
    const result = new STLExporter().parse(object, { binary: true });
    return { binary: true, value: toBytes(result) };
  }
  return { binary: false, value: new OBJExporter().parse(object) };
}

export function bytesToBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}