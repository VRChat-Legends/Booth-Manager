using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace BoothManager.Services;

public sealed class Booth
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("name")] public string Name { get; set; } = "";
    [JsonPropertyName("description")] public string Description { get; set; } = "";
    [JsonPropertyName("logoUrl")] public string LogoUrl { get; set; } = "";
    [JsonPropertyName("publicUrl")] public string PublicUrl { get; set; } = "";
    [JsonPropertyName("groupId")] public string GroupId { get; set; } = "";
    [JsonPropertyName("avatarId")] public string AvatarId { get; set; } = "";
    [JsonPropertyName("worldIds")] public List<string> WorldIds { get; set; } = new();
    [JsonPropertyName("images")] public List<string> Images { get; set; } = new();
    [JsonPropertyName("assignedTo")] public List<string> AssignedTo { get; set; } = new();
    [JsonPropertyName("published")] public bool Published { get; set; }
    [JsonPropertyName("createdAt")] public string CreatedAt { get; set; } = "";
    [JsonPropertyName("updatedAt")] public string UpdatedAt { get; set; } = "";
    [JsonPropertyName("updatedBy")] public string UpdatedBy { get; set; } = "";
}

public sealed class DeviceLink
{
    [JsonPropertyName("discordId")] public string DiscordId { get; set; } = "";
    [JsonPropertyName("discordUsername")] public string DiscordUsername { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("teamRoles")] public List<string> TeamRoles { get; set; } = new();
    [JsonPropertyName("createdAt")] public string CreatedAt { get; set; } = "";
    [JsonPropertyName("lastSeenAt")] public string LastSeenAt { get; set; } = "";
}

public sealed class VerifyResponse
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("discordId")] public string DiscordId { get; set; } = "";
    [JsonPropertyName("username")] public string Username { get; set; } = "";
    [JsonPropertyName("avatarUrl")] public string AvatarUrl { get; set; } = "";
    [JsonPropertyName("role")] public string Role { get; set; } = "";
    [JsonPropertyName("teamRoles")] public List<string> TeamRoles { get; set; } = new();
}

public sealed class ApiResult<T>
{
    public T? Data { get; set; }
    public int Status { get; set; }
    public string Error { get; set; } = "";
    public bool Ok => Status >= 200 && Status < 300 && Data != null;
}

/// <summary>HTTP client for the Booth Manager API on vrchatlegends.com.</summary>
public static class ApiClient
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(25) };
    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private static string Base => AppConfig.Current.ApiBase.TrimEnd('/') + "/api/alley/booth-manager";

    private static HttpRequestMessage Req(HttpMethod method, string path, object? body = null)
    {
        var req = new HttpRequestMessage(method, Base + path);
        if (!string.IsNullOrEmpty(AppConfig.Current.Token))
            req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", AppConfig.Current.Token);
        if (body != null)
            req.Content = new StringContent(JsonSerializer.Serialize(body, JsonOpts), Encoding.UTF8, "application/json");
        return req;
    }

    private static async Task<ApiResult<T>> SendAsync<T>(HttpRequestMessage req)
    {
        var result = new ApiResult<T>();
        try
        {
            using var res = await Http.SendAsync(req);
            result.Status = (int)res.StatusCode;
            var text = await res.Content.ReadAsStringAsync();
            if (res.IsSuccessStatusCode)
            {
                result.Data = JsonSerializer.Deserialize<T>(text, JsonOpts);
            }
            else
            {
                try
                {
                    using var doc = JsonDocument.Parse(text);
                    result.Error = doc.RootElement.TryGetProperty("error", out var e) ? e.GetString() ?? "" : text;
                }
                catch
                {
                    result.Error = text;
                }
            }
        }
        catch (Exception ex)
        {
            result.Status = 0;
            result.Error = ex.Message;
        }
        return result;
    }

    public static Task<ApiResult<VerifyResponse>> VerifyAsync() =>
        SendAsync<VerifyResponse>(Req(HttpMethod.Get, "/verify"));

    public static Task<ApiResult<JsonElement>> LogoutAsync() =>
        SendAsync<JsonElement>(Req(HttpMethod.Post, "/logout"));

    private sealed class BoothsWrap
    {
        [JsonPropertyName("booths")] public List<Booth> Booths { get; set; } = new();
        [JsonPropertyName("role")] public string Role { get; set; } = "";
    }

    private sealed class BoothWrap
    {
        [JsonPropertyName("booth")] public Booth? Booth { get; set; }
    }

    private sealed class LinksWrap
    {
        [JsonPropertyName("links")] public List<DeviceLink> Links { get; set; } = new();
    }

    public static async Task<ApiResult<List<Booth>>> GetBoothsAsync()
    {
        var r = await SendAsync<BoothsWrap>(Req(HttpMethod.Get, "/booths"));
        return new ApiResult<List<Booth>> { Status = r.Status, Error = r.Error, Data = r.Data?.Booths };
    }

    public static async Task<ApiResult<Booth>> CreateBoothAsync(object body)
    {
        var r = await SendAsync<BoothWrap>(Req(HttpMethod.Post, "/booths", body));
        return new ApiResult<Booth> { Status = r.Status, Error = r.Error, Data = r.Data?.Booth };
    }

    public static async Task<ApiResult<Booth>> UpdateBoothAsync(string id, object patch)
    {
        var r = await SendAsync<BoothWrap>(Req(HttpMethod.Put, $"/booths/{Uri.EscapeDataString(id)}", patch));
        return new ApiResult<Booth> { Status = r.Status, Error = r.Error, Data = r.Data?.Booth };
    }

    public static Task<ApiResult<JsonElement>> DeleteBoothAsync(string id) =>
        SendAsync<JsonElement>(Req(HttpMethod.Delete, $"/booths/{Uri.EscapeDataString(id)}"));

    public static async Task<ApiResult<List<DeviceLink>>> GetLinksAsync()
    {
        var r = await SendAsync<LinksWrap>(Req(HttpMethod.Get, "/admin/links"));
        return new ApiResult<List<DeviceLink>> { Status = r.Status, Error = r.Error, Data = r.Data?.Links };
    }

    public static Task<ApiResult<JsonElement>> RevokeLinkAsync(string discordId) =>
        SendAsync<JsonElement>(Req(HttpMethod.Delete, $"/admin/links/{Uri.EscapeDataString(discordId)}"));
}
