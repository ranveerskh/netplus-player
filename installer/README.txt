STB PLAY latest-installer bootstrapper

Install-Latest.cmd checks the latest published GitHub Release and downloads
only the newest STB-PLAY Windows installer before launching it.

For the public website, publish this bootstrapper only after the GitHub
workflow is configured to publish a Windows installer asset matching:
STB-PLAY-Setup-<version>.exe

The bootstrapper requires an internet connection. It does not collect portal,
MAC, PIN, or playback data.
