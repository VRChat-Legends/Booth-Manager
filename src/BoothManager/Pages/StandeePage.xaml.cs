using BoothManager.Controls;
using BoothManager.Core;
using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;

namespace BoothManager.Pages;

public sealed partial class StandeePage : Page
{
    private string _inputPath = "";
    private string _lastOutputDir = "";
    private readonly ModelViewport _viewport = new();

    public StandeePage()
    {
        InitializeComponent();
        Preview3DHost.Children.Add(_viewport);
    }

    private async void PickBtn_Click(object sender, RoutedEventArgs e)
    {
        var picker = new Windows.Storage.Pickers.FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".webp");
        picker.FileTypeFilter.Add(".bmp");
        var file = await picker.PickSingleFileAsync();
        if (file == null) return;

        _inputPath = file.Path;
        FileText.Text = file.Name;
        ShowImage(_inputPath);
    }

    private void ShowImage(string path)
    {
        var bmp = new BitmapImage { CreateOptions = BitmapCreateOptions.IgnoreImageCache };
        bmp.UriSource = new Uri(path);
        PreviewImg.Source = bmp;
        PreviewPlaceholder.Visibility = Visibility.Collapsed;
        PreviewImg.Visibility = Visibility.Visible;
        Preview3DHost.Visibility = Visibility.Collapsed;
    }

    private void Show3D()
    {
        PreviewPlaceholder.Visibility = Visibility.Collapsed;
        PreviewImg.Visibility = Visibility.Collapsed;
        Preview3DHost.Visibility = Visibility.Visible;
        _viewport.RequestRender();
    }

    private void View3DBtn_Click(object sender, RoutedEventArgs e)
    {
        Show3D();
        View3DBtn.IsEnabled = false;
        View2DBtn.IsEnabled = true;
    }

    private void View2DBtn_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_lastPreviewPng)) ShowImage(_lastPreviewPng);
        View3DBtn.IsEnabled = true;
        View2DBtn.IsEnabled = false;
    }

    private string _lastPreviewPng = "";

    private async void GenerateBtn_Click(object sender, RoutedEventArgs e)
    {
        if (string.IsNullOrEmpty(_inputPath))
        {
            ShowStatus("No image", "Choose an image first.", InfoBarSeverity.Warning);
            return;
        }

        var folderPicker = new Windows.Storage.Pickers.FolderPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(folderPicker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        folderPicker.FileTypeFilter.Add("*");
        var folder = await folderPicker.PickSingleFolderAsync();
        if (folder == null) return;

        var options = new StandeeOptions
        {
            InputPath = _inputPath,
            OutputDir = folder.Path,
            HeightMeters = HeightBox.Value,
            ThicknessCm = ThickBox.Value,
            Resolution = QualityCombo.SelectedIndex switch { 0 => 256, 2 => 1024, _ => 512 },
            BackFlap = FlapToggle.IsOn,
        };

        GenerateBtn.IsEnabled = false;
        Busy.IsActive = true;
        StatusBar.IsOpen = false;
        OpenFolderBtn.Visibility = Visibility.Collapsed;

        try
        {
            var result = await Task.Run(() => StandeeGenerator.Generate(options));
            _lastOutputDir = folder.Path;
            _lastPreviewPng = result.PreviewPath;

            // load the exported OBJ (with texture) into the 3D preview
            try
            {
                var model = await Task.Run(() => Model3D.LoadObj(result.ObjPath));
                _viewport.SetModel(model);
                _viewport.AutoSpin = true;
                View3DBtn.IsEnabled = false;
                View2DBtn.IsEnabled = true;
                Show3D();
            }
            catch
            {
                ShowImage(result.PreviewPath);
            }

            AudioService.Success();
            ShowStatus(
                "Standee exported",
                $"{Path.GetFileName(result.ObjPath)}  |  {result.VertexCount} vertices, {result.TriangleCount} triangles, {result.ContourPointCount} outline points.",
                InfoBarSeverity.Success);
            OpenFolderBtn.Visibility = Visibility.Visible;
        }
        catch (Exception ex)
        {
            ShowStatus("Generation failed", ex.Message, InfoBarSeverity.Error);
        }
        finally
        {
            GenerateBtn.IsEnabled = true;
            Busy.IsActive = false;
        }
    }

    private void OpenFolderBtn_Click(object sender, RoutedEventArgs e)
    {
        if (!string.IsNullOrEmpty(_lastOutputDir)) Helpers.OpenFolder(_lastOutputDir);
    }

    private void ShowStatus(string title, string message, InfoBarSeverity severity)
    {
        StatusBar.Title = title;
        StatusBar.Message = message;
        StatusBar.Severity = severity;
        StatusBar.IsOpen = true;
    }
}
