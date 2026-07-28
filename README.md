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
```

## Build the installer

```
npm run dist     # NSIS installer in release/
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
