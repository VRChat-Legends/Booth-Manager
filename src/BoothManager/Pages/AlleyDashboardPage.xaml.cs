using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Windows.Storage.Pickers;

namespace BoothManager.Pages;

/// <summary>Mirror of vrchatlegends.com/alley/dashboard: Overview, Profile, Team, Booths.</summary>
public sealed partial class AlleyDashboardPage : Page
{
    private AlleyMe? _me;
    private List<AlleyBooth> _booths = new();
    private List<AlleyEvent> _events = new();
    private bool _busy;
    private int _tab;

    private bool IsOwner => _me?.Role == "owner" || (_me?.Staff == true && _me.Community != null);

    public AlleyDashboardPage()
    {
        InitializeComponent();
        Anim.Entrance(OverviewTab);
        Anim.Entrance(ProfileTab);
        Anim.Entrance(TeamTab);
        Anim.Entrance(BoothsTab);
        Loaded += async (_, _) => await RefreshAsync();
    }

    // ------------------------------------------------------------ connect

    private async Task RefreshAsync()
    {
        if (!AlleyApi.IsConnected)
        {
            ShowGate(null);
            return;
        }

        GateRing.IsActive = true;
        var res = await AlleyApi.MeAsync();
        GateRing.IsActive = false;

        if (res.Status == 401 || res.Status == 403)
        {
            Session.ClearAlley();
            ShowGate("Your Alley session expired. Sign in again.");
            return;
        }
        if (!res.Ok || res.Data == null)
        {
            ShowGate(string.IsNullOrEmpty(res.Error) ? "Could not reach the Alley service." : res.Error);
            return;
        }

        _me = res.Data;
        GatePanel.Visibility = Visibility.Collapsed;
        ContentRoot.Visibility = Visibility.Visible;
        ConnectBtnText.Text = "Sign out";
        string roleLabel = _me.Role == "owner" ? "owner" : "booth manager";
        Subtitle.Text = _me.Community != null
            ? $"{_me.Community.Name}  |  signed in as {roleLabel}"
            : (_me.Staff ? "Signed in as Alley staff (no community linked)." : "No community linked to this account.");
        App.Window?.UpdateAlleyNav();

        var boothsTask = AlleyApi.MyBoothsAsync();
        var eventsTask = AlleyApi.EventsAsync();
        await Task.WhenAll(boothsTask, eventsTask);
        _booths = boothsTask.Result.Data ?? new List<AlleyBooth>();
        _events = eventsTask.Result.Data ?? new List<AlleyEvent>();

        BuildOverview();
        BuildProfile();
        BuildTeam();
        BuildBooths();
        SelectTab(_tab);
    }

    private void ShowGate(string? error)
    {
        GatePanel.Visibility = Visibility.Visible;
        ContentRoot.Visibility = Visibility.Collapsed;
        ConnectBtnText.Text = "Sign in";
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

    private async void ConnectBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_busy) return;
        if (AlleyApi.IsConnected)
        {
            await AlleyApi.RevokeAsync();
            Session.ClearAlley();
            _me = null;
            App.Window?.UpdateAlleyNav();
            ShowGate(null);
            return;
        }

        _busy = true;
        GateRing.IsActive = true;
        GateError.Visibility = Visibility.Collapsed;
        var result = await AlleyApi.SignInAsync(TimeSpan.FromMinutes(3));
        _busy = false;
        GateRing.IsActive = false;

        if (!result.Success)
        {
            ShowGate(result.Error == "timeout" ? "Sign in timed out. Try again." : "Sign in failed: " + result.Error);
            return;
        }

        Session.SetAlley(result.Token, result.Staff, result.Role, result.Community?.Name ?? "");
        AudioService.Success();
        await RefreshAsync();
    }

    private void OpenWebBtn_Click(object sender, RoutedEventArgs e) =>
        Helpers.OpenUrl("https://vrchatlegends.com/alley/dashboard");

    // ------------------------------------------------------------ tabs

    private void Tab_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button b && b.Tag is string t && int.TryParse(t, out int idx)) SelectTab(idx);
    }

    private void SelectTab(int idx)
    {
        _tab = idx;
        var tabs = new[] { OverviewTab, ProfileTab, TeamTab, BoothsTab };
        var btns = new[] { TabOverviewBtn, TabProfileBtn, TabTeamBtn, TabBoothsBtn };
        for (int i = 0; i < tabs.Length; i++)
        {
            tabs[i].Visibility = i == idx ? Visibility.Visible : Visibility.Collapsed;
            btns[i].Style = i == idx ? (Style)Application.Current.Resources["AccentButtonStyle"] : null;
        }
        Anim.FadeInChildren(tabs[idx]);
    }

    // ------------------------------------------------------------ overview

    private void BuildOverview()
    {
        OverviewTab.Children.Clear();
        var c = _me?.Community;

        // community card
        var commCard = AlleyUi.Card(20);
        if (c == null)
        {
            commCard.Child = AlleyUi.EmptyState("\uE716", "No community linked",
                "Your Discord account does not own or manage an approved Alley community. Apply on the website first.");
            OverviewTab.Children.Add(commCard);
            return;
        }

        var commGrid = new Grid { ColumnSpacing = 16 };
        commGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        commGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        commGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

        var logo = new PersonPicture { Width = 72, Height = 72, DisplayName = c.Name };
        LoadLogo(logo, c.LogoUrl);
        commGrid.Children.Add(logo);

        var mid = new StackPanel { Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
        var nameRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        nameRow.Children.Add(new TextBlock { Text = c.Name, FontSize = 20, FontWeight = Microsoft.UI.Text.FontWeights.Bold });
        nameRow.Children.Add(AlleyUi.Chip("approved"));
        if (c.LimitsBypass) nameRow.Children.Add(AlleyUi.BypassBadge());
        mid.Children.Add(nameRow);
        mid.Children.Add(AlleyUi.Muted(string.IsNullOrEmpty(c.Description)
            ? "No description yet. Add one in the Profile tab."
            : c.Description));

        var links = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
        if (!string.IsNullOrEmpty(c.GroupId)) links.Children.Add(AlleyUi.IconText("\uE716", c.GroupId));
        if (!string.IsNullOrEmpty(c.InviteUrl)) links.Children.Add(AlleyUi.IconText("\uE8F2", "Discord invite"));
        foreach (string s in c.Socials.Take(5))
        {
            try { links.Children.Add(AlleyUi.IconText("\uE71B", new Uri(s).Host)); } catch { }
        }
        if (links.Children.Count > 0) mid.Children.Add(links);
        Grid.SetColumn(mid, 1);
        commGrid.Children.Add(mid);

        var editBtn = new Button { VerticalAlignment = VerticalAlignment.Center };
        editBtn.Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { new FontIcon { Glyph = "\uE70F", FontSize = 13 }, new TextBlock { Text = "Edit profile" } },
        };
        editBtn.Click += (_, _) => SelectTab(1);
        Grid.SetColumn(editBtn, 2);
        commGrid.Children.Add(editBtn);

        commCard.Child = commGrid;
        OverviewTab.Children.Add(commCard);

        // stat tiles
        var tiles = new Grid { ColumnSpacing = 10 };
        for (int i = 0; i < 4; i++) tiles.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

        var t1 = AlleyUi.StatTile("\uE898", "Booth uploads", out var v1);
        v1.Text = _booths.Count.ToString();
        var t2 = AlleyUi.StatTile("\uE7B8", "Active booth", out var v2);
        var active = _booths.FirstOrDefault(b => b.Status == "active");
        v2.Text = active != null ? $"v{active.Version}" : "None yet";
        if (active != null) v2.Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x34, 0xD3, 0x99));
        else v2.Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"];
        var t3 = AlleyUi.StatTile("\uE816", "Booth manager", out var v3);
        string mgr = !string.IsNullOrEmpty(c.ManagerUsername) ? c.ManagerUsername : c.ManagerDiscordId;
        v3.Text = string.IsNullOrEmpty(mgr) ? "Not set" : mgr;
        v3.FontSize = 18;
        var t4 = AlleyUi.StatTile("\uE77B", "Your role", out var v4);
        v4.Text = _me?.Role == "owner" ? "Owner" : "Booth manager";
        v4.FontSize = 18;

        Grid.SetColumn(t2, 1); Grid.SetColumn(t3, 2); Grid.SetColumn(t4, 3);
        tiles.Children.Add(t1); tiles.Children.Add(t2); tiles.Children.Add(t3); tiles.Children.Add(t4);
        OverviewTab.Children.Add(tiles);

        // event card
        var ev = _events.FirstOrDefault(x => x.Active) ?? _events.FirstOrDefault();
        if (ev != null)
        {
            var evCard = AlleyUi.Card();
            var evGrid = new Grid { ColumnSpacing = 14 };
            evGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            evGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            evGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            evGrid.Children.Add(new FontIcon
            {
                Glyph = "\uE787",
                FontSize = 24,
                Foreground = (Brush)Application.Current.Resources["AlleyTealBrush"],
                VerticalAlignment = VerticalAlignment.Center,
            });

            var evMid = new StackPanel { Spacing = 3, VerticalAlignment = VerticalAlignment.Center };
            evMid.Children.Add(new TextBlock { Text = ev.Name, FontWeight = Microsoft.UI.Text.FontWeights.Bold });
            if (!string.IsNullOrEmpty(ev.UploadDeadline))
            {
                evMid.Children.Add(AlleyUi.Muted(
                    $"Upload deadline {AlleyUi.LocalTime(ev.UploadDeadline)} ({AlleyUi.DeadlineCountdown(ev.UploadDeadline)})"));
            }
            Grid.SetColumn(evMid, 1);
            evGrid.Children.Add(evMid);

            var chip = AlleyUi.Chip(ev.AcceptingBooths ? "uploads open" : "uploads closed");
            Grid.SetColumn(chip, 2);
            evGrid.Children.Add(chip);

            evCard.Child = evGrid;
            Anim.Lift(evCard);
            OverviewTab.Children.Add(evCard);
        }

        // empty state steps
        if (_booths.Count == 0)
        {
            var steps = AlleyUi.Card(20);
            var sp = new StackPanel { Spacing = 8 };
            sp.Children.Add(new TextBlock { Text = "Get your booth into the event", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });
            string[] items =
            {
                "1.  Install the Legends Alley SDK through the VRChat Creator Companion.",
                "2.  Open Legends Alley in Unity and sign in with this Discord account (or your booth manager's).",
                "3.  Build your booth inside the plot bounds and press Build + Upload. It shows up here.",
            };
            foreach (string s in items) sp.Children.Add(AlleyUi.Muted(s));
            steps.Child = sp;
            OverviewTab.Children.Add(steps);
        }
    }

    // ------------------------------------------------------------ profile

    private TextBox? _descBox;
    private TextBox? _inviteBox;
    private StackPanel? _socialsList;
    private TextBlock? _profileStatus;
    private PersonPicture? _profileLogo;

    private void BuildProfile()
    {
        ProfileTab.Children.Clear();
        var c = _me?.Community;
        if (c == null)
        {
            var na = AlleyUi.Card(20);
            na.Child = AlleyUi.EmptyState("\uE716", "No community linked", "There is no profile to edit on this account.");
            ProfileTab.Children.Add(na);
            return;
        }

        if (!IsOwner)
        {
            var notice = AlleyUi.Card(14);
            var nsp = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            nsp.Children.Add(new FontIcon { Glyph = "\uE7B3", FontSize = 14, Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"] });
            nsp.Children.Add(AlleyUi.Muted("You are the booth manager, so the profile is read-only here. The community owner can edit it."));
            notice.Child = nsp;
            ProfileTab.Children.Add(notice);
        }

        // logo card
        var logoCard = AlleyUi.Card(18);
        var logoGrid = new Grid { ColumnSpacing = 14 };
        logoGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        logoGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        _profileLogo = new PersonPicture { Width = 64, Height = 64, DisplayName = c.Name };
        LoadLogo(_profileLogo, c.LogoUrl);
        logoGrid.Children.Add(_profileLogo);
        var logoRight = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        if (IsOwner)
        {
            var changeBtn = new Button();
            changeBtn.Content = new StackPanel
            {
                Orientation = Orientation.Horizontal,
                Spacing = 8,
                Children = { new FontIcon { Glyph = "\uEB9F", FontSize = 13 }, new TextBlock { Text = "Change logo" } },
            };
            changeBtn.Click += async (_, _) => await ChangeLogoAsync();
            logoRight.Children.Add(changeBtn);
        }
        logoRight.Children.Add(AlleyUi.Muted("Shown with your booth in the event world, on the website and in the SDK. PNG, JPEG or WebP up to 2 MB.", 11));
        Grid.SetColumn(logoRight, 1);
        logoGrid.Children.Add(logoRight);
        logoCard.Child = logoGrid;
        ProfileTab.Children.Add(logoCard);

        // about card
        var about = AlleyUi.Card(18);
        var asp = new StackPanel { Spacing = 12 };
        asp.Children.Add(new TextBlock { Text = "About your community", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });

        _descBox = new TextBox
        {
            Header = "Description",
            Text = c.Description ?? "",
            AcceptsReturn = true,
            TextWrapping = TextWrapping.Wrap,
            MaxLength = 500,
            Height = 100,
            IsEnabled = IsOwner,
        };
        asp.Children.Add(_descBox);

        _inviteBox = new TextBox
        {
            Header = "Discord invite",
            Text = c.InviteUrl ?? "",
            PlaceholderText = "https://discord.gg/...",
            IsEnabled = IsOwner,
        };
        asp.Children.Add(_inviteBox);
        asp.Children.Add(AlleyUi.Muted("A permanent discord.gg invite to your server.", 11));

        asp.Children.Add(new TextBlock { Text = "Social links", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 13, Margin = new Thickness(0, 4, 0, 0) });
        _socialsList = new StackPanel { Spacing = 6 };
        foreach (string s in c.Socials.Take(5)) AddSocialRow(s);
        asp.Children.Add(_socialsList);

        if (IsOwner)
        {
            var addLink = new Button { Content = "+ Add link", FontSize = 12 };
            addLink.Click += (_, _) => { if (_socialsList!.Children.Count < 5) AddSocialRow(""); };
            asp.Children.Add(addLink);

            var saveRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(0, 6, 0, 0) };
            var saveBtn = new Button { Content = "Save profile", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
            saveBtn.Click += async (_, _) => await SaveProfileAsync(saveBtn);
            saveRow.Children.Add(saveBtn);
            _profileStatus = new TextBlock { FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)Application.Current.Resources["AlleyTealBrush"] };
            saveRow.Children.Add(_profileStatus);
            asp.Children.Add(saveRow);
        }

        about.Child = asp;
        ProfileTab.Children.Add(about);
    }

    private void AddSocialRow(string value)
    {
        var row = new Grid { ColumnSpacing = 6 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var box = new TextBox { Text = value, PlaceholderText = "https://...", IsEnabled = IsOwner, MaxLength = 160 };
        row.Children.Add(box);
        if (IsOwner)
        {
            var del = new Button { Content = new FontIcon { Glyph = "\uE74D", FontSize = 12 } };
            del.Click += (_, _) => _socialsList!.Children.Remove(row);
            Grid.SetColumn(del, 1);
            row.Children.Add(del);
        }
        _socialsList!.Children.Add(row);
    }

    private async Task SaveProfileAsync(Button saveBtn)
    {
        saveBtn.IsEnabled = false;
        saveBtn.Content = "Saving...";
        var socials = new List<string>();
        foreach (var child in _socialsList!.Children)
        {
            if (child is Grid g && g.Children[0] is TextBox tb && !string.IsNullOrWhiteSpace(tb.Text))
                socials.Add(tb.Text.Trim());
        }
        var res = await AlleyApi.PatchMyCommunityAsync(new
        {
            description = _descBox!.Text.Trim(),
            inviteUrl = _inviteBox!.Text.Trim(),
            socials,
        });
        saveBtn.IsEnabled = true;
        saveBtn.Content = "Save profile";
        _profileStatus!.Text = res.Ok ? "Profile saved." : "Save failed: " + res.Error;
        _profileStatus.Foreground = res.Ok
            ? (Brush)Application.Current.Resources["AlleyTealBrush"]
            : new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFF, 0x6B, 0x81));
        if (res.Ok)
        {
            AudioService.Success();
            if (_me?.Community != null)
            {
                _me.Community.Description = _descBox.Text.Trim();
                _me.Community.InviteUrl = _inviteBox.Text.Trim();
                _me.Community.Socials = socials;
            }
            BuildOverview();
        }
    }

    private async Task ChangeLogoAsync()
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
            if (_profileStatus != null) _profileStatus.Text = "Logo must be under 2 MB.";
            return;
        }
        string ct = file.FileType.ToLowerInvariant() switch
        {
            ".png" => "image/png",
            ".webp" => "image/webp",
            _ => "image/jpeg",
        };
        var res = await AlleyApi.UploadMyLogoAsync(bytes, ct);
        if (res.Ok)
        {
            AudioService.Success();
            if (_me?.Community != null && !string.IsNullOrEmpty(res.Data)) _me.Community.LogoUrl = res.Data!;
            if (_profileLogo != null) LoadLogo(_profileLogo, res.Data ?? "");
            BuildOverview();
        }
        else if (_profileStatus != null)
        {
            _profileStatus.Text = "Upload failed: " + res.Error;
        }
    }

    // ------------------------------------------------------------ team

    private StackPanel? _memberList;
    private TextBlock? _teamStatus;

    private void BuildTeam()
    {
        TeamTab.Children.Clear();
        var c = _me?.Community;
        if (c == null)
        {
            var na = AlleyUi.Card(20);
            na.Child = AlleyUi.EmptyState("\uE716", "No community linked", "There is no team to manage on this account.");
            TeamTab.Children.Add(na);
            return;
        }

        // booth manager card
        var mgrCard = AlleyUi.Card(18);
        var msp = new StackPanel { Spacing = 12 };
        msp.Children.Add(new TextBlock { Text = "Booth manager", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });
        msp.Children.Add(AlleyUi.Muted("A booth manager is one extra Discord account that can sign in to the SDK and this dashboard to build and upload your community's booth. They cannot edit the profile or change the team."));

        // owner row
        var ownerRow = PersonRow("\uE734", Windows.UI.Color.FromArgb(255, 0xFF, 0xD7, 0x00),
            string.IsNullOrEmpty(c.OwnerUsername) ? "Owner" : c.OwnerUsername,
            $"Owner ({c.OwnerDiscordId})", AlleyUi.Chip("owner"));
        msp.Children.Add(ownerRow);

        if (!string.IsNullOrEmpty(c.ManagerDiscordId))
        {
            FrameworkElement trailing;
            if (IsOwner)
            {
                var removeBtn = new Button
                {
                    Content = "Remove",
                    Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFF, 0x6B, 0x81)),
                };
                removeBtn.Click += async (_, _) => await RemoveManagerAsync();
                trailing = removeBtn;
            }
            else
            {
                trailing = AlleyUi.Chip("you");
            }
            msp.Children.Add(PersonRow("\uE816", Windows.UI.Color.FromArgb(255, 0x00, 0xE6, 0xCC),
                string.IsNullOrEmpty(c.ManagerUsername) ? "Waiting for first sign in" : c.ManagerUsername,
                $"Booth manager ({c.ManagerDiscordId})", trailing));
        }
        else if (IsOwner)
        {
            var addPanel = new StackPanel { Spacing = 8, Margin = new Thickness(0, 4, 0, 0) };
            addPanel.Children.Add(new TextBlock
            {
                Text = "ADD A BOOTH MANAGER",
                FontSize = 10,
                CharacterSpacing = 100,
                Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
            });
            var addRow = new Grid { ColumnSpacing = 8 };
            addRow.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            addRow.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var idBox = new TextBox { PlaceholderText = "Discord user ID", MaxLength = 25 };
            addRow.Children.Add(idBox);
            var addBtn = new Button { Content = "Add manager", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
            addBtn.Click += async (_, _) => await SetManagerAsync(idBox.Text.Trim());
            Grid.SetColumn(addBtn, 1);
            addRow.Children.Add(addBtn);
            addPanel.Children.Add(addRow);
            addPanel.Children.Add(AlleyUi.Muted("In Discord: Settings, Advanced, turn on Developer Mode, then right click their name and Copy User ID.", 11));
            msp.Children.Add(addPanel);
        }
        else
        {
            msp.Children.Add(AlleyUi.Muted("No booth manager is set."));
        }

        mgrCard.Child = msp;
        TeamTab.Children.Add(mgrCard);

        // team members card
        var teamCard = AlleyUi.Card(18);
        var tsp = new StackPanel { Spacing = 10 };
        tsp.Children.Add(new TextBlock { Text = "Team members", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });
        tsp.Children.Add(AlleyUi.Muted("The people helping run your booth, shown on your community profile. Enter usernames exactly as they appear on VRChat, up to 8. Add their Discord ID too and the bot gives them your community's roles in the Legends Alley server."));

        _memberList = new StackPanel { Spacing = 6 };
        foreach (var m in c.TeamMembers.Take(8)) AddMemberRow(m.Name, m.DiscordId);
        if (c.TeamMembers.Count == 0 && !IsOwner) tsp.Children.Add(AlleyUi.Muted("No team members listed."));
        tsp.Children.Add(_memberList);

        if (IsOwner)
        {
            var addMember = new Button { Content = "+ Add team member", FontSize = 12 };
            addMember.Click += (_, _) => { if (_memberList!.Children.Count < 8) AddMemberRow("", ""); };
            tsp.Children.Add(addMember);

            var saveRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
            var saveBtn = new Button { Content = "Save team members", Style = (Style)Application.Current.Resources["AccentButtonStyle"] };
            saveBtn.Click += async (_, _) => await SaveTeamAsync(saveBtn);
            saveRow.Children.Add(saveBtn);
            _teamStatus = new TextBlock { FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)Application.Current.Resources["AlleyTealBrush"] };
            saveRow.Children.Add(_teamStatus);
            tsp.Children.Add(saveRow);
        }

        teamCard.Child = tsp;
        TeamTab.Children.Add(teamCard);

        // discord roles card
        var rolesCard = AlleyUi.Card(18);
        var rsp = new StackPanel { Spacing = 10 };
        rsp.Children.Add(new TextBlock { Text = "Discord roles", FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 15 });
        rsp.Children.Add(AlleyUi.Muted(
            $"Everyone here gets roles in the Legends Alley Discord automatically: a {c.Name} role for the whole team, plus {c.Name} Booth Manager and {c.Name} Team Member. Anyone not in the server is skipped. If someone joined the server after being added, sync to hand out what is missing."));
        var syncRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10 };
        var syncBtn = new Button();
        syncBtn.Content = new StackPanel
        {
            Orientation = Orientation.Horizontal,
            Spacing = 8,
            Children = { new FontIcon { Glyph = "\uE72C", FontSize = 13 }, new TextBlock { Text = "Sync Discord roles" } },
        };
        var syncStatus = new TextBlock { FontSize = 12, VerticalAlignment = VerticalAlignment.Center, Foreground = (Brush)Application.Current.Resources["AlleyTealBrush"] };
        syncBtn.Click += async (_, _) =>
        {
            syncBtn.IsEnabled = false;
            var res = await AlleyApi.SyncDiscordRolesAsync();
            syncBtn.IsEnabled = true;
            syncStatus.Text = res.Ok ? "Role sync requested." : (res.Status == 429 ? "Can be used once every 10 minutes." : "Sync failed: " + res.Error);
        };
        syncRow.Children.Add(syncBtn);
        syncRow.Children.Add(syncStatus);
        rsp.Children.Add(syncRow);
        rsp.Children.Add(AlleyUi.Muted("Can be used once every 10 minutes.", 11));
        rolesCard.Child = rsp;
        TeamTab.Children.Add(rolesCard);
    }

    private Grid PersonRow(string glyph, Windows.UI.Color glyphColor, string name, string subtitle, FrameworkElement trailing)
    {
        var row = new Grid { ColumnSpacing = 12 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        row.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 18,
            Foreground = new SolidColorBrush(glyphColor),
            VerticalAlignment = VerticalAlignment.Center,
        });
        var mid = new StackPanel { Spacing = 1, VerticalAlignment = VerticalAlignment.Center };
        mid.Children.Add(new TextBlock { Text = name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, FontSize = 13 });
        mid.Children.Add(AlleyUi.Muted(subtitle, 11));
        Grid.SetColumn(mid, 1);
        row.Children.Add(mid);
        trailing.VerticalAlignment = VerticalAlignment.Center;
        Grid.SetColumn(trailing, 2);
        row.Children.Add(trailing);
        return row;
    }

    private void AddMemberRow(string name, string discordId)
    {
        var row = new Grid { ColumnSpacing = 6 };
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
        row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
        var nameBox = new TextBox { Text = name, PlaceholderText = "VRChat username", MaxLength = 32, IsEnabled = IsOwner };
        row.Children.Add(nameBox);
        var idBox = new TextBox { Text = discordId, PlaceholderText = "Discord ID (optional)", MaxLength = 25, IsEnabled = IsOwner };
        Grid.SetColumn(idBox, 1);
        row.Children.Add(idBox);
        if (IsOwner)
        {
            var del = new Button { Content = new FontIcon { Glyph = "\uE74D", FontSize = 12 } };
            del.Click += (_, _) => _memberList!.Children.Remove(row);
            Grid.SetColumn(del, 2);
            row.Children.Add(del);
        }
        _memberList!.Children.Add(row);
    }

    private async Task SaveTeamAsync(Button saveBtn)
    {
        saveBtn.IsEnabled = false;
        saveBtn.Content = "Saving...";
        var members = new List<object>();
        foreach (var child in _memberList!.Children)
        {
            if (child is Grid g && g.Children[0] is TextBox nb && g.Children[1] is TextBox ib)
            {
                string n = nb.Text.Trim();
                if (n.Length < 2) continue;
                string id = ib.Text.Trim();
                members.Add(string.IsNullOrEmpty(id) ? new { name = n } : (object)new { name = n, discordId = id });
            }
        }
        var res = await AlleyApi.PatchMyCommunityAsync(new { teamMembers = members });
        saveBtn.IsEnabled = true;
        saveBtn.Content = "Save team members";
        _teamStatus!.Text = res.Ok ? "Team saved." : "Save failed: " + res.Error;
        if (res.Ok) AudioService.Success();
    }

    private async Task SetManagerAsync(string discordId)
    {
        if (string.IsNullOrEmpty(discordId)) return;
        var res = await AlleyApi.SetManagerAsync(discordId);
        if (res.Ok)
        {
            AudioService.Success();
            if (_me?.Community != null) { _me.Community.ManagerDiscordId = discordId; _me.Community.ManagerUsername = ""; }
            BuildTeam();
            BuildOverview();
        }
    }

    private async Task RemoveManagerAsync()
    {
        var dialog = new ContentDialog
        {
            Title = "Remove booth manager?",
            Content = "Their SDK and dashboard access ends immediately. You can add them back any time.",
            PrimaryButtonText = "Remove manager",
            CloseButtonText = "Cancel",
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        var res = await AlleyApi.RemoveManagerAsync();
        if (res.Ok)
        {
            if (_me?.Community != null) { _me.Community.ManagerDiscordId = ""; _me.Community.ManagerUsername = ""; }
            BuildTeam();
            BuildOverview();
        }
    }

    // ------------------------------------------------------------ booths

    private void BuildBooths()
    {
        BoothsTab.Children.Clear();
        if (_booths.Count == 0)
        {
            var card = AlleyUi.Card(20);
            card.Child = AlleyUi.EmptyState("\uE7B8", "No booth uploads yet",
                "Build and upload your booth from the Legends Alley SDK in Unity. Every upload shows up here with its build stats.");
            BoothsTab.Children.Add(card);
            return;
        }

        foreach (var b in _booths.OrderByDescending(x => x.Version))
        {
            var card = AlleyUi.Card(14);
            var grid = new Grid { ColumnSpacing = 14 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var preview = new Border
            {
                Width = 84,
                Height = 84,
                CornerRadius = new CornerRadius(8),
                Background = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0x0D, 0x11, 0x17)),
            };
            var img = new Image { Stretch = Microsoft.UI.Xaml.Media.Stretch.UniformToFill };
            preview.Child = img;
            AlleyUi.AuthImage(img, b.PreviewUrl);
            grid.Children.Add(preview);

            var mid = new StackPanel { Spacing = 5, VerticalAlignment = VerticalAlignment.Center };
            var titleRow = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
            titleRow.Children.Add(new TextBlock
            {
                Text = string.IsNullOrEmpty(b.PrefabName) ? $"Booth v{b.Version}" : b.PrefabName,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            });
            titleRow.Children.Add(AlleyUi.Muted($"v{b.Version}", 11));
            titleRow.Children.Add(AlleyUi.Chip(b.Status));
            mid.Children.Add(titleRow);

            var stats = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 14 };
            stats.Children.Add(AlleyUi.IconText("\uE8B5", AlleyUi.FormatMB(b.FileSize)));
            if (b.Stats != null)
            {
                stats.Children.Add(AlleyUi.IconText("\uE879", $"{b.Stats.Triangles:N0} tris"));
                stats.Children.Add(AlleyUi.IconText("\uE790", $"{b.Stats.MaterialSlots} materials"));
            }
            if (!string.IsNullOrEmpty(b.UploadedAt)) stats.Children.Add(AlleyUi.IconText("\uE823", AlleyUi.LocalTime(b.UploadedAt)));
            mid.Children.Add(stats);
            Grid.SetColumn(mid, 1);
            grid.Children.Add(mid);

            card.Child = grid;
            Anim.Lift(card);
            BoothsTab.Children.Add(card);
        }
    }

    // ------------------------------------------------------------ shared

    private async void LoadLogo(PersonPicture pic, string logoUrl)
    {
        if (string.IsNullOrEmpty(logoUrl)) return;
        if (logoUrl.StartsWith("http", StringComparison.OrdinalIgnoreCase))
        {
            try { pic.ProfilePicture = new BitmapImage(new Uri(logoUrl)); } catch { }
            return;
        }
        byte[]? data = await AlleyApi.GetBytesAsync(logoUrl);
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
