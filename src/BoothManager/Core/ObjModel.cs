using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;

namespace BoothManager.Core;

/// <summary>In-memory RGBA texture for the software renderer.</summary>
public sealed class Texture3D
{
    public int Width;
    public int Height;
    public byte[] Pixels = Array.Empty<byte>(); // BGRA

    public static Texture3D? FromFile(string path)
    {
        try
        {
            using var bmp = new Bitmap(path);
            return FromBitmap(bmp);
        }
        catch
        {
            return null;
        }
    }

    public static Texture3D? FromBytes(byte[] data)
    {
        try
        {
            using var ms = new MemoryStream(data);
            using var bmp = new Bitmap(ms);
            return FromBitmap(bmp);
        }
        catch
        {
            return null;
        }
    }

    public static Texture3D FromBitmap(Bitmap src)
    {
        // Downscale very large textures so sampling stays cheap.
        int w = src.Width, h = src.Height;
        const int maxDim = 1024;
        if (w > maxDim || h > maxDim)
        {
            double s = Math.Min((double)maxDim / w, (double)maxDim / h);
            w = Math.Max(1, (int)(w * s));
            h = Math.Max(1, (int)(h * s));
        }

        using var scaled = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(scaled))
        {
            g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
            g.DrawImage(src, 0, 0, w, h);
        }

        var tex = new Texture3D { Width = w, Height = h, Pixels = new byte[w * h * 4] };
        var rect = new Rectangle(0, 0, w, h);
        var bd = scaled.LockBits(rect, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            for (int y = 0; y < h; y++)
            {
                System.Runtime.InteropServices.Marshal.Copy(bd.Scan0 + y * bd.Stride, tex.Pixels, y * w * 4, w * 4);
            }
        }
        finally
        {
            scaled.UnlockBits(bd);
        }
        return tex;
    }

    public static Texture3D Solid(byte r, byte g, byte b)
    {
        return new Texture3D { Width = 1, Height = 1, Pixels = new byte[] { b, g, r, 255 } };
    }
}

/// <summary>Material for a mesh part.</summary>
public sealed class Material3D
{
    public string Name = "default";
    public float R = 0.8f, G = 0.8f, B = 0.8f;
    public float Alpha = 1f;
    public Texture3D? Texture;
    public bool Emissive; // rendered at full brightness (screens, posters)
}

/// <summary>A group of triangles sharing one material.</summary>
public sealed class MeshPart
{
    public int MaterialIndex;
    public int[] Indices = Array.Empty<int>(); // triplets into the vertex arrays
}

/// <summary>Triangulated model with unified vertex arrays.</summary>
public sealed class Model3D
{
    public float[] Positions = Array.Empty<float>(); // xyz
    public float[] Uvs = Array.Empty<float>();       // uv
    public float[] Normals = Array.Empty<float>();   // xyz
    public List<MeshPart> Parts = new();
    public List<Material3D> Materials = new();

    public int VertexCount => Positions.Length / 3;

    public (float minX, float minY, float minZ, float maxX, float maxY, float maxZ) Bounds()
    {
        if (Positions.Length == 0) return (0, 0, 0, 0, 0, 0);
        float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
        float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;
        for (int i = 0; i < Positions.Length; i += 3)
        {
            minX = Math.Min(minX, Positions[i]); maxX = Math.Max(maxX, Positions[i]);
            minY = Math.Min(minY, Positions[i + 1]); maxY = Math.Max(maxY, Positions[i + 1]);
            minZ = Math.Min(minZ, Positions[i + 2]); maxZ = Math.Max(maxZ, Positions[i + 2]);
        }
        return (minX, minY, minZ, maxX, maxY, maxZ);
    }

    public int TriangleCount()
    {
        int n = 0;
        foreach (var p in Parts) n += p.Indices.Length / 3;
        return n;
    }

    public Material3D? FindMaterial(string name)
    {
        foreach (var m in Materials)
        {
            if (string.Equals(m.Name, name, StringComparison.OrdinalIgnoreCase)) return m;
        }
        return null;
    }

    /// <summary>
    /// Parses an OBJ file (v/vt/vn/f/usemtl/mtllib). Faces are triangulated (fan).
    /// Vertices are deduplicated per unique v/vt/vn triple.
    /// </summary>
    public static Model3D LoadObj(string objPath)
    {
        var model = new Model3D();
        string dir = Path.GetDirectoryName(objPath) ?? "";

        var vs = new List<float>();
        var vts = new List<float>();
        var vns = new List<float>();

        var outPos = new List<float>();
        var outUv = new List<float>();
        var outN = new List<float>();
        var vertMap = new Dictionary<(int, int, int), int>();

        var partIndices = new List<int>();
        int currentMat = -1;
        var matLookup = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        var inv = CultureInfo.InvariantCulture;

        void FlushPart()
        {
            if (partIndices.Count > 0)
            {
                model.Parts.Add(new MeshPart { MaterialIndex = currentMat, Indices = partIndices.ToArray() });
                partIndices = new List<int>();
            }
        }

        int ResolveVertex(string spec)
        {
            int vi = 0, ti = -1, ni = -1;
            var seg = spec.Split('/');
            if (seg.Length > 0 && seg[0].Length > 0) vi = int.Parse(seg[0], inv);
            if (seg.Length > 1 && seg[1].Length > 0) ti = int.Parse(seg[1], inv);
            if (seg.Length > 2 && seg[2].Length > 0) ni = int.Parse(seg[2], inv);
            if (vi < 0) vi = vs.Count / 3 + vi + 1;
            if (ti < 0 && ti != -1) ti = vts.Count / 2 + ti + 1;
            if (ni < 0 && ni != -1) ni = vns.Count / 3 + ni + 1;

            var key = (vi, ti, ni);
            if (vertMap.TryGetValue(key, out int idx)) return idx;

            idx = outPos.Count / 3;
            int p = (vi - 1) * 3;
            outPos.Add(vs[p]); outPos.Add(vs[p + 1]); outPos.Add(vs[p + 2]);
            if (ti > 0 && (ti - 1) * 2 + 1 < vts.Count) { outUv.Add(vts[(ti - 1) * 2]); outUv.Add(vts[(ti - 1) * 2 + 1]); }
            else { outUv.Add(0); outUv.Add(0); }
            if (ni > 0 && (ni - 1) * 3 + 2 < vns.Count) { outN.Add(vns[(ni - 1) * 3]); outN.Add(vns[(ni - 1) * 3 + 1]); outN.Add(vns[(ni - 1) * 3 + 2]); }
            else { outN.Add(0); outN.Add(0); outN.Add(0); }
            vertMap[key] = idx;
            return idx;
        }

        foreach (string raw in File.ReadLines(objPath))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            var tok = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            switch (tok[0])
            {
                case "v":
                    vs.Add(float.Parse(tok[1], inv)); vs.Add(float.Parse(tok[2], inv)); vs.Add(float.Parse(tok[3], inv));
                    break;
                case "vt":
                    vts.Add(float.Parse(tok[1], inv)); vts.Add(tok.Length > 2 ? float.Parse(tok[2], inv) : 0f);
                    break;
                case "vn":
                    vns.Add(float.Parse(tok[1], inv)); vns.Add(float.Parse(tok[2], inv)); vns.Add(float.Parse(tok[3], inv));
                    break;
                case "mtllib":
                    LoadMtl(Path.Combine(dir, string.Join(' ', tok.Skip(1))), model, matLookup);
                    break;
                case "usemtl":
                    FlushPart();
                    string mname = string.Join(' ', tok.Skip(1));
                    if (!matLookup.TryGetValue(mname, out currentMat))
                    {
                        model.Materials.Add(new Material3D { Name = mname });
                        currentMat = model.Materials.Count - 1;
                        matLookup[mname] = currentMat;
                    }
                    break;
                case "f":
                    for (int i = 2; i < tok.Length - 1; i++)
                    {
                        partIndices.Add(ResolveVertex(tok[1]));
                        partIndices.Add(ResolveVertex(tok[i]));
                        partIndices.Add(ResolveVertex(tok[i + 1]));
                    }
                    break;
            }
        }
        FlushPart();

        model.Positions = outPos.ToArray();
        model.Uvs = outUv.ToArray();
        model.Normals = outN.ToArray();
        if (model.Materials.Count == 0)
        {
            model.Materials.Add(new Material3D());
            foreach (var p in model.Parts) p.MaterialIndex = 0;
        }
        ComputeMissingNormals(model);
        return model;
    }

    private static void LoadMtl(string mtlPath, Model3D model, Dictionary<string, int> lookup)
    {
        if (!File.Exists(mtlPath)) return;
        string dir = Path.GetDirectoryName(mtlPath) ?? "";
        Material3D? cur = null;
        var inv = CultureInfo.InvariantCulture;

        foreach (string raw in File.ReadLines(mtlPath))
        {
            string line = raw.Trim();
            if (line.Length == 0 || line[0] == '#') continue;
            var tok = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            switch (tok[0].ToLowerInvariant())
            {
                case "newmtl":
                    cur = new Material3D { Name = string.Join(' ', tok.Skip(1)) };
                    lookup[cur.Name] = model.Materials.Count;
                    model.Materials.Add(cur);
                    break;
                case "kd":
                    if (cur != null && tok.Length >= 4)
                    {
                        cur.R = float.Parse(tok[1], inv); cur.G = float.Parse(tok[2], inv); cur.B = float.Parse(tok[3], inv);
                    }
                    break;
                case "d":
                    if (cur != null && tok.Length >= 2) cur.Alpha = float.Parse(tok[1], inv);
                    break;
                case "tr":
                    if (cur != null && tok.Length >= 2) cur.Alpha = 1f - float.Parse(tok[1], inv);
                    break;
                case "map_kd":
                    if (cur != null)
                    {
                        string file = string.Join(' ', tok.Skip(1));
                        string full = Path.IsPathRooted(file) ? file : Path.Combine(dir, file);
                        cur.Texture = Texture3D.FromFile(full);
                    }
                    break;
                case "map_ke":
                    if (cur != null)
                    {
                        cur.Emissive = true;
                        if (cur.Texture == null)
                        {
                            string keFile = string.Join(' ', tok.Skip(1));
                            string keFull = Path.IsPathRooted(keFile) ? keFile : Path.Combine(dir, keFile);
                            cur.Texture = Texture3D.FromFile(keFull);
                        }
                    }
                    break;
            }
        }
    }

    private static void ComputeMissingNormals(Model3D model)
    {
        bool any = false;
        for (int i = 0; i < model.Normals.Length; i += 3)
        {
            if (model.Normals[i] != 0 || model.Normals[i + 1] != 0 || model.Normals[i + 2] != 0) { any = true; break; }
        }
        if (any) return;

        var n = new float[model.Positions.Length];
        foreach (var part in model.Parts)
        {
            for (int i = 0; i < part.Indices.Length; i += 3)
            {
                int a = part.Indices[i] * 3, b = part.Indices[i + 1] * 3, c = part.Indices[i + 2] * 3;
                float ux = model.Positions[b] - model.Positions[a], uy = model.Positions[b + 1] - model.Positions[a + 1], uz = model.Positions[b + 2] - model.Positions[a + 2];
                float vx = model.Positions[c] - model.Positions[a], vy = model.Positions[c + 1] - model.Positions[a + 1], vz = model.Positions[c + 2] - model.Positions[a + 2];
                float nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
                n[a] += nx; n[a + 1] += ny; n[a + 2] += nz;
                n[b] += nx; n[b + 1] += ny; n[b + 2] += nz;
                n[c] += nx; n[c + 1] += ny; n[c + 2] += nz;
            }
        }
        for (int i = 0; i < n.Length; i += 3)
        {
            float len = MathF.Sqrt(n[i] * n[i] + n[i + 1] * n[i + 1] + n[i + 2] * n[i + 2]);
            if (len > 1e-6f) { n[i] /= len; n[i + 1] /= len; n[i + 2] /= len; }
        }
        model.Normals = n;
    }
}
