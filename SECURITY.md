# Security Policy

Booth Manager is the Windows community companion for Legends Alley. It handles Discord based sign in, community chat, peer to peer file sharing, and downloads of retained booth uploads, so security reports are taken seriously.

## Supported versions

Only the latest release receives security fixes. The app downloads updates in the background and installs them on restart, so staying current is automatic for most users.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Anything older | No |

## How to report a vulnerability

Please do not report security vulnerabilities through public GitHub issues, the in-app Bug Tracker, or public Discord channels.

Use one of these private channels instead:

1. GitHub private vulnerability reporting: [open a draft security advisory](https://github.com/VRChat-Legends/Booth-Manager/security/advisories/new). This is the preferred channel.
2. Discord: join the [VRChat Legends Discord](https://discord.gg/6xPkZ7Dxp9) and send a direct message to a member of the staff team.

Helpful details to include:

- The app version (shown at the bottom of the Settings page) and your Windows version.
- Steps to reproduce, a proof of concept, or a clear description of the flaw.
- The impact you believe it has, meaning what an attacker could actually do.
- Whether the issue involves the desktop app, the Legends Alley service, or both.

## Scope

In scope:

- This desktop application: the main and renderer processes, the preload bridge, the sign in flow, the auto updater, peer file transfers, and booth backup downloads.
- Issues in the Legends Alley service discovered through this app. We maintain that service and will route the report.

Out of scope:

- Vulnerabilities in VRChat, Discord, or GitHub themselves.
- Third party dependencies without a demonstrated impact on this app. Please report those upstream as well.
- Denial of service, spam, or social engineering of community members.

## What to expect

- An acknowledgement within a few days.
- Status updates while the issue is investigated and fixed.
- Credit in the release notes if you would like it. There is no bug bounty program at this time.
