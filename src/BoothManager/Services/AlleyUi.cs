using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;
using Windows.Storage.Streams;

namespace BoothManager.Services;

/// <summary>Shared building blocks for the Alley dashboard/admin pages (mirrors the website look).</summary>
public static class AlleyUi
{
    public static Border Card(double padding = 18) => new()
    {
        Background = (Brush)Application.Current.Resources["AlleyCardBrush"],
        BorderBrush = (Brush)Application.Current.Resources["AlleyCardBorderBrush"],
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(12),
        Padding = new Thickness(padding),
    };

    public static TextBlock Muted(string text, double size = 12) => new()
    {
        Text = text,
        FontSize = size,
        Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
        TextWrapping = TextWrapping.Wrap,
    };

    /// <summary>Status chip with website color conventions.</summary>
    public static Border Chip(string status)
    {
        byte bgA, bgR, bgG, bgB, fgR, fgG, fgB;
        switch (status.ToLowerInvariant())
        {
            case "active":
            case "approved":
                bgA = 0x2E; bgR = 0x10; bgG = 0xB9; bgB = 0x81; fgR = 0x34; fgG = 0xD3; fgB = 0x99; // emerald
                break;
            case "open":
            case "owner":
            case "you":
            case "uploads open":
                bgA = 0x2E; bgR = 0x00; bgG = 0xE6; bgB = 0xCC; fgR = 0x00; fgG = 0xE6; fgB = 0xCC; // teal
                break;
            case "pending":
                bgA = 0x2E; bgR = 0xF5; bgG = 0x9E; bgB = 0x0B; fgR = 0xFC; fgG = 0xD3; fgB = 0x4D; // amber
                break;
            case "rejected":
                bgA = 0x2E; bgR = 0xEF; bgG = 0x44; bgB = 0x44; fgR = 0xFC; fgG = 0x8B; fgB = 0x8B; // red
                break;
            default:
                bgA = 0x22; bgR = 0x8B; bgG = 0x95; bgB = 0xA0; fgR = 0xA8; fgG = 0xB2; fgB = 0xBD; // gray
                break;
        }
        return new Border
        {
            Background = new SolidColorBrush(Windows.UI.Color.FromArgb(bgA, bgR, bgG, bgB)),
            CornerRadius = new CornerRadius(10),
            Padding = new Thickness(9, 2, 9, 3),
            VerticalAlignment = VerticalAlignment.Center,
            Child = new TextBlock
            {
                Text = status.ToUpperInvariant(),
                FontSize = 10,
                FontWeight = Microsoft.UI.Text.FontWeights.Bold,
                CharacterSpacing = 60,
                Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, fgR, fgG, fgB)),
            },
        };
    }

    /// <summary>Amber "LIMITS BYPASS" badge.</summary>
    public static Border BypassBadge() => new()
    {
        Background = new SolidColorBrush(Windows.UI.Color.FromArgb(0x1A, 0xF5, 0x9E, 0x0B)),
        BorderBrush = new SolidColorBrush(Windows.UI.Color.FromArgb(0x4D, 0xF5, 0x9E, 0x0B)),
        BorderThickness = new Thickness(1),
        CornerRadius = new CornerRadius(10),
        Padding = new Thickness(9, 2, 9, 3),
        VerticalAlignment = VerticalAlignment.Center,
        Child = new TextBlock
        {
            Text = "LIMITS BYPASS",
            FontSize = 10,
            FontWeight = Microsoft.UI.Text.FontWeights.Bold,
            CharacterSpacing = 60,
            Foreground = new SolidColorBrush(Windows.UI.Color.FromArgb(255, 0xFC, 0xD3, 0x4D)),
        },
    };

    public static Border StatTile(string glyph, string label, out TextBlock valueBlock)
    {
        var value = new TextBlock { Text = "...", FontSize = 26, FontWeight = Microsoft.UI.Text.FontWeights.Bold };
        valueBlock = value;
        var card = Card();
        var sp = new StackPanel { Spacing = 6 };
        var head = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 8 };
        head.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 13,
            Foreground = (Brush)Application.Current.Resources["AlleyTealBrush"],
        });
        head.Children.Add(new TextBlock
        {
            Text = label.ToUpperInvariant(),
            FontSize = 10,
            CharacterSpacing = 100,
            Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
            VerticalAlignment = VerticalAlignment.Center,
        });
        sp.Children.Add(head);
        sp.Children.Add(value);
        card.Child = sp;
        Anim.Lift(card);
        return card;
    }

    /// <summary>Loads an auth-required alley image (booth preview, logo) into an Image control.</summary>
    public static async void AuthImage(Image img, string url)
    {
        if (string.IsNullOrEmpty(url)) return;
        try
        {
            string path = url.StartsWith("http", StringComparison.OrdinalIgnoreCase)
                ? new Uri(url).PathAndQuery
                : url;
            byte[]? data = await AlleyApi.GetBytesAsync(path);
            if (data == null || data.Length == 0) return;

            var ms = new InMemoryRandomAccessStream();
            await ms.WriteAsync(data.AsBuffer());
            ms.Seek(0);
            var bmp = new BitmapImage();
            await bmp.SetSourceAsync(ms);
            img.Source = bmp;
        }
        catch
        {
            // leave placeholder
        }
    }

    public static string FormatMB(long bytes) => $"{bytes / 1024.0 / 1024.0:0.0} MB";

    public static string LocalTime(string iso) =>
        DateTimeOffset.TryParse(iso, out var d) ? d.LocalDateTime.ToString("MMM d, yyyy h:mm tt") : iso;

    /// <summary>Website deadline wording: "N days left" / "Deadline is today" / "Deadline passed".</summary>
    public static string DeadlineCountdown(string iso)
    {
        if (!DateTimeOffset.TryParse(iso, out var deadline)) return "";
        int days = (int)Math.Ceiling((deadline - DateTimeOffset.Now).TotalDays);
        if (days < 0) return "Deadline passed";
        if (days == 0) return "Deadline is today";
        return $"{days} day{(days == 1 ? "" : "s")} left";
    }

    public static StackPanel IconText(string glyph, string text)
    {
        var sp = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };
        sp.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 12,
            Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
            VerticalAlignment = VerticalAlignment.Center,
        });
        sp.Children.Add(Muted(text));
        return sp;
    }

    public static StackPanel EmptyState(string glyph, string title, string hint)
    {
        var sp = new StackPanel { Spacing = 8, HorizontalAlignment = HorizontalAlignment.Center, Margin = new Thickness(0, 36, 0, 36) };
        sp.Children.Add(new FontIcon
        {
            Glyph = glyph,
            FontSize = 34,
            Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        sp.Children.Add(new TextBlock
        {
            Text = title,
            FontSize = 15,
            FontWeight = Microsoft.UI.Text.FontWeights.SemiBold,
            HorizontalAlignment = HorizontalAlignment.Center,
        });
        var hintBlock = Muted(hint);
        hintBlock.HorizontalAlignment = HorizontalAlignment.Center;
        hintBlock.TextAlignment = TextAlignment.Center;
        hintBlock.MaxWidth = 420;
        sp.Children.Add(hintBlock);
        return sp;
    }
}
