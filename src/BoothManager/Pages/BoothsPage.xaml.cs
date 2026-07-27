using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BoothManager.Pages;

public sealed partial class BoothsPage : Page
{
    private List<Booth> _booths = new();
    private Booth? _selected;

    public BoothsPage()
    {
        InitializeComponent();
        Loaded += (_, _) => _ = LoadAsync(null);
        bool admin = Session.IsAdmin;
        NewBtn.Visibility = admin ? Visibility.Visible : Visibility.Collapsed;
        DeleteBtn.Visibility = admin ? Visibility.Visible : Visibility.Collapsed;
        AdminOnlyPanel.Visibility = admin ? Visibility.Visible : Visibility.Collapsed;
    }

    private static string[] Lines(string text) =>
        text.Split('\n').Select(l => l.Trim()).Where(l => l.Length > 0).ToArray();

    private async Task LoadAsync(string? selectId)
    {
        var r = await ApiClient.GetBoothsAsync();
        if (!r.Ok || r.Data == null)
        {
            ShowStatus("Could not load booths", r.Error, InfoBarSeverity.Error);
            return;
        }
        _booths = r.Data;
        BoothList.Items.Clear();
        foreach (var b in _booths)
        {
            var panel = new StackPanel { Spacing = 2, Margin = new Thickness(4) };
            panel.Children.Add(new TextBlock { Text = b.Name, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            panel.Children.Add(new TextBlock
            {
                Text = $"{(b.Published ? "Published" : "Draft")}  |  edited {Helpers.TimeAgo(b.UpdatedAt)}",
                FontSize = 11,
                Foreground = (Microsoft.UI.Xaml.Media.Brush)Application.Current.Resources["AlleyMutedBrush"],
            });
            BoothList.Items.Add(new ListViewItem { Content = panel, Tag = b.Id });
        }
        if (selectId != null)
        {
            foreach (var item in BoothList.Items.Cast<ListViewItem>())
                if ((string)item.Tag == selectId) { BoothList.SelectedItem = item; break; }
        }
        else if (_selected != null)
        {
            foreach (var item in BoothList.Items.Cast<ListViewItem>())
                if ((string)item.Tag == _selected.Id) { BoothList.SelectedItem = item; break; }
        }
    }

    private void BoothList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (BoothList.SelectedItem is not ListViewItem item)
        {
            _selected = null;
            EditorScroll.Visibility = Visibility.Collapsed;
            NoSelectionText.Visibility = Visibility.Visible;
            return;
        }
        _selected = _booths.FirstOrDefault(b => b.Id == (string)item.Tag);
        if (_selected == null) return;

        EditorScroll.Visibility = Visibility.Visible;
        NoSelectionText.Visibility = Visibility.Collapsed;
        EditorTitle.Text = _selected.Name;
        EditorMeta.Text = $"{_selected.Id}  |  last edited {Helpers.TimeAgo(_selected.UpdatedAt)} by {(_selected.UpdatedBy is { Length: > 0 } u ? u : "unknown")}";
        NameBox.Text = _selected.Name;
        DescBox.Text = _selected.Description;
        GroupBox.Text = _selected.GroupId;
        AvatarBox.Text = _selected.AvatarId;
        WorldsBox.Text = string.Join("\n", _selected.WorldIds);
        ImagesBox.Text = string.Join("\n", _selected.Images);
        LogoBox.Text = _selected.LogoUrl;
        PublicBox.Text = _selected.PublicUrl;
        AssignedBox.Text = string.Join("\n", _selected.AssignedTo);
        PublishedToggle.IsOn = _selected.Published;
        StatusBar.IsOpen = false;
    }

    private async void SaveBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_selected == null) return;
        SaveBtn.IsEnabled = false;
        SaveBusy.IsActive = true;

        var patch = new Dictionary<string, object?>
        {
            ["name"] = NameBox.Text.Trim(),
            ["description"] = DescBox.Text.Trim(),
            ["groupId"] = GroupBox.Text.Trim(),
            ["avatarId"] = AvatarBox.Text.Trim(),
            ["worldIds"] = Lines(WorldsBox.Text),
            ["images"] = Lines(ImagesBox.Text),
            ["logoUrl"] = LogoBox.Text.Trim(),
            ["publicUrl"] = PublicBox.Text.Trim(),
        };
        if (Session.IsAdmin)
        {
            patch["assignedTo"] = Lines(AssignedBox.Text);
            patch["published"] = PublishedToggle.IsOn;
        }

        var r = await ApiClient.UpdateBoothAsync(_selected.Id, patch);
        SaveBtn.IsEnabled = true;
        SaveBusy.IsActive = false;

        if (r.Ok && r.Data != null)
        {
            AudioService.Success();
            ShowStatus("Saved", $"\"{r.Data.Name}\" was updated.", InfoBarSeverity.Success);
            await LoadAsync(r.Data.Id);
        }
        else
        {
            ShowStatus("Save failed", r.Error, InfoBarSeverity.Error);
        }
    }

    private async void NewBtn_Click(object sender, RoutedEventArgs e)
    {
        NewBtn.IsEnabled = false;
        var r = await ApiClient.CreateBoothAsync(new Dictionary<string, object?> { ["name"] = "New booth" });
        NewBtn.IsEnabled = true;
        if (r.Ok && r.Data != null)
        {
            AudioService.Success();
            await LoadAsync(r.Data.Id);
        }
        else
        {
            ShowStatus("Create failed", r.Error, InfoBarSeverity.Error);
        }
    }

    private async void DeleteBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_selected == null) return;
        var dialog = new ContentDialog
        {
            Title = "Delete booth?",
            Content = $"\"{_selected.Name}\" will be removed for everyone. This cannot be undone.",
            PrimaryButtonText = "Delete",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Close,
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;

        var r = await ApiClient.DeleteBoothAsync(_selected.Id);
        if (r.Status >= 200 && r.Status < 300)
        {
            _selected = null;
            await LoadAsync(null);
            EditorScroll.Visibility = Visibility.Collapsed;
            NoSelectionText.Visibility = Visibility.Visible;
        }
        else
        {
            ShowStatus("Delete failed", r.Error, InfoBarSeverity.Error);
        }
    }

    private void RefreshBtn_Click(object sender, RoutedEventArgs e) => _ = LoadAsync(null);

    private void CopyGroupBtn_Click(object sender, RoutedEventArgs e)
    {
        Helpers.CopyToClipboard(GroupBox.Text.Trim());
        ShowStatus("Copied", "Group id copied to the clipboard.", InfoBarSeverity.Informational);
    }

    private void OpenGroupBtn_Click(object sender, RoutedEventArgs e)
    {
        var id = GroupBox.Text.Trim();
        if (id.Length > 0) Helpers.OpenUrl($"https://vrchat.com/home/group/{Uri.EscapeDataString(id)}");
    }

    private void OpenAvatarBtn_Click(object sender, RoutedEventArgs e)
    {
        var id = AvatarBox.Text.Trim();
        if (id.Length > 0) Helpers.OpenUrl($"https://vrchat.com/home/avatar/{Uri.EscapeDataString(id)}");
    }

    private void ShowStatus(string title, string message, InfoBarSeverity severity)
    {
        StatusBar.Title = title;
        StatusBar.Message = message;
        StatusBar.Severity = severity;
        StatusBar.IsOpen = true;
    }
}
