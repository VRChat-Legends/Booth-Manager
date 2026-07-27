namespace BoothManager.Core;

/// <summary>
/// Dependency-free software 3D renderer: perspective camera, z-buffer,
/// per-pixel textured triangles, simple directional + ambient lighting.
/// Renders into a BGRA byte buffer that the UI copies into a WriteableBitmap.
/// </summary>
public sealed class SoftRenderer
{
    public int Width { get; private set; }
    public int Height { get; private set; }
    public byte[] Frame { get; private set; } = Array.Empty<byte>(); // BGRA

    private float[] _depth = Array.Empty<float>();

    // Orbit camera state
    public float Yaw = 0.6f;
    public float Pitch = 0.35f;
    public float Distance = 8f;
    public float TargetX, TargetY, TargetZ;
    public float Fov = 55f * MathF.PI / 180f;

    // Background gradient (dark Legends Alley night)
    public (byte r, byte g, byte b) BgTop = (10, 13, 19);
    public (byte r, byte g, byte b) BgBottom = (18, 24, 33);

    // Light
    private readonly float _lx, _ly, _lz;

    public SoftRenderer()
    {
        // key light from upper-front-left
        float lx = -0.45f, ly = 0.8f, lz = -0.5f;
        float len = MathF.Sqrt(lx * lx + ly * ly + lz * lz);
        _lx = lx / len; _ly = ly / len; _lz = lz / len;
    }

    public void Resize(int width, int height)
    {
        Width = Math.Max(8, width);
        Height = Math.Max(8, height);
        Frame = new byte[Width * Height * 4];
        _depth = new float[Width * Height];
    }

    public void FrameModel(Model3D model)
    {
        var (minX, minY, minZ, maxX, maxY, maxZ) = model.Bounds();
        TargetX = (minX + maxX) * 0.5f;
        TargetY = (minY + maxY) * 0.5f;
        TargetZ = (minZ + maxZ) * 0.5f;
        float radius = MathF.Max(MathF.Max(maxX - minX, maxY - minY), maxZ - minZ) * 0.5f;
        if (radius < 0.01f) radius = 1f;
        Distance = radius / MathF.Tan(Fov * 0.5f) * 1.55f;
    }

    public void Render(Model3D model)
    {
        if (Frame.Length == 0) return;

        // background gradient
        for (int y = 0; y < Height; y++)
        {
            float t = (float)y / Height;
            byte r = (byte)(BgTop.r + (BgBottom.r - BgTop.r) * t);
            byte g = (byte)(BgTop.g + (BgBottom.g - BgTop.g) * t);
            byte b = (byte)(BgTop.b + (BgBottom.b - BgTop.b) * t);
            int row = y * Width * 4;
            for (int x = 0; x < Width; x++)
            {
                Frame[row] = b; Frame[row + 1] = g; Frame[row + 2] = r; Frame[row + 3] = 255;
                row += 4;
            }
        }
        Array.Fill(_depth, float.MaxValue);

        // camera basis
        float cp = MathF.Cos(Pitch), sp = MathF.Sin(Pitch);
        float cy = MathF.Cos(Yaw), sy = MathF.Sin(Yaw);
        float ex = TargetX + Distance * cp * sy;
        float ey = TargetY + Distance * sp;
        float ez = TargetZ + Distance * cp * cy;

        // forward = normalize(target - eye)
        float fx = TargetX - ex, fy = TargetY - ey, fz = TargetZ - ez;
        float fl = MathF.Sqrt(fx * fx + fy * fy + fz * fz);
        fx /= fl; fy /= fl; fz /= fl;
        // right = normalize(cross(forward, up))
        float rx = fz * 0f - fy * 1f, ry = fx * 1f - fz * 0f, rz = fy * 0f - fx * 0f;
        float rl = MathF.Sqrt(rx * rx + ry * ry + rz * rz);
        if (rl < 1e-5f) { rx = 1; ry = 0; rz = 0; rl = 1; }
        rx /= rl; ry /= rl; rz /= rl;
        // up = cross(right, forward)
        float ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;

        float aspect = (float)Width / Height;
        float tanHalf = MathF.Tan(Fov * 0.5f);
        float near = 0.05f;

        int vcount = model.VertexCount;
        // view-space positions + projected screen coords
        var vx = new float[vcount];
        var vyArr = new float[vcount];
        var vz = new float[vcount];
        var sxArr = new float[vcount];
        var syArr = new float[vcount];
        var lit = new float[vcount];

        for (int i = 0; i < vcount; i++)
        {
            float px = model.Positions[i * 3] - ex;
            float py = model.Positions[i * 3 + 1] - ey;
            float pz = model.Positions[i * 3 + 2] - ez;
            // view space: x=dot(right), y=dot(up), z=dot(forward)
            float cxv = px * rx + py * ry + pz * rz;
            float cyv = px * ux + py * uy + pz * uz;
            float czv = px * fx + py * fy + pz * fz;
            vx[i] = cxv; vyArr[i] = cyv; vz[i] = czv;
            if (czv > near)
            {
                sxArr[i] = (cxv / (czv * tanHalf * aspect) * 0.5f + 0.5f) * Width;
                syArr[i] = (0.5f - cyv / (czv * tanHalf) * 0.5f) * Height;
            }

            // vertex lighting (double-sided lambert + ambient)
            float nx = model.Normals[i * 3], ny = model.Normals[i * 3 + 1], nz = model.Normals[i * 3 + 2];
            float d = MathF.Abs(nx * _lx + ny * _ly + nz * _lz);
            lit[i] = 0.38f + 0.62f * d;
        }

        // opaque parts first, then transparent
        foreach (bool transparentPass in new[] { false, true })
        {
            foreach (var part in model.Parts)
            {
                var mat = part.MaterialIndex >= 0 && part.MaterialIndex < model.Materials.Count
                    ? model.Materials[part.MaterialIndex]
                    : new Material3D();
                bool isTransparent = mat.Alpha < 0.99f;
                if (isTransparent != transparentPass) continue;

                var tex = mat.Texture;
                for (int i = 0; i < part.Indices.Length; i += 3)
                {
                    int a = part.Indices[i], b = part.Indices[i + 1], c = part.Indices[i + 2];
                    if (vz[a] <= near || vz[b] <= near || vz[c] <= near) continue; // near clip: skip

                    RasterTriangle(model, mat, tex, a, b, c, sxArr, syArr, vz, lit, isTransparent);
                }
            }
        }
    }

    private void RasterTriangle(Model3D model, Material3D mat, Texture3D? tex,
        int a, int b, int c, float[] sx, float[] sy, float[] vz, float[] lit, bool transparent)
    {
        float x0 = sx[a], y0 = sy[a], x1 = sx[b], y1 = sy[b], x2 = sx[c], y2 = sy[c];

        float area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
        if (MathF.Abs(area) < 0.01f) return;

        int minX = Math.Max(0, (int)MathF.Floor(MathF.Min(x0, MathF.Min(x1, x2))));
        int maxX = Math.Min(Width - 1, (int)MathF.Ceiling(MathF.Max(x0, MathF.Max(x1, x2))));
        int minY = Math.Max(0, (int)MathF.Floor(MathF.Min(y0, MathF.Min(y1, y2))));
        int maxY = Math.Min(Height - 1, (int)MathF.Ceiling(MathF.Max(y0, MathF.Max(y1, y2))));
        if (minX > maxX || minY > maxY) return;

        float invArea = 1f / area;
        float iz0 = 1f / vz[a], iz1 = 1f / vz[b], iz2 = 1f / vz[c];
        float u0 = model.Uvs[a * 2] * iz0, v0 = model.Uvs[a * 2 + 1] * iz0;
        float u1 = model.Uvs[b * 2] * iz1, v1 = model.Uvs[b * 2 + 1] * iz1;
        float u2 = model.Uvs[c * 2] * iz2, v2 = model.Uvs[c * 2 + 1] * iz2;
        float l0 = lit[a], l1 = lit[b], l2 = lit[c];
        float matAlpha = mat.Alpha;

        for (int py = minY; py <= maxY; py++)
        {
            float pyc = py + 0.5f;
            for (int px = minX; px <= maxX; px++)
            {
                float pxc = px + 0.5f;
                float w0 = ((x1 - x0) * (pyc - y0) - (pxc - x0) * (y1 - y0)) * invArea;
                float w1 = ((x2 - x1) * (pyc - y1) - (pxc - x1) * (y2 - y1)) * invArea;
                float w2 = ((x0 - x2) * (pyc - y2) - (pxc - x2) * (y0 - y2)) * invArea;
                // double-sided: accept if all barycentrics share the sign of area
                if (w0 < 0 || w1 < 0 || w2 < 0)
                {
                    if (w0 > 0 || w1 > 0 || w2 > 0) continue;
                    w0 = -w0; w1 = -w1; w2 = -w2;
                }
                // w1 corresponds to vertex c-opposite edge etc.; standard mapping:
                float ba = w1, bb = w2, bc = w0;

                float iz = ba * iz0 + bb * iz1 + bc * iz2;
                if (iz <= 0) continue;
                float depth = 1f / iz;

                int di = py * Width + px;
                if (depth >= _depth[di]) continue;

                float light = mat.Emissive ? 1f : ba * l0 + bb * l1 + bc * l2;
                float cr = mat.R, cg = mat.G, cb = mat.B;

                if (tex != null)
                {
                    float uu = (ba * u0 + bb * u1 + bc * u2) * depth;
                    float vv = (ba * v0 + bb * v1 + bc * v2) * depth;
                    uu -= MathF.Floor(uu);
                    vv -= MathF.Floor(vv);
                    int txp = Math.Clamp((int)(uu * tex.Width), 0, tex.Width - 1);
                    int typ = Math.Clamp((int)((1f - vv) * tex.Height), 0, tex.Height - 1);
                    int ti = (typ * tex.Width + txp) * 4;
                    cb = tex.Pixels[ti] / 255f;
                    cg = tex.Pixels[ti + 1] / 255f;
                    cr = tex.Pixels[ti + 2] / 255f;
                }

                byte outR = (byte)Math.Clamp((int)(cr * light * 255f), 0, 255);
                byte outG = (byte)Math.Clamp((int)(cg * light * 255f), 0, 255);
                byte outB = (byte)Math.Clamp((int)(cb * light * 255f), 0, 255);

                int fi = di * 4;
                if (transparent)
                {
                    float ia = 1f - matAlpha;
                    Frame[fi] = (byte)(outB * matAlpha + Frame[fi] * ia);
                    Frame[fi + 1] = (byte)(outG * matAlpha + Frame[fi + 1] * ia);
                    Frame[fi + 2] = (byte)(outR * matAlpha + Frame[fi + 2] * ia);
                    // transparent surfaces do not write depth
                }
                else
                {
                    _depth[di] = depth;
                    Frame[fi] = outB;
                    Frame[fi + 1] = outG;
                    Frame[fi + 2] = outR;
                }
                Frame[fi + 3] = 255;
            }
        }
    }
}
