# Standalone Windows installer

The Windows package runs Canvix without Docker Desktop, GHCR, or a separate PostgreSQL installation. It bundles the Next.js standalone server, Node.js, PostgreSQL 17.12, Prisma migrations, and the built-in template seed.

Use `CanvixSetup.exe` for normal installation. It requests administrator approval, runs the embedded per-machine MSI, and starts Canvix after installation. The launcher stores application settings and the PostgreSQL data directory in `%ProgramData%\Canvix`. Designs remain in that local PostgreSQL database across application updates.

The launcher starts PostgreSQL on `127.0.0.1:54321`, runs migrations and the template seed, then starts Canvix on `127.0.0.1:3000`. It checks the latest GitHub release at `https://github.com/mir-ashiq/canvix/releases/latest` and downloads a newer complete installer when available.

Build locally from the repository root with PowerShell:

```powershell
pwsh -NoProfile -File packaging/windows/standalone/build-standalone.ps1 -Version 0.23.2
```

The build downloads these verified runtime inputs when absent from `packaging/windows/standalone/downloads`:

- Node.js `22.14.0` Windows x64 ZIP
- PostgreSQL `17.12-1` Windows x64 binaries ZIP

Each local build is written to a timestamped folder such as `builds/Canvix-0.23.2-20261116-114530/`, containing `CanvixSetup.exe` and `CanvixSetup.msi`. The `Windows installer` GitHub Actions workflow uploads those timestamped files and publishes them under the canonical `CanvixSetup.exe` and `CanvixSetup.msi` release asset names. The standalone package has no GHCR visibility requirement.
