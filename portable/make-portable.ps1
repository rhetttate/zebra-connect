# Copies a fully portable Zebra Connect onto a thumb drive.
# Usage:  powershell -ExecutionPolicy Bypass -File portable\make-portable.ps1 E:
param([Parameter(Mandatory = $true)][string]$Drive)

$ErrorActionPreference = 'Stop'
$Drive = $Drive.TrimEnd('\').TrimEnd(':') + ':'
if (-not (Test-Path $Drive)) { throw "Drive $Drive not found. Is the stick plugged in?" }

$src = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $Drive 'ZebraConnect'
Write-Host "Building portable app at $dest ..."

New-Item -ItemType Directory -Force "$dest\app" | Out-Null

# The Node runtime itself (a single exe is all the server needs).
Copy-Item (Get-Command node).Source "$dest\node.exe" -Force

# The app: code, UI, and installed dependencies.
foreach ($item in 'src', 'public', 'package.json') {
  Copy-Item "$src\$item" "$dest\app\$item" -Recurse -Force
}
robocopy "$src\node_modules" "$dest\app\node_modules" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
if ($LASTEXITCODE -ge 8) { throw "node_modules copy failed (robocopy code $LASTEXITCODE)" }

# Current labels and settings travel with the stick.
if (Test-Path "$src\data") { Copy-Item "$src\data" "$dest\data" -Recurse -Force }

Copy-Item "$PSScriptRoot\START-LABELS.bat" "$dest\START-LABELS.bat" -Force

Write-Host "Done. On any Windows PC: plug in the stick, open the ZebraConnect folder,"
Write-Host "and double-click START-LABELS.bat. The window shows the address for the phones."
