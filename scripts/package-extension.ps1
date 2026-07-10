[CmdletBinding()]
param(
  [string] $OutputDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist")
)

$ErrorActionPreference = "Stop"

$repositoryRoot = Split-Path -Parent $PSScriptRoot
$extensionRoot = Join-Path $repositoryRoot "chrome_extension"
$manifestPath = Join-Path $extensionRoot "manifest.json"
$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json

if (-not $manifest.version) {
  throw "chrome_extension/manifest.json does not define a version."
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$outputRoot = (Resolve-Path -LiteralPath $OutputDirectory).Path
$archiveName = "smartflow-helper-extension-v$($manifest.version).zip"
$archivePath = Join-Path $outputRoot $archiveName
$stagingRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("smartflow-helper-" + [guid]::NewGuid().ToString("N"))
$runtimePaths = @("manifest.json", "src")

try {
  New-Item -ItemType Directory -Path $stagingRoot | Out-Null

  foreach ($runtimePath in $runtimePaths) {
    $sourcePath = Join-Path $extensionRoot $runtimePath
    if (-not (Test-Path -LiteralPath $sourcePath)) {
      throw "Required extension path is missing: chrome_extension/$runtimePath"
    }

    Copy-Item -LiteralPath $sourcePath -Destination (Join-Path $stagingRoot $runtimePath) -Recurse
  }

  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath
  }

  Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $archivePath -CompressionLevel Optimal
}
finally {
  if (Test-Path -LiteralPath $stagingRoot) {
    Remove-Item -LiteralPath $stagingRoot -Recurse -Force
  }
}

Write-Output $archivePath
