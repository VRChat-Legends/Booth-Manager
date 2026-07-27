namespace BoothManager.Core;

/// <summary>
/// Tiny software synthesizer: generates the app's background music loop and
/// UI sound effects as WAV files so no audio binaries ship in the repo.
/// </summary>
public static class WavSynth
{
    private const int Rate = 44100;

    public static void EnsureGenerated(string dir)
    {
        Directory.CreateDirectory(dir);
        Generate(Path.Combine(dir, "music_loop.wav"), MusicLoop);
        Generate(Path.Combine(dir, "click.wav"), Click);
        Generate(Path.Combine(dir, "success.wav"), Success);
    }

    private static void Generate(string path, Func<(float[] left, float[] right)> maker)
    {
        if (File.Exists(path)) return;
        var (l, r) = maker();
        WriteWav(path, l, r);
    }

    /* ── music: slow ambient pad, Am F C G, 32 second loop ── */

    private static (float[], float[]) MusicLoop()
    {
        double[][] chords =
        {
            new[] { 110.00, 220.00, 261.63, 329.63 },  // A minor
            new[] { 174.61, 220.00, 261.63, 349.23 },  // F major
            new[] { 130.81, 196.00, 261.63, 329.63 },  // C major
            new[] { 98.00, 196.00, 246.94, 293.66 },   // G major (add9 feel)
        };
        double chordSec = 8.0;
        int total = (int)(Rate * chordSec * chords.Length);
        var left = new float[total];
        var right = new float[total];

        for (int c = 0; c < chords.Length; c++)
        {
            int start = (int)(c * chordSec * Rate);
            int len = (int)(chordSec * Rate);
            for (int i = 0; i < len; i++)
            {
                double t = (double)i / Rate;
                // Raised-cosine window so chords crossfade smoothly and the loop seam is silent.
                double win = 0.5 - 0.5 * Math.Cos(2 * Math.PI * i / len);
                double l = 0, r = 0;
                for (int n = 0; n < chords[c].Length; n++)
                {
                    double f = chords[c][n];
                    double amp = 1.0 / (n + 1.6);
                    l += amp * Math.Sin(2 * Math.PI * f * t);
                    r += amp * Math.Sin(2 * Math.PI * f * 1.0016 * t + 0.9);
                    // Soft octave shimmer.
                    l += 0.12 * amp * Math.Sin(2 * Math.PI * f * 2 * t + n);
                    r += 0.12 * amp * Math.Sin(2 * Math.PI * f * 2.0022 * t + n + 0.5);
                }
                double trem = 1.0 - 0.18 * (0.5 + 0.5 * Math.Sin(2 * Math.PI * 0.11 * (start + i) / Rate));
                left[start + i] += (float)(l * win * trem);
                right[start + i] += (float)(r * win * trem);
            }
        }

        Normalize(left, right, 0.42f);
        return (left, right);
    }

    /* ── UI sounds ── */

    private static (float[], float[]) Click()
    {
        int len = (int)(Rate * 0.045);
        var buf = new float[len];
        for (int i = 0; i < len; i++)
        {
            double t = (double)i / Rate;
            buf[i] = (float)(Math.Sin(2 * Math.PI * 1850 * t) * Math.Exp(-t * 160) * 0.5);
        }
        return (buf, (float[])buf.Clone());
    }

    private static (float[], float[]) Success()
    {
        int len = (int)(Rate * 0.5);
        var buf = new float[len];
        for (int i = 0; i < len; i++)
        {
            double t = (double)i / Rate;
            double v = 0;
            if (t < 0.22) v = Math.Sin(2 * Math.PI * 523.25 * t) * Math.Exp(-t * 9);
            if (t >= 0.12) { double u = t - 0.12; v += Math.Sin(2 * Math.PI * 783.99 * u) * Math.Exp(-u * 7); }
            buf[i] = (float)(v * 0.35);
        }
        return (buf, (float[])buf.Clone());
    }

    /* ── WAV writing ── */

    private static void Normalize(float[] l, float[] r, float peak)
    {
        float max = 0.0001f;
        for (int i = 0; i < l.Length; i++)
        {
            max = Math.Max(max, Math.Abs(l[i]));
            max = Math.Max(max, Math.Abs(r[i]));
        }
        float k = peak / max;
        for (int i = 0; i < l.Length; i++) { l[i] *= k; r[i] *= k; }
    }

    private static void WriteWav(string path, float[] left, float[] right)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write);
        using var w = new BinaryWriter(fs);
        int samples = left.Length;
        int dataBytes = samples * 2 * 2; // stereo, 16-bit

        w.Write("RIFF"u8.ToArray());
        w.Write(36 + dataBytes);
        w.Write("WAVE"u8.ToArray());
        w.Write("fmt "u8.ToArray());
        w.Write(16);
        w.Write((short)1);            // PCM
        w.Write((short)2);            // stereo
        w.Write(Rate);
        w.Write(Rate * 2 * 2);        // byte rate
        w.Write((short)4);            // block align
        w.Write((short)16);           // bits
        w.Write("data"u8.ToArray());
        w.Write(dataBytes);
        for (int i = 0; i < samples; i++)
        {
            w.Write((short)Math.Clamp((int)(left[i] * 32767f), short.MinValue, short.MaxValue));
            w.Write((short)Math.Clamp((int)(right[i] * 32767f), short.MinValue, short.MaxValue));
        }
    }
}
