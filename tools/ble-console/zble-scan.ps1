# Passive BLE advertisement scan of the printer (default 48:A4:93:E7:1C:F3) for N seconds.
param([uint64]$Addr = 0x48A493E71CF3, [int]$Seconds = 12)
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$dll = Join-Path $dir 'ZBleScan.dll'; $cs = Join-Path $dir 'ZBleScan.cs'
if (-not (Test-Path $dll) -or (Get-Item $cs).LastWriteTime -gt (Get-Item $dll).LastWriteTime) {
  $winmd = Get-ChildItem "C:\Program Files (x86)\Windows Kits\10\UnionMetadata" -Recurse -Filter Windows.winmd | Where-Object { $_.Length -gt 1MB } | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
  $rtwr  = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime.WindowsRuntime" -Recurse -Filter System.Runtime.WindowsRuntime.dll | Select-Object -First 1 -ExpandProperty FullName
  $rtfac = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime" -Recurse -Filter System.Runtime.dll | Select-Object -First 1 -ExpandProperty FullName
  $iwr   = Get-ChildItem "C:\Windows\Microsoft.NET\assembly\GAC_MSIL\System.Runtime.InteropServices.WindowsRuntime" -Recurse -Filter *.dll | Select-Object -First 1 -ExpandProperty FullName
  & "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /target:library /out:"$dll" /reference:"$winmd" /reference:"$rtwr" /reference:"$rtfac" /reference:"$iwr" "$cs"
  if (-not (Test-Path $dll)) { Write-Output "compile failed"; exit 1 }
}
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -Path $dll
Write-Output ("scanning {0} s for {1:X12} ..." -f $Seconds, $Addr)
Write-Output ([ZBleScan]::Scan($Addr, $Seconds * 1000))
