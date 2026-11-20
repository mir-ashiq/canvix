param(
    [string]$Version = '0.23.2',
    [string]$NodeVersion = '22.14.0',
    [string]$PostgresVersion = '17.12-1'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$downloads = Join-Path $PSScriptRoot 'downloads'
$staging = Join-Path $PSScriptRoot 'staging'
$payload = Join-Path $staging 'payload'
$artifactRoot = Join-Path $root 'builds'
$buildStamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$artifactDirectory = Join-Path $artifactRoot "Canvix-$Version-$buildStamp"
$nodeZip = Join-Path $downloads "node-v$NodeVersion-win-x64.zip"
$postgresZip = Join-Path $downloads "postgresql-$PostgresVersion-windows-x64-binaries.zip"
$nodeUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-x64.zip"
$postgresUrl = "https://get.enterprisedb.com/postgresql/postgresql-$PostgresVersion-windows-x64-binaries.zip"

New-Item -ItemType Directory -Force -Path $downloads, $staging | Out-Null
if (!(Test-Path $nodeZip)) {
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
}
if (!(Test-Path $postgresZip)) {
    Invoke-WebRequest -Uri $postgresUrl -OutFile $postgresZip
}

$nodeExtract = Join-Path $staging 'node'
if (Test-Path $nodeExtract) {
    Remove-Item $nodeExtract -Recurse -Force
}
Expand-Archive -LiteralPath $nodeZip -DestinationPath $nodeExtract -Force
$nodeExe = Get-ChildItem $nodeExtract -Recurse -Filter node.exe | Select-Object -First 1
if ($null -eq $nodeExe) {
    throw 'The Node.js archive does not contain node.exe.'
}

if (Test-Path $payload) {
    Remove-Item $payload -Recurse -Force
}

Push-Location $root
try {
    & npm.cmd ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed with exit code $LASTEXITCODE." }
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw "npm run build failed with exit code $LASTEXITCODE." }
}
finally {
    Pop-Location
}

$prepare = Join-Path $PSScriptRoot 'prepare-runtime.ps1'
& $prepare -SourceDir $root -OutputDir $payload -NodeExePath $nodeExe.FullName -PostgresZip $postgresZip
if ($LASTEXITCODE -gt 7) { throw "Runtime assembly failed with exit code $LASTEXITCODE." }

$launcherProject = Join-Path $root 'packaging\windows\CanvixLauncher\CanvixLauncher.csproj'
$launcherPublish = Join-Path $root 'packaging\windows\CanvixLauncher\bin\Release\net8.0-windows\win-x64\publish'
& dotnet publish $launcherProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:Version=$Version
if ($LASTEXITCODE -ne 0) { throw "Launcher publish failed with exit code $LASTEXITCODE." }

$msi = Join-Path $root 'CanvixSetup.msi'
$wxs = Join-Path $root 'packaging\windows\Canvix.wxs'
& wix build $wxs -arch x64 -d ProductVersion=$Version -d PublishDir=$launcherPublish -d StandaloneDir=$payload -o $msi
if ($LASTEXITCODE -ne 0) { throw "MSI build failed with exit code $LASTEXITCODE." }

$bootstrapperProject = Join-Path $root 'packaging\windows\CanvixSetupBootstrapper\CanvixSetupBootstrapper.csproj'
& dotnet publish $bootstrapperProject -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true -p:Version=$Version -p:MsiPath=$msi
if ($LASTEXITCODE -ne 0) { throw "Setup publish failed with exit code $LASTEXITCODE." }

$setupSource = Join-Path $root 'packaging\windows\CanvixSetupBootstrapper\bin\Release\net8.0-windows\win-x64\publish\CanvixSetup.exe'
& wix msi validate $msi
if ($LASTEXITCODE -ne 0) { throw "MSI validation failed with exit code $LASTEXITCODE." }

New-Item -ItemType Directory -Force -Path $artifactDirectory | Out-Null
Move-Item $msi (Join-Path $artifactDirectory 'CanvixSetup.msi') -Force
Copy-Item $setupSource (Join-Path $artifactDirectory 'CanvixSetup.exe') -Force

Write-Host "Standalone installer ready: $artifactDirectory\CanvixSetup.exe"
Write-Host "Standalone MSI ready: $artifactDirectory\CanvixSetup.msi"
