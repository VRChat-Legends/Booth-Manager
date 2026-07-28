import { useMemo } from "react";
import { Boxes, Clock3, MousePointer2 } from "lucide-react";
import Viewer3D from "../components/Viewer3D.jsx";

export default function BuilderPage({ goTo }) {
  const source = useMemo(() => ({
    type: "obj",
    objUrl: "./booth-model/booth.obj",
    mtlUrl: "./booth-model/booth.mtl",
    resourcePath: "./booth-model/"
  }), []);

  return (
    <div className="page" style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 16, height: "100%" }}>
      <Viewer3D source={source} autoRotate hint="the official Legends Alley booth prefab" style={{ minHeight: 420 }} />
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="card">
          <span className="pill yellow"><Clock3 size={12} />COMING SOON</span>
          <h3 className="mt12">Booth Builder</h3>
          <p className="sub" style={{ lineHeight: 1.55 }}>
            Build your booth right here on the official prefab: drop your images onto the
            poster, screen, and banner slots, place your group button with your grp_ id,
            your avatar pedestal, and your world portals, then see exactly how it will
            look in the Alley before you ever open Unity.
          </p>
        </div>
        <div className="card">
          <h3>Until then</h3>
          <p className="sub">
            Everything the Alley team needs lives in the Booths tab: booth images, group
            id, avatar id, and world ids you save there are already wired up to the
            website.
          </p>
          <button className="primary mt8" onClick={() => goTo("booths")}><Boxes size={15} />Open Booths</button>
        </div>
        <div className="card">
          <h3>The prefab</h3>
          <p className="sub tiny">
            This is the real booth model creators build on with the Legends Alley SDK,
            rendered live. Drag it around.
          </p>
          <div className="viewer-tip"><MousePointer2 size={14} />Orbit and inspect only. Editing is not enabled yet.</div>
        </div>
      </div>
    </div>
  );
}
