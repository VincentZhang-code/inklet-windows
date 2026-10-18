# Inklet for Windows

![Inklet](assets/inklet.png)

A local Markdown editor for Windows, with source and visual editing, tables,
math, Mermaid, local images, search, a reading outline and HTML/PDF/DOCX export.

## Download

Download the complete Windows x64 ZIP from [Releases](https://github.com/VincentZhang-code/inklet-windows/releases).
Extract the whole archive and launch Inklet.exe; do not move the executable alone.

Windows 10/11 x64, .NET Framework 4.7.2 or newer and Microsoft Edge WebView2 Runtime
are required. The application uses the installed runtime; the ZIP does not bundle it.
The current build is unsigned. Windows may display an unknown-publisher warning.
Do not disable Windows security checks. Verify the SHA-256 checksum before use.

## Build

Install Node.js 24 LTS (including npm), and use Windows PowerShell:

```powershell
.\tools\bootstrap.ps1
npm --prefix app test
.\tools\test-native.ps1
.\tools\build.ps1
```

Bootstrap downloads the lockfile-pinned npm dependencies and WebView2 SDK 1.0.2903.40.
The .NET Framework compiler under Windows is used. Build output is under release/.
Generated icons and local visual assets are included; no browser is needed to build.

## Scope

This repository contains the ordinary Windows edition only. Temporary test data,
browser profiles, old releases, development dependencies and local workspace data
are not committed. Small core and native tests remain for regression coverage.
There is no server, account registration, telemetry or automatic update service.

The editor is an early release, not a complete implementation of every Markdown
extension. Keep independent backups. Unsaved recovery covers acknowledged writes,
not every last keystroke; complex input methods and long-term workflows need testing.

## License

Project sources are licensed under [MIT](LICENSE). Bundled third-party libraries
and assets retain their own notices under [licenses](licenses). No trademark rights
are granted by the source license.
