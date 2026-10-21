#Requires -Version 5.1
<#
.SYNOPSIS
    Zips the TabSwitcherExtension folder as TabSwitcherExtension_<date>_v<version>_chrome.zip (Chrome)
    and TabSwitcherExtension_<date>_v<version>_firefox.zip (Firefox).
.PARAMETER OutputDirectory
    Where to write the zips. Defaults to the repo root.
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

Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

# Compress-Archive on 5.1 writes backslash entry paths, which the stores reject.
# $manifestOverride replaces the manifest.json entry when given.
function New-ExtensionZip {
    param([string]$ZipPath, [string]$ManifestOverride)
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        $root = (Resolve-Path -LiteralPath $sourceDir).ProviderPath.TrimEnd('\') + '\'
        Get-ChildItem -LiteralPath $sourceDir -Recurse -File |
            Where-Object { $_.Name -notin 'desktop.ini', 'Thumbs.db', '.DS_Store' } |
            ForEach-Object {
                $entryName = $_.FullName.Substring($root.Length).Replace('\', '/')
                if ($ManifestOverride -and $entryName -eq 'manifest.json') {
                    $entry = $zip.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
                    $stream = $entry.Open()
                    try {
                        $bytes = (New-Object System.Text.UTF8Encoding($false)).GetBytes($ManifestOverride)
                        $stream.Write($bytes, 0, $bytes.Length)
                    }
                    finally { $stream.Dispose() }
                }
                else {
                    [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                        $zip, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
                }
            }
    }
    finally {
        $zip.Dispose()
    }
    Write-Host "Created $ZipPath"
}

New-ExtensionZip -ZipPath (Join-Path $OutputDirectory "TabSwitcherExtension_${date}_v${version}_chrome.zip")

# Firefox has no extension service workers, so it runs the same files as a background event page.
$firefox = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$firefox.background = [ordered]@{ scripts = @('shared.js', 'background.js') }
$firefox | Add-Member -NotePropertyName browser_specific_settings -NotePropertyValue ([ordered]@{
    gecko = [ordered]@{
        id = 'skillys-auto-tab-switcher@bryceforsm.github.io'
        strict_min_version = '140.0'
        data_collection_permissions = [ordered]@{ required = @('none') }
    }
    # Android only gained data_collection_permissions support in 142.
    gecko_android = [ordered]@{ strict_min_version = '142.0' }
})
New-ExtensionZip -ZipPath (Join-Path $OutputDirectory "TabSwitcherExtension_${date}_v${version}_firefox.zip") `
    -ManifestOverride ($firefox | ConvertTo-Json -Depth 10)
