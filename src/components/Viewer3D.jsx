import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

/**
 * GPU 3D viewport (three.js).
 * props:
 *  - source: { type: "obj", objUrl, mtlUrl, resourcePath } | { type: "geometry", build: (THREE) => THREE.Object3D }
 *  - autoRotate: boolean
 *  - textureOverrides: { [materialName]: dataUrl } applied live
 *  - viewDirection: [x, y, z] initial camera direction from the model
 *  - frameFactor: camera fit margin multiplier
 *  - inspection: brighter neutral lighting for dark asset inspection
 *  - style: css for the wrapper
 *  - onReady: (info { triangles, materials }) => void
 */
export default function Viewer3D({ source, autoRotate = false, textureOverrides, style, onReady, hint, viewDirection = [0.62, 0.42, 0.75], frameFactor = 1.35, inspection = false }) {
  const wrapRef = useRef(null);
  const stateRef = useRef(null);
  const [loadState, setLoadState] = useState(source ? "loading" : "idle");
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState("");

  // build scene once per source change
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || !source) return undefined;

    setLoadState("loading");
    setLoadProgress(0);
    setLoadError("");

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    wrap.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);
    camera.position.set(3.2, 2.2, 4.2);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.1;
    controls.minDistance = 0.4;
    controls.maxDistance = 40;

    // lights: key + fill + rim, alley night mood
    scene.add(new THREE.AmbientLight(inspection ? 0xffffff : 0xbfd8e0, inspection ? 1.15 : 0.55));
    const key = new THREE.DirectionalLight(0xffffff, inspection ? 1.8 : 1.35);
    key.position.set(-3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x00e6cc, 0.45);
    rim.position.set(4, 2, -4);
    scene.add(rim);

    // ground glow disc
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(6, 48),
      new THREE.MeshBasicMaterial({ color: 0x0d141c, transparent: true, opacity: 0.85 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.005;
    scene.add(ground);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(5.8, 6, 64),
      new THREE.MeshBasicMaterial({ color: 0x00e6cc, transparent: true, opacity: 0.22, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    scene.add(ring);

    const state = { renderer, scene, camera, controls, model: null, disposed: false, materials: new Map() };
    stateRef.current = state;

    const frameObject = (obj) => {
      const box = new THREE.Box3().setFromObject(obj);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const radius = Math.max(size.x, size.y, size.z) * 0.5 || 1;
      controls.target.copy(center);
      const dist = radius / Math.tan((camera.fov * Math.PI) / 360) * frameFactor;
      controls.minDistance = Math.max(radius * 0.25, 0.0001);
      controls.maxDistance = Math.max(radius * 100, dist * 4);
      const groundRadius = radius * 2.5;
      const groundScale = groundRadius / 6;
      ground.scale.setScalar(groundScale);
      ring.scale.setScalar(groundScale);
      ground.position.y = box.min.y - radius * 0.04;
      ring.position.y = ground.position.y + radius * 0.002;
      const direction = new THREE.Vector3(...viewDirection);
      if (direction.lengthSq() < 0.0001) direction.set(0.62, 0.42, 0.75);
      direction.normalize();
      camera.position.copy(center).addScaledVector(direction, dist);
      camera.near = Math.max(0.01, dist / 100);
      camera.far = dist * 40;
      camera.updateProjectionMatrix();
      controls.update();
    };

    const registerMaterials = (obj) => {
      let tris = 0;
      obj.traverse((child) => {
        if (child.isMesh) {
          const geo = child.geometry;
          if (geo?.index) tris += geo.index.count / 3;
          else if (geo?.attributes?.position) tris += geo.attributes.position.count / 3;
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            if (m && m.name) state.materials.set(m.name, m);
          }
        }
      });
      setLoadProgress(1);
      setLoadState("ready");
      onReady?.({ triangles: Math.round(tris), materials: [...state.materials.keys()] });
    };

    const failLoad = (error) => {
      if (state.disposed) return;
      setLoadError(String(error?.message || error || "The model data could not be read."));
      setLoadState("error");
    };

    const progress = (start, span) => (event) => {
      if (state.disposed || !event?.total) return;
      setLoadProgress(start + Math.min(1, event.loaded / event.total) * span);
    };

    try {
      if (source.type === "obj") {
        const mtlLoader = new MTLLoader();
        mtlLoader.setResourcePath(source.resourcePath || "");
        mtlLoader.load(source.mtlUrl, (materials) => {
          if (state.disposed) return;
          try {
            materials.preload();
            setLoadProgress((current) => Math.max(current, 0.45));
            const objLoader = new OBJLoader();
            objLoader.setMaterials(materials);
            objLoader.load(source.objUrl, (obj) => {
              if (state.disposed) return;
              obj.traverse((child) => {
                if (child.isMesh && child.material) {
                  const mats = Array.isArray(child.material) ? child.material : [child.material];
                  for (const m of mats) {
                    m.side = THREE.DoubleSide;
                    if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
                  }
                }
              });
              state.model = obj;
              scene.add(obj);
              frameObject(obj);
              registerMaterials(obj);
            }, progress(0.45, 0.55), failLoad);
          } catch (error) {
            failLoad(error);
          }
        }, progress(0, 0.45), failLoad);
      } else if (source.type === "geometry" && typeof source.build === "function") {
        const obj = source.build(THREE);
        if (!obj?.isObject3D) throw new Error("The generated model is not a valid 3D object.");
        state.model = obj;
        scene.add(obj);
        frameObject(obj);
        registerMaterials(obj);
      } else {
        throw new Error("This model source is not supported.");
      }
    } catch (error) {
      failLoad(error);
    }

    const resize = () => {
      const wpx = wrap.clientWidth;
      const hpx = wrap.clientHeight;
      if (wpx < 4 || hpx < 4) return;
      renderer.setSize(wpx, hpx, false);
      camera.aspect = wpx / hpx;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    let raf = 0;
    const loop = () => {
      if (state.disposed) return;
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(loop);
    };
    loop();

    return () => {
      state.disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (child.isMesh) {
          child.geometry?.dispose?.();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          for (const m of mats) {
            m?.map?.dispose?.();
            m?.dispose?.();
          }
        }
      });
      renderer.dispose();
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement);
      stateRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  // live texture overrides
  useEffect(() => {
    const state = stateRef.current;
    if (!state || !textureOverrides) return;
    for (const [matName, dataUrl] of Object.entries(textureOverrides)) {
      const mat = state.materials.get(matName);
      if (!mat) continue;
      if (!dataUrl) continue;
      new THREE.TextureLoader().load(dataUrl, (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true;
        mat.map?.dispose?.();
        mat.map = tex;
        mat.color?.set?.(0xffffff);
        mat.emissive?.set?.(0x111111);
        mat.needsUpdate = true;
      });
    }
  }, [textureOverrides]);

  // autoRotate toggle without rebuild
  useEffect(() => {
    const state = stateRef.current;
    if (state?.controls) state.controls.autoRotate = autoRotate;
  }, [autoRotate]);

  return (
    <div className="viewport" style={style}>
      <div ref={wrapRef} style={{ position: "absolute", inset: 0 }} />
      {loadState === "loading" && (
        <div className="viewer-loading">
          <div className="viewer-loader-mark"><span /><span /><span /></div>
          <strong>Preparing 3D preview</strong>
          <span>{loadProgress > 0 ? `${Math.round(loadProgress * 100)}%` : "Reading model data"}</span>
          <div className="viewer-load-track"><span style={{ width: loadProgress > 0 ? `${Math.max(8, loadProgress * 100)}%` : "32%" }} /></div>
        </div>
      )}
      {loadState === "error" && (
        <div className="viewer-load-error">
          <strong>Model preview unavailable</strong>
          <span>{loadError}</span>
        </div>
      )}
      {loadState === "ready" && (hint ? <div className="hint">{hint}</div> : <div className="hint">drag to orbit | scroll to zoom</div>)}
    </div>
  );
}
