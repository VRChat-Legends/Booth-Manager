using BoothManager.Core;
using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace BoothManager.Pages;

public sealed partial class AtlasPage : Page
{
    private readonly List<string> _files = new();

    public AtlasPage()
    {
        InitializeComponent();
    }

    private void RebuildList()
    {
        FilesList.Items.Clear();
        foreach (var f in _files)
        {
            var row = new Grid();
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            row.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var name = new TextBlock { Text = Path.GetFileName(f), VerticalAlignment = VerticalAlignment.Center };
            var remove = new Button
            {
                Content = new FontIcon { Glyph = "\uE711", FontSize = 11 },
                Padding = new Thickness(6, 3, 6, 3),
                Tag = f,
            };
            remove.Click += (s, _) =>
            {
                _files.Remove((string)((Button)s).Tag);
                RebuildList();
            };
            Grid.SetColumn(remove, 1);
            row.Children.Add(name);
            row.Children.Add(remove);
            FilesList.Items.Add(new ListViewItem { Content = row, HorizontalContentAlignment = HorizontalAlignment.Stretch });
        }
    }

    private async void AddBtn_Click(object sender, RoutedEventArgs e)
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".bmp");
        var files = await picker.PickMultipleFilesAsync();
        if (files == null) return;
        foreach (var f in files)
            if (!_files.Contains(f.Path)) _files.Add(f.Path);
        RebuildList();
    }

    private void ClearBtn_Click(object sender, RoutedEventArgs e)
    {
        _files.Clear();
        RebuildList();
    }

    private async void PackBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_files.Count == 0)
        {
            ShowStatus("No images", "Add at least one image first.", InfoBarSeverity.Warning);
            return;
        }

        var savePicker = new Windows.Storage.Pickers.FileSavePicker();
        WinRT.Interop.InitializeWithWindow.Initialize(savePicker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        savePicker.FileTypeChoices.Add("PNG image", new List<string> { ".png" });
        savePicker.SuggestedFileName = "booth_atlas";
        var target = await savePicker.PickSaveFileAsync();
        if (target == null) return;

        int maxSize = SizeCombo.SelectedIndex switch { 0 => 1024, 2 => 4096, _ => 2048 };
        int padding = (int)PadBox.Value;
        var files = _files.ToList();

        PackBtn.IsEnabled = false;
        Busy.IsActive = true;
        StatusBar.IsOpen = false;

        try
        {
            var result = await Task.Run(() => AtlasPacker.Pack(files, maxSize, padding, target.Path));
            var bmp = new BitmapImage { CreateOptions = BitmapCreateOptions.IgnoreImageCache };
            bmp.UriSource = new Uri(result.AtlasPath);
            AtlasPreview.Source = bmp;
            PreviewPlaceholder.Visibility = Visibility.Collapsed;
            AudioService.Success();
            string scaleNote = result.Scale < 0.999 ? $" Images were scaled to {result.Scale:P0} to fit." : "";
            ShowStatus(
                "Atlas packed",
                $"{result.Placed} images packed into {result.Size} x {result.Size}. UV manifest: {Path.GetFileName(result.ManifestPath)}.{scaleNote}",
                InfoBarSeverity.Success);
        }
        catch (Exception ex)
        {
            ShowStatus("Packing failed", ex.Message, InfoBarSeverity.Error);
        }
        finally
        {
            PackBtn.IsEnabled = true;
            Busy.IsActive = false;
        }
    }

    private void ShowStatus(string title, string message, InfoBarSeverity severity)
    {
        StatusBar.Title = title;
        StatusBar.Message = message;
        StatusBar.Severity = severity;
        StatusBar.IsOpen = true;
    }
}
