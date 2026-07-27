using BoothManager.Core;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using System.Runtime.InteropServices.WindowsRuntime;

namespace BoothManager.Controls;

/// <summary>
/// Interactive 3D viewport: drag to orbit, wheel to zoom.
/// Renders on a background thread with the software rasterizer.
/// </summary>
public sealed class ModelViewport : Grid
{
    private readonly Image _image = new() { Stretch = Stretch.UniformToFill };
    private readonly TextBlock _hint;
    private readonly SoftRenderer _renderer = new();
    private WriteableBitmap? _bitmap;
    private Model3D? _model;

    private bool _dragging;
    private Microsoft.UI.Input.PointerPoint? _lastPoint;
    private bool _renderBusy;
    private bool _renderDirty;
    private DateTime _lastResizeRender = DateTime.MinValue;

    public ModelViewport()
    {
        Background = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(255, 10, 13, 19));
        CornerRadius = new CornerRadius(12);
        Children.Add(_image);

        _hint = new TextBlock
        {
            Text = "drag to orbit  |  scroll to zoom",
            FontSize = 11,
            Opacity = 0.45,
            HorizontalAlignment = HorizontalAlignment.Center,
            VerticalAlignment = VerticalAlignment.Bottom,
            Margin = new Thickness(0, 0, 0, 10),
            IsHitTestVisible = false,
        };
        Children.Add(_hint);

        SizeChanged += (_, _) => OnViewportResized();
        PointerPressed += OnPointerPressed;
        PointerMoved += OnPointerMoved;
        PointerReleased += OnPointerReleased;
        PointerCanceled += OnPointerReleased;
        PointerExited += OnPointerReleased;
        PointerWheelChanged += OnWheel;
    }

    public void SetModel(Model3D model, bool frame = true)
    {
        _model = model;
        if (frame) _renderer.FrameModel(model);
        RequestRender();
    }

    public Model3D? Model => _model;

    public float CameraYaw => _renderer.Yaw;
    public float CameraPitch => _renderer.Pitch;
    public float CameraDistance => _renderer.Distance;

    /// <summary>Re-render after external changes (e.g. texture swap).</summary>
    public void RequestRender()
    {
        if (_model == null || ActualWidth < 10 || ActualHeight < 10) return;
        _ = RenderAsync();
    }

    private void OnViewportResized()
    {
        // avoid re-render storms while the pane animates
        if ((DateTime.UtcNow - _lastResizeRender).TotalMilliseconds < 120)
        {
            _renderDirty = true;
            return;
        }
        _lastResizeRender = DateTime.UtcNow;
        RequestRender();
    }

    private async Task RenderAsync()
    {
        if (_renderBusy) { _renderDirty = true; return; }
        _renderBusy = true;

        try
        {
            do
            {
                _renderDirty = false;
                var model = _model;
                if (model == null) break;

                // cap resolution for performance; UniformToFill hides the difference
                double scale = Math.Min(1.0, 1280.0 / Math.Max(ActualWidth, 1));
                int w = Math.Max(64, (int)(ActualWidth * scale));
                int h = Math.Max(64, (int)(ActualHeight * scale));

                await Task.Run(() =>
                {
                    if (_renderer.Width != w || _renderer.Height != h) _renderer.Resize(w, h);
                    _renderer.Render(model);
                });

                if (_bitmap == null || _bitmap.PixelWidth != w || _bitmap.PixelHeight != h)
                {
                    _bitmap = new WriteableBitmap(w, h);
                    _image.Source = _bitmap;
                }
                using (var stream = _bitmap.PixelBuffer.AsStream())
                {
                    stream.Write(_renderer.Frame, 0, _renderer.Frame.Length);
                }
                _bitmap.Invalidate();
            }
            while (_renderDirty);
        }
        catch
        {
            // rendering must never crash the app
        }
        finally
        {
            _renderBusy = false;
        }
    }

    private void OnPointerPressed(object sender, PointerRoutedEventArgs e)
    {
        _dragging = true;
        _lastPoint = e.GetCurrentPoint(this);
        CapturePointer(e.Pointer);
        _hint.Opacity = 0;
    }

    private void OnPointerMoved(object sender, PointerRoutedEventArgs e)
    {
        if (!_dragging || _lastPoint == null) return;
        var pt = e.GetCurrentPoint(this);
        float dx = (float)(pt.Position.X - _lastPoint.Position.X);
        float dy = (float)(pt.Position.Y - _lastPoint.Position.Y);
        _lastPoint = pt;

        _renderer.Yaw -= dx * 0.011f;
        _renderer.Pitch = Math.Clamp(_renderer.Pitch + dy * 0.009f, -1.35f, 1.45f);
        RequestRender();
    }

    private void OnPointerReleased(object sender, PointerRoutedEventArgs e)
    {
        _dragging = false;
        ReleasePointerCaptures();
    }

    private void OnWheel(object sender, PointerRoutedEventArgs e)
    {
        int delta = e.GetCurrentPoint(this).Properties.MouseWheelDelta;
        _renderer.Distance = Math.Clamp(_renderer.Distance * (delta > 0 ? 0.88f : 1.14f), 0.6f, 80f);
        RequestRender();
        e.Handled = true;
    }
}
