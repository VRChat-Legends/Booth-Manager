using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace BoothManager.Pages;

public sealed partial class BoothBuilderPage : Page
{
    public BoothBuilderPage()
    {
        InitializeComponent();
    }

    private void OpenBoothsBtn_Click(object sender, RoutedEventArgs e) => App.Window?.NavigateTo("booths");
}
