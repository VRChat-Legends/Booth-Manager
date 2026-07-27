using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Text.Json;

namespace BoothManager.Core;

public sealed class AtlasResult
{
    public string AtlasPath { get; set; } = "";
    public string ManifestPath { get; set; } = "";
    public int Size { get; set; }
    public int Placed { get; set; }
    public double Scale { get; set; } = 1.0;
}

/// <summary>
/// Packs a set of images into a single power-of-two texture atlas (shelf
/// packing) and writes a JSON manifest with pixel rects + normalized UVs.
/// Images are proportionally downscaled if they cannot fit the max size.
/// </summary>
public static class AtlasPacker
{
    private sealed class Entry
    {
        public string File = "";
        public string Name = "";
        public int W;
        public int H;
        public int X;
        public int Y;
        public int Pw;
        public int Ph;
    }

    public static AtlasResult Pack(IList<string> files, int maxSize, int padding, string outPngPath)
    {
        if (files.Count == 0) throw new InvalidOperationException("Add at least one image.");

        var entries = new List<Entry>();
        var seen = new HashSet<string>();
        foreach (var f in files)
        {
            using var img = Image.FromFile(f);
            string name = Path.GetFileNameWithoutExtension(f);
            string unique = name;
            int k = 2;
            while (!seen.Add(unique)) unique = $"{name}_{k++}";
            entries.Add(new Entry { File = f, Name = unique, W = img.Width, H = img.Height });
        }

        double scale = 1.0;
        int size = 0;
        for (int attempt = 0; attempt < 40; attempt++)
        {
            size = TryPack(entries, maxSize, padding, scale);
            if (size > 0) break;
            scale *= 0.88;
            if (scale < 0.04)
                throw new InvalidOperationException("Images do not fit even after heavy downscaling. Use a larger max size or fewer images.");
        }

        using (var atlas = new Bitmap(size, size, PixelFormat.Format32bppArgb))
        {
            using (var g = Graphics.FromImage(atlas))
            {
                g.Clear(Color.Transparent);
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.SmoothingMode = SmoothingMode.AntiAlias;
                foreach (var e in entries)
                {
                    using var img = Image.FromFile(e.File);
                    g.DrawImage(img, new Rectangle(e.X, e.Y, e.Pw, e.Ph));
                }
            }
            atlas.Save(outPngPath, ImageFormat.Png);
        }

        string manifestPath = Path.ChangeExtension(outPngPath, ".json");
        var manifest = new
        {
            atlas = Path.GetFileName(outPngPath),
            width = size,
            height = size,
            scale,
            generator = "Booth Manager (VRChat Legends)",
            sprites = entries.Select(e => new
            {
                name = e.Name,
                file = Path.GetFileName(e.File),
                x = e.X,
                y = e.Y,
                w = e.Pw,
                h = e.Ph,
                u0 = Math.Round((double)e.X / size, 6),
                v0 = Math.Round((double)e.Y / size, 6),
                u1 = Math.Round((double)(e.X + e.Pw) / size, 6),
                v1 = Math.Round((double)(e.Y + e.Ph) / size, 6),
            }).ToList(),
        };
        File.WriteAllText(manifestPath, JsonSerializer.Serialize(manifest, new JsonSerializerOptions { WriteIndented = true }));

        return new AtlasResult
        {
            AtlasPath = outPngPath,
            ManifestPath = manifestPath,
            Size = size,
            Placed = entries.Count,
            Scale = scale,
        };
    }

    /// <summary>Shelf-pack at the given scale; returns the atlas size used, or 0 when nothing fits.</summary>
    private static int TryPack(List<Entry> entries, int maxSize, int padding, double scale)
    {
        foreach (var e in entries)
        {
            e.Pw = Math.Max(1, (int)Math.Round(e.W * scale));
            e.Ph = Math.Max(1, (int)Math.Round(e.H * scale));
        }
        var sorted = entries.OrderByDescending(e => e.Ph).ToList();

        long area = 0;
        int maxDim = 1;
        foreach (var e in sorted)
        {
            area += (long)(e.Pw + padding) * (e.Ph + padding);
            maxDim = Math.Max(maxDim, Math.Max(e.Pw, e.Ph));
        }
        int start = 64;
        while (start < maxDim + padding * 2 || (long)start * start < area) start *= 2;

        for (int size = start; size <= maxSize; size *= 2)
        {
            int x = padding, y = padding, shelf = 0;
            bool ok = true;
            foreach (var e in sorted)
            {
                if (x + e.Pw + padding > size)
                {
                    x = padding;
                    y += shelf + padding;
                    shelf = 0;
                }
                if (y + e.Ph + padding > size || e.Pw + padding * 2 > size)
                {
                    ok = false;
                    break;
                }
                e.X = x;
                e.Y = y;
                x += e.Pw + padding;
                shelf = Math.Max(shelf, e.Ph);
            }
            if (ok) return size;
        }
        return 0;
    }
}
