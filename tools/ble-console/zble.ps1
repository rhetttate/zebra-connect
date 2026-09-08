# BLE SGD console for the Zebra ZQ620 Plus (address 48:A4:93:E7:1C:F3).
# Usage: powershell -File zble.ps1 -Cmds 'getvar "bluetooth.bonding"','setvar "x" "y"'
param([string[]]$Cmds = @('getvar "device.friendly_name"'), [string]$CmdFile = '', [int]$WaitMs = 4000)
if ($CmdFile) { $Cmds = Get-Content $CmdFile | Where-Object { $_.Trim() -ne '' } }

$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dll = Join-Path $dir 'ZBle.dll'
$cs  = Join-Path $dir 'ZBle.cs'
if (-not (Test-Path $dll)) {
  $winmd = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\UnionMetadata" -Recurse -Filter Windows.winmd | Where-Object { $_.Length -gt 1MB } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  $rtwr  = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime.WindowsRuntime" -Recurse -Filter System.Runtime.WindowsRuntime.dll | Select-Object -First 1 -ExpandProperty FullName
  $rtfac = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime" -Recurse -Filter System.Runtime.dll | Select-Object -First 1 -ExpandProperty FullName
  $iwr   = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime.InteropServices.WindowsRuntime" -Recurse -Filter *.dll | Select-Object -First 1 -ExpandProperty FullName
  $csc   = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
  Write-Output "compiling with $csc"
  & $csc /nologo /target:library /out:"$dll" /reference:"$winmd" /reference:"$rtwr" /reference:"$rtfac" /reference:"$iwr" "$cs"
  if (-not (Test-Path $dll)) { Write-Output "compile failed"; exit 1 }
  Write-Output "compiled OK"
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -Path $dll
$z = New-Object ZBle
$ok = $false
for ($i = 1; $i -le 6; $i++) {
  $r = $z.Connect([uint64]0x48A493E71CF3); Write-Output "connect attempt $i : $r"
  if ($r -like 'connected*') { $ok = $true; break }
  $z.Close(); $z = New-Object ZBle; Start-Sleep -Seconds 4
}
if (-not $ok) { Write-Output "BLE connect failed"; exit 2 }
foreach ($c in $Cmds) { $r = $z.Send("! U1 $c`r`n", $WaitMs); Write-Output ("$c => [" + $r.Trim() + "]") }
$tail = $z.Drain(3000); if ($tail.Trim()) { Write-Output ("trailing => [" + $tail.Trim() + "]") }
$z.Close()
