using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;

namespace BoothManager.Pages;

public sealed partial class AdminPage : Page
{
    public AdminPage()
    {
        InitializeComponent();
        Loaded += (_, _) => _ = LoadAsync();
    }

    private async Task LoadAsync()
    {
        var r = await ApiClient.GetLinksAsync();
        if (!r.Ok || r.Data == null)
        {
            StatusBar.Title = "Could not load devices";
            StatusBar.Message = r.Error;
            StatusBar.Severity = InfoBarSeverity.Error;
            StatusBar.IsOpen = true;
            return;
        }

        LinksPanel.Children.Clear();
        EmptyText.Visibility = r.Data.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
        foreach (var link in r.Data.OrderByDescending(l => l.LastSeenAt))
        {
            var grid = new Grid { ColumnSpacing = 12 };
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            grid.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });

            var avatar = new PersonPicture { Width = 36, Height = 36, DisplayName = link.DiscordUsername };
            grid.Children.Add(avatar);

            var info = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Center };
            info.Children.Add(new TextBlock { Text = link.DiscordUsername, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            string roles = link.TeamRoles.Count > 0 ? string.Join(", ", link.TeamRoles) : "site admin";
            info.Children.Add(new TextBlock
            {
                Text = $"{link.DiscordId}  |  {roles}  |  last seen {Helpers.TimeAgo(link.LastSeenAt)}",
                FontSize = 11,
                Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
            });
            Grid.SetColumn(info, 1);
            grid.Children.Add(info);

            bool isAdmin = link.Role == "admin";
            var badge = new Border
            {
                Background = new SolidColorBrush(isAdmin
                    ? Windows.UI.Color.FromArgb(0x33, 0x00, 0xE6, 0xCC)
                    : Windows.UI.Color.FromArgb(0x33, 0x8B, 0x95, 0xA0)),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(10, 3, 10, 3),
                VerticalAlignment = VerticalAlignment.Center,
                Child = new TextBlock
                {
                    Text = isAdmin ? "ADMIN" : "TEAM",
                    FontSize = 11,
                    FontWeight = Microsoft.UI.Text.FontWeights.Bold,
                    Foreground = new SolidColorBrush(isAdmin
                        ? Windows.UI.Color.FromArgb(0xFF, 0x00, 0xE6, 0xCC)
                        : Windows.UI.Color.FromArgb(0xFF, 0xB8, 0xC2, 0xCC)),
                },
            };
            Grid.SetColumn(badge, 2);
            grid.Children.Add(badge);

            var revoke = new Button
            {
                Content = "Revoke",
                Tag = link,
                VerticalAlignment = VerticalAlignment.Center,
            };
            revoke.Click += Revoke_Click;
            Grid.SetColumn(revoke, 3);
            grid.Children.Add(revoke);

            LinksPanel.Children.Add(new Border
            {
                Background = (Brush)Application.Current.Resources["AlleyCardBrush"],
                BorderBrush = (Brush)Application.Current.Resources["AlleyCardBorderBrush"],
                BorderThickness = new Thickness(1),
                CornerRadius = new CornerRadius(10),
                Padding = new Thickness(14, 10, 14, 10),
                Child = grid,
            });
        }
    }

    private async void Revoke_Click(object sender, RoutedEventArgs e)
    {
        if (((Button)sender).Tag is not DeviceLink link) return;
        var dialog = new ContentDialog
        {
            Title = "Revoke device?",
            Content = $"{link.DiscordUsername} will be signed out of Booth Manager and will need to log in again.",
            PrimaryButtonText = "Revoke",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        await ApiClient.RevokeLinkAsync(link.DiscordId);
        await LoadAsync();
    }

    private void RefreshBtn_Click(object sender, RoutedEventArgs e) => _ = LoadAsync();
}
