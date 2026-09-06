# Booth Manager

Booth Manager is the Windows community companion for Legends Alley. It uses the
same authoritative community, team, event, and booth upload data as the Alley
website and Unity SDK. It is built with Electron, React, Vite, and Three.js.

## Features

- Discord sign-in for community owners, managers, linked team members, and
  Alley staff. Community name, VRChat group ID, and current role stay visible
  in the app shell.
- One retained chat room per community, independent of booth upload state.
  Staff can inspect and participate in every community room.
- Peer-to-peer images, videos, and files. The backend retains message text and
  attachment metadata only. File bytes remain on the uploader's computer and
  are transferred directly over WebRTC when requested.
- Explicit unavailable states when an attachment uploader is offline or a
  local file was moved, changed, or deleted.
- Read-only booth backups sourced exclusively from accepted Unity SDK uploads.
  Every retained server version can be inspected and downloaded as its
  original ZIP package.
- Notifications when a newly retained booth upload appears.
- Automatic backup-only mode beginning five days before the event and lasting
  through its end. Community editing and collaboration are locked during this
  window while booth ZIP downloads remain available. Staff are exempt.
- Community profile, team, and upload views backed by the Alley service, plus
  cross-community administration for staff.
- Booth Builder remains visible as a disabled preview for a future release.
- Standee Studio generates live 3D cutouts with background detection, bevels,
  optional back art and support stands, wireframe preview, and GLB, FBX, OBJ,
  or STL export.
- Background update downloads and restart-to-install support.

## Analytics and workspace tools

- Analytics uses Recharts for interactive upload activity, version status, SDK performance, and archive-storage charts.
- Filter by 7, 30, or 90 days, all retained records, or custom UTC dates; staff can also filter all-community data.
- CSV exports include the filtered records, measurement gaps, report scope, and snapshot time; each chart can be saved as SVG.
- Totals cover retained SDK uploads only, not deleted history, visits, or downloads. Missing measurements are never substituted with zeros.
- The dashboard includes upload activity, event timing, recent backups, and shortcuts. Ctrl+K opens keyboard navigation.
- QR tools check contrast, quiet zones, and raster detail; PNG and SVG exports use the current payload and settings.
- Texture Atlas serializes rebuilds, blocks stale exports, and displays measured material and mesh reductions with local GLB and PNG exports.

## Team chat

- Pop chat into one native desktop window. Dock from either window or close the pop-out to return it to Team Chat. Repeat requests focus the existing window instead of creating another.
- The pop-out moves the same live chat view, preserving drafts, pending attachments, settings, reading position, and active transfers. The main window can navigate elsewhere while chat stays open.
- Search rooms, star favorites, and keep separate text drafts for the session. Leaving docked Team Chat ends that session; changing pages while chat is detached does not. Drafts survive docking but not app restarts or sign-out.
- Search message text, authors, and filenames within the latest 300 loaded messages, with All, Mentions, Files, and Mine filters. This is not a search of deleted or older server history.
- View room members and shared files, insert mentions, copy messages, or add a plain-text quote to a draft. The member list does not claim to show online presence.
- CommonMark and GitHub-flavored Markdown support headings, nested lists, tasks, tables, quotes, links, footnotes, and highlighted code blocks with copy controls. Mentions and search highlighting do not alter code or link destinations.
- The composer has a formatting toolbar, selection-aware keyboard shortcuts, Markdown help, Write/Preview modes, and an auto-sizing text area. Ctrl+B, Ctrl+I, Ctrl+Shift+X, and Ctrl+backtick format text; Ctrl+K remains app navigation. Messages retain the service's 1200-character limit.
- HTML is sanitized and unsafe links are blocked. External images require an explicit Load image action, which contacts the external host; disabling previews or using the global lounge prevents inline loading. Peer-file privacy controls remain separate.
- Personal settings include compact or comfortable density, text size, avatars, timestamps, 12/24-hour time, role badges, message grouping, media previews, and automatic peer-image loading.
- Choose Enter or Ctrl/Cmd+Enter to send. Shift+Enter inserts a newline. New messages preserve your reading position and offer a jump to the latest message.
- Choose all messages, mentions, or mute, with separate room overrides and sound controls. Notifications cover only the selected room while Team Chat is open, docked or popped out; desktop alerts also require that chat window to be hidden or unfocused.
- Desktop alerts and message previews are off by default. The app-wide sound and native-notification switches remain master controls.
- Preferences are saved locally per account and service. Reset restores appearance and behavior without removing favorites or room overrides. Failed saves are shown instead of reported as successful.
- Room locks and message deletion require confirmation and existing permissions. Personal mute does not lock a room. The global lounge remains text only, with peer transfers disabled there.
- Failed polls retain the last successful snapshot. Switching rooms ignores old responses, and delayed sends cannot clear a newer draft or another room's draft.

## Peer Attachments

Messages allow up to five attachments, each no larger than 500 MB. Transfers
use WebRTC data channels with STUN discovery and no backend byte storage. The
uploader must be online with the original local file still available. The
current release does not use a TURN relay, so direct transfer may be unavailable
on restrictive networks.

## Develop

Requirements: Node 20+.

```
npm install
npm run dev      # vite + electron with hot reload
npm run build:icon
npm test
```

The unit tests cover analytics, QR exports, chat filtering, mentions, preference persistence, notifications, request races, atomic settings writes, Markdown safety, formatting selections, and native window lifecycle rules without accessing user data.

Run `npm run test:desktop` with Vite running to exercise the real Electron pop-out at desktop sizes. After `npm run build:web`, setting `BOOTH_TEST_BUILT=1` runs the same test against the built renderer using file URLs instead. These tests use a separate temporary app profile and synthetic data, never the installed app or production messages. Screenshots are written to the system temporary directory under `booth-chat-desktop-previews`.

The [desktop fixture](tests/ui/chatDesktop.html) loads the [synthetic bridge](tests/ui/chatFixture.js) before the real renderer. It supports failed or delayed requests and in-memory settings. All interaction and layout checks are desktop-only; no phone emulation is used.

## Build the installer

```
npm run dist -- --publish never
```

The installer build regenerates the multi-size Windows icon from
`assets/app-icon.svg` before compiling the renderer.

## Server support

Authentication, community chat, attachment metadata, WebRTC signaling, event
state, community management, and retained upload downloads are served by the
Legends Alley backend. Deploy its matching auth, chat, event, and upload route
changes before testing this client against production.

## License
Proprietary - Copyright (c) 2026 VRChat Legends. See LICENSE.
