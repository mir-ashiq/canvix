# Windows installer

The Windows package installs `CanvixLauncher.exe` and a Docker Compose file. Docker Desktop is a prerequisite; if it is missing, the launcher offers Docker's official installer. The package does not bundle Docker, PostgreSQL, or the application image.

Use `CanvixSetup.exe` for normal installation. It requests administrator approval, runs the embedded per-machine MSI, writes a verbose failure log to `%TEMP%\CanvixSetup-<id>.log`, and starts Canvix after installation. The launcher stores its generated `.env` file in `%ProgramData%\Canvix` and keeps PostgreSQL data in a Docker volume.

At startup, the launcher checks the latest GitHub release at `https://github.com/mir-ashiq/canvix/releases/latest`. A newer `CanvixSetup.exe` is offered for download. When only the runtime image needs updating, it pulls the tagged Canvix image and recreates the web service without touching the database volume.

Build locally from the repository root:

```bash
dotnet publish packaging/windows/CanvixLauncher/CanvixLauncher.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:Version=0.23.1
wix build packaging/windows/Canvix.wxs -arch x64 -d ProductVersion=0.23.1 -d PublishDir=packaging/windows/CanvixLauncher/bin/Release/net8.0-windows/win-x64/publish -d SourceDir=packaging/windows -o CanvixSetup.msi
dotnet publish packaging/windows/CanvixSetupBootstrapper/CanvixSetupBootstrapper.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:Version=0.23.1 -p:MsiPath="$PWD/CanvixSetup.msi"
```

The `Docker images` GitHub Actions workflow builds the `ghcr.io/mir-ashiq/canvix-web` image and, when given a version, publishes `CanvixSetup.exe` and `CanvixSetup.msi` in the matching GitHub release. Set the GHCR package visibility to public; the launcher pulls the image without credentials.
