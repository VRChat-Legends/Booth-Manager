using BoothManager.Controls;
using BoothManager.Core;
using BoothManager.Services;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Net.Http;
using Windows.Storage.Pickers;

namespace BoothManager.Pages;

public sealed partial class BoothBuilderPage : Page
{
    private static readonly HttpClient Http = new() { Timeout = TimeSpan.FromSeconds(20) };

    private readonly ModelViewport _viewport = new();
    private Model3D? _model;
    private List<Booth> _booths = new();
    private Booth? _selected;

    // material name -> friendly slot label (the swappable image surfaces on the prefab)
    private static readonly (string material, string label, string hint)[] Slots =
    {
        ("back_poster_1_large", "Poster wall", "wide 2:1 artwork"),
        ("screen", "Screen", "1920x1080 landscape"),
    };

    public BoothBuilderPage()
    {
        InitializeComponent();
        ViewportHost.Children.Add(_viewport);
        Loaded += async (_, _) => await StartupAsync();
    }

    private async Task StartupAsync()
    {
        if (_model == null)
        {
            LoadRing.IsActive = true;
            string objPath = Path.Combine(AppContext.BaseDirectory, "Assets", "BoothModel", "booth.obj");
            if (!File.Exists(objPath))
            {
                LoadRing.IsActive = false;
                ModelMissingPanel.Visibility = Visibility.Visible;
                return;
            }

            try
            {
                _model = await Task.Run(() => Model3D.LoadObj(objPath));
            }
            catch
            {
                LoadRing.IsActive = false;
                ModelMissingPanel.Visibility = Visibility.Visible;
                return;
            }

            LoadRing.IsActive = false;
            _viewport.SetModel(_model);
            StatsBadge.Visibility = Visibility.Visible;
            StatsText.Text = $"{_model.TriangleCount():N0} tris  |  {_model.Materials.Count} materials  |  official Alley prefab";
            BuildSlotControls();
        }

        await LoadBoothsAsync();
    }

    private void BuildSlotControls()
    {
        SlotList.Children.Clear();
        if (_model == null) return;

        foreach (var (material, label, hint) in Slots)
        {
            var mat = _model.FindMaterial(material);
            if (mat == null) continue;

            var panel = new StackPanel { Spacing = 6 };
            var header = new Grid();
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(1, GridUnitType.Star) });
            header.ColumnDefinitions.Add(new ColumnDefinition { Width = GridLength.Auto });
            var title = new TextBlock { Text = label, FontSize = 13, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold };
            var sub = new TextBlock
            {
                Text = hint,
                FontSize = 10,
                Foreground = (Brush)Application.Current.Resources["AlleyMutedBrush"],
                VerticalAlignment = VerticalAlignment.Center,
            };
            Grid.SetColumn(sub, 1);
            header.Children.Add(title);
            header.Children.Add(sub);
            panel.Children.Add(header);

            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6 };

            var boothImgBtn = new Button { Content = "Booth image", FontSize = 12, Tag = material };
            boothImgBtn.Click += async (s, _) => await PickBoothImageAsync((string)((Button)s).Tag);
            row.Children.Add(boothImgBtn);

            var fileBtn = new Button { Content = "File...", FontSize = 12, Tag = material };
            fileBtn.Click += async (s, _) => await PickLocalFileAsync((string)((Button)s).Tag);
            row.Children.Add(fileBtn);

            var clearBtn = new Button { FontSize = 12, Tag = material, Content = new FontIcon { Glyph = "\uE74D", FontSize = 12 } };
            ToolTipService.SetToolTip(clearBtn, "Reset to default");
            clearBtn.Click += (s, _) => ResetSlot((string)((Button)s).Tag);
            row.Children.Add(clearBtn);

            panel.Children.Add(row);
            SlotList.Children.Add(panel);
        }
    }

    private async Task LoadBoothsAsync()
    {
        var res = await ApiClient.GetBoothsAsync();
        if (!res.Ok || res.Data == null) return;
        _booths = res.Data;

        BoothCombo.Items.Clear();
        foreach (var b in _booths)
        {
            BoothCombo.Items.Add(new ComboBoxItem { Content = b.Name, Tag = b.Id });
        }
        if (_booths.Count > 0) BoothCombo.SelectedIndex = 0;
    }

    private void BoothCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (BoothCombo.SelectedItem is not ComboBoxItem item) return;
        _selected = _booths.FirstOrDefault(b => b.Id == (string)item.Tag);
        int imgs = _selected?.Images.Count ?? 0;
        BoothHint.Text = _selected == null
            ? "Booth images from the Booths tab can be applied to any slot."
            : $"{imgs} image{(imgs == 1 ? "" : "s")} on this booth" + (imgs == 0 ? ". Add image URLs in the Booths tab first." : ", ready to apply.");
    }

    private async Task PickBoothImageAsync(string material)
    {
        if (_model == null) return;
        if (_selected == null || _selected.Images.Count == 0)
        {
            BoothHint.Text = "No booth images. Select a booth with images, or add URLs in the Booths tab.";
            return;
        }

        // build a quick chooser dialog with the booth's images
        var list = new ListView { SelectionMode = ListViewSelectionMode.Single, MaxHeight = 420 };
        foreach (string url in _selected.Images)
        {
            var sp = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 10, Margin = new Thickness(2) };
            var img = new Image { Width = 96, Height = 54, Stretch = Stretch.UniformToFill };
            try
            {
                img.Source = new BitmapImage(new Uri(url));
            }
            catch { }
            sp.Children.Add(img);
            sp.Children.Add(new TextBlock
            {
                Text = ShortUrl(url),
                VerticalAlignment = VerticalAlignment.Center,
                FontSize = 12,
                MaxWidth = 300,
                TextTrimming = TextTrimming.CharacterEllipsis,
            });
            list.Items.Add(new ListViewItem { Content = sp, Tag = url });
        }
        list.SelectedIndex = 0;

        var dialog = new ContentDialog
        {
            Title = "Apply booth image",
            Content = list,
            PrimaryButtonText = "Apply",
            CloseButtonText = "Cancel",
            DefaultButton = ContentDialogButton.Primary,
            XamlRoot = XamlRoot,
        };
        if (await dialog.ShowAsync() != ContentDialogResult.Primary) return;
        if (list.SelectedItem is not ListViewItem sel) return;

        string chosen = (string)sel.Tag;
        LoadRing.IsActive = true;
        try
        {
            byte[] data = await Http.GetByteArrayAsync(chosen);
            var tex = await Task.Run(() => Texture3D.FromBytes(data));
            if (tex != null) ApplyTexture(material, tex);
            else BoothHint.Text = "That image could not be decoded.";
        }
        catch
        {
            BoothHint.Text = "Could not download that image.";
        }
        finally
        {
            LoadRing.IsActive = false;
        }
    }

    private async Task PickLocalFileAsync(string material)
    {
        if (_model == null) return;
        var picker = new FileOpenPicker();
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        picker.FileTypeFilter.Add(".png");
        picker.FileTypeFilter.Add(".jpg");
        picker.FileTypeFilter.Add(".jpeg");
        picker.FileTypeFilter.Add(".webp");
        var file = await picker.PickSingleFileAsync();
        if (file == null) return;

        LoadRing.IsActive = true;
        var tex = await Task.Run(() => Texture3D.FromFile(file.Path));
        LoadRing.IsActive = false;
        if (tex != null) ApplyTexture(material, tex);
    }

    private readonly Dictionary<string, Texture3D?> _defaults = new();

    private void ApplyTexture(string material, Texture3D tex)
    {
        var mat = _model?.FindMaterial(material);
        if (mat == null) return;
        if (!_defaults.ContainsKey(material)) _defaults[material] = mat.Texture;
        mat.Texture = tex;
        mat.Emissive = true; // user content should read clearly
        _viewport.RequestRender();
        AudioService.Success();
    }

    private void ResetSlot(string material)
    {
        var mat = _model?.FindMaterial(material);
        if (mat == null) return;
        if (_defaults.TryGetValue(material, out var def))
        {
            mat.Texture = def;
            mat.Emissive = false;
            _viewport.RequestRender();
        }
    }

    private void ResetViewBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_model == null) return;
        _viewport.SetModel(_model);
    }

    private async void SnapshotBtn_Click(object sender, RoutedEventArgs e)
    {
        if (_model == null) return;
        var picker = new FileSavePicker { SuggestedFileName = "booth-preview" };
        WinRT.Interop.InitializeWithWindow.Initialize(picker, WinRT.Interop.WindowNative.GetWindowHandle(App.Window!));
        picker.FileTypeChoices.Add("PNG image", new List<string> { ".png" });
        var file = await picker.PickSaveFileAsync();
        if (file == null) return;

        var model = _model;
        await Task.Run(() =>
        {
            // render a high-res still with the current camera
            var r = new SoftRenderer();
            r.Resize(1920, 1080);
            CopyCamera(r);
            r.Render(model);
            using var bmp = new System.Drawing.Bitmap(1920, 1080, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            var rect = new System.Drawing.Rectangle(0, 0, 1920, 1080);
            var bd = bmp.LockBits(rect, System.Drawing.Imaging.ImageLockMode.WriteOnly, System.Drawing.Imaging.PixelFormat.Format32bppArgb);
            try
            {
                System.Runtime.InteropServices.Marshal.Copy(r.Frame, 0, bd.Scan0, r.Frame.Length);
            }
            finally
            {
                bmp.UnlockBits(bd);
            }
            bmp.Save(file.Path, System.Drawing.Imaging.ImageFormat.Png);
        });

        SnapshotResult.Text = "Saved " + file.Name;
        SnapshotResult.Visibility = Visibility.Visible;
        AudioService.Success();
    }

    private void CopyCamera(SoftRenderer target)
    {
        if (_model != null) target.FrameModel(_model);
        target.Yaw = _viewport.CameraYaw;
        target.Pitch = _viewport.CameraPitch;
        target.Distance = _viewport.CameraDistance;
    }

    private static string ShortUrl(string url)
    {
        try
        {
            var u = new Uri(url);
            string last = u.Segments.Length > 0 ? u.Segments[^1] : url;
            return string.IsNullOrWhiteSpace(last) || last == "/" ? u.Host : last;
        }
        catch
        {
            return url;
        }
    }
}
