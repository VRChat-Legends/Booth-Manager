# Booth Manager

The Legends Alley booth toolkit. Windows desktop app (C# / WinUI 3) for the
VRChat Legends team: manage Alley booths, generate cardboard standees, atlas
booth images, and (soon) build booths on the 3D prefab.

## Features
- Discord sign-in through vrchatlegends.com. Login is blocked unless the
  account is a site admin or has a team role.
- Role-aware UI: team members only see their assigned booths; the Admin tab
  is site-admin only.
- Booth records: name, description, group id (grp_), avatar id (avtr_),
  world ids (wrld_), booth images.
- Standee Studio: turn a transparent/plain-background image into a cardboard
  standee mesh (OBJ + texture) - original implementation inspired by
  Sketch494's Auto-Standee.
- Image Atlas: pack booth images into a single power-of-two atlas + UV map.
- Background music and UI sounds (toggle in Settings).
- Update check on launch and while running; one-click update from GitHub
  releases.

## Build

Requirements: .NET 9 SDK, Windows 10 19041+.

```
cd src/BoothManager
dotnet build -p:Platform=x64
dotnet run -p:Platform=x64
```

Release: `dotnet publish -c Release -p:Platform=x64 -r win-x64`

## License
Proprietary - Copyright (c) 2026 VRChat Legends. See LICENSE.
