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

# The app: code, UI, and installed dependencies. Mirroring (rather than
# Copy-Item -Recurse) keeps re-runs from nesting folders and drops files
# that no longer exist in the repo.
foreach ($item in 'src', 'public', 'node_modules') {
  robocopy "$src\$item" "$dest\app\$item" /MIR /NFL /NDL /NJH /NJS /NP | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "$item copy failed (robocopy code $LASTEXITCODE)" }
}
Copy-Item "$src\package.json" "$dest\app\package.json" -Force

# Current labels and settings travel with the stick. Copy the files, not the
# folder, so an existing data folder on the stick is updated rather than
# getting a nested copy.
if (Test-Path "$src\data") {
  New-Item -ItemType Directory -Force "$dest\data" | Out-Null
  Copy-Item "$src\data\*" "$dest\data\" -Recurse -Force
}

Copy-Item "$PSScriptRoot\START-LABELS.bat" "$dest\START-LABELS.bat" -Force

Write-Host "Done. On any Windows PC: plug in the stick, open the ZebraConnect folder,"
Write-Host "and double-click START-LABELS.bat. The window shows the address for the phones."
