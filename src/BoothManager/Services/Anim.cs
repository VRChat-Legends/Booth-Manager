using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;

namespace BoothManager.Services;

/// <summary>Small animation helpers: hover lift on cards, staggered entrances, page transitions.</summary>
public static class Anim
{
    /// <summary>Hover lift: the element floats up slightly and its border glows teal.</summary>
    public static void Lift(FrameworkElement el)
    {
        el.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(180) };

        Brush? normalBrush = null;
        el.PointerEntered += (_, _) =>
        {
            el.Translation = new System.Numerics.Vector3(0, -3, 0);
            if (el is Border b)
            {
                normalBrush ??= b.BorderBrush;
                b.BorderBrush = new SolidColorBrush(Microsoft.UI.ColorHelper.FromArgb(0x66, 0x00, 0xE6, 0xCC));
            }
        };
        el.PointerExited += (_, _) =>
        {
            el.Translation = System.Numerics.Vector3.Zero;
            if (el is Border b && normalBrush != null) b.BorderBrush = normalBrush;
        };
    }

    /// <summary>Staggered entrance + smooth reposition for a panel's children.</summary>
    public static void Entrance(Panel panel)
    {
        panel.ChildrenTransitions = new TransitionCollection
        {
            new EntranceThemeTransition { IsStaggeringEnabled = true, FromVerticalOffset = 28 },
            new RepositionThemeTransition(),
        };
    }

    /// <summary>Content transitions for a freshly built list.</summary>
    public static void FadeInChildren(Panel panel)
    {
        int i = 0;
        foreach (var child in panel.Children)
        {
            if (child is not FrameworkElement fe) continue;
            fe.Opacity = 0;
            var sb = new Storyboard();
            var fade = new DoubleAnimation
            {
                From = 0,
                To = 1,
                Duration = new Duration(TimeSpan.FromMilliseconds(240)),
                BeginTime = TimeSpan.FromMilliseconds(40 * Math.Min(i, 10)),
                EasingFunction = new QuadraticEase { EasingMode = EasingMode.EaseOut },
            };
            Storyboard.SetTarget(fade, fe);
            Storyboard.SetTargetProperty(fade, "Opacity");
            sb.Children.Add(fade);

            fe.TranslationTransition = null;
            fe.Translation = new System.Numerics.Vector3(0, 14, 0);
            fe.TranslationTransition = new Vector3Transition { Duration = TimeSpan.FromMilliseconds(280 + 40 * Math.Min(i, 10)) };
            fe.Translation = System.Numerics.Vector3.Zero;

            sb.Begin();
            i++;
        }
    }
}
