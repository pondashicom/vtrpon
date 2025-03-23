# VTR-PON 2

A software for instant playback ("Pon-Dashi") of videos, audio, still images, and UVC video sources.

For detailed usage instructions, tutorials, and further information, please visit our [official website](https://pondashi.com/vtrpon).

---

## Overview

VTR-PON 2 utilizes dual displays, allowing separate operational and fullscreen playback screens, making it ideal for presentations, events, or any scenario requiring instant playback of multimedia files.

---

## Key Features

- Instant playback of videos (MP4, MOV, WEBM), audio (WAV, MP3, FLAC), and images (PNG)
- Playback and streaming of UVC device inputs
- Convert and playback PowerPoint slides (.pptx) as videos
- Customizable playback points (IN/OUT), fade effects
- Playlist creation, management, and quick recall
- Volume management and fullscreen output monitoring

---

## System Requirements

- Windows 10/11
- Two or more displays required
- Dedicated graphics card recommended
- 8GB RAM or higher recommended
- Microsoft PowerPoint (Office 2016 or later) required only for pptx conversion feature

---

## Installation

1. Download the VTR-PON 2 installer from the link below.
2. Run the installer and follow the on-screen instructions.
3. Launch the application.

Download the latest version: [public beta 2.2.5](https://pondashi.com/vtrpon/download/vtrponsetup2.2.5.zip)

---

## Building from Source

If you intend to build the installer from source code, the following components must be installed separately:

- Node.js ([Download Node.js](https://nodejs.org/))
- FFmpeg and ffprobe executables (must be placed manually into the application directory)

Refer to `package.json` for asset details:

```json
"extraResources": [
  {
    "from": "src/assets/ffmpeg.exe",
    "to": "ffmpeg.exe"
  },
  {
    "from": "src/assets/ffprobe.exe",
    "to": "ffprobe.exe"
  }
]
```

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

## License

Distributed under the GNU General Public License (GPL) Version 3.

[View the full GPL v3 License Text](https://www.gnu.org/licenses/gpl-3.0.txt)

---

c 2024-2025 Tetsu Suzuki All Rights Reserved.