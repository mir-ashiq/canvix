param(
    [Parameter(Mandatory = $true)]
    [string]$SourceDir,
    [Parameter(Mandatory = $true)]
    [string]$OutputDir,
    [Parameter(Mandatory = $true)]
    [string]$NodeExePath,
    [Parameter(Mandatory = $true)]
    [string]$PostgresZip
)

$ErrorActionPreference = 'Stop'

$SourceDir = (Resolve-Path $SourceDir).Path
$OutputDir = [IO.Path]::GetFullPath($OutputDir)
$NodeExePath = (Resolve-Path $NodeExePath).Path
$PostgresZip = (Resolve-Path $PostgresZip).Path

function Copy-Tree([string]$Source, [string]$Destination) {
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    & robocopy.exe $Source $Destination /E /NFL /NDL /NJH /NJS /NP | Out-Null
    if ($LASTEXITCODE -gt 7) {
        throw "Failed to copy $Source to $Destination (robocopy exit code $LASTEXITCODE)."
    }
}

if (Test-Path $OutputDir) {
    Remove-Item $OutputDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

$runtimeDir = Join-Path $OutputDir 'runtime'
$appDir = Join-Path $OutputDir 'app'
New-Item -ItemType Directory -Force -Path $runtimeDir, $appDir | Out-Null
Copy-Item $NodeExePath (Join-Path $runtimeDir 'node.exe') -Force

$postgresExtract = Join-Path ([IO.Path]::GetTempPath()) ("canvix-postgres-" + [guid]::NewGuid().ToString('N'))
try {
    Expand-Archive -LiteralPath $PostgresZip -DestinationPath $postgresExtract -Force
    $postgresRoot = Get-ChildItem $postgresExtract -Directory |
        Where-Object { Test-Path (Join-Path $_.FullName 'bin\postgres.exe') } |
        Select-Object -First 1
    if ($null -eq $postgresRoot) {
        throw "The PostgreSQL archive does not contain bin\postgres.exe."
    }
    Copy-Tree $postgresRoot.FullName (Join-Path $runtimeDir 'pgsql')

    $standaloneDir = Join-Path $SourceDir '.next\standalone'
    if (!(Test-Path (Join-Path $standaloneDir 'server.js'))) {
        throw 'The Next.js standalone build is missing server.js.'
    }
    Copy-Tree $standaloneDir $appDir
    $sourceModules = Join-Path $SourceDir 'node_modules'
    $payloadModules = Join-Path $appDir 'node_modules'
    foreach ($package in @('@prisma', 'prisma', 'tsx', 'esbuild', 'get-tsconfig', 'resolve-pkg-maps', '@esbuild\win32-x64')) {
        $sourcePackage = Join-Path $sourceModules $package
        if (!(Test-Path $sourcePackage)) {
            throw "The build is missing node_modules\$package."
        }
        $destinationPackage = Join-Path $payloadModules $package
        Remove-Item $destinationPackage -Recurse -Force -ErrorAction SilentlyContinue
        Copy-Tree $sourcePackage $destinationPackage
    }
    Copy-Tree (Join-Path $SourceDir '.next\static') (Join-Path $appDir '.next\static')
    Copy-Tree (Join-Path $SourceDir 'public') (Join-Path $appDir 'public')
    Copy-Tree (Join-Path $SourceDir 'prisma') (Join-Path $appDir 'prisma')
    Copy-Tree (Join-Path $SourceDir 'src') (Join-Path $appDir 'src')
    New-Item -ItemType Directory -Force -Path (Join-Path $appDir 'scripts') | Out-Null
    Copy-Item (Join-Path $SourceDir 'scripts\db-setup.mjs') (Join-Path $appDir 'scripts\db-setup.mjs') -Force
    Copy-Item (Join-Path $SourceDir 'package.json') (Join-Path $appDir 'package.json') -Force
    Copy-Item (Join-Path $SourceDir 'tsconfig.json') (Join-Path $appDir 'tsconfig.json') -Force

    foreach ($required in @(
        (Join-Path $appDir 'server.js'),
        (Join-Path $appDir 'node_modules\prisma\build\index.js'),
        (Join-Path $appDir 'node_modules\tsx\dist\cli.mjs'),
        (Join-Path $runtimeDir 'pgsql\bin\postgres.exe')
    )) {
        if (!(Test-Path $required)) {
            throw "Standalone payload is missing $required."
        }
    }
}
finally {
    if (Test-Path $postgresExtract) {
        Remove-Item $postgresExtract -Recurse -Force -ErrorAction SilentlyContinue
    }
}
