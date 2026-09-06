import { useEffect, useId, useRef, useState } from "react";
import "../chat-settings.css";

function SettingsToggle({ label, checked, disabled, help, onChange }) {
  const id = useId();

  return (
    <div className="chat-settings-control">
      <label className="chat-settings-toggle" htmlFor={id}>
        <span className="chat-settings-label">{label}</span>
        <input
          className="chat-settings-checkbox"
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label}
          aria-describedby={help ? `${id}-help` : undefined}
          onChange={(event) => {
            if (!disabled) onChange(event.target.checked);
          }}
        />
      </label>
      {help && <p className="chat-settings-help" id={`${id}-help`}>{help}</p>}
    </div>
  );
}

function SettingsSelect({ label, value, disabled, help, onChange, children }) {
  const id = useId();

  return (
    <div className="chat-settings-control">
      <label className="chat-settings-label" htmlFor={id}>{label}</label>
      <select
        className="chat-settings-select"
        id={id}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-describedby={help ? `${id}-help` : undefined}
        onChange={(event) => {
          if (!disabled) onChange(event.target.value);
        }}
      >
        {children}
      </select>
      {help && <p className="chat-settings-help" id={`${id}-help`}>{help}</p>}
    </div>
  );
}

export default function ChatSettingsPanel({
  preferences,
  roomPreferences,
  roomName,
  isGlobal = false,
  disabled = false,
  saving = false,
  saveError = "",
  cfg = {},
  onChange,
  onRoomChange,
  onReset
}) {
  const id = useId();
  const [confirmReset, setConfirmReset] = useState(false);
  const resetButton = useRef(null);
  const cancelButton = useRef(null);
  const pingBlocked = cfg.pingSoundEnabled === false;
  const desktopBlocked = cfg.nativeNotificationsEnabled === false;
  const sendSoundBlocked = cfg.sfxEnabled === false;
  const previewBlocked = desktopBlocked || !preferences.desktopNotifications;
  const status = disabled
    ? "Sign in to change preferences"
    : saving
      ? "Saving..."
      : saveError
        ? "Changes not saved"
        : "Saved on this computer";

  useEffect(() => {
    if (disabled || saving) {
      setConfirmReset(false);
    } else if (confirmReset) {
      cancelButton.current?.focus();
    }
  }, [confirmReset, disabled, saving]);

  const invoke = (callback, ...args) => {
    if (disabled) return;
    Promise.resolve().then(() => callback?.(...args)).catch(() => {});
  };

  const change = (key, value) => invoke(onChange, { [key]: value });

  const cancelReset = () => {
    setConfirmReset(false);
    resetButton.current?.focus();
  };

  const reset = () => {
    if (disabled || saving || !confirmReset) return;
    cancelReset();
    invoke(onReset);
  };

  return (
    <section className="chat-settings-panel" aria-labelledby={`${id}-heading`} aria-describedby={`${id}-scope`}>
      <header className="chat-settings-header">
        <h3 className="chat-settings-title" id={`${id}-heading`}>Chat preferences</h3>
        <p className="chat-settings-status" role="status" aria-atomic="true" data-error={Boolean(saveError) && !saving && !disabled}>
          {status}
        </p>
        <p className="chat-settings-help" id={`${id}-scope`}>
          Personal settings for this account on this computer. Other members are not affected.
        </p>
      </header>

      {saveError && <p className="chat-settings-error" role="alert">{saveError}</p>}

      <fieldset className="chat-settings-section" disabled={disabled}>
        <legend className="chat-settings-legend">Current room</legend>
        <div className="chat-settings-fields">
          <p className="chat-settings-room-name">{roomName || (isGlobal ? "Global lounge" : "Selected room")}</p>
          <SettingsToggle
            label="Favorite this room"
            checked={roomPreferences.favorite}
            disabled={disabled}
            onChange={(favorite) => invoke(onRoomChange, { favorite })}
          />
          <SettingsSelect
            label="Room notifications"
            value={roomPreferences.notifications}
            disabled={disabled}
            help="Personal mute only. It does not lock the room or stop other members from posting."
            onChange={(notifications) => invoke(onRoomChange, { notifications })}
          >
            <option value="inherit">Inherit default</option>
            <option value="all">All messages</option>
            <option value="mentions">Mentions only</option>
            <option value="muted">Muted</option>
          </SettingsSelect>
        </div>
      </fieldset>

      <fieldset className="chat-settings-section" disabled={disabled}>
        <legend className="chat-settings-legend">Notifications</legend>
        <div className="chat-settings-fields">
          <p className="chat-settings-help">Notifications cover the selected room while Team Chat is open.</p>
          <SettingsSelect
            label="Default notifications"
            value={preferences.notificationMode}
            disabled={disabled}
            help="Used unless the current room has its own notification choice. App controls in Settings still apply."
            onChange={(value) => change("notificationMode", value)}
          >
            <option value="all">All messages</option>
            <option value="mentions">Mentions only</option>
            <option value="muted">Muted</option>
          </SettingsSelect>
          <SettingsToggle
            label="Notification sound"
            checked={preferences.notificationSound}
            disabled={disabled || pingBlocked}
            help={pingBlocked
              ? "Ping sound is off in Settings. Turn it on there to use notification sounds. Your chat choice is kept."
              : "Play a chime for messages covered by your notification choice."}
            onChange={(value) => change("notificationSound", value)}
          />
          <SettingsToggle
            label="Desktop notifications"
            checked={preferences.desktopNotifications}
            disabled={disabled || desktopBlocked}
            help={desktopBlocked
              ? "Only when the app is hidden or unfocused. Native notifications is off in Settings. Your chat choice is kept."
              : "Only when the app is hidden or unfocused."}
            onChange={(value) => change("desktopNotifications", value)}
          />
          <SettingsToggle
            label="Message preview"
            checked={preferences.notificationPreview}
            disabled={disabled || previewBlocked}
            help={previewBlocked
              ? "Enable desktop notifications to include message text. Your preview choice is kept."
              : "Include message text in desktop notifications. Turn off for more privacy."}
            onChange={(value) => change("notificationPreview", value)}
          />
        </div>
      </fieldset>

      <fieldset className="chat-settings-section" disabled={disabled}>
        <legend className="chat-settings-legend">Appearance</legend>
        <div className="chat-settings-fields">
          <SettingsSelect
            label="Density"
            value={preferences.density}
            disabled={disabled}
            onChange={(value) => change("density", value)}
          >
            <option value="comfortable">Comfortable</option>
            <option value="compact">Compact</option>
          </SettingsSelect>
          <SettingsSelect
            label="Text size"
            value={preferences.fontSize}
            disabled={disabled}
            onChange={(value) => change("fontSize", value)}
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="large">Large</option>
          </SettingsSelect>
          <SettingsToggle
            label="Show avatars"
            checked={preferences.showAvatars}
            disabled={disabled}
            onChange={(value) => change("showAvatars", value)}
          />
          <SettingsToggle
            label="Show timestamps"
            checked={preferences.showTimestamps}
            disabled={disabled}
            onChange={(value) => change("showTimestamps", value)}
          />
          <SettingsSelect
            label="Time format"
            value={preferences.timeFormat}
            disabled={disabled || !preferences.showTimestamps}
            help={!preferences.showTimestamps ? "Turn on timestamps to change the time format." : undefined}
            onChange={(value) => change("timeFormat", value)}
          >
            <option value="12h">12 hour (3:45 PM)</option>
            <option value="24h">24 hour (15:45)</option>
          </SettingsSelect>
          <SettingsToggle
            label="Show role badges"
            checked={preferences.showRoleBadges}
            disabled={disabled}
            onChange={(value) => change("showRoleBadges", value)}
          />
          <SettingsToggle
            label="Group messages"
            checked={preferences.groupMessages}
            disabled={disabled}
            help="Keep consecutive messages from the same member together."
            onChange={(value) => change("groupMessages", value)}
          />
        </div>
      </fieldset>

      <fieldset className="chat-settings-section" disabled={disabled}>
        <legend className="chat-settings-legend">Reading &amp; composer</legend>
        <div className="chat-settings-fields">
          <SettingsSelect
            label="Send shortcut"
            value={preferences.sendShortcut}
            disabled={disabled}
            help="Ctrl on Windows, Cmd on macOS. Shift+Enter adds a new line."
            onChange={(value) => change("sendShortcut", value)}
          >
            <option value="enter">Enter</option>
            <option value="mod-enter">Ctrl/Cmd+Enter</option>
          </SettingsSelect>
          <SettingsToggle
            label="Follow newest messages"
            checked={preferences.autoScroll}
            disabled={disabled}
            help="Follow new messages only when you are already at the bottom. Scrolling up keeps your place."
            onChange={(value) => change("autoScroll", value)}
          />
          <SettingsToggle
            label="Send success sound"
            checked={preferences.sendSound}
            disabled={disabled || sendSoundBlocked}
            help={sendSoundBlocked
              ? "UI sounds is off in Settings. Turn it on there to hear successful sends. Your chat choice is kept."
              : "Play a small chime after a message is sent successfully."}
            onChange={(value) => change("sendSound", value)}
          />
          <SettingsToggle
            label="Inline media previews"
            checked={preferences.showMediaPreviews}
            disabled={disabled}
            help="Show supported images and videos inside messages."
            onChange={(value) => change("showMediaPreviews", value)}
          />
          <SettingsToggle
            label="Auto load peer images"
            checked={preferences.autoLoadImages}
            disabled={disabled || isGlobal || !preferences.showMediaPreviews}
            help={isGlobal
              ? "The global lounge is text only. Peer images are not requested here. Your choice is kept for other rooms."
              : `Requesting peer images exposes your network address to the sender.${!preferences.showMediaPreviews ? " Turn on inline media previews to allow automatic loading." : " Load only from members you trust."}`}
            onChange={(value) => change("autoLoadImages", value)}
          />
        </div>
      </fieldset>

      <fieldset className="chat-settings-section" disabled={disabled}>
        <legend className="chat-settings-legend">Reset preferences</legend>
        <div className="chat-settings-fields">
          <p className="chat-settings-help">
            Restore chat appearance and behavior defaults. Keeps favorites and room notification overrides.
          </p>
          <button
            className="chat-settings-button chat-settings-reset-trigger"
            type="button"
            ref={resetButton}
            disabled={disabled || saving}
            aria-expanded={confirmReset}
            aria-controls={confirmReset ? `${id}-reset` : undefined}
            onClick={() => {
              if (!disabled && !saving) setConfirmReset((current) => !current);
            }}
          >
            Reset preferences
          </button>
          {confirmReset && (
            <div
              className="chat-settings-confirm"
              id={`${id}-reset`}
              role="group"
              aria-labelledby={`${id}-reset-heading`}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelReset();
                }
              }}
            >
              <p className="chat-settings-confirm-title" id={`${id}-reset-heading`}>Reset chat preferences?</p>
              <p className="chat-settings-help">Favorites and room overrides will be kept.</p>
              <div className="chat-settings-actions">
                <button className="chat-settings-button" type="button" ref={cancelButton} disabled={disabled || saving} onClick={cancelReset}>
                  Cancel
                </button>
                <button className="chat-settings-button chat-settings-confirm-button" type="button" disabled={disabled || saving} onClick={reset}>
                  Reset now
                </button>
              </div>
            </div>
          )}
        </div>
      </fieldset>
    </section>
  );
}