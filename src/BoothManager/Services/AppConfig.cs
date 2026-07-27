using System.Text.Json;

namespace BoothManager.Services;

/// <summary>Persisted app settings + session, stored in %LocalAppData%\BoothManager.</summary>
public sealed class AppConfig
{
    public string ApiBase { get; set; } = "https://api.vrchatlegends.com";
    public string Token { get; set; } = "";
    public string Role { get; set; } = "";
    public string Username { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public string DiscordId { get; set; } = "";
    public bool MusicEnabled { get; set; } = true;
    public bool SfxEnabled { get; set; } = true;

    public static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BoothManager");

    private static string FilePath => Path.Combine(Dir, "settings.json");

    public static AppConfig Current { get; private set; } = new();

    public static void Load()
    {
        try
        {
            if (File.Exists(FilePath))
                Current = JsonSerializer.Deserialize<AppConfig>(File.ReadAllText(FilePath)) ?? new AppConfig();
        }
        catch
        {
            Current = new AppConfig();
        }
    }

    public static void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(Current, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Non-fatal: settings just will not persist.
        }
    }
}

/// <summary>Convenience view over the current signed-in session.</summary>
public static class Session
{
    public static bool IsLoggedIn => !string.IsNullOrEmpty(AppConfig.Current.Token);
    public static bool IsAdmin => AppConfig.Current.Role == "admin";
    public static string Username => AppConfig.Current.Username;
    public static string Role => AppConfig.Current.Role;
    public static string AvatarUrl => AppConfig.Current.AvatarUrl;
    public static string DiscordId => AppConfig.Current.DiscordId;

    public static void Set(string token, string role, string username, string avatarUrl, string discordId)
    {
        AppConfig.Current.Token = token;
        AppConfig.Current.Role = role;
        AppConfig.Current.Username = username;
        AppConfig.Current.AvatarUrl = avatarUrl;
        AppConfig.Current.DiscordId = discordId;
        AppConfig.Save();
    }

    public static void Clear()
    {
        AppConfig.Current.Token = "";
        AppConfig.Current.Role = "";
        AppConfig.Save();
    }
}
