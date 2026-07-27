using BoothManager.Core;
using Windows.Media.Core;
using Windows.Media.Playback;

namespace BoothManager.Services;

/// <summary>
/// Background music + UI sounds. The audio files are synthesized on first
/// launch (no binary assets in the repo) and cached in local app data.
/// Both channels can be toggled in Settings.
/// </summary>
public static class AudioService
{
    private static MediaPlayer? _music;
    private static MediaPlayer? _sfx;
    private static string _dir = "";
    public static bool Ready { get; private set; }

    public static async Task InitAsync()
    {
        try
        {
            _dir = Path.Combine(AppConfig.Dir, "audio");
            await Task.Run(() => WavSynth.EnsureGenerated(_dir));
            _music = new MediaPlayer
            {
                IsLoopingEnabled = true,
                Volume = 0.28,
                Source = MediaSource.CreateFromUri(new Uri(Path.Combine(_dir, "music_loop.wav"))),
            };
            _sfx = new MediaPlayer { Volume = 0.45 };
            Ready = true;
            ApplyMusicSetting();
        }
        catch
        {
            Ready = false;
        }
    }

    public static void ApplyMusicSetting()
    {
        if (_music == null) return;
        if (AppConfig.Current.MusicEnabled) _music.Play();
        else _music.Pause();
    }

    public static void Click() => PlaySfx("click.wav");
    public static void Success() => PlaySfx("success.wav");

    private static void PlaySfx(string file)
    {
        if (_sfx == null || !AppConfig.Current.SfxEnabled) return;
        try
        {
            _sfx.Source = MediaSource.CreateFromUri(new Uri(Path.Combine(_dir, file)));
            _sfx.Play();
        }
        catch
        {
        }
    }
}
