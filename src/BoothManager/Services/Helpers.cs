using System.Diagnostics;

namespace BoothManager.Services;

public static class Helpers
{
    /// <summary>Open a URL in the user's default browser.</summary>
    public static void OpenUrl(string url)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = url, UseShellExecute = true });
        }
        catch
        {
            // Ignore: browser launch failed.
        }
    }

    /// <summary>Open a folder in Explorer.</summary>
    public static void OpenFolder(string path)
    {
        try
        {
            Process.Start(new ProcessStartInfo { FileName = path, UseShellExecute = true });
        }
        catch
        {
        }
    }

    /// <summary>Human readable "x minutes ago" from an ISO timestamp.</summary>
    public static string TimeAgo(string? iso)
    {
        if (string.IsNullOrWhiteSpace(iso)) return "never";
        if (!DateTimeOffset.TryParse(iso, out var t)) return iso;
        var d = DateTimeOffset.UtcNow - t.ToUniversalTime();
        if (d.TotalSeconds < 60) return "just now";
        if (d.TotalMinutes < 60) return $"{(int)d.TotalMinutes}m ago";
        if (d.TotalHours < 24) return $"{(int)d.TotalHours}h ago";
        if (d.TotalDays < 30) return $"{(int)d.TotalDays}d ago";
        return t.ToLocalTime().ToString("yyyy-MM-dd");
    }

    public static void CopyToClipboard(string text)
    {
        try
        {
            var pkg = new Windows.ApplicationModel.DataTransfer.DataPackage();
            pkg.SetText(text ?? "");
            Windows.ApplicationModel.DataTransfer.Clipboard.SetContent(pkg);
        }
        catch
        {
        }
    }
}
