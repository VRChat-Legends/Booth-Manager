using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BoothManager.Pages;

public sealed partial class DashboardPage : Page
{
    public DashboardPage()
    {
        InitializeComponent();
        Loaded += DashboardPage_Loaded;
    }

    private async void DashboardPage_Loaded(object sender, RoutedEventArgs e)
    {
        WelcomeText.Text = $"Welcome back, {Session.Username}";
        SubText.Text = Session.IsAdmin
            ? "Site admin: you can see and manage every Legends Alley booth."
            : "Team member: you can edit the booths assigned to you.";
        TileBoothsLabel.Text = Session.IsAdmin ? "Booths (all)" : "Your booths";

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
            RecentList.Children.Add(card);
        }
    }

    private void GoBoothsBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("booths");
    private void GoStandeeBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("standee");
    private void GoAtlasBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("atlas");
}
