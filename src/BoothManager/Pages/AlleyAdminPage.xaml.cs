using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Pickers;

namespace BoothManager.Pages;

/// <summary>Mirror of vrchatlegends.com/alley/admin: Applications, Communities, Events, Booths.</summary>
public sealed partial class AlleyAdminPage : Page
{
    private AlleyMe? _me;
    private bool _busy;
    private int _tab;
    private string _appStatus = "pending";
    private List<AlleyApplication> _apps = new();
    private List<AlleyCommunity> _comms = new();
    private List<AlleyEvent> _events = new();
    private List<AlleyBooth> _booths = new();
    private string _commSearch = "";
    private string _boothSearch = "";

    public AlleyAdminPage()
    {
        InitializeComponent();
        Anim.Entrance(AppsTab);
        Anim.Entrance(CommsTab);
        Anim.Entrance(EventsTab);
        Anim.Entrance(BoothsTab);
        Loaded += async (_, _) => await RefreshAsync();
    }

    // ------------------------------------------------------------ gate

    private async Task RefreshAsync()
    {
        if (!AlleyApi.IsConnected)
        {
            ShowGate(null, needSignIn: true);
            return;
        }

        GateRing.IsActive = true;
        var res = await AlleyApi.MeAsync();
        GateRing.IsActive = false;

        if (res.Status == 401 || res.Status == 403)
        {
            Session.ClearAlley();
            ShowGate("Your Alley session expired. Sign in again.", needSignIn: true);
            return;
        }
        if (!res.Ok || res.Data == null)
        {
            ShowGate(string.IsNullOrEmpty(res.Error) ? "Could not reach the Alley service." : res.Error, needSignIn: true);
            return;
        }

        _me = res.Data;
        if (!_me.Staff)
        {
            GateTitle.Text = "Staff only";
            GateText.Text = "This console needs an Alley staff account. You are signed in, but this account is not staff.";
            GateConnectBtn.Visibility = Visibility.Collapsed;
            ShowGate(null, needSignIn: false);
            return;
        }

        GatePanel.Visibility = Visibility.Collapsed;
        ContentRoot.Visibility = Visibility.Visible;
        StatsRow.Visibility = Visibility.Visible;
        Subtitle.Text = "Signed in as Alley staff.";
        App.Window?.UpdateAlleyNav();

        await LoadAllAsync();
    }

    private void ShowGate(string? error, bool needSignIn)
    {
        GatePanel.Visibility = Visibility.Visible;
        ContentRoot.Visibility = Visibility.Collapsed;
        StatsRow.Visibility = Visibility.Collapsed;
        GateConnectBtn.Visibility = needSignIn ? Visibility.Visible : Visibility.Collapsed;
        if (!string.IsNullOrEmpty(error))
        {
            GateError.Text = error;
            GateError.Visibility = Visibility.Visible;
        }
        else
        {
            GateError.Visibility = Visibility.Collapsed;
        }
    }

    private async void GateConnectBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        _busy = true;
        GateRing.IsActive = true;
        GateError.Visibility = Visibility.Collapsed;
        var result = await AlleyApi.SignInAsync(TimeSpan.FromMinutes(3));
        _busy = false;
        GateRing.IsActive = false;
        if (!result.Success)
        {
            ShowGate(result.Error == "timeout" ? "Sign in timed out. Try again." : "Sign in failed: " + result.Error, needSignIn: true);
            return;
        }
        Session.SetAlley(result.Token, result.Staff, result.Role, result.Community?.Name ?? "");
        AudioService.Success();
        await RefreshAsync();
    }

    private void OpenWebBtn_Click(object sender, RoutedEventArgs e) =>
        Helpers.OpenUrl("https://vrchatlegends.com/alley/admin");

    private async void RefreshBtn_Click(object sender, RoutedEventArgs e) => await RefreshAsync();

    // ------------------------------------------------------------ data

    private async Task LoadAllAsync()
    {
        var appsTask = AlleyApi.AdminApplicationsAsync(_appStatus);
        var commsTask = AlleyApi.AdminCommunitiesAsync();
        var eventsTask = AlleyApi.EventsAsync();
        var boothsTask = AlleyApi.AdminBoothsAsync();
        await Task.WhenAll(appsTask, commsTask, eventsTask, boothsTask);
        _apps = appsTask.Result.Data ?? new List<AlleyApplication>();
        _comms = commsTask.Result.Data ?? new List<AlleyCommunity>();
        _events = eventsTask.Result.Data ?? new List<AlleyEvent>();
        _booths = boothsTask.Result.Data ?? new List<AlleyBooth>();

        BuildStats();
        BuildApps();
        BuildComms();
        BuildEvents();
        BuildBooths();
        SelectTab(_tab);
    }

    private void BuildStats()
    {
        StatSlot0.Children.Clear();
        StatSlot1.Children.Clear();
        StatSlot2.Children.Clear();

        int pending = _appStatus == "pending" ? _apps.Count : _apps.Count(a => a.Status == "pending");
        var s0 = AlleyUi.StatTile("\uE715", "Pending applications", out var v0);
        v0.Text = pending.ToString();
        v0.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFC, 0xD3, 0x4D));
        StatSlot0.Children.Add(s0);

        var s1 = AlleyUi.StatTile("\uE716", "Active communities", out var v1);
        v1.Text = _comms.Count(x => x.Active).ToString();
        StatSlot1.Children.Add(s1);

        var s2 = AlleyUi.StatTile("\uE7B8", "Active booths", out var v2);
        v2.Text = _booths.Count(x => x.Status == "active").ToString();
        v2.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x34, 0xD3, 0x99));
        StatSlot2.Children.Add(s2);

        if (pending > 0)
        {
            PendingBadge.Visibility = Visibility.Visible;
            PendingBadgeText.Text = pending.ToString();
        }
        else
        {
            PendingBadge.Visibility = Visibility.Collapsed;
        }
    }

    // ------------------------------------------------------------ tabs

    private void Tab_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.Tag is string t && int.TryParse(t, out int idx)) SelectTab(idx);
    }

    private void SelectTab(int idx)
    {
        _tab = idx;
        var tabs = new[] { AppsTab, CommsTab, EventsTab, BoothsTab };
        var btns = new[] { TabAppsBtn, TabCommsBtn, TabEventsBtn, TabBoothsBtn };
        for (int i = 0; i < tabs.Length; i++)
        {
            tabs[i].Visibility = i == idx ? Visibility.Visible : Visibility.Collapsed;
            btns[i].Style = i == idx ? (Style)Application.Current.Resources["AccentButtonStyle"] : null;
        }
        Anim.FadeInChildren(tabs[idx]);
    }

    // ------------------------------------------------------------ applications

    private void BuildApps()
    {
        AppsTab.Children.Clear();

        var filterRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        foreach (string status in new[] { "pending", "approved", "rejected" })
        {
            var btn = new Button
            {
                Content = status,
                FontSize = 12,
                Style = status == _appStatus ? (Style)Application.Current.Resources["AccentButtonStyle"] : null,
                Tag = status,
            };
            btn.Click += async (s, _) =>
            {
                _appStatus = (string)((Button)s).Tag;
                var r = await AlleyApi.AdminApplicationsAsync(_appStatus);
                _apps = r.Data ?? new List<AlleyApplication>();
                BuildApps();
                Anim.FadeInChildren(AppsTab);
            };
            filterRow.Children.Add(btn);
        }
        AppsTab.Children.Add(filterRow);

        if (_apps.Count == 0)
        {
            var empty = AlleyUi.Card(20);
            empty.Child = AlleyUi.EmptyState("\uE715", $"No {_appStatus} applications",
                _appStatus == "pending" ? "New community applications land here for review." : "");
            AppsTab.Children.Add(empty);
            return;
        }

        foreach (var app in _apps)
        {
            AppsTab.Children.Add(AppCard(app));
        }
    }

    private Border AppCard(AlleyApplication app)
    {
        var card = AlleyUi.Card(16);
        var root = new StackPanel { Spacing = 8 };

        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var logo = new PersonPicture { Width = 44, Height = 44, DisplayName = app.CommunityName };
        if (!string.IsNullOrEmpty(app.LogoUrl)) LoadAlleyImage(logo, app.LogoUrl);
        head.Children.Add(logo);
        var headText = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
        var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        nameRow.Children.Add(new TextBlock { Text = app.CommunityName, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });
        nameRow.Children.Add(AlleyUi.Chip(app.Status));
        headText.Children.Add(nameRow);
        headText.Children.Add(AlleyUi.Muted(
            $"{app.DiscordUsername} ({app.DiscordUserId})  |  {(DateTimeOffset.TryParse(app.CreatedAt, out var cd) ? cd.LocalDateTime.ToString("g") : app.CreatedAt)}", 11));
        head.Children.Add(headText);
        root.Children.Add(head);

        if (!string.IsNullOrEmpty(app.Description)) root.Children.Add(AlleyUi.Muted(app.Description));
        if (!string.IsNullOrEmpty(app.Reason)) root.Children.Add(AlleyUi.Muted("Why: " + app.Reason, 11));

        var links = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        if (!string.IsNullOrEmpty(app.GroupId)) links.Children.Add(AlleyUi.IconText("\uE716", app.GroupId));
        if (!string.IsNullOrEmpty(app.InviteUrl))
        {
            var inviteLink = new HyperlinkButton { Content = "Discord invite", FontSize = 12, Padding = new Thickness(0) };
            inviteLink.Click += (_, _) => Helpers.OpenUrl(app.InviteUrl);
            links.Children.Add(inviteLink);
        }
        foreach (string s in app.Socials.Take(5))
        {
            if (!s.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) continue;
            var link = new HyperlinkButton { Content = SafeHost(s), FontSize = 12, Padding = new Thickness(0) };
            string url = s;
            link.Click += (_, _) => Helpers.OpenUrl(url);
            links.Children.Add(link);
        }
        if (links.Children.Count > 0) root.Children.Add(links);

        if (app.Status == "rejected" && !string.IsNullOrEmpty(app.ReviewNote))
        {
            root.Children.Add(AlleyUi.Muted($"Note: {app.ReviewNote} ({app.ReviewedBy})", 11));
        }

        if (app.Status == "pending")
        {
            var noteBox = new TextBox
            {
                PlaceholderText = "Why is this being rejected? The applicant sees this.",
                MaxLength = 300,
                Visibility = Visibility.Collapsed,
            };
            root.Children.Add(noteBox);

            var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            var approveBtn = new Button { Content = "Approve", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
            var rejectBtn = new Button { Content = "Reject", Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFF, 0x6B, 0x81)) };
            var cancelBtn = new Button { Content = "Cancel", Visibility = Visibility.Collapsed };

            approveBtn.Click += async (_, _) =>
            {
                approveBtn.IsEnabled = false;
                var r = await AlleyApi.AdminApproveApplicationAsync(app.Id);
                if (r.Ok) { AudioService.Success(); await LoadAllAsync(); }
                else approveBtn.IsEnabled = true;
            };
            rejectBtn.Click += async (_, _) =>
            {
                if (noteBox.Visibility == Visibility.Collapsed)
                {
                    noteBox.Visibility = Visibility.Visible;
                    cancelBtn.Visibility = Visibility.Visible;
                    rejectBtn.Content = "Confirm reject";
                    return;
                }
                rejectBtn.IsEnabled = false;
                var r = await AlleyApi.AdminRejectApplicationAsync(app.Id, noteBox.Text.Trim());
                if (r.Ok) await LoadAllAsync();
                else rejectBtn.IsEnabled = true;
            };
            cancelBtn.Click += (_, _) =>
            {
                noteBox.Visibility = Visibility.Collapsed;
                cancelBtn.Visibility = Visibility.Collapsed;
                rejectBtn.Content = "Reject";
            };

            actions.Children.Add(approveBtn);
            actions.Children.Add(rejectBtn);
            actions.Children.Add(cancelBtn);
            root.Children.Add(actions);
        }

        card.Child = root;
        Anim.Lift(card);
        return card;
    }

    // ------------------------------------------------------------ communities

    private void BuildComms()
    {
        CommsTab.Children.Clear();

        var listHost = new StackPanel { Spacing = 8 };

        var searchRow = new Grid { ColumnSpacing = 10 };
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var searchBox = new TextBox { PlaceholderText = "Search name, owner, manager...", Text = _commSearch };
        var countText = AlleyUi.Muted("", 11);
        countText.VerticalAlignment = VerticalAlignment.Center;
        searchBox.TextChanged += (_, _) => { _commSearch = searchBox.Text; RenderCommList(); };
        searchRow.Children.Add(searchBox);
        Grid.SetColumn(countText, 1);
        searchRow.Children.Add(countText);
        CommsTab.Children.Add(searchRow);
        CommsTab.Children.Add(listHost);

        void RenderCommList()
        {
            listHost.Children.Clear();
            string q = _commSearch.Trim().ToLowerInvariant();
            var shown = _comms.Where(x => q.Length == 0
                || x.Name.ToLowerInvariant().Contains(q)
                || x.Slug.ToLowerInvariant().Contains(q)
                || x.OwnerUsername.ToLowerInvariant().Contains(q)
                || x.ManagerUsername.ToLowerInvariant().Contains(q)).ToList();
            countText.Text = $"{shown.Count} of {_comms.Count} communities";

            if (_comms.Count == 0)
            {
                var empty = AlleyUi.Card(20);
                empty.Child = AlleyUi.EmptyState("\uE716", "No communities yet", "Approve an application and it becomes a community here.");
                listHost.Children.Add(empty);
                return;
            }
            foreach (var c in shown) listHost.Children.Add(CommCard(c));
            Anim.FadeInChildren(listHost);
        }

        RenderCommList();
    }

    private Border CommCard(AlleyCommunity c)
    {
        var card = AlleyUi.Card(14);
        var grid = new Grid { ColumnSpacing = 12 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var logo = new PersonPicture { Width = 46, Height = 46, DisplayName = c.Name };
        LoadAlleyImage(logo, c.LogoUrl);
        grid.Children.Add(logo);

        var mid = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
        var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        nameRow.Children.Add(new TextBlock { Text = c.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        nameRow.Children.Add(AlleyUi.Chip(c.Active ? "active" : "disabled"));
        if (c.LimitsBypass) nameRow.Children.Add(AlleyUi.BypassBadge());
        mid.Children.Add(nameRow);

        var meta = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 };
        meta.Children.Add(AlleyUi.Muted("@" + c.Slug, 11));
        meta.Children.Add(AlleyUi.IconText("\uE734", $"{c.OwnerUsername} ({c.OwnerDiscordId})"));
        if (!string.IsNullOrEmpty(c.ManagerDiscordId))
        {
            meta.Children.Add(AlleyUi.IconText("\uE816",
                string.IsNullOrEmpty(c.ManagerUsername) ? c.ManagerDiscordId : c.ManagerUsername));
        }
        mid.Children.Add(meta);
        Grid.SetColumn(mid, 1);
        grid.Children.Add(mid);

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var editBtn = new Button { Content = "Edit", FontSize = 12 };
        editBtn.Click += async (_, _) => await ShowCommunityEditorAsync(c);
        actions.Children.Add(editBtn);
        var toggleBtn = new Button { Content = c.Active ? "Disable" : "Enable", FontSize = 12 };
        toggleBtn.Click += async (_, _) =>
        {
            toggleBtn.IsEnabled = false;
            var r = await AlleyApi.AdminPatchCommunityAsync(c.Id, new { active = !c.Active });
            if (r.Ok) await LoadAllAsync();
            else toggleBtn.IsEnabled = true;
        };
        actions.Children.Add(toggleBtn);
        Grid.SetColumn(actions, 2);
        grid.Children.Add(actions);

        card.Child = grid;
        Anim.Lift(card);
        return card;
    }

    private async Task ShowCommunityEditorAsync(AlleyCommunity c)
    {
        var panel = new StackPanel { Spacing = 10, Width = 460 };

        var nameBox = new TextBox { Header = "Community name", Text = c.Name, MaxLength = 48 };
        var ownerBox = new TextBox { Header = "Owner Discord ID", Text = c.OwnerDiscordId, MaxLength = 25 };
        var mgrBox = new TextBox { Header = "Booth manager Discord ID", Text = c.ManagerDiscordId, PlaceholderText = "empty = no booth manager", MaxLength = 25 };
        var descBox = new TextBox { Header = "Description", Text = c.Description, MaxLength = 500, AcceptsReturn = true, Height = 80, TextWrapping = TextWrapping.Wrap };
        var inviteBox = new TextBox { Header = "Discord invite", Text = c.InviteUrl, PlaceholderText = "https://discord.gg/..." };
        var groupBox = new TextBox { Header = "VRChat Group ID", Text = c.GroupId, PlaceholderText = "grp_..." };
        var socialsBox = new TextBox
        {
            Header = "Social links (one per line, up to 5)",
            Text = string.Join("\n", c.Socials),
            AcceptsReturn = true,
            Height = 70,
        };
        var bypassCheck = new CheckBox { Content = "Booth limits bypass", IsChecked = c.LimitsBypass };

        panel.Children.Add(nameBox);
        panel.Children.Add(ownerBox);
        panel.Children.Add(AlleyUi.Muted("Changing the owner signs the previous owner out of the SDK.", 11));
        panel.Children.Add(mgrBox);
        panel.Children.Add(AlleyUi.Muted("The one extra account allowed to upload for this community. Clear it to remove their access.", 11));
        panel.Children.Add(descBox);
        panel.Children.Add(inviteBox);
        panel.Children.Add(groupBox);
        panel.Children.Add(socialsBox);
        panel.Children.Add(bypassCheck);
        panel.Children.Add(AlleyUi.Muted("Lets this community upload booths over the event limits (size, triangles, memory, feature gates). Metadata checks and the shader whitelist still apply. Bypassed uploads get flagged in the staff log.", 11));

        var logoBtn = new Button { Content = "Change logo..." };
        logoBtn.Click += async (_, _) =>
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
            if (bytes.Length > 2 * 1024 * 1024) return;
            string ct = file.FileType.ToLowerInvariant() switch
            {
                ".png" => "image/png",
                ".webp" => "image/webp",
                _ => "image/jpeg",
            };
            await AlleyApi.AdminUploadCommunityLogoAsync(c.Id, bytes, ct);
        };
        panel.Children.Add(logoBtn);

        var dialog = new ContentDialog
        {
            Title = $"Edit {c.Name}",
            Content = new ScrollViewer { Content = panel, MaxHeight = 560 },
            PrimaryButtonText = "Save changes",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        var socials = socialsBox.Text
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Take(5)
            .ToList();
        var res = await AlleyApi.AdminPatchCommunityAsync(c.Id, new
        {
            name = nameBox.Text.Trim(),
            ownerDiscordId = ownerBox.Text.Trim(),
            managerDiscordId = mgrBox.Text.Trim(),
            description = descBox.Text.Trim(),
            inviteUrl = inviteBox.Text.Trim(),
            groupId = groupBox.Text.Trim(),
            socials,
            limitsBypass = bypassCheck.IsChecked == true,
        });
        if (res.Ok)
        {
            AudioService.Success();
            await LoadAllAsync();
        }
    }

    // ------------------------------------------------------------ events

    private void BuildEvents()
    {
        EventsTab.Children.Clear();

        var headRow = new Grid { ColumnSpacing = 10 };
        headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        headRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var headText = AlleyUi.Muted("The active event is the one the SDK and website treat as current.");
        headText.VerticalAlignment = VerticalAlignment.Center;
        headRow.Children.Add(headText);
        var newBtn = new Button { Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
        newBtn.Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { new FontIcon { Glyph = "\uE710", FontSize = 12 }, new TextBlock { Text = "New event" } },
        };
        newBtn.Click += async (_, _) => await ShowEventEditorAsync(null);
        Grid.SetColumn(newBtn, 1);
        headRow.Children.Add(newBtn);
        EventsTab.Children.Add(headRow);

        if (_events.Count == 0)
        {
            var empty = AlleyUi.Card(20);
            empty.Child = AlleyUi.EmptyState("\uE787", "No events yet", "Make the first one, the active event drives the SDK and uploads.");
            EventsTab.Children.Add(empty);
            return;
        }

        foreach (var ev in _events) EventsTab.Children.Add(EventCard(ev));
    }

    private Border EventCard(AlleyEvent ev)
    {
        var card = AlleyUi.Card(16);
        var root = new StackPanel { Spacing = 10 };

        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        head.Children.Add(new TextBlock { Text = ev.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });
        if (ev.Active) head.Children.Add(AlleyUi.Chip("active"));
        head.Children.Add(AlleyUi.Chip(ev.AcceptingBooths ? "open" : "closed"));
        if (!string.IsNullOrEmpty(ev.MinSdkVersion)) head.Children.Add(AlleyUi.Muted($"SDK {ev.MinSdkVersion}+", 11));
        root.Children.Add(head);

        var sched = new Grid { ColumnSpacing = 20 };
        for (int i = 0; i < 3; i++) sched.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        string[][] rows =
        {
            new[] { "Starts", ev.StartsAt },
            new[] { "Ends", ev.EndsAt },
            new[] { "Upload deadline", ev.UploadDeadline },
        };
        for (int i = 0; i < rows.Length; i++)
        {
            var cell = new StackPanel { Spacing = 2 };
            cell.Children.Add(new TextBlock
            {
                Text = rows[i][0].ToUpperInvariant(),
                FontSize = 10,
                CharacterSpacing = 100,
                Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
            });
            cell.Children.Add(new TextBlock { Text = AlleyUi.LocalTime(rows[i][1]), FontSize = 13 });
            Grid.SetColumn(cell, i);
            sched.Children.Add(cell);
        }
        root.Children.Add(sched);
        root.Children.Add(AlleyUi.Muted($"Times shown in your local timezone. Event timezone: {(string.IsNullOrEmpty(ev.Timezone) ? "UTC" : ev.Timezone)}", 11));

        var actions = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        var activeBtn = new Button { Content = ev.Active ? "Deactivate" : "Set active", FontSize = 12 };
        if (!ev.Active) activeBtn.Style = (Style)Application.Current.Resources["AccentButtonStyle"];
        activeBtn.Click += async (_, _) =>
        {
            activeBtn.IsEnabled = false;
            var r = await AlleyApi.PatchEventAsync(ev.Id, new { active = !ev.Active });
            if (r.Ok) await LoadAllAsync();
            else activeBtn.IsEnabled = true;
        };
        actions.Children.Add(activeBtn);
        var editBtn = new Button { Content = "Edit", FontSize = 12 };
        editBtn.Click += async (_, _) => await ShowEventEditorAsync(ev);
        actions.Children.Add(editBtn);
        var delBtn = new Button { Content = "Delete", FontSize = 12, Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFF, 0x6B, 0x81)) };
        delBtn.Click += async (_, _) => await DeleteEventAsync(ev);
        actions.Children.Add(delBtn);
        root.Children.Add(actions);

        card.Child = root;
        Anim.Lift(card);
        return card;
    }

    private static readonly string[] Timezones =
    {
        "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles",
        "America/Phoenix", "America/Anchorage", "Pacific/Honolulu", "UTC",
        "Europe/London", "Europe/Paris", "Europe/Berlin", "Europe/Moscow",
        "Asia/Tokyo", "Asia/Seoul", "Asia/Shanghai", "Asia/Kolkata",
        "Australia/Sydney", "Australia/Perth", "Pacific/Auckland",
    };

    private async Task ShowEventEditorAsync(AlleyEvent? ev)
    {
        bool isNew = ev == null;
        var panel = new StackPanel { Spacing = 10, Width = 470 };

        // Basics
        panel.Children.Add(SectionHeader("Basics"));
        var nameBox = new TextBox { Header = "Event name", Text = ev?.Name ?? "", MaxLength = 64 };
        panel.Children.Add(nameBox);
        panel.Children.Add(AlleyUi.Muted("What creators see in the SDK and on the site.", 11));
        var tzCombo = new ComboBox { Header = "Timezone", HorizontalAlignment = HorizontalAlignment.Stretch };
        string curTz = string.IsNullOrEmpty(ev?.Timezone) ? "America/New_York" : ev!.Timezone;
        var tzList = Timezones.Contains(curTz) ? Timezones : Timezones.Append(curTz).ToArray();
        foreach (string tzName in tzList) tzCombo.Items.Add(tzName);
        tzCombo.SelectedItem = curTz;
        panel.Children.Add(tzCombo);
        panel.Children.Add(AlleyUi.Muted("Every date below is read in this timezone.", 11));

        // Schedule
        panel.Children.Add(SectionHeader("Schedule"));
        var (startDate, startTime) = DateTimeRow(panel, "Event starts", ev?.StartsAt);
        var (endDate, endTime) = DateTimeRow(panel, "Event ends", ev?.EndsAt);
        var (dlDate, dlTime) = DateTimeRow(panel, "Booth upload deadline", ev?.UploadDeadline);
        panel.Children.Add(AlleyUi.Muted("Communities usually need the deadline a few days before doors open.", 11));

        // Booth rules
        panel.Children.Add(SectionHeader("Booth rules"));
        var sdkBox = new TextBox { Header = "Minimum SDK version", Text = ev?.MinSdkVersion ?? "1.0.0", MaxLength = 16 };
        panel.Children.Add(sdkBox);
        var acceptingCheck = new CheckBox { Content = "Accepting booth uploads", IsChecked = ev?.AcceptingBooths ?? false };
        panel.Children.Add(acceptingCheck);
        var defaultsCheck = new CheckBox
        {
            Content = "Recommended default limits (5m plot, 60k tris, box colliders only)",
            IsChecked = true,
        };
        if (!isNew) defaultsCheck.Content = "Keep current booth limits";
        panel.Children.Add(defaultsCheck);
        panel.Children.Add(AlleyUi.Muted("Untick to fine-tune every budget on the website. The app keeps limits at their current values.", 11));

        // Info wall
        panel.Children.Add(SectionHeader("Info wall"));
        var schedText = new TextBox
        {
            Header = "Event schedule",
            Text = ev?.ScheduleText ?? "",
            AcceptsReturn = true,
            Height = 110,
            MaxLength = 4000,
            PlaceholderText = "FRIDAY\nDoors 5pm PT\nOpening show 6pm PT",
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
        };
        panel.Children.Add(schedText);
        var crewText = new TextBox
        {
            Header = "Event crew",
            Text = ev?.CrewText ?? "",
            AcceptsReturn = true,
            Height = 80,
            MaxLength = 4000,
            PlaceholderText = "Staff, greeters and the build team.",
            FontFamily = new FontFamily("Consolas"),
            FontSize = 12,
        };
        panel.Children.Add(crewText);
        panel.Children.Add(AlleyUi.Muted("The info wall in the world downloads this text live, changes show up within a couple of minutes.", 11));

        var dialog = new ContentDialog
        {
            Title = isNew ? "New event" : $"Edit {ev!.Name}",
            Content = new ScrollViewer { Content = panel, MaxHeight = 560 },
            PrimaryButtonText = isNew ? "Create event" : "Save changes",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        if (nameBox.Text.Trim().Length < 2) return;
        string tz = tzCombo.SelectedItem as string ?? "UTC";

        var body = new Dictionary<string, object?>
        {
            ["name"] = nameBox.Text.Trim(),
            ["timezone"] = tz,
            ["minSdkVersion"] = sdkBox.Text.Trim(),
            ["acceptingBooths"] = acceptingCheck.IsChecked == true,
            ["scheduleText"] = schedText.Text,
            ["crewText"] = crewText.Text,
        };
        string? startsIso = ComposeIso(startDate, startTime, tz);
        string? endsIso = ComposeIso(endDate, endTime, tz);
        string? dlIso = ComposeIso(dlDate, dlTime, tz);
        if (startsIso != null) body["startsAt"] = startsIso;
        if (endsIso != null) body["endsAt"] = endsIso;
        if (dlIso != null) body["uploadDeadline"] = dlIso;

        var res = isNew
            ? await AlleyApi.CreateEventAsync(body)
            : await AlleyApi.PatchEventAsync(ev!.Id, body);
        if (res.Ok)
        {
            AudioService.Success();
            await LoadAllAsync();
        }
    }

    private static TextBlock SectionHeader(string text) => new()
    {
        Text = text.ToUpperInvariant(),
        FontSize = 11,
        FontWeight = Microsoft.UI.Text.FontWeights.Bold,
        CharacterSpacing = 100,
        Foreground = (Brush)Application.Current.Resources["AlleyTealBrush"],
        Margin = new Thickness(0, 6, 0, 0),
    };

    private static (DatePicker, TimePicker) DateTimeRow(StackPanel host, string label, string? iso)
    {
        host.Children.Add(new TextBlock { Text = label, FontSize = 12, Margin = new Thickness(0, 2, 0, 0) });
        var row = new Grid { ColumnSpacing = 8 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(3, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(2, GridUnitType.Star) });
        var date = new DatePicker { HorizontalAlignment = HorizontalAlignment.Stretch };
        var time = new TimePicker { ClockIdentifier = "12HourClock", HorizontalAlignment = HorizontalAlignment.Stretch };
        if (!string.IsNullOrEmpty(iso) && DateTimeOffset.TryParse(iso, out var dto))
        {
            var local = dto.LocalDateTime;
            date.Date = new DateTimeOffset(local.Date);
            time.Time = local.TimeOfDay;
        }
        row.Children.Add(date);
        Grid.SetColumn(time, 1);
        row.Children.Add(time);
        host.Children.Add(row);
        return (date, time);
    }

    private static string? ComposeIso(DatePicker date, TimePicker time, string ianaTz)
    {
        try
        {
            var d = date.Date;
            var wall = new DateTime(d.Year, d.Month, d.Day, time.Time.Hours, time.Time.Minutes, 0, DateTimeKind.Unspecified);
            TimeZoneInfo tzi;
            try
            {
                tzi = TimeZoneInfo.FindSystemTimeZoneById(ianaTz);
            }
            catch
            {
                tzi = TimeZoneInfo.Utc;
            }
            var offset = tzi.GetUtcOffset(wall);
            return new DateTimeOffset(wall, offset).ToUniversalTime().ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'");
        }
        catch
        {
            return null;
        }
    }

    private async Task DeleteEventAsync(AlleyEvent ev)
    {
        var boothCount = _booths.Count(b => b.EventId == ev.Id);
        var content = new StackPanel { Spacing = 8 };
        content.Children.Add(new TextBlock
        {
            Text = boothCount > 0
                ? "Deleting anyway removes every uploaded booth and its files for this event. Communities keep their accounts, only the booths go."
                : "This cannot be undone.",
            TextWrapping = TextWrapping.Wrap,
        });
        var dialog = new ContentDialog
        {
            Title = $"Delete {ev.Name}?",
            Content = content,
            PrimaryButtonText = boothCount > 0 ? "Delete event + booths" : "Delete event",
            CloseButtonText = "Cancel",
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var res = await AlleyApi.DeleteEventAsync(ev.Id, boothCount > 0);
        if (res.Ok) await LoadAllAsync();
    }

    // ------------------------------------------------------------ booths

    private void BuildBooths()
    {
        BoothsTab.Children.Clear();

        var searchRow = new Grid { ColumnSpacing = 10 };
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        searchRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var searchBox = new TextBox { PlaceholderText = "Search by community...", Text = _boothSearch };
        var countText = AlleyUi.Muted("", 11);
        countText.VerticalAlignment = VerticalAlignment.Center;
        searchRow.Children.Add(searchBox);
        Grid.SetColumn(countText, 1);
        searchRow.Children.Add(countText);
        BoothsTab.Children.Add(searchRow);

        var listHost = new StackPanel { Spacing = 8 };
        BoothsTab.Children.Add(listHost);

        void Render()
        {
            listHost.Children.Clear();
            string q = _boothSearch.Trim().ToLowerInvariant();
            var shown = _booths.Where(b => q.Length == 0 || b.CommunityName.ToLowerInvariant().Contains(q)).ToList();
            countText.Text = $"{_booths.Count(b => b.Status == "active")} active of {_booths.Count} uploads";

            if (_booths.Count == 0)
            {
                var empty = AlleyUi.Card(20);
                empty.Child = AlleyUi.EmptyState("\uE7B8", "No booths uploaded yet", "Uploads from the SDK land here with their build stats.");
                listHost.Children.Add(empty);
                return;
            }

            foreach (var b in shown.OrderByDescending(x => x.UploadedAt)) listHost.Children.Add(StaffBoothCard(b));
            Anim.FadeInChildren(listHost);
        }

        searchBox.TextChanged += (_, _) => { _boothSearch = searchBox.Text; Render(); };
        Render();
    }

    private Border StaffBoothCard(AlleyBooth b)
    {
        var card = AlleyUi.Card(14);
        var grid = new Grid { ColumnSpacing = 14 };
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var preview = new Border
        {
            Width = 72,
            Height = 72,
            CornerRadius = new CornerRadius(8),
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0D, 0x11, 0x17)),
        };
        var img = new Image { Stretch = Microsoft.UI.Xaml.Media.Stretch.UniformToFill };
        preview.Child = img;
        AlleyUi.AuthImage(img, b.PreviewUrl);
        grid.Children.Add(preview);

        var mid = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center };
        var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        titleRow.Children.Add(new TextBlock { Text = b.CommunityName, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
        titleRow.Children.Add(AlleyUi.Muted($"v{b.Version}", 11));
        titleRow.Children.Add(AlleyUi.Chip(b.Status));
        if (b.LimitsBypassed) titleRow.Children.Add(AlleyUi.BypassBadge());
        mid.Children.Add(titleRow);

        var stats = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        stats.Children.Add(AlleyUi.IconText("\uE8B5", AlleyUi.FormatMB(b.FileSize)));
        if (b.Stats != null) stats.Children.Add(AlleyUi.IconText("\uE879", $"{b.Stats.Triangles:N0} tris | {b.Stats.MaterialSlots} mats"));
        if (!string.IsNullOrEmpty(b.UploadedAt)) stats.Children.Add(AlleyUi.IconText("\uE823", AlleyUi.LocalTime(b.UploadedAt)));
        mid.Children.Add(stats);

        if (b.Shaders.Count > 0) mid.Children.Add(AlleyUi.Muted("Shaders: " + string.Join(", ", b.Shaders), 10));
        Grid.SetColumn(mid, 1);
        grid.Children.Add(mid);

        var dlBtn = new Button { VerticalAlignment = VerticalAlignment.Center };
        dlBtn.Content = new FontIcon { Glyph = "\uE896", FontSize = 13 };
        ToolTipService.SetToolTip(dlBtn, "Download booth package");
        dlBtn.Click += async (_, _) =>
        {
            var picker = new FileSavePicker
            {
                SuggestedFileName = $"{(string.IsNullOrEmpty(b.CommunitySlug) ? b.Id : b.CommunitySlug)}-v{b.Version}",
            };
            WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
            picker.FileTypeChoices.Add("Booth package", new List<string> { ".zip" });
            var file = await picker.PickSaveFileAsync();
            if (file == null) return;
            dlBtn.IsEnabled = false;
            byte[]? data = await AlleyApi.AdminDownloadBoothAsync(b.Id);
            dlBtn.IsEnabled = true;
            if (data == null) return;
            await File.WriteAllBytesAsync(file.Path, data);
            AudioService.Success();
        };
        Grid.SetColumn(dlBtn, 2);
        grid.Children.Add(dlBtn);

        card.Child = grid;
        Anim.Lift(card);
        return card;
    }

    // ------------------------------------------------------------ shared

    private static string SafeHost(string url)
    {
        try { return new Uri(url).Host; } catch { return url; }
    }

    private async void LoadAlleyImage(PersonPicture pic, string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        if (url.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            try { pic.ProfilePicture = new BitmapImage(new Uri(url)); } catch { }
            return;
        }
        byte[]? data = await AlleyApi.GetBytesAsync(url);
        if (data == null) return;
        try
        {
            var ms = new Windows.Storage.Streams.InMemoryRandomAccessStream();
            await ms.WriteAsync(System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(data));
            ms.Seek(0);
            var bmp = new BitmapImage();
            await bmp.SetSourceAsync(ms);
            pic.ProfilePicture = bmp;
        }
        catch { }
    }
}
