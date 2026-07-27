using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;

namespace BoothManager.Core;

public sealed class StandeeOptions
{
    public string InputPath { get; set; } = "";
    public string OutputDir { get; set; } = "";
    public double HeightMeters { get; set; } = 1.7;
    public double ThicknessCm { get; set; } = 3.0;
    /// <summary>Working resolution for silhouette detection (256 / 512 / 1024).</summary>
    public int Resolution { get; set; } = 512;
    public bool BackFlap { get; set; } = true;
}

public sealed class StandeeResult
{
    public string ObjPath { get; set; } = "";
    public string MtlPath { get; set; } = "";
    public string TexturePath { get; set; } = "";
    public string PreviewPath { get; set; } = "";
    public int VertexCount { get; set; }
    public int TriangleCount { get; set; }
    public int ContourPointCount { get; set; }
}

/// <summary>
/// Cardboard standee generator: image -> silhouette mask -> contour ->
/// triangulated, extruded mesh -> OBJ + MTL + texture export.
/// Original implementation for Booth Manager; the concept is inspired by
/// "Auto-Standee" by Sketch494 (no GPL code is used here).
/// </summary>
public static class StandeeGenerator
{
    public static StandeeResult Generate(StandeeOptions o)
    {
        using var src = new Bitmap(o.InputPath);

        // ── 1. Downscale to working resolution ──
        double scale = Math.Min(1.0, (double)o.Resolution / Math.Max(src.Width, src.Height));
        int w = Math.Max(8, (int)Math.Round(src.Width * scale));
        int h = Math.Max(8, (int)Math.Round(src.Height * scale));
        byte[] px = RasterToBgra(src, w, h);

        // ── 2. Silhouette mask (alpha channel, or background keying + Otsu) ──
        bool[] mask = BuildMask(px, w, h);

        // ── 3. Keep largest blob, fill holes ──
        mask = KeepLargestComponent(mask, w, h);
        mask = FillHoles(mask, w, h);
        int area = mask.Count(v => v);
        if (area < 64)
            throw new InvalidOperationException("Could not find a subject in this image. Use a picture with a transparent or plain background.");

        // ── 4. Outer contour ──
        List<Point> contour = TraceOuterContour(mask, w, h);
        if (contour.Count < 3)
            throw new InvalidOperationException("Could not trace an outline for this image.");

        // ── 5. Simplify ──
        contour = CollapseCollinear(contour);
        double eps = Math.Max(1.25, 0.0035 * Math.Max(w, h));
        List<PointF> simple = contour.Select(p => new PointF(p.X, p.Y)).ToList();
        for (int guard = 0; guard < 8; guard++)
        {
            var reduced = RamerDouglasPeucker(simple, eps);
            if (reduced.Count <= 600) { simple = reduced; break; }
            eps *= 1.5;
        }
        if (simple.Count < 3)
            throw new InvalidOperationException("Outline collapsed during simplification.");

        // ── 6. World-space 2D points (x right, y up, meters) ──
        float minX = simple.Min(p => p.X), maxX = simple.Max(p => p.X);
        float minY = simple.Min(p => p.Y), maxY = simple.Max(p => p.Y);
        double s = o.HeightMeters / Math.Max(1f, maxY - minY);
        float cx = (minX + maxX) / 2f;
        var world = simple.Select(p => new PointF((float)((p.X - cx) * s), (float)((maxY - p.Y) * s))).ToList();
        if (SignedArea(world) < 0)
        {
            world.Reverse();
            simple.Reverse();
        }

        // ── 7. Triangulate the silhouette ──
        List<int[]> tris = EarClip(world);

        // ── 8. Build + export mesh ──
        Directory.CreateDirectory(o.OutputDir);
        string baseName = Path.GetFileNameWithoutExtension(o.InputPath);
        baseName = string.Concat(baseName.Where(c => char.IsLetterOrDigit(c) || c is '-' or '_'));
        if (baseName.Length == 0) baseName = "standee";
        string objPath = Path.Combine(o.OutputDir, baseName + "_standee.obj");
        string mtlPath = Path.Combine(o.OutputDir, baseName + "_standee.mtl");
        string texPath = Path.Combine(o.OutputDir, baseName + "_texture.png");

        src.Save(texPath, ImageFormat.Png);
        var result = WriteObj(objPath, mtlPath, Path.GetFileName(texPath), world, simple, tris, w, h, o);

        // ── 9. Preview image ──
        result.PreviewPath = WritePreview(mask, simple, w, h);
        result.ObjPath = objPath;
        result.MtlPath = mtlPath;
        result.TexturePath = texPath;
        result.ContourPointCount = simple.Count;
        return result;
    }

    /* ────────────────────────── raster + mask ────────────────────────── */

    private static byte[] RasterToBgra(Bitmap src, int w, int h)
    {
        using var work = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(work))
        {
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.Clear(Color.Transparent);
            g.DrawImage(src, new Rectangle(0, 0, w, h));
        }
        var data = work.LockBits(new Rectangle(0, 0, w, h), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        var px = new byte[data.Stride * h];
        Marshal.Copy(data.Scan0, px, 0, px.Length);
        int stride = data.Stride;
        work.UnlockBits(data);
        if (stride == w * 4) return px;
        // Compact rows if stride is padded.
        var tight = new byte[w * h * 4];
        for (int y = 0; y < h; y++)
            Buffer.BlockCopy(px, y * stride, tight, y * w * 4, w * 4);
        return tight;
    }

    private static bool[] BuildMask(byte[] bgra, int w, int h)
    {
        int n = w * h;
        byte aMin = 255, aMax = 0;
        for (int i = 0; i < n; i++)
        {
            byte a = bgra[i * 4 + 3];
            if (a < aMin) aMin = a;
            if (a > aMax) aMax = a;
        }

        var mask = new bool[n];
        if (aMin < 100 && aMax > 180)
        {
            // Real alpha channel: threshold it directly.
            for (int i = 0; i < n; i++) mask[i] = bgra[i * 4 + 3] >= 128;
            return mask;
        }

        // Opaque image: key out the background color sampled from the corners.
        var (bb, bg, br) = CornerMedianColor(bgra, w, h);
        var dist = new byte[n];
        for (int i = 0; i < n; i++)
        {
            int db = bgra[i * 4] - bb;
            int dg = bgra[i * 4 + 1] - bg;
            int dr = bgra[i * 4 + 2] - br;
            double d = Math.Sqrt(db * db + dg * dg + dr * dr) / 441.673 * 255.0;
            dist[i] = (byte)Math.Clamp((int)d, 0, 255);
        }
        int thr = OtsuThreshold(dist);
        for (int i = 0; i < n; i++) mask[i] = dist[i] > thr;

        // Sanity: corners must be background; if most are foreground, invert.
        int cornersFg = 0;
        foreach (var (cxp, cyp) in new[] { (1, 1), (w - 2, 1), (1, h - 2), (w - 2, h - 2) })
            if (mask[cyp * w + cxp]) cornersFg++;
        if (cornersFg >= 3)
            for (int i = 0; i < n; i++) mask[i] = !mask[i];
        return mask;
    }

    private static (int b, int g, int r) CornerMedianColor(byte[] bgra, int w, int h)
    {
        var bs = new List<byte>(); var gs = new List<byte>(); var rs = new List<byte>();
        int patch = Math.Max(2, Math.Min(8, Math.Min(w, h) / 16));
        foreach (var (ox, oy) in new[] { (0, 0), (w - patch, 0), (0, h - patch), (w - patch, h - patch) })
        {
            for (int y = 0; y < patch; y++)
                for (int x = 0; x < patch; x++)
                {
                    int i = ((oy + y) * w + ox + x) * 4;
                    bs.Add(bgra[i]); gs.Add(bgra[i + 1]); rs.Add(bgra[i + 2]);
                }
        }
        bs.Sort(); gs.Sort(); rs.Sort();
        int m = bs.Count / 2;
        return (bs[m], gs[m], rs[m]);
    }

    private static int OtsuThreshold(byte[] values)
    {
        var hist = new long[256];
        foreach (var v in values) hist[v]++;
        long total = values.Length;
        double sum = 0;
        for (int i = 0; i < 256; i++) sum += i * (double)hist[i];
        double sumB = 0; long wB = 0;
        double maxVar = -1; int best = 127;
        for (int t = 0; t < 256; t++)
        {
            wB += hist[t];
            if (wB == 0) continue;
            long wF = total - wB;
            if (wF == 0) break;
            sumB += t * (double)hist[t];
            double mB = sumB / wB, mF = (sum - sumB) / wF;
            double between = (double)wB * wF * (mB - mF) * (mB - mF);
            if (between > maxVar) { maxVar = between; best = t; }
        }
        return best;
    }

    /* ───────────────────── components + holes ───────────────────── */

    private static bool[] KeepLargestComponent(bool[] mask, int w, int h)
    {
        int n = w * h;
        var label = new int[n];
        int next = 0, bestLabel = -1, bestSize = 0;
        var queue = new Queue<int>();
        for (int start = 0; start < n; start++)
        {
            if (!mask[start] || label[start] != 0) continue;
            next++;
            int size = 0;
            label[start] = next;
            queue.Enqueue(start);
            while (queue.Count > 0)
            {
                int i = queue.Dequeue();
                size++;
                int x = i % w, y = i / w;
                if (x > 0 && mask[i - 1] && label[i - 1] == 0) { label[i - 1] = next; queue.Enqueue(i - 1); }
                if (x < w - 1 && mask[i + 1] && label[i + 1] == 0) { label[i + 1] = next; queue.Enqueue(i + 1); }
                if (y > 0 && mask[i - w] && label[i - w] == 0) { label[i - w] = next; queue.Enqueue(i - w); }
                if (y < h - 1 && mask[i + w] && label[i + w] == 0) { label[i + w] = next; queue.Enqueue(i + w); }
            }
            if (size > bestSize) { bestSize = size; bestLabel = next; }
        }
        var outMask = new bool[n];
        if (bestLabel > 0)
            for (int i = 0; i < n; i++) outMask[i] = label[i] == bestLabel;
        return outMask;
    }

    private static bool[] FillHoles(bool[] mask, int w, int h)
    {
        int n = w * h;
        var outside = new bool[n];
        var queue = new Queue<int>();
        for (int x = 0; x < w; x++)
        {
            if (!mask[x] && !outside[x]) { outside[x] = true; queue.Enqueue(x); }
            int b = (h - 1) * w + x;
            if (!mask[b] && !outside[b]) { outside[b] = true; queue.Enqueue(b); }
        }
        for (int y = 0; y < h; y++)
        {
            int l = y * w, r = y * w + w - 1;
            if (!mask[l] && !outside[l]) { outside[l] = true; queue.Enqueue(l); }
            if (!mask[r] && !outside[r]) { outside[r] = true; queue.Enqueue(r); }
        }
        while (queue.Count > 0)
        {
            int i = queue.Dequeue();
            int x = i % w, y = i / w;
            if (x > 0 && !mask[i - 1] && !outside[i - 1]) { outside[i - 1] = true; queue.Enqueue(i - 1); }
            if (x < w - 1 && !mask[i + 1] && !outside[i + 1]) { outside[i + 1] = true; queue.Enqueue(i + 1); }
            if (y > 0 && !mask[i - w] && !outside[i - w]) { outside[i - w] = true; queue.Enqueue(i - w); }
            if (y < h - 1 && !mask[i + w] && !outside[i + w]) { outside[i + w] = true; queue.Enqueue(i + w); }
        }
        var filled = new bool[n];
        for (int i = 0; i < n; i++) filled[i] = mask[i] || !outside[i];
        return filled;
    }

    /* ───────────────────────── contour ───────────────────────── */

    /// <summary>
    /// Collect boundary edges between foreground pixels and background
    /// 4-neighbors, then chain them into loops; the largest loop is the
    /// outer contour. Points are pixel-lattice coordinates.
    /// </summary>
    private static List<Point> TraceOuterContour(bool[] mask, int w, int h)
    {
        bool At(int x, int y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x];

        var edges = new Dictionary<(int x, int y), List<(int x, int y)>>();
        void AddEdge(int ax, int ay, int bx, int by)
        {
            var key = (ax, ay);
            if (!edges.TryGetValue(key, out var list)) { list = new List<(int, int)>(); edges[key] = list; }
            list.Add((bx, by));
        }

        for (int y = 0; y < h; y++)
        {
            for (int x = 0; x < w; x++)
            {
                if (!mask[y * w + x]) continue;
                if (!At(x, y - 1)) AddEdge(x, y, x + 1, y);          // top edge, walk right
                if (!At(x + 1, y)) AddEdge(x + 1, y, x + 1, y + 1);  // right edge, walk down
                if (!At(x, y + 1)) AddEdge(x + 1, y + 1, x, y + 1);  // bottom edge, walk left
                if (!At(x - 1, y)) AddEdge(x, y + 1, x, y);          // left edge, walk up
            }
        }

        var best = new List<Point>();
        double bestArea = -1;
        while (edges.Count > 0)
        {
            var start = edges.Keys.First();
            var loop = new List<Point>();
            var cur = start;
            (int x, int y) prevDir = (0, 0);
            int guard = w * h * 8;
            while (guard-- > 0)
            {
                loop.Add(new Point(cur.x, cur.y));
                if (!edges.TryGetValue(cur, out var outs) || outs.Count == 0) break;
                (int x, int y) chosen;
                if (outs.Count == 1)
                {
                    chosen = outs[0];
                }
                else
                {
                    // Pinch point: prefer the sharpest left turn to stay on one loop.
                    chosen = outs[0];
                    double bestTurn = double.MinValue;
                    foreach (var cand in outs)
                    {
                        var d = (x: cand.x - cur.x, y: cand.y - cur.y);
                        double turn = prevDir.x * d.y - prevDir.y * d.x;
                        if (turn > bestTurn) { bestTurn = turn; chosen = cand; }
                    }
                }
                outs.Remove(chosen);
                if (outs.Count == 0) edges.Remove(cur);
                prevDir = (chosen.x - cur.x, chosen.y - cur.y);
                cur = chosen;
                if (cur == start) break;
            }
            if (loop.Count >= 3)
            {
                double a = Math.Abs(SignedArea(loop.Select(p => new PointF(p.X, p.Y)).ToList()));
                if (a > bestArea) { bestArea = a; best = loop; }
            }
        }
        return best;
    }

    private static List<Point> CollapseCollinear(List<Point> pts)
    {
        if (pts.Count < 3) return pts;
        var outPts = new List<Point>();
        for (int i = 0; i < pts.Count; i++)
        {
            var prev = pts[(i - 1 + pts.Count) % pts.Count];
            var cur = pts[i];
            var next = pts[(i + 1) % pts.Count];
            long cross = (long)(cur.X - prev.X) * (next.Y - cur.Y) - (long)(cur.Y - prev.Y) * (next.X - cur.X);
            if (cross != 0) outPts.Add(cur);
        }
        return outPts.Count >= 3 ? outPts : pts;
    }

    private static List<PointF> RamerDouglasPeucker(List<PointF> pts, double eps)
    {
        if (pts.Count < 4) return new List<PointF>(pts);
        var keep = new bool[pts.Count];
        keep[0] = keep[pts.Count - 1] = true;
        var stack = new Stack<(int a, int b)>();
        stack.Push((0, pts.Count - 1));
        while (stack.Count > 0)
        {
            var (a, b) = stack.Pop();
            double maxD = 0; int idx = -1;
            for (int i = a + 1; i < b; i++)
            {
                double d = PerpDistance(pts[i], pts[a], pts[b]);
                if (d > maxD) { maxD = d; idx = i; }
            }
            if (idx != -1 && maxD > eps)
            {
                keep[idx] = true;
                stack.Push((a, idx));
                stack.Push((idx, b));
            }
        }
        var result = new List<PointF>();
        for (int i = 0; i < pts.Count; i++)
            if (keep[i]) result.Add(pts[i]);
        return result;
    }

    private static double PerpDistance(PointF p, PointF a, PointF b)
    {
        double dx = b.X - a.X, dy = b.Y - a.Y;
        double len = Math.Sqrt(dx * dx + dy * dy);
        if (len < 1e-9) return Math.Sqrt((p.X - a.X) * (p.X - a.X) + (p.Y - a.Y) * (p.Y - a.Y));
        return Math.Abs(dx * (a.Y - p.Y) - (a.X - p.X) * dy) / len;
    }

    private static double SignedArea(List<PointF> pts)
    {
        double a = 0;
        for (int i = 0; i < pts.Count; i++)
        {
            var p = pts[i];
            var q = pts[(i + 1) % pts.Count];
            a += p.X * q.Y - q.X * p.Y;
        }
        return a / 2;
    }

    /* ─────────────────────── triangulation ─────────────────────── */

    private static List<int[]> EarClip(List<PointF> poly)
    {
        var tris = new List<int[]>();
        var idx = Enumerable.Range(0, poly.Count).ToList();

        bool IsConvex(int a, int b, int c)
        {
            var p = poly[a]; var q = poly[b]; var r = poly[c];
            return (q.X - p.X) * (r.Y - q.Y) - (q.Y - p.Y) * (r.X - q.X) > 1e-12;
        }

        bool InTriangle(PointF p, PointF a, PointF b, PointF c)
        {
            double d1 = (p.X - b.X) * (a.Y - b.Y) - (a.X - b.X) * (p.Y - b.Y);
            double d2 = (p.X - c.X) * (b.Y - c.Y) - (b.X - c.X) * (p.Y - c.Y);
            double d3 = (p.X - a.X) * (c.Y - a.Y) - (c.X - a.X) * (p.Y - a.Y);
            bool neg = d1 < 0 || d2 < 0 || d3 < 0;
            bool pos = d1 > 0 || d2 > 0 || d3 > 0;
            return !(neg && pos);
        }

        int guard = poly.Count * poly.Count + 100;
        while (idx.Count > 3 && guard-- > 0)
        {
            bool clipped = false;
            for (int i = 0; i < idx.Count; i++)
            {
                int ia = idx[(i - 1 + idx.Count) % idx.Count];
                int ib = idx[i];
                int ic = idx[(i + 1) % idx.Count];
                if (!IsConvex(ia, ib, ic)) continue;

                bool blocked = false;
                foreach (int other in idx)
                {
                    if (other == ia || other == ib || other == ic) continue;
                    if (IsConvex(ia, ib, ic) && InTriangle(poly[other], poly[ia], poly[ib], poly[ic]))
                    {
                        blocked = true;
                        break;
                    }
                }
                if (blocked) continue;

                tris.Add(new[] { ia, ib, ic });
                idx.RemoveAt(i);
                clipped = true;
                break;
            }
            if (!clipped)
            {
                // Degenerate leftovers: clip the widest angle to keep progressing.
                tris.Add(new[] { idx[0], idx[1], idx[2] });
                idx.RemoveAt(1);
            }
        }
        if (idx.Count == 3)
            tris.Add(new[] { idx[0], idx[1], idx[2] });
        return tris;
    }

    /* ───────────────────────── export ───────────────────────── */

    private static StandeeResult WriteObj(
        string objPath, string mtlPath, string textureFileName,
        List<PointF> world, List<PointF> pixel, List<int[]> tris,
        int imgW, int imgH, StandeeOptions o)
    {
        var inv = CultureInfo.InvariantCulture;
        int n = world.Count;
        float tz = (float)(o.ThicknessCm / 100.0 / 2.0);
        var sb = new StringBuilder(1 << 20);
        sb.AppendLine("# Booth Manager standee export");
        sb.AppendLine("# VRChat Legends - Legends Alley");
        sb.AppendLine($"mtllib {Path.GetFileName(mtlPath)}");
        sb.AppendLine("o standee");

        // Vertices: front (+z) then back (-z), interleaved per contour point.
        for (int i = 0; i < n; i++)
        {
            sb.AppendLine(string.Format(inv, "v {0:0.000000} {1:0.000000} {2:0.000000}", world[i].X, world[i].Y, tz));
            sb.AppendLine(string.Format(inv, "v {0:0.000000} {1:0.000000} {2:0.000000}", world[i].X, world[i].Y, -tz));
        }
        // UVs, one per contour point.
        for (int i = 0; i < n; i++)
        {
            double u = pixel[i].X / imgW;
            double v = 1.0 - pixel[i].Y / imgH;
            sb.AppendLine(string.Format(inv, "vt {0:0.000000} {1:0.000000}", u, v));
        }

        int Front(int i) => i * 2 + 1;     // 1-based OBJ indices
        int Back(int i) => i * 2 + 2;

        sb.AppendLine("usemtl standee_front");
        foreach (var t in tris)
            sb.AppendLine($"f {Front(t[0])}/{t[0] + 1} {Front(t[1])}/{t[1] + 1} {Front(t[2])}/{t[2] + 1}");

        sb.AppendLine("usemtl standee_cardboard");
        foreach (var t in tris)
            sb.AppendLine($"f {Back(t[2])}/{t[2] + 1} {Back(t[1])}/{t[1] + 1} {Back(t[0])}/{t[0] + 1}");
        for (int i = 0; i < n; i++)
        {
            int j = (i + 1) % n;
            sb.AppendLine($"f {Front(i)}/{i + 1} {Back(i)}/{i + 1} {Back(j)}/{j + 1}");
            sb.AppendLine($"f {Front(i)}/{i + 1} {Back(j)}/{j + 1} {Front(j)}/{j + 1}");
        }

        int extraVerts = 0, extraTris = 0;
        if (o.BackFlap)
        {
            float minX = world.Min(p => p.X), maxX = world.Max(p => p.X);
            float width = maxX - minX;
            float x1 = minX + width * 0.30f, x2 = minX + width * 0.70f;
            float len = (float)(o.HeightMeters * 0.45);
            double ang = 32.0 * Math.PI / 180.0;
            float fy = (float)(len * Math.Sin(ang));
            float fz = -tz - (float)(len * Math.Cos(ang));
            int b = n * 2; // vertex count so far
            sb.AppendLine(string.Format(inv, "v {0:0.000000} 0.000000 {1:0.000000}", x1, -tz));
            sb.AppendLine(string.Format(inv, "v {0:0.000000} 0.000000 {1:0.000000}", x2, -tz));
            sb.AppendLine(string.Format(inv, "v {0:0.000000} {1:0.000000} {2:0.000000}", x2, fy, fz));
            sb.AppendLine(string.Format(inv, "v {0:0.000000} {1:0.000000} {2:0.000000}", x1, fy, fz));
            int uvFlap = n + 1;
            sb.AppendLine("vt 0.010000 0.010000");
            // Double-sided flap so it renders from both sides.
            sb.AppendLine($"f {b + 1}/{uvFlap} {b + 2}/{uvFlap} {b + 3}/{uvFlap}");
            sb.AppendLine($"f {b + 1}/{uvFlap} {b + 3}/{uvFlap} {b + 4}/{uvFlap}");
            sb.AppendLine($"f {b + 3}/{uvFlap} {b + 2}/{uvFlap} {b + 1}/{uvFlap}");
            sb.AppendLine($"f {b + 4}/{uvFlap} {b + 3}/{uvFlap} {b + 1}/{uvFlap}");
            extraVerts = 4;
            extraTris = 4;
        }

        File.WriteAllText(objPath, sb.ToString());

        var mtl = new StringBuilder();
        mtl.AppendLine("# Booth Manager standee materials");
        mtl.AppendLine("newmtl standee_front");
        mtl.AppendLine("Kd 1.000 1.000 1.000");
        mtl.AppendLine("d 1.0");
        mtl.AppendLine($"map_Kd {textureFileName}");
        mtl.AppendLine();
        mtl.AppendLine("newmtl standee_cardboard");
        mtl.AppendLine("Kd 0.720 0.550 0.380");
        mtl.AppendLine("d 1.0");
        File.WriteAllText(mtlPath, mtl.ToString());

        return new StandeeResult
        {
            VertexCount = n * 2 + extraVerts,
            TriangleCount = tris.Count * 2 + n * 2 + extraTris,
        };
    }

    private static string WritePreview(bool[] mask, List<PointF> contour, int w, int h)
    {
        string path = Path.Combine(Path.GetTempPath(), "bm_standee_preview.png");
        using var bmp = new Bitmap(w, h, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.Clear(Color.FromArgb(255, 11, 15, 20));
            var pts = contour.Select(p => new PointF(p.X, p.Y)).ToArray();
            using var fill = new SolidBrush(Color.FromArgb(70, 0, 230, 204));
            using var pen = new Pen(Color.FromArgb(255, 0, 230, 204), 2f);
            if (pts.Length >= 3)
            {
                g.FillPolygon(fill, pts);
                g.DrawPolygon(pen, pts);
            }
        }
        bmp.Save(path, ImageFormat.Png);
        return path;
    }
}
