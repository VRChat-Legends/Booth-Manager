using System.Diagnostics;
using System.Net.Http;
using System.Text.Json;

namespace BoothManager.Services;

public sealed class UpdateInfo
{
    public Version Version { get; set; } = new(0, 0, 0);
    public string Tag { get; set; } = "";
    public string HtmlUrl { get; set; } = "";
    public string? InstallerUrl { get; set; }
    public string? InstallerName { get; set; }
}

/// <summary>
/// Discord-style updater: checks GitHub releases on launch and periodically
/// while the app is open; "Update now" downloads and runs the new installer.
/// </summary>
public static class UpdateService
{
    private const string ReleasesLatest = "https://api.github.com/repos/VRChat-Legends/Booth-Manager/releases/latest";

    public static Version CurrentVersion
    {
        get
        {
            var v = typeof(UpdateService).Assembly.GetName().Version;
            return v == null ? new Version(1, 0, 0) : new Version(v.Major, v.Minor, Math.Max(v.Build, 0));
        }
    }

    public static async Task<UpdateInfo?> CheckAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("BoothManager-Updater/1.0");
            var text = await http.GetStringAsync(ReleasesLatest);
            using var doc = JsonDocument.Parse(text);
            var root = doc.RootElement;

            string tag = root.TryGetProperty("tag_name", out var t) ? t.GetString() ?? "" : "";
            string cleaned = tag.TrimStart('v', 'V').Trim();
            if (!Version.TryParse(cleaned, out var remote)) return null;
            if (remote <= CurrentVersion) return null;

            var info = new UpdateInfo
            {
                Version = remote,
                Tag = tag,
                HtmlUrl = root.TryGetProperty("html_url", out var h) ? h.GetString() ?? "" : "",
            };
            if (root.TryGetProperty("assets", out var assets) && assets.ValueKind == JsonValueKind.Array)
            {
                foreach (var a in assets.EnumerateArray())
                {
                    string name = a.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                    if (name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                    {
                        info.InstallerName = name;
                        info.InstallerUrl = a.TryGetProperty("browser_download_url", out var u) ? u.GetString() : null;
                        break;
                    }
                }
            }
            return info;
        }
        catch
        {
            return null;
        }
    }

    /// <summary>Download and launch the installer, then close the app. Falls back to the release page.</summary>
    public static async Task<bool> ApplyAsync(UpdateInfo info)
    {
        if (string.IsNullOrEmpty(info.InstallerUrl))
        {
            if (!string.IsNullOrEmpty(info.HtmlUrl)) Helpers.OpenUrl(info.HtmlUrl);
            return false;
        }
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(5) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("BoothManager-Updater/1.0");
            byte[] bytes = await http.GetByteArrayAsync(info.InstallerUrl);
            string path = Path.Combine(Path.GetTempPath(), info.InstallerName ?? "BoothManager-Setup.exe");
            await File.WriteAllBytesAsync(path, bytes);
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
            return true;
        }
        catch
        {
            if (!string.IsNullOrEmpty(info.HtmlUrl)) Helpers.OpenUrl(info.HtmlUrl);
            return false;
        }
    }
}
