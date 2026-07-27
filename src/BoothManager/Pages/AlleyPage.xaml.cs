using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Pickers;

namespace BoothManager.Pages;

public sealed partial class AlleyPage : Page
{
    private AlleyMe? _me;
    private bool _busy;

    public AlleyPage()
    {
        InitializeComponent();
        Loaded += async (_, _) => await RefreshAsync();
    }

    // ------------------------------------------------------------------
    // connection
    // ------------------------------------------------------------------

    private async Task RefreshAsync()
    {
        if (!AlleyApi.IsConnected)
        {
            ShowDisconnected(null);
            return;
        }

        ConnRing.IsActive = true;
        var res = await AlleyApi.MeAsync();
        ConnRing.IsActive = false;

        if (res.Status == 401 || res.Status == 403)
        {
            Session.ClearAlley();
            ShowDisconnected("Your Alley session expired. Connect again.");
            return;
        }
        if (!res.Ok || res.Data == null)
        {
            ShowDisconnected(string.IsNullOrEmpty(res.Error) ? "Could not reach the Alley service." : res.Error);
            return;
        }

        _me = res.Data;
        EnterConnected();
        await Task.WhenAll(LoadCommunityTabAsync(), LoadStaffTabsAsync());
    }

    private void ShowDisconnected(string? error)
    {
        DisconnectedPanel.Visibility = Visibility.Visible;
        MainPivot.Visibility = Visibility.Collapsed;
        ConnectBtnText.Text = "Connect";
        ConnSubtitle.Text = "Connect to alley.vrchatlegends.com to manage your community, booth uploads, and events.";
        if (!string.IsNullOrEmpty(error))
        {
            ConnError.Text = error;
            ConnError.Visibility = Visibility.Visible;
        }
        else
        {
            ConnError.Visibility = Visibility.Collapsed;
        }
    }

    private void EnterConnected()
    {
        DisconnectedPanel.Visibility = Visibility.Collapsed;
        MainPivot.Visibility = Visibility.Visible;
        ConnectBtnText.Text = "Disconnect";

        bool staff = _me?.Staff == true;
        StaffAppsTab.Visibility = staff ? Visibility.Visible : Visibility.Collapsed;
        StaffCommunitiesTab.Visibility = staff ? Visibility.Visible : Visibility.Collapsed;
        StaffBoothsTab.Visibility = staff ? Visibility.Visible : Visibility.Collapsed;

        string who = _me?.Community != null ? _me.Community.Name : "no community";
        ConnSubtitle.Text = staff
            ? $"Connected as Alley staff ({who})"
            : $"Connected: {who} ({(_me?.Role ?? "member")})";
    }

    private async void ConnectBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;

        if (AlleyApi.IsConnected)
        {
            await AlleyApi.RevokeAsync();
            Session.ClearAlley();
            _me = null;
            ShowDisconnected(null);
            return;
        }

        _busy = true;
        ConnRing.IsActive = true;
        ConnError.Visibility = Visibility.Collapsed;

        var result = await AlleyApi.SignInAsync(TimeSpan.FromMinutes(3));

        _busy = false;
        ConnRing.IsActive = false;

        if (!result.Success)
        {
            ShowDisconnected(result.Error switch
            {
                "timeout" => "Sign in timed out. Try again.",
                _ => "Sign in failed: " + result.Error,
            });
            return;
        }

        Session.SetAlley(result.Token, result.Staff, result.Role, result.Community?.Name ?? "");
        AudioService.Success();
        await RefreshAsync();
    }

    private void OpenSiteBtn_Click(object sender, RoutedEventArgs e) =>
        Helpers.OpenUrl("https://vrchatlegends.com/alley");

    // ------------------------------------------------------------------
    // my community tab
    // ------------------------------------------------------------------

    private async Task LoadCommunityTabAsync()
    {
        var c = _me?.Community;
        if (c == null)
        {
            CommunityName.Text = "No community linked";
            CommunityMeta.Text = "Your Discord account does not own or manage an approved Alley community.";
            CommunityRole.Text = _me?.Staff == true ? "Alley staff" : "";
            CommDescBox.IsEnabled = CommInviteBox.IsEnabled = SaveCommunityBtn.IsEnabled = UploadLogoBtn.IsEnabled = SyncRolesBtn.IsEnabled = false;
            MyBoothsEmpty.Visibility = Visibility.Visible;
            await LoadEventsAsync();
            return;
        }

        CommunityName.Text = c.Name;
        CommunityMeta.Text = $"owner {c.OwnerUsername}" +
            (string.IsNullOrEmpty(c.ManagerUsername) ? "" : $"  |  booth manager {c.ManagerUsername}") +
            (string.IsNullOrEmpty(c.GroupId) ? "" : $"  |  {c.GroupId}");
        CommunityRole.Text = _me?.Staff == true ? "Alley staff" : (_me?.Role ?? "");
        CommunityLogo.DisplayName = c.Name;
        if (!string.IsNullOrEmpty(c.LogoUrl))
        {
            try { CommunityLogo.ProfilePicture = new BitmapImage(new Uri(FullUrl(c.LogoUrl))); } catch { }
        }

        CommDescBox.Text = c.Description ?? "";
        CommInviteBox.Text = c.InviteUrl ?? "";

        await Task.WhenAll(LoadMyBoothsAsync(), LoadEventsAsync());
    }

    private string FullUrl(string url) =>
        url.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? url : AlleyApi.Base + url;

    private async Task LoadMyBoothsAsync()
    {
        var res = await AlleyApi.MyBoothsAsync();
        MyBoothsList.Children.Clear();
        var booths = res.Data ?? new List<AlleyBooth>();
        MyBoothsCount.Text = booths.Count == 0 ? "" : $"{booths.Count} version{(booths.Count == 1 ? "" : "s")}";
        MyBoothsEmpty.Visibility = booths.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        foreach (var b in booths.OrderByDescending(x => x.Version))
        {
            MyBoothsList.Children.Add(BoothRow(b, staffView: false));
        }
    }

    private async Task LoadEventsAsync()
    {
        var res = await AlleyApi.EventsAsync();
        EventsList.Children.Clear();
        var events = res.Data ?? new List<AlleyEvent>();
        if (events.Count == 0)
        {
            EventsList.Children.Add(Muted("No events published."));
            return;
        }

        foreach (var ev in events)
        {
            var card = NewCard();
            var sp = new StackPanel { Spacing = 4 };
            var head = new Grid();
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            head.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            head.Children.Add(new TextBlock { Text = ev.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            var badge = new Border
            {
                Background = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(ev.AcceptingBooths ? (byte)0x33 : (byte)0x22, 0x00, 0xE6, 0xCC)),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(10, 3, 10, 3),
                Child = new TextBlock
                {
                    Text = ev.AcceptingBooths ? "ACCEPTING BOOTHS" : "CLOSED",
                    FontSize = 10,
                    FontWeight = Microsoft.UI.Text.FontWeights.Bold,
                    Foreground = (Brush)Application.Current.Resources[ev.AcceptingBooths ? "AlleyTealBrush" : "AlleyMutedBrush"],
                },
            };
            Grid.SetColumn(badge, 1);
            head.Children.Add(badge);
            sp.Children.Add(head);

            string deadline = FormatDate(ev.UploadDeadline);
            var metaParts = new List<string>();
            if (!string.IsNullOrEmpty(deadline)) metaParts.Add("upload deadline " + deadline);
            if (ev.Limits != null) metaParts.Add($"{ev.Limits.MaxTriangles:N0} tris | {ev.Limits.MaxBuildSizeMB} MB | {ev.Limits.MaxMaterialSlots} materials");
            if (metaParts.Count > 0) sp.Children.Add(Muted(string.Join("   ", metaParts)));

            card.Child = sp;
            EventsList.Children.Add(card);
        }
    }

    // ------------------------------------------------------------------
    // community actions
    // ------------------------------------------------------------------

    private async void SaveCommunityBtn_Click(object sender, RoutedEventArgs e)
    {
        var res = await AlleyApi.PatchMyCommunityAsync(new
        {
            description = CommDescBox.Text.Trim(),
            inviteUrl = CommInviteBox.Text.Trim(),
        });
        ShowCommunityStatus(res.Ok ? "Profile saved." : "Save failed: " + res.Error);
        if (res.Ok) AudioService.Success();
    }

    private async void UploadLogoBtn_Click(object sender, RoutedEventArgs e)
    {
        var picker = new FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".webp");
        var file = await picker.PickSingleFileAsync();
        if (file == null) return;

        byte[] bytes = File.ReadAllBytes(file.Path);
        if (bytes.Length > 2 * 1024 * 1024)
        {
            ShowCommunityStatus("Logo must be 2 MB or smaller.");
            return;
        }
        string ct = file.FileType.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "image/jpeg",
        };

        var res = await AlleyApi.UploadMyLogoAsync(bytes, ct);
        if (res.Ok && !string.IsNullOrEmpty(res.Data))
        {
            try { CommunityLogo.ProfilePicture = new BitmapImage(new Uri(FullUrl(res.Data))); } catch { }
            ShowCommunityStatus("Logo updated.");
            AudioService.Success();
        }
        else
        {
            ShowCommunityStatus("Upload failed: " + res.Error);
        }
    }

    private async void SyncRolesBtn_Click(object sender, RoutedEventArgs e)
    {
        var res = await AlleyApi.SyncDiscordRolesAsync();
        ShowCommunityStatus(res.Ok ? "Discord roles synced." : "Sync failed: " + res.Error);
    }

    private void ShowCommunityStatus(string text)
    {
        CommunityStatus.Text = text;
        CommunityStatus.Visibility = Visibility.Visible;
    }

    // ------------------------------------------------------------------
    // staff tabs
    // ------------------------------------------------------------------

    private async Task LoadStaffTabsAsync()
    {
        if (_me?.Staff != true) return;
        await Task.WhenAll(LoadApplicationsAsync(), LoadCommunitiesAsync(), LoadStaffBoothsAsync());
    }

    private string SelectedAppStatus =>
        (AppStatusCombo.SelectedItem as ComboBoxItem)?.Tag as string ?? "pending";

    private async void AppStatusCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (_me?.Staff == true) await LoadApplicationsAsync();
    }

    private async void RefreshAppsBtn_Click(object sender, RoutedEventArgs e) => await LoadApplicationsAsync();

    private async Task LoadApplicationsAsync()
    {
        var res = await AlleyApi.AdminApplicationsAsync(SelectedAppStatus);
        AppsList.Children.Clear();
        var apps = res.Data ?? new List<AlleyApplication>();
        if (apps.Count == 0)
        {
            AppsList.Children.Add(Muted(res.Ok ? "No applications with this status." : "Load failed: " + res.Error));
            return;
        }

        foreach (var app in apps)
        {
            var card = NewCard();
            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var pic = new PersonPicture { Width = 44, Height = 44, DisplayName = app.CommunityName };
            if (!string.IsNullOrEmpty(app.DiscordAvatar))
            {
                try { pic.ProfilePicture = new BitmapImage(new Uri(app.DiscordAvatar)); } catch { }
            }
            grid.Children.Add(pic);

            var mid = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            mid.Children.Add(new TextBlock { Text = app.CommunityName, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            mid.Children.Add(Muted($"{app.DiscordUsername}  |  {Helpers.TimeAgo(app.CreatedAt)}"));
            if (!string.IsNullOrEmpty(app.Description))
            {
                mid.Children.Add(new TextBlock
                {
                    Text = app.Description,
                    FontSize = 12,
                    TextWrapping = TextWrapping.Wrap,
                    MaxLines = 2,
                    Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
                });
            }
            Grid.SetColumn(mid, 1);
            grid.Children.Add(mid);

            if (SelectedAppStatus == "pending")
            {
                var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
                var approve = new Button { Content = "Approve", Style = (Style)Application.Current.Resources["AccentButtonStyle"], Tag = app.Id };
                approve.Click += async (s, _) => await ApproveAppAsync((string)((Button)s).Tag);
                var reject = new Button { Content = "Reject", Tag = app.Id };
                reject.Click += async (s, _) => await RejectAppAsync((string)((Button)s).Tag);
                actions.Children.Add(approve);
                actions.Children.Add(reject);
                Grid.SetColumn(actions, 2);
                grid.Children.Add(actions);
            }
            else if (!string.IsNullOrEmpty(app.ReviewNote) || !string.IsNullOrEmpty(app.ReviewedBy))
            {
                var note = Muted($"{app.Status} by {app.ReviewedBy}" + (string.IsNullOrEmpty(app.ReviewNote) ? "" : $": {app.ReviewNote}"));
                note.VerticalAlignment = VerticalAlignment.Center;
                Grid.SetColumn(note, 2);
                grid.Children.Add(note);
            }

            card.Child = grid;
            AppsList.Children.Add(card);
        }
    }

    private async Task ApproveAppAsync(string id)
    {
        var res = await AlleyApi.AdminApproveApplicationAsync(id);
        if (res.Ok) { AudioService.Success(); await LoadApplicationsAsync(); await LoadCommunitiesAsync(); }
    }

    private async Task RejectAppAsync(string id)
    {
        var noteBox = new TextBox { PlaceholderText = "Reason (sent to the applicant)", AcceptsReturn = true, Height = 80 };
        var dialog = new ContentDialog
        {
            Title = "Reject application",
            Content = noteBox,
            PrimaryButtonText = "Reject",
            CloseButtonText = "Cancel",
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var res = await AlleyApi.AdminRejectApplicationAsync(id, noteBox.Text.Trim());
        if (res.Ok) await LoadApplicationsAsync();
    }

    private async Task LoadCommunitiesAsync()
    {
        var res = await AlleyApi.AdminCommunitiesAsync();
        CommunitiesList.Children.Clear();
        var comms = res.Data ?? new List<AlleyCommunity>();
        if (comms.Count == 0)
        {
            CommunitiesList.Children.Add(Muted(res.Ok ? "No communities." : "Load failed: " + res.Error));
            return;
        }

        foreach (var c in comms)
        {
            var card = NewCard();
            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var pic = new PersonPicture { Width = 44, Height = 44, DisplayName = c.Name };
            if (!string.IsNullOrEmpty(c.LogoUrl))
            {
                try { pic.ProfilePicture = new BitmapImage(new Uri(FullUrl(c.LogoUrl))); } catch { }
            }
            grid.Children.Add(pic);

            var mid = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            mid.Children.Add(new TextBlock { Text = c.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            mid.Children.Add(Muted($"owner {c.OwnerUsername}" +
                (string.IsNullOrEmpty(c.ManagerUsername) ? "" : $"  |  manager {c.ManagerUsername}") +
                (c.LimitsBypass ? "  |  LIMITS BYPASS" : "")));
            Grid.SetColumn(mid, 1);
            grid.Children.Add(mid);

            var open = new Button { Content = new FontIcon { Glyph = "\uE774", FontSize = 13 }, Tag = c, VerticalAlignment = VerticalAlignment.Center };
            ToolTipService.SetToolTip(open, "Open admin page on the website");
            open.Click += (_, _) => Helpers.OpenUrl("https://vrchatlegends.com/alley/admin");
            Grid.SetColumn(open, 2);
            grid.Children.Add(open);

            card.Child = grid;
            CommunitiesList.Children.Add(card);
        }
    }

    private async Task LoadStaffBoothsAsync()
    {
        var res = await AlleyApi.AdminBoothsAsync();
        StaffBoothsList.Children.Clear();
        var booths = res.Data ?? new List<AlleyBooth>();
        if (booths.Count == 0)
        {
            StaffBoothsList.Children.Add(Muted(res.Ok ? "No booth uploads." : "Load failed: " + res.Error));
            return;
        }

        foreach (var b in booths.OrderByDescending(x => x.UploadedAt))
        {
            StaffBoothsList.Children.Add(BoothRow(b, staffView: true));
        }
    }

    // ------------------------------------------------------------------
    // shared UI helpers
    // ------------------------------------------------------------------

    private Border BoothRow(AlleyBooth b, bool staffView)
    {
        var card = NewCard();
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var icon = new FontIcon
        {
            Glyph = "\uE7B8",
            FontSize = 22,
            Foreground = (Brush)Application.Current.Resources[b.Status == "active" ? "AlleyTealBrush" : "AlleyMutedBrush"],
            VerticalAlignment = VerticalAlignment.Center,
        };
        grid.Children.Add(icon);

        var mid = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        string title = staffView && !string.IsNullOrEmpty(b.CommunityName)
            ? $"{b.CommunityName}  v{b.Version}"
            : (string.IsNullOrEmpty(b.PrefabName) ? $"Booth v{b.Version}" : $"{b.PrefabName}  v{b.Version}");
        mid.Children.Add(new TextBlock { Text = title, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });

        var meta = new List<string> { b.Status };
        if (b.FileSize > 0) meta.Add($"{b.FileSize / 1024.0 / 1024.0:0.0} MB");
        if (b.Stats != null) meta.Add($"{b.Stats.Triangles:N0} tris | {b.Stats.MaterialSlots} materials");
        if (!string.IsNullOrEmpty(b.UploadedAt)) meta.Add(Helpers.TimeAgo(b.UploadedAt));
        mid.Children.Add(Muted(string.Join("  |  ", meta)));
        Grid.SetColumn(mid, 1);
        grid.Children.Add(mid);

        if (staffView)
        {
            var dl = new Button { Content = new FontIcon { Glyph = "\uE896", FontSize = 13 }, Tag = b, VerticalAlignment = VerticalAlignment.Center };
            ToolTipService.SetToolTip(dl, "Download booth package");
            dl.Click += async (s, _) => await DownloadBoothAsync((AlleyBooth)((Button)s).Tag, (Button)s);
            Grid.SetColumn(dl, 2);
            grid.Children.Add(dl);
        }

        card.Child = grid;
        return card;
    }

    private async Task DownloadBoothAsync(AlleyBooth b, Button btn)
    {
        var picker = new FileSavePicker
        {
            SuggestedFileName = $"{(string.IsNullOrEmpty(b.CommunitySlug) ? b.Id : b.CommunitySlug)}-v{b.Version}",
        };
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        picker.FileTypeChoices.Add("Booth package", new List<string> { ".zip" });
        var file = await picker.PickSaveFileAsync();
        if (file == null) return;

        btn.IsEnabled = false;
        byte[]? data = await AlleyApi.AdminDownloadBoothAsync(b.Id);
        btn.IsEnabled = true;
        if (data == null) return;
        await File.WriteAllBytesAsync(file.Path, data);
        AudioService.Success();
    }

    private static Border NewCard() => new()
    {
        Background = (Brush)Application.Current.Resources["AlleyCardBrush"],
        BorderBrush = (Brush)Application.Current.Resources["AlleyCardBorderBrush"],
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(10),
        Padding = new Thickness(14, 10, 14, 10),
    };

    private static TextBlock Muted(string text) => new()
    {
        Text = text,
        FontSize = 12,
        Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
        TextWrapping = TextWrapping.Wrap,
    };

    private static string FormatDate(string iso)
    {
        if (string.IsNullOrEmpty(iso)) return "";
        return DateTimeOffset.TryParse(iso, out var dto) ? dto.LocalDateTime.ToString("MMM d, yyyy h:mm tt") : iso;
    }
}
