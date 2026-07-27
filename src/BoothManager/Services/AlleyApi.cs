using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BoothManager.Services;

// ------------------------------------------------------------------
// DTOs (mirror the Legends Alley SDK's AlleyModels.cs and the website
// frontend's alley.js client)
// ------------------------------------------------------------------

public class AlleyTeamMember
{
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("discordId")] public string DiscordId { get; set; } = "";
}

public class AlleyCommunity
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("inviteUrl")] public string InviteUrl { get; set; } = "";
    [JsonPropertyName("logoUrl")] public string LogoUrl { get; set; } = "";
    [JsonPropertyName("groupId")] public string GroupId { get; set; } = "";
    [JsonPropertyName("ownerDiscordId")] public string OwnerDiscordId { get; set; } = "";
    [JsonPropertyName("ownerUsername")] public string OwnerUsername { get; set; } = "";
    [JsonPropertyName("managerDiscordId")] public string ManagerDiscordId { get; set; } = "";
    [JsonPropertyName("managerUsername")] public string ManagerUsername { get; set; } = "";
    [JsonPropertyName("teamMembers")] public List<AlleyTeamMember> TeamMembers { get; set; } = new();
    [JsonPropertyName("limitsBypass")] public bool LimitsBypass { get; set; }
    [JsonPropertyName("active")] public bool Active { get; set; }
    [JsonPropertyName("published")] public bool Published { get; set; }
    [JsonPropertyName("socials")] public List<string> Socials { get; set; } = new();
}

public class AlleyEventLimits
{
    [JsonPropertyName("maxBoundsMeters")] public AlleyBounds? MaxBoundsMeters { get; set; }
    [JsonPropertyName("maxTriangles")] public int MaxTriangles { get; set; }
    [JsonPropertyName("maxBuildSizeMB")] public int MaxBuildSizeMB { get; set; }
    [JsonPropertyName("maxVramMB")] public int MaxVramMB { get; set; }
    [JsonPropertyName("maxMaterialSlots")] public int MaxMaterialSlots { get; set; }
    [JsonPropertyName("maxUniqueTextures")] public int MaxUniqueTextures { get; set; }
    [JsonPropertyName("maxTextureResolution")] public int MaxTextureResolution { get; set; }
    [JsonPropertyName("maxAndroidTextureResolution")] public int MaxAndroidTextureResolution { get; set; }
    [JsonPropertyName("maxStaticMeshes")] public int MaxStaticMeshes { get; set; }
    [JsonPropertyName("maxSkinnedMeshes")] public int MaxSkinnedMeshes { get; set; }
    [JsonPropertyName("maxParticleSystems")] public int MaxParticleSystems { get; set; }
    [JsonPropertyName("maxTotalParticles")] public int MaxTotalParticles { get; set; }
    [JsonPropertyName("maxAnimators")] public int MaxAnimators { get; set; }
    [JsonPropertyName("maxAnimationClips")] public int MaxAnimationClips { get; set; }
    [JsonPropertyName("maxUdonScripts")] public int MaxUdonScripts { get; set; }
    [JsonPropertyName("maxPickups")] public int MaxPickups { get; set; }
    [JsonPropertyName("maxAvatarPedestals")] public int MaxAvatarPedestals { get; set; }
    [JsonPropertyName("maxPortals")] public int MaxPortals { get; set; }
    [JsonPropertyName("maxTextComponents")] public int MaxTextComponents { get; set; }
    [JsonPropertyName("maxAudioSources")] public int MaxAudioSources { get; set; }
    [JsonPropertyName("maxAudioRangeMeters")] public double MaxAudioRangeMeters { get; set; }
    [JsonPropertyName("maxSlideshowImages")] public int MaxSlideshowImages { get; set; }
    [JsonPropertyName("maxVideoPlayers")] public int MaxVideoPlayers { get; set; }
    [JsonPropertyName("maxGroupButtons")] public int MaxGroupButtons { get; set; }
    [JsonPropertyName("maxEstimatedDrawCalls")] public int MaxEstimatedDrawCalls { get; set; }
    [JsonPropertyName("maxEstimatedSetPasses")] public int MaxEstimatedSetPasses { get; set; }
    [JsonPropertyName("maxNonBoxColliders")] public int MaxNonBoxColliders { get; set; }
    [JsonPropertyName("allowUdon")] public bool AllowUdon { get; set; }
    [JsonPropertyName("allowPickups")] public bool AllowPickups { get; set; }
    [JsonPropertyName("allowPedestals")] public bool AllowPedestals { get; set; }
    [JsonPropertyName("allowPortals")] public bool AllowPortals { get; set; }
}

public class AlleyBounds
{
    [JsonPropertyName("x")] public double X { get; set; }
    [JsonPropertyName("y")] public double Y { get; set; }
    [JsonPropertyName("z")] public double Z { get; set; }
}

public class AlleyEvent
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("slug")] public string Slug { get; set; } = "";
    [JsonPropertyName("startsAt")] public string StartsAt { get; set; } = "";
    [JsonPropertyName("endsAt")] public string EndsAt { get; set; } = "";
    [JsonPropertyName("uploadDeadline")] public string UploadDeadline { get; set; } = "";
    [JsonPropertyName("timezone")] public string Timezone { get; set; } = "";
    [JsonPropertyName("active")] public bool Active { get; set; }
    [JsonPropertyName("acceptingBooths")] public bool AcceptingBooths { get; set; }
    [JsonPropertyName("minSdkVersion")] public string MinSdkVersion { get; set; } = "";
    [JsonPropertyName("scheduleText")] public string ScheduleText { get; set; } = "";
    [JsonPropertyName("crewText")] public string CrewText { get; set; } = "";
    [JsonPropertyName("limits")] public AlleyEventLimits? Limits { get; set; }
}

public class AlleyBoothStats
{
    [JsonPropertyName("triangles")] public int Triangles { get; set; }
    [JsonPropertyName("materialSlots")] public int MaterialSlots { get; set; }
    [JsonPropertyName("uniqueTextures")] public int UniqueTextures { get; set; }
    [JsonPropertyName("buildSizeMB")] public double BuildSizeMB { get; set; }
    [JsonPropertyName("vramMB")] public double VramMB { get; set; }
    [JsonPropertyName("udonScripts")] public int UdonScripts { get; set; }
}

public class AlleyBooth
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("eventId")] public string EventId { get; set; } = "";
    [JsonPropertyName("communityId")] public string CommunityId { get; set; } = "";
    [JsonPropertyName("communityName")] public string CommunityName { get; set; } = "";
    [JsonPropertyName("communitySlug")] public string CommunitySlug { get; set; } = "";
    [JsonPropertyName("groupId")] public string GroupId { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("logoUrl")] public string LogoUrl { get; set; } = "";
    [JsonPropertyName("version")] public int Version { get; set; }
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("fileSize")] public long FileSize { get; set; }
    [JsonPropertyName("sha256")] public string Sha256 { get; set; } = "";
    [JsonPropertyName("prefabName")] public string PrefabName { get; set; } = "";
    [JsonPropertyName("shaders")] public List<string> Shaders { get; set; } = new();
    [JsonPropertyName("limitsBypassed")] public bool LimitsBypassed { get; set; }
    [JsonPropertyName("downloadUrl")] public string DownloadUrl { get; set; } = "";
    [JsonPropertyName("previewUrl")] public string PreviewUrl { get; set; } = "";
    [JsonPropertyName("uploadedAt")] public string UploadedAt { get; set; } = "";
    [JsonPropertyName("stats")] public AlleyBoothStats? Stats { get; set; }
}

public class AlleyApplication
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("communityName")] public string CommunityName { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("discordUsername")] public string DiscordUsername { get; set; } = "";
    [JsonPropertyName("discordUserId")] public string DiscordUserId { get; set; } = "";
    [JsonPropertyName("discordAvatar")] public string DiscordAvatar { get; set; } = "";
    [JsonPropertyName("groupId")] public string GroupId { get; set; } = "";
    [JsonPropertyName("inviteUrl")] public string InviteUrl { get; set; } = "";
    [JsonPropertyName("logoUrl")] public string LogoUrl { get; set; } = "";
    [JsonPropertyName("reason")] public string Reason { get; set; } = "";
    [JsonPropertyName("socials")] public List<string> Socials { get; set; } = new();
    [JsonPropertyName("status")] public string Status { get; set; } = "";
    [JsonPropertyName("reviewNote")] public string ReviewNote { get; set; } = "";
    [JsonPropertyName("reviewedBy")] public string ReviewedBy { get; set; } = "";
    [JsonPropertyName("reviewedAt")] public string ReviewedAt { get; set; } = "";
    [JsonPropertyName("createdAt")] public string CreatedAt { get; set; } = "";
}

public class AlleyMe
{
    [JsonPropertyName("community")] public AlleyCommunity? Community { get; set; }
    [JsonPropertyName("staff")] public bool Staff { get; set; }
    [JsonPropertyName("role")] public string Role { get; set; } = "";
}

public class AlleySignInResult
{
    public bool Success;
    public string Token = "";
    public AlleyCommunity? Community;
    public bool Staff;
    public string Role = "";
    public string Error = "";
}

// ------------------------------------------------------------------
// Client
// ------------------------------------------------------------------

/// <summary>
/// Client for the separate Legends Alley backend (alley.vrchatlegends.com).
/// Sign-in uses the same grant/exchange loopback protocol as the Unity SDK.
/// </summary>
public static class AlleyApi
{
    private static readonly HttpClient Http = CreateClient();
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static HttpClient CreateClient()
    {
        var c = new HttpClient { Timeout = TimeSpan.FromSeconds(40) };
        c.DefaultRequestHeaders.UserAgent.ParseAdd("BoothManager/1.0");
        return c;
    }

    public static string Base =>
        string.IsNullOrWhiteSpace(AppConfig.Current.AlleyApiBase)
            ? "https://alley.vrchatlegends.com"
            : AppConfig.Current.AlleyApiBase.TrimEnd('/');

    private static string Token => AppConfig.Current.AlleyToken ?? "";

    public static bool IsConnected => !string.IsNullOrEmpty(Token);
    public static bool IsStaff => AppConfig.Current.AlleyStaff;

    // ---------------- sign in (SDK loopback grant/exchange) ----------------

    public static async Task<AlleySignInResult> SignInAsync(TimeSpan timeout)
    {
        string verifier = RandomUrlSafe(48);
        string challenge = Sha256UrlSafe(verifier);

        var listener = new TcpListener(IPAddress.Loopback, 0);
        listener.Start();
        int port = ((IPEndPoint)listener.LocalEndpoint).Port;

        try
        {
            Helpers.OpenUrl($"{Base}/api/auth/sdk/start?port={port}&challenge={Uri.EscapeDataString(challenge)}");

            string grant;
            var grantTask = WaitForGrantAsync(listener);
            var done = await Task.WhenAny(grantTask, Task.Delay(timeout));
            if (done != grantTask) return new AlleySignInResult { Error = "timeout" };
            try
            {
                grant = await grantTask;
            }
            catch (Exception ex)
            {
                return new AlleySignInResult { Error = ex.Message };
            }

            var (status, body) = await SendAsync(HttpMethod.Post, "/api/auth/sdk/exchange",
                JsonSerializer.Serialize(new { grant, verifier }), null);
            if (status != 200) return new AlleySignInResult { Error = ExtractError(body, $"exchange failed ({status})") };

            var doc = JsonDocument.Parse(body);
            var root = doc.RootElement;
            var result = new AlleySignInResult
            {
                Success = true,
                Token = root.TryGetProperty("token", out var t) ? t.GetString() ?? "" : "",
                Staff = root.TryGetProperty("staff", out var s) && s.GetBoolean(),
                Role = root.TryGetProperty("role", out var r) ? r.GetString() ?? "" : "",
            };
            if (root.TryGetProperty("community", out var cEl) && cEl.ValueKind == JsonValueKind.Object)
            {
                result.Community = cEl.Deserialize<AlleyCommunity>(JsonOpts);
            }
            if (string.IsNullOrEmpty(result.Token))
            {
                return new AlleySignInResult { Error = "exchange returned no token" };
            }
            return result;
        }
        finally
        {
            try { listener.Stop(); } catch { }
        }
    }

    private static async Task<string> WaitForGrantAsync(TcpListener listener)
    {
        while (true)
        {
            using var client = await listener.AcceptTcpClientAsync();
            using var stream = client.GetStream();

            var buffer = new byte[4096];
            int read = await stream.ReadAsync(buffer);
            string text = read > 0 ? Encoding.ASCII.GetString(buffer, 0, read) : "";
            int lineEnd = text.IndexOf("\r\n", StringComparison.Ordinal);
            string requestLine = lineEnd > 0 ? text[..lineEnd] : text;
            var parts = requestLine.Split(' ');
            string? target = parts.Length >= 2 && parts[0] == "GET" ? parts[1] : null;

            if (target == null || !target.StartsWith("/callback"))
            {
                await RespondAsync(stream, "Legends Alley", "Nothing to see here.");
                continue;
            }

            string? grant = QueryValue(target, "grant");
            string? error = QueryValue(target, "error");

            if (!string.IsNullOrEmpty(error))
            {
                await RespondAsync(stream, "Sign in failed", error);
                throw new InvalidOperationException(error);
            }
            if (string.IsNullOrEmpty(grant))
            {
                await RespondAsync(stream, "Sign in failed", "The sign in response was missing its grant. Try again.");
                throw new InvalidOperationException("missing grant");
            }

            await RespondAsync(stream, "Connected", "You can close this tab and head back to Booth Manager.");
            return grant;
        }
    }

    private static string? QueryValue(string target, string key)
    {
        int q = target.IndexOf('?');
        if (q < 0) return null;
        foreach (string pair in target[(q + 1)..].Split('&'))
        {
            int eq = pair.IndexOf('=');
            if (eq <= 0) continue;
            if (pair[..eq] == key) return Uri.UnescapeDataString(pair[(eq + 1)..].Replace('+', ' '));
        }
        return null;
    }

    private static async Task RespondAsync(Stream stream, string title, string message)
    {
        string html =
            "<!doctype html><html><head><title>" + WebUtility.HtmlEncode(title) + "</title></head>" +
            "<body style=\"background:#080B10;color:#E8EDF2;font-family:'Segoe UI',sans-serif;display:grid;place-items:center;height:100vh;margin:0\">" +
            "<div style=\"text-align:center;padding:2.4rem 3rem;border:1px solid rgba(0,230,204,.3);border-radius:1rem;background:#12161D\">" +
            "<h2 style=\"color:#00E6CC;margin-top:0\">" + WebUtility.HtmlEncode(title) + "</h2>" +
            "<p style=\"color:#8B95A0\">" + WebUtility.HtmlEncode(message) + "</p></div></body></html>";
        byte[] body = Encoding.UTF8.GetBytes(html);
        string header = "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\n" +
                        $"Content-Length: {body.Length}\r\nConnection: close\r\n\r\n";
        byte[] headerBytes = Encoding.ASCII.GetBytes(header);
        await stream.WriteAsync(headerBytes);
        await stream.WriteAsync(body);
        await stream.FlushAsync();
    }

    private static string RandomUrlSafe(int bytes)
    {
        var data = new byte[bytes];
        RandomNumberGenerator.Fill(data);
        return Base64Url(data);
    }

    private static string Sha256UrlSafe(string value)
    {
        return Base64Url(SHA256.HashData(Encoding.ASCII.GetBytes(value)));
    }

    private static string Base64Url(byte[] data)
    {
        return Convert.ToBase64String(data).TrimEnd('=').Replace('+', '-').Replace('/', '_');
    }

    // ---------------- generic plumbing ----------------

    private static async Task<(int status, string body)> SendAsync(HttpMethod method, string path, string? jsonBody, string? token)
    {
        try
        {
            using var req = new HttpRequestMessage(method, Base + path);
            if (!string.IsNullOrEmpty(token)) req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
            if (jsonBody != null) req.Content = new StringContent(jsonBody, Encoding.UTF8, "application/json");
            using var res = await Http.SendAsync(req);
            string body = await res.Content.ReadAsStringAsync();
            return ((int)res.StatusCode, body);
        }
        catch (Exception ex)
        {
            return (0, ex.Message);
        }
    }

    private static string ExtractError(string body, string fallback)
    {
        try
        {
            var doc = JsonDocument.Parse(body);
            if (doc.RootElement.TryGetProperty("error", out var e) && e.ValueKind == JsonValueKind.String)
            {
                return e.GetString() ?? fallback;
            }
        }
        catch { }
        return fallback;
    }

    private static async Task<ApiResult<T>> GetJson<T>(string path, Func<JsonElement, T?> pick)
    {
        var (status, body) = await SendAsync(HttpMethod.Get, path, null, Token);
        if (status != 200) return new ApiResult<T> { Status = status, Error = ExtractError(body, $"HTTP {status}") };
        try
        {
            using var doc = JsonDocument.Parse(body);
            return new ApiResult<T> { Status = 200, Data = pick(doc.RootElement) };
        }
        catch (Exception ex)
        {
            return new ApiResult<T> { Status = status, Error = "parse: " + ex.Message };
        }
    }

    private static async Task<ApiResult<bool>> SendOk(HttpMethod method, string path, object? body)
    {
        var (status, resBody) = await SendAsync(method, path, body == null ? null : JsonSerializer.Serialize(body, JsonOpts), Token);
        return new ApiResult<bool> { Status = status, Data = status >= 200 && status < 300, Error = status >= 300 ? ExtractError(resBody, $"HTTP {status}") : "" };
    }

    private static List<T> DeserializeList<T>(JsonElement root, string prop)
    {
        if (root.TryGetProperty(prop, out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            return arr.Deserialize<List<T>>(JsonOpts) ?? new List<T>();
        }
        if (root.ValueKind == JsonValueKind.Array)
        {
            return root.Deserialize<List<T>>(JsonOpts) ?? new List<T>();
        }
        return new List<T>();
    }

    // ---------------- session ----------------

    public static Task<ApiResult<AlleyMe>> MeAsync() =>
        GetJson("/api/auth/me", root => root.Deserialize<AlleyMe>(JsonOpts));

    public static async Task RevokeAsync()
    {
        if (!IsConnected) return;
        await SendOk(HttpMethod.Post, "/api/auth/revoke", null);
    }

    // ---------------- community (owner/manager) ----------------

    public static Task<ApiResult<List<AlleyBooth>>> MyBoothsAsync() =>
        GetJson("/api/booths/mine", root => DeserializeList<AlleyBooth>(root, "booths"));

    public static Task<ApiResult<List<AlleyEvent>>> EventsAsync() =>
        GetJson("/api/events", root => DeserializeList<AlleyEvent>(root, "events"));

    public static Task<ApiResult<bool>> PatchMyCommunityAsync(object patch) =>
        SendOk(HttpMethod.Patch, "/api/communities/mine", patch);

    public static async Task<ApiResult<string>> UploadMyLogoAsync(byte[] bytes, string contentType)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Put, Base + "/api/communities/mine/logo");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            req.Content = new ByteArrayContent(bytes);
            req.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            using var res = await Http.SendAsync(req);
            string body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                return new ApiResult<string> { Status = (int)res.StatusCode, Error = ExtractError(body, $"HTTP {(int)res.StatusCode}") };
            }
            using var doc = JsonDocument.Parse(body);
            string url = doc.RootElement.TryGetProperty("logoUrl", out var u) ? u.GetString() ?? "" : "";
            return new ApiResult<string> { Status = 200, Data = url };
        }
        catch (Exception ex)
        {
            return new ApiResult<string> { Status = 0, Error = ex.Message };
        }
    }

    public static Task<ApiResult<bool>> SetManagerAsync(string discordId) =>
        SendOk(HttpMethod.Put, "/api/communities/mine/manager", new { discordId });

    public static Task<ApiResult<bool>> RemoveManagerAsync() =>
        SendOk(HttpMethod.Delete, "/api/communities/mine/manager", null);

    public static Task<ApiResult<bool>> SyncDiscordRolesAsync() =>
        SendOk(HttpMethod.Post, "/api/communities/mine/sync-roles", null);

    public static async Task<byte[]?> GetBytesAsync(string path)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, Base + path);
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            using var res = await Http.SendAsync(req);
            if (!res.IsSuccessStatusCode) return null;
            return await res.Content.ReadAsByteArrayAsync();
        }
        catch
        {
            return null;
        }
    }

    // ---------------- staff admin ----------------

    public static Task<ApiResult<List<AlleyApplication>>> AdminApplicationsAsync(string status) =>
        GetJson($"/api/admin/applications?status={Uri.EscapeDataString(status)}",
            root => DeserializeList<AlleyApplication>(root, "applications"));

    public static Task<ApiResult<bool>> AdminApproveApplicationAsync(string id) =>
        SendOk(HttpMethod.Post, $"/api/admin/applications/{Uri.EscapeDataString(id)}/approve", null);

    public static Task<ApiResult<bool>> AdminRejectApplicationAsync(string id, string note) =>
        SendOk(HttpMethod.Post, $"/api/admin/applications/{Uri.EscapeDataString(id)}/reject", new { note });

    public static Task<ApiResult<List<AlleyCommunity>>> AdminCommunitiesAsync() =>
        GetJson("/api/admin/communities", root => DeserializeList<AlleyCommunity>(root, "communities"));

    public static Task<ApiResult<bool>> AdminPatchCommunityAsync(string id, object patch) =>
        SendOk(HttpMethod.Patch, $"/api/admin/communities/{Uri.EscapeDataString(id)}", patch);

    public static Task<ApiResult<List<AlleyBooth>>> AdminBoothsAsync() =>
        GetJson("/api/admin/booths", root => DeserializeList<AlleyBooth>(root, "booths"));

    public static Task<byte[]?> AdminDownloadBoothAsync(string id) =>
        GetBytesAsync($"/api/admin/booths/{Uri.EscapeDataString(id)}/download");

    public static Task<ApiResult<bool>> CreateEventAsync(object body) =>
        SendOk(HttpMethod.Post, "/api/events", body);

    public static Task<ApiResult<bool>> PatchEventAsync(string id, object patch) =>
        SendOk(HttpMethod.Patch, $"/api/events/{Uri.EscapeDataString(id)}", patch);

    public static Task<ApiResult<bool>> DeleteEventAsync(string id, bool deleteBooths) =>
        SendOk(HttpMethod.Delete, $"/api/events/{Uri.EscapeDataString(id)}?deleteBooths={(deleteBooths ? "true" : "false")}", null);

    public static Task<ApiResult<AlleyEventLimits>> DefaultLimitsAsync() =>
        GetJson("/api/events/defaults/limits", root =>
            root.TryGetProperty("limits", out var l) ? l.Deserialize<AlleyEventLimits>(JsonOpts) : root.Deserialize<AlleyEventLimits>(JsonOpts));

    public static async Task<ApiResult<string>> AdminUploadCommunityLogoAsync(string id, byte[] bytes, string contentType)
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Put, Base + $"/api/admin/communities/{Uri.EscapeDataString(id)}/logo");
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", Token);
            req.Content = new ByteArrayContent(bytes);
            req.Content.Headers.ContentType = new MediaTypeHeaderValue(contentType);
            using var res = await Http.SendAsync(req);
            string body = await res.Content.ReadAsStringAsync();
            if (!res.IsSuccessStatusCode)
            {
                return new ApiResult<string> { Status = (int)res.StatusCode, Error = ExtractError(body, $"HTTP {(int)res.StatusCode}") };
            }
            using var doc = JsonDocument.Parse(body);
            return new ApiResult<string> { Status = 200, Data = doc.RootElement.TryGetProperty("logoUrl", out var u) ? u.GetString() ?? "" : "" };
        }
        catch (Exception ex)
        {
            return new ApiResult<string> { Status = 0, Error = ex.Message };
        }
    }
}
