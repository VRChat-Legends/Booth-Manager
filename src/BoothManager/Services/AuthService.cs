using System.Net;
using System.Net.Sockets;
using System.Text;

namespace BoothManager.Services;

public sealed class LoginResult
{
    public bool Success { get; set; }
    public string Token { get; set; } = "";
    public string Role { get; set; } = "";
    public string Username { get; set; } = "";
    public string AvatarUrl { get; set; } = "";
    public string Error { get; set; } = "";
    public string ErrorDetail { get; set; } = "";
}

/// <summary>
/// Discord sign-in through vrchatlegends.com using a loopback redirect:
/// the app opens the browser to the site's OAuth start URL, and the site
/// redirects back to a local HTTP listener with a bm_ device token
/// (or bm_error=no_permission when the account is not allowed).
/// </summary>
public static class AuthService
{
    private static int GetFreePort()
    {
        var l = new TcpListener(IPAddress.Loopback, 0);
        l.Start();
        int port = ((IPEndPoint)l.LocalEndpoint).Port;
        l.Stop();
        return port;
    }

    public static async Task<LoginResult> LoginAsync(TimeSpan timeout)
    {
        var result = new LoginResult();
        HttpListener? listener = null;
        try
        {
            int port = GetFreePort();
            listener = new HttpListener();
            listener.Prefixes.Add($"http://127.0.0.1:{port}/");
            listener.Start();

            string redirect = $"http://127.0.0.1:{port}/callback";
            string startUrl = $"{AppConfig.Current.ApiBase.TrimEnd('/')}/api/alley/booth-manager/oauth/discord/start" +
                              $"?redirect_uri={Uri.EscapeDataString(redirect)}";
            Helpers.OpenUrl(startUrl);

            var ctxTask = listener.GetContextAsync();
            var finished = await Task.WhenAny(ctxTask, Task.Delay(timeout));
            if (finished != ctxTask)
            {
                result.Error = "timeout";
                return result;
            }

            var ctx = await ctxTask;
            var q = ctx.Request.QueryString;
            string token = q["bm_token"] ?? "";
            string error = q["bm_error"] ?? "";

            if (!string.IsNullOrEmpty(token))
            {
                result.Success = true;
                result.Token = token;
                result.Role = q["role"] ?? "";
                result.Username = q["username"] ?? "";
                result.AvatarUrl = q["avatar"] ?? "";
            }
            else
            {
                result.Error = string.IsNullOrEmpty(error) ? "unknown" : error;
                result.ErrorDetail = q["bm_error_detail"] ?? "";
            }

            string title = result.Success ? "Signed in" : "Sign-in failed";
            string message = result.Success
                ? "You are signed in. You can close this tab and return to Booth Manager."
                : $"Sign-in failed ({result.Error}). Close this tab and try again in Booth Manager.";
            string html =
                "<!doctype html><html><head><meta charset=\"utf-8\"><title>Booth Manager</title></head>" +
                "<body style=\"background:#080b10;color:#e7ecf2;font-family:Segoe UI,sans-serif;display:flex;" +
                "align-items:center;justify-content:center;height:100vh;margin:0\">" +
                "<div style=\"text-align:center\">" +
                $"<h1 style=\"color:#00e6cc;margin-bottom:8px\">{title}</h1>" +
                $"<p style=\"color:#8b95a0\">{message}</p>" +
                "</div></body></html>";
            byte[] buf = Encoding.UTF8.GetBytes(html);
            ctx.Response.ContentType = "text/html; charset=utf-8";
            ctx.Response.ContentLength64 = buf.Length;
            await ctx.Response.OutputStream.WriteAsync(buf);
            ctx.Response.Close();
        }
        catch (Exception ex)
        {
            result.Success = false;
            result.Error = "exception";
            result.ErrorDetail = ex.Message;
        }
        finally
        {
            try { listener?.Stop(); } catch { }
        }
        return result;
    }
}
