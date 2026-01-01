# VTR-PON 2

A software for instant playback ("Pon-Dashi") of videos, audio, still images, and UVC video sources.

For detailed usage instructions, tutorials, and further information, please visit our [official website](https://pondashi.com/vtrpon).

---

## Overview

VTR-PON 2 utilizes dual displays, allowing separate operational and fullscreen playback screens, making it ideal for presentations, events, or any scenario requiring instant playback of multimedia files.

---

## Key Features

- Instant playback of videos (MP4, MOV, WEBM), audio (WAV, MP3, FLAC, M4A, AAC), and images (PNG, JPG)
- Playback and streaming of UVC device inputs (live camera sources)
- PowerPoint (PPTX) import and playback as video (Windows only)
- Customizable playback points (IN/OUT) and fade effects
- Playlist creation, management, and quick recall (up to 9 slots, depending on build)
- Playback automation via Start/End Modes (Repeat with optional count, NEXT, GOTO)
- Import-time conversions for operational workflow:
  - Still images -> timed MP4 clip
  - Alpha sources -> WebM with alpha
  - Capture -> timed MP4 clip
  - PPTX -> timed MP4 clip
- Volume management and fullscreen output monitoring
- Blackmagic ATEM integration: map ATEM inputs, auto-switch and auto-OnAir

Keyboard shortcuts and detailed operational guides:
- Official site: https://pondashi.com/vtrpon/

[![Watch the video](https://img.youtube.com/vi/mEIB4ZRhXXw/0.jpg)](https://www.youtube.com/watch?v=mEIB4ZRhXXw)

---

## System Requirements

### Platform
- Windows: supported (Windows 10/11 recommended)
- macOS: Apple Silicon only (Intel Macs are not supported)
  - Supported OS: macOS 12+

### Hardware
- Two or more displays recommended (operation screen + fullscreen output)
- Dedicated graphics card recommended
- 8GB RAM or higher recommended

### Optional (PPTX feature)
- Microsoft PowerPoint (Office 2016 or later) is required for PPTX conversion (Windows only)
- PPTX is not supported on macOS

---

## Installation

1. Download the VTR-PON 2 installer from the link below.
2. Run the installer and follow the on-screen instructions.
3. Launch the application.

Download the latest version:(https://pondashi.com/vtrpon/)

---

## Building from Source

If you intend to build the installer from source code, the following components must be installed separately:

- Node.js ([Download Node.js](https://nodejs.org/))

---

## Important Notice

This software is currently in public beta. Bugs may exist; avoid using in critical production environments.

**Disclaimer**  
This software is provided as-is without warranty of any kind. Use at your own risk, especially in production environments.

---

## Contribution & Feedback

Feedback and contributions are always welcome.

- Email: info@pondashi.com
- Twitter: [@vtrpon2](https://x.com/vtrpon2)


---

## Contributors

Special thanks to all contributors who have helped improve VTR-PON 2.

- [nasshu2916](https://github.com/nasshu2916) - Cross-platform compatibility improvements, automated build scripts for Windows and macOS

---

## License

Distributed under the GNU General Public License (GPL) Version 3.

[View the full GPL v3 License Text](https://www.gnu.org/licenses/gpl-3.0.txt)

---

c 2024-2025 Tetsu Suzuki All Rights Reserved.
