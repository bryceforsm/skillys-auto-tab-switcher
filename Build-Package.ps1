#Requires -Version 5.1
<#
.SYNOPSIS
    Zips the TabSwitcherExtension folder as TabSwitcherExtension_<date>_v<version>.zip.
.PARAMETER OutputDirectory
    Where to write the zip. Defaults to the repo root.
#>
[CmdletBinding()]
param(
    [string]$OutputDirectory = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$sourceDir = Join-Path $PSScriptRoot 'TabSwitcherExtension'
$manifestPath = Join-Path $sourceDir 'manifest.json'

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$version = $manifest.version
if (-not $version) { throw "No 'version' field found in $manifestPath" }

$date = Get-Date -Format 'yyyy-MM-dd'
$zipPath = Join-Path $OutputDirectory "TabSwitcherExtension_${date}_v$version.zip"

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

# Compress-Archive on 5.1 writes backslash entry paths, which the Chrome Web Store rejects.
$zip = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $root = (Resolve-Path -LiteralPath $sourceDir).ProviderPath.TrimEnd('\') + '\'
    Get-ChildItem -LiteralPath $sourceDir -Recurse -File |
        Where-Object { $_.Name -notin 'desktop.ini', 'Thumbs.db', '.DS_Store' } |
        ForEach-Object {
            $entryName = $_.FullName.Substring($root.Length).Replace('\', '/')
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        }
}
finally {
    $zip.Dispose()
}

Write-Host "Created $zipPath"
