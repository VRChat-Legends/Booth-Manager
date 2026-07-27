using BoothManager.Controls;
using BoothManager.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BoothManager.Pages;

/// <summary>Coming-soon teaser: the official booth prefab spinning live in the app.</summary>
public sealed partial class BoothBuilderPage : Page
{
    private static Model3D? _cachedModel;
    private readonly ModelViewport _viewport = new();

    public BoothBuilderPage()
    {
        InitializeComponent();
        ViewportHost.Children.Add(_viewport);
        Loaded += async (_, _) => await LoadModelAsync();
    }

    private async Task LoadModelAsync()
    {
        if (_cachedModel == null)
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
                _cachedModel = await Task.Run(() => Model3D.LoadObj(objPath));
            }
            catch
            {
                LoadRing.IsActive = false;
                ModelMissingPanel.Visibility = Visibility.Visible;
                return;
            }
            LoadRing.IsActive = false;
        }

        _viewport.SetModel(_cachedModel);
        _viewport.AutoSpin = true;
        StatsBadge.Visibility = Visibility.Visible;
        StatsText.Text = $"{_cachedModel.TriangleCount():N0} tris  |  {_cachedModel.Materials.Count} materials  |  official Alley prefab";
    }

    private void OpenBoothsBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("booths");
}
