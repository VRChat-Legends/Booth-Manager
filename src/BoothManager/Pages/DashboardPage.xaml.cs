using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace BoothManager.Pages;

public sealed partial class DashboardPage : Page
{
    private DispatcherTimer? _countdownTimer;
    private DateTimeOffset? _eventStart;

    public DashboardPage()
    {
        InitializeComponent();
        Anim.Entrance(RootPanel);
        Loaded += DashboardPage_Loaded;
        Unloaded += (_, _) => _countdownTimer?.Stop();
    }

    private async void DashboardPage_Loaded(object sender, RoutedEventArgs e)
    {
        WelcomeText.Text = $"Welcome back, {Session.Username}";
        SubText.Text = Session.IsAdmin
            ? "Site admin: you can see and manage every Legends Alley booth."
            : "Team member: you can edit the booths assigned to you.";
        TileBoothsLabel.Text = Session.IsAdmin ? "Booths (all)" : "Your booths";
        LinkAdmin.Visibility = Session.IsAdmin ? Visibility.Visible : Visibility.Collapsed;

        var landingTask = LoadLandingAsync();
        await LoadBoothsAsync();
        await landingTask;
    }

    private async Task LoadLandingAsync()
    {
        var res = await ApiClient.GetAlleyLandingAsync();
        if (!res.Ok || res.Data == null) return;
        var landing = res.Data;

        if (landing.Event != null)
        {
            EventHero.Visibility = Visibility.Visible;
            EventName.Text = landing.Event.Name;
            EventDate.Text = landing.Event.DisplayDate;

            // countdown target: prefer live event dates from the Alley service,
            // otherwise fall back to the site's published start (Sept 5 EDT)
            _eventStart = new DateTimeOffset(landing.Event.Year, 9, 5, 0, 0, 0, TimeSpan.FromHours(-4));
            if (AlleyApi.IsConnected)
            {
                var ev = await AlleyApi.EventsAsync();
                var match = ev.Data?.FirstOrDefault(x => !string.IsNullOrEmpty(x.StartsAt));
                if (match != null && DateTimeOffset.TryParse(match.StartsAt, out var startsAt))
                {
                    _eventStart = startsAt;
                }
            }
            UpdateCountdown();
            _countdownTimer = new DispatcherTimer { Interval = TimeSpan.FromSeconds(30) };
            _countdownTimer.Tick += (_, _) => UpdateCountdown();
            _countdownTimer.Start();
        }

        LineupPanel.Items.Clear();
        var comms = landing.Communities;
        LineupCount.Text = comms.Count == 0 ? "" : $"{comms.Count} communities";
        EventLineupNote.Text = comms.Count == 0 ? "Lineup coming soon" : $"{comms.Count} communities confirmed for the lineup";
        LineupEmpty.Visibility = comms.Count == 0 ? Visibility.Visible : Visibility.Collapsed;

        foreach (var c in comms)
        {
            var grid = new Grid { ColumnSpacing = 10, Padding = new Thickness(12, 10, 12, 10) };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });

            var pic = new PersonPicture { Width = 40, Height = 40, DisplayName = c.Name };
            if (!string.IsNullOrEmpty(c.LogoUrl))
            {
                try { pic.ProfilePicture = new BitmapImage(new Uri(c.LogoUrl)); } catch { }
            }
            grid.Children.Add(pic);

            var sp = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 1 };
            sp.Children.Add(new TextBlock
            {
                Text = c.Name,
                FontSize = 13,
                FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxLines = 1,
            });
            sp.Children.Add(new TextBlock
            {
                Text = c.Description,
                FontSize = 11,
                Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyMutedBrush"],
                TextTrimming = TextTrimming.CharacterEllipsis,
                MaxLines = 2,
                TextWrapping = TextWrapping.Wrap,
            });
            Grid.SetColumn(sp, 1);
            grid.Children.Add(sp);

            var card = new Border
            {
                Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyCardBrush"],
                BorderBrush = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyCardBorderBrush"],
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Margin = new Thickness(0, 0, 8, 8),
                Child = grid,
            };
            if (!string.IsNullOrEmpty(c.PublicUrl))
            {
                string url = c.PublicUrl;
                card.PointerReleased += (_, _) => Helpers.OpenUrl(url);
            }
            Anim.Lift(card);
            LineupPanel.Items.Add(card);
        }
    }

    private void UpdateCountdown()
    {
        if (_eventStart == null) return;
        var left = _eventStart.Value - DateTimeOffset.Now;
        if (left <= TimeSpan.Zero)
        {
            CdDays.Text = "LIVE";
            CdHours.Text = "";
            CdMins.Text = "";
            return;
        }
        CdDays.Text = ((int)left.TotalDays).ToString();
        CdHours.Text = left.Hours.ToString();
        CdMins.Text = left.Minutes.ToString();
    }

    private async Task LoadBoothsAsync()
    {
        var r = await ApiClient.GetBoothsAsync();
        if (!r.Ok || r.Data == null)
        {
            StatusBar.Title = "Could not load booths";
            StatusBar.Message = r.Error;
            StatusBar.Severity = InfoBarSeverity.Error;
            StatusBar.IsOpen = true;
            return;
        }

        var booths = r.Data;
        TileBooths.Text = booths.Count.ToString();
        TilePublished.Text = booths.Count(b => b.Published).ToString();
        TileImages.Text = booths.Sum(b => b.Images.Count).ToString();
        TileWorlds.Text = booths.Sum(b => b.WorldIds.Count).ToString();

        RecentList.Children.Clear();
        var recent = booths.OrderByDescending(b => b.UpdatedAt).Take(6).ToList();
        EmptyText.Visibility = recent.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var b in recent)
        {
            var panel = new StackPanel { Spacing = 2 };
            panel.Children.Add(new TextBlock { Text = b.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            panel.Children.Add(new TextBlock
            {
                Text = $"{(b.Published ? "Published" : "Draft")}  |  {b.Images.Count} images  |  edited {Helpers.TimeAgo(b.UpdatedAt)}",
                FontSize = 12,
                Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyMutedBrush"],
            });
            var card = new Border
            {
                Background = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyCardBrush"],
                BorderBrush = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyCardBorderBrush"],
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(14, 10, 14, 10),
                Child = panel,
            };
            Anim.Lift(card);
            RecentList.Children.Add(card);
        }
        Anim.FadeInChildren(RecentList);
    }

    private void GoBoothsBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("booths");
    private void GoBuilderBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("builder");
    private void GoStandeeBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("standee");
    private void GoAtlasBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("atlas");

    private void WebLink_Click(object sender, RoutedEventArgs e)
    {
        if (sender is HyperlinkButton btn && btn.Tag is string url) Helpers.OpenUrl(url);
    }
}
