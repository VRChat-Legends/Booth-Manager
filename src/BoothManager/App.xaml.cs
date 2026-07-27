using Microsoft.UI.Xaml;

namespace BoothManager;

public partial class App : Application
{
    public static MainWindow? Window { get; private set; }

    public App()
    {
        InitializeComponent();
    }

    protected override void OnLaunched(LaunchActivatedEventArgs args)
    {
        if (Environment.GetCommandLineArgs().Contains("--selftest"))
        {
            string resultPath = Path.Combine(Path.GetTempPath(), "bm_selftest", "result.txt");
            try
            {
                Core.SelfTest.Run();
            }
            catch (Exception ex)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(resultPath)!);
                    File.WriteAllText(resultPath, "FAIL " + ex);
                }
                catch
                {
                }
            }
            Environment.Exit(0);
            return;
        }

        Window = new MainWindow();
        Window.Activate();
    }
}
