using System.Drawing;
using System.Drawing.Imaging;

namespace BoothManager.Core;

/// <summary>
/// Headless smoke test (run with --selftest): generates a synthetic image,
/// runs the standee and atlas pipelines, and writes a result file to %TEMP%.
/// </summary>
public static class SelfTest
{
    public static string Run()
    {
        string dir = Path.Combine(Path.GetTempPath(), "bm_selftest");
        if (Directory.Exists(dir)) Directory.Delete(dir, true);
        Directory.CreateDirectory(dir);

        // Synthetic subject: a "person-ish" silhouette on transparency.
        string img = Path.Combine(dir, "subject.png");
        using (var bmp = new Bitmap(256, 256, PixelFormat.Format32bppArgb))
        {
            using var g = Graphics.FromImage(bmp);
            g.Clear(Color.Transparent);
            using var brush = new SolidBrush(Color.FromArgb(255, 40, 180, 220));
            g.FillEllipse(brush, 88, 20, 80, 80);      // head
            g.FillRectangle(brush, 78, 95, 100, 130);  // body
            g.FillRectangle(brush, 88, 225, 30, 28);   // leg
            g.FillRectangle(brush, 138, 225, 30, 28);  // leg
            bmp.Save(img, ImageFormat.Png);
        }

        var standee = StandeeGenerator.Generate(new StandeeOptions
        {
            InputPath = img,
            OutputDir = dir,
            HeightMeters = 1.7,
            ThicknessCm = 3,
            Resolution = 256,
            BackFlap = true,
        });
        if (!File.Exists(standee.ObjPath)) throw new InvalidOperationException("OBJ missing");
        if (!File.Exists(standee.MtlPath)) throw new InvalidOperationException("MTL missing");
        if (!File.Exists(standee.TexturePath)) throw new InvalidOperationException("texture missing");
        if (standee.TriangleCount < 8) throw new InvalidOperationException("too few triangles");

        var atlasInputs = new List<string> { img, img, img };
        var atlas = AtlasPacker.Pack(atlasInputs, 1024, 2, Path.Combine(dir, "atlas.png"));
        if (!File.Exists(atlas.AtlasPath)) throw new InvalidOperationException("atlas missing");
        if (!File.Exists(atlas.ManifestPath)) throw new InvalidOperationException("manifest missing");

        string audioDir = Path.Combine(dir, "audio");
        WavSynth.EnsureGenerated(audioDir);
        long musicBytes = new FileInfo(Path.Combine(audioDir, "music_loop.wav")).Length;
        if (musicBytes < 1000000) throw new InvalidOperationException("music loop too small");
        if (!File.Exists(Path.Combine(audioDir, "click.wav"))) throw new InvalidOperationException("click missing");
        if (!File.Exists(Path.Combine(audioDir, "success.wav"))) throw new InvalidOperationException("success missing");

        string summary =
            $"OK standee: verts={standee.VertexCount} tris={standee.TriangleCount} contour={standee.ContourPointCount}; " +
            $"atlas: {atlas.Size}x{atlas.Size} placed={atlas.Placed}; music={musicBytes / 1024}KB";
        File.WriteAllText(Path.Combine(dir, "result.txt"), summary);
        return summary;
    }
}
