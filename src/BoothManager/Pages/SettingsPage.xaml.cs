using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BoothManager.Pages;

public sealed partial class SettingsPage : Page
{
    private bool _loading = true;

    public SettingsPage()
    {
        InitializeComponent();
        MusicToggle.IsOn = AppConfig.Current.MusicEnabled;
        SfxToggle.IsOn = AppConfig.Current.SfxEnabled;
        ApiBox.Text = AppConfig.Current.ApiBase;
        VersionText.Text = $"Current version: {UpdateService.CurrentVersion}";
        AccountText.Text = $"Signed in as {Session.Username} ({(Session.IsAdmin ? "site admin" : "team member")})";
        _loading = false;
    }

    private void MusicToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_loading) return;
        AppConfig.Current.MusicEnabled = MusicToggle.IsOn;
        AppConfig.Save();
        AudioService.ApplyMusicSetting();
    }

    private void SfxToggle_Toggled(object sender, RoutedEventArgs e)
    {
        if (_loading) return;
        AppConfig.Current.SfxEnabled = SfxToggle.IsOn;
        AppConfig.Save();
    }

    private void SaveApiBtn_Click(object sender, RoutedEventArgs e)
    {
        var value = ApiBox.Text.Trim();
        if (!Uri.TryCreate(value, UriKind.Absolute, out var uri) || (uri.Scheme != "https" && uri.Scheme != "http"))
        {
            ApiBox.Text = AppConfig.Current.ApiBase;
            return;
        }
        AppConfig.Current.ApiBase = value.TrimEnd('/');
        AppConfig.Save();
        ApiBox.Text = AppConfig.Current.ApiBase;
    }

    private async void CheckBtn_Click(object sender, RoutedEventArgs e)
    {
        CheckBtn.IsEnabled = false;
        CheckBusy.IsActive = true;
        UpdateStatusText.Text = "Checking GitHub releases...";
        var info = await UpdateService.CheckAsync();
        CheckBusy.IsActive = false;
        CheckBtn.IsEnabled = true;
        if (info != null)
        {
            UpdateStatusText.Text = $"Update {info.Tag} is available. Use the banner at the top to install it.";
            App.Window?.ShowUpdate(info);
        }
        else
        {
            UpdateStatusText.Text = "You are up to date.";
        }
    }

    private void SignOutBtn_Click(object sender, RoutedEventArgs e) => App.Window?.SignOut();
}
