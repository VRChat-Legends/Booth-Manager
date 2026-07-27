using BoothManager.Pages;
using BoothManager.Services;
using Microsoft.UI.Composition.SystemBackdrops;
using Microsoft.UI.Dispatching;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;

namespace BoothManager;

public sealed partial class MainWindow : Window
{
    private UpdateInfo? _pendingUpdate;
    private DispatcherQueueTimer? _updateTimer;

    public MainWindow()
    {
        InitializeComponent();
        Title = "Booth Manager";
        SystemBackdrop = new MicaBackdrop { Kind = MicaKind.BaseAlt };
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(TitleBarArea);
        try
        {
            AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "app-icon.ico"));
            AppWindow.Resize(new Windows.Graphics.SizeInt32(1320, 860));
        }
        catch
        {
        }

        // Soft UI click for every press anywhere in the app.
        Root.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => AudioService.Click()), true);

        _ = StartupAsync();
    }

    private async Task StartupAsync()
    {
        AppConfig.Load();
        _ = AudioService.InitAsync();

        if (Session.IsLoggedIn)
        {
            var v = await ApiClient.VerifyAsync();
            if (v.Ok && v.Data != null)
            {
                Session.Set(AppConfig.Current.Token, v.Data.Role, v.Data.Username, v.Data.AvatarUrl, v.Data.DiscordId);
                EnterShell();
            }
            else if (v.Status == 403)
            {
                Session.Clear();
                ShowLogin("blocked");
            }
            else if (v.Status == 401)
            {
                Session.Clear();
                ShowLogin("Your session expired. Sign in again.");
            }
            else
            {
                ShowLogin("Could not reach vrchatlegends.com. Check your connection, then sign in.");
            }
        }
        else
        {
            ShowLogin(null);
        }

        // Update check on open + every 30 minutes while running.
        await CheckForUpdatesAsync();
        _updateTimer = DispatcherQueue.CreateTimer();
        _updateTimer.Interval = TimeSpan.FromMinutes(30);
        _updateTimer.Tick += async (_, _) => await CheckForUpdatesAsync();
        _updateTimer.Start();
    }

    private async Task CheckForUpdatesAsync()
    {
        var info = await UpdateService.CheckAsync();
        if (info != null) ShowUpdate(info);
    }

    public void ShowUpdate(UpdateInfo info)
    {
        _pendingUpdate = info;
        UpdateBar.Title = $"Update {info.Tag} is ready";
        UpdateBar.Message = "A new version of Booth Manager is available on GitHub. Install it now and the app will restart.";
        UpdateBar.IsOpen = true;
    }

    private async void UpdateNowBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_pendingUpdate == null) return;
        UpdateNowBtn.IsEnabled = false;
        UpdateBar.Message = "Downloading the update...";
        bool launched = await UpdateService.ApplyAsync(_pendingUpdate);
        if (launched)
        {
            Application.Current.Exit();
        }
        else
        {
            UpdateBar.Message = "Could not auto-install. The release page was opened in your browser instead.";
            UpdateNowBtn.IsEnabled = true;
        }
    }

    /* ── auth flow ── */

    public void ShowLogin(string? message)
    {
        UserChip.Visibility = Visibility.Collapsed;
        NavView.IsPaneVisible = false;
        ContentFrame.Navigate(typeof(LoginPage), message);
    }

    public async void CompleteLogin(LoginResult r)
    {
        Session.Set(r.Token, r.Role, r.Username, r.AvatarUrl, "");
        var v = await ApiClient.VerifyAsync();
        if (v.Ok && v.Data != null)
            Session.Set(r.Token, v.Data.Role, v.Data.Username, v.Data.AvatarUrl, v.Data.DiscordId);
        AudioService.Success();
        EnterShell();
    }

    public void SignOut()
    {
        _ = ApiClient.LogoutAsync();
        Session.Clear();
        ShowLogin(null);
    }

    private void EnterShell()
    {
        UserNameText.Text = Session.Username;
        RoleBadgeText.Text = Session.IsAdmin ? "ADMIN" : "TEAM";
        RoleBadge.Background = new SolidColorBrush(Session.IsAdmin
            ? Windows.UI.Color.FromArgb(0x33, 0x00, 0xE6, 0xCC)
            : Windows.UI.Color.FromArgb(0x33, 0x8B, 0x95, 0xA0));
        RoleBadgeText.Foreground = new SolidColorBrush(Session.IsAdmin
            ? Windows.UI.Color.FromArgb(0xFF, 0x00, 0xE6, 0xCC)
            : Windows.UI.Color.FromArgb(0xFF, 0xB8, 0xC2, 0xCC));
        if (!string.IsNullOrEmpty(Session.AvatarUrl))
        {
            try { UserAvatar.ProfilePicture = new BitmapImage(new Uri(Session.AvatarUrl)); } catch { }
        }
        UserAvatar.DisplayName = Session.Username;
        UserChip.Visibility = Visibility.Visible;

        NavAdmin.Visibility = Session.IsAdmin ? Visibility.Visible : Visibility.Collapsed;
        NavView.IsPaneVisible = true;
        NavView.SelectedItem = NavDashboard;
    }

    /* ── navigation ── */

    public void NavigateTo(string tag)
    {
        foreach (var obj in NavView.MenuItems.Concat(NavView.FooterMenuItems))
        {
            if (obj is NavigationViewItem item && (string?)item.Tag == tag)
            {
                NavView.SelectedItem = item;
                return;
            }
        }
    }

    private void NavView_SelectionChanged(NavigationView sender, NavigationViewSelectionChangedEventArgs args)
    {
        if (args.SelectedItem is not NavigationViewItem item) return;
        Type? target = (string?)item.Tag switch
        {
            "dashboard" => typeof(DashboardPage),
            "booths" => typeof(BoothsPage),
            "alley" => typeof(AlleyPage),
            "builder" => typeof(BoothBuilderPage),
            "standee" => typeof(StandeePage),
            "atlas" => typeof(AtlasPage),
            "admin" => typeof(AdminPage),
            "settings" => typeof(SettingsPage),
            _ => null,
        };
        if (target != null && ContentFrame.CurrentSourcePageType != target)
            ContentFrame.Navigate(target);
    }
}
