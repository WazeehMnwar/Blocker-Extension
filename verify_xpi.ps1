$ErrorActionPreference = 'Stop'
Add-Type -Assembly 'System.IO.Compression.FileSystem'
foreach ($name in @('extension.xpi', 'extension-chromium.zip')) {
    $zip = [System.IO.Compression.ZipFile]::OpenRead((Join-Path $PSScriptRoot $name))
    try {
        $reader = [System.IO.StreamReader]::new($zip.GetEntry('manifest.json').Open())
        try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
        if ($manifest.version -ne '2.0.0') { throw "Incorrect version in $name" }
        if ($zip.Entries.Count -ne 13) { throw "Unexpected package file count in $name" }
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName -eq 'manifest.json') { continue }
            $stream = $entry.Open()
            $sha = [System.Security.Cryptography.SHA256]::Create()
            try { $packagedHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose(); $sha.Dispose() }
            $sourceHash = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $PSScriptRoot $entry.FullName)).Hash
            if ($sourceHash -ne $packagedHash) { throw "Stale packaged file: $($entry.FullName)" }
        }
        if ($name -eq 'extension.xpi') {
            if ($manifest.background.service_worker -or ($manifest.background.scripts -join ',') -ne 'core.js,background.js') { throw 'Firefox package must use background scripts.' }
            if ($manifest.browser_specific_settings.gecko.id -ne 'blockout@example.com') { throw 'Missing Firefox extension ID.' }
        }
        if ($name -eq 'extension-chromium.zip') {
            if ($manifest.background.scripts -or $manifest.background.service_worker -ne 'background.js') { throw 'Chromium package must use a service worker.' }
            if ($manifest.browser_specific_settings) { throw 'Firefox settings must not be included in the Chromium package.' }
        }
        Write-Host "Verified $name : v$($manifest.version), $($zip.Entries.Count) files, source hashes match."
    } finally { $zip.Dispose() }
}
