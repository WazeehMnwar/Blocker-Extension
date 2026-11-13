param([ValidateSet('both', 'firefox', 'chromium')][string]$Target = 'both')
$ErrorActionPreference = 'Stop'
Add-Type -Assembly 'System.IO.Compression.FileSystem'
$source = $PSScriptRoot
$files = @('core.js', 'background.js', 'challenge.js', 'content.js', 'blocked.html', 'blocked.js', 'popup.html', 'popup.js', 'dashboard.html', 'dashboard.js', 'bridge.js', 'ui.css')
$original = Join-Path $source 'extension.xpi'
$backup = Join-Path $source 'releases\Blockout-1.0-original.xpi'
if ((Test-Path -LiteralPath $original) -and !(Test-Path -LiteralPath $backup)) {
    $old = [System.IO.Compression.ZipFile]::OpenRead($original)
    try {
        $reader = [System.IO.StreamReader]::new($old.GetEntry('manifest.json').Open())
        try { $oldManifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
    } finally { $old.Dispose() }
    if ($oldManifest.version -eq '1.0') {
        New-Item -ItemType Directory -Path (Join-Path $source 'releases') -Force | Out-Null
        Copy-Item -LiteralPath $original -Destination $backup
    }
}
$targets = if ($Target -eq 'both') { @('firefox', 'chromium') } else { @($Target) }
foreach ($browserTarget in $targets) {
    $manifest = Get-Content -Raw -LiteralPath (Join-Path $source 'manifest.json') | ConvertFrom-Json
    $dest = Join-Path $source $(if ($browserTarget -eq 'firefox') { 'extension.xpi' } else { 'extension-chromium.zip' })
    if ($browserTarget -eq 'firefox') {
        $manifest.background.PSObject.Properties.Remove('service_worker')
        $manifest.background | Add-Member -NotePropertyName 'scripts' -NotePropertyValue @('core.js', 'background.js') -Force
        $manifest | Add-Member -NotePropertyName 'browser_specific_settings' -NotePropertyValue @{
            gecko = @{ id = 'blockout@example.com'; strict_min_version = '121.0' }
        } -Force
    } else {
        $manifest.background.PSObject.Properties.Remove('scripts')
        $manifest.PSObject.Properties.Remove('browser_specific_settings')
    }
    $tempArchive = Join-Path $source ($browserTarget + '-build.tmp.zip')
    if (Test-Path -LiteralPath $tempArchive) { Remove-Item -LiteralPath $tempArchive -Force }
    $zip = [System.IO.Compression.ZipFile]::Open($tempArchive, 'Create')
    try {
        $entry = $zip.CreateEntry('manifest.json')
        $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
        try { $writer.Write(($manifest | ConvertTo-Json -Depth 20)) } finally { $writer.Dispose() }
        foreach ($file in $files) {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $source $file), $file, 'Optimal') | Out-Null
        }
    } finally { $zip.Dispose() }
    Move-Item -LiteralPath $tempArchive -Destination $dest -Force
    Write-Host "Built $browserTarget package: $dest"
}
