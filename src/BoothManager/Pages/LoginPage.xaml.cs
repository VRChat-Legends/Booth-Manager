using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Navigation;

namespace BoothManager.Pages;

public sealed partial class LoginPage : Page
{
    public LoginPage()
    {
        InitializeComponent();
    }

    protected override void OnNavigatedTo(NavigationEventArgs e)
    {
        base.OnNavigatedTo(e);
        if (e.Parameter is string message && !string.IsNullOrEmpty(message))
        {
            if (message == "blocked")
                ShowBlocked();
            else
                ShowError("Heads up", message, InfoBarSeverity.Warning);
        }
    }

    private void ShowBlocked()
    {
        ShowError(
            "Access blocked",
            "This Discord account does not have Booth Manager access. Only VRChat Legends site admins and team members can sign in. Ask an admin on Discord if you think this is a mistake.",
            InfoBarSeverity.Error);
    }

    private void ShowError(string title, string message, InfoBarSeverity severity)
    {
        ErrorBar.Title = title;
        ErrorBar.Message = message;
        ErrorBar.Severity = severity;
        ErrorBar.IsOpen = true;
    }

    private async void LoginBtn_Click(object sender, RoutedEventArgs e)
    {
        LoginBtn.IsEnabled = false;
        WaitPanel.Visibility = Visibility.Visible;
        ErrorBar.IsOpen = false;

        var result = await AuthService.LoginAsync(TimeSpan.FromMinutes(5));

        WaitPanel.Visibility = Visibility.Collapsed;
        LoginBtn.IsEnabled = true;

        if (result.Success)
        {
            App.Window?.CompleteLogin(result);
            return;
        }

        switch (result.Error)
        {
            case "no_permission":
                ShowBlocked();
                break;
            case "denied":
                ShowError("Sign-in cancelled", "You cancelled the sign-in inside Discord.", InfoBarSeverity.Warning);
                break;
            case "timeout":
                ShowError("Timed out", "The sign-in took too long. Try again.", InfoBarSeverity.Warning);
                break;
            default:
                var detail = string.IsNullOrEmpty(result.ErrorDetail) ? "" : $" ({result.ErrorDetail})";
                ShowError("Sign-in failed", $"Something went wrong: {result.Error}{detail}. Try again.", InfoBarSeverity.Error);
                break;
        }
    }
}
