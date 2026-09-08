# BLE SGD console for the ZQ620 Plus

Talks to the printer over Bluetooth Low Energy (Zebra Link-OS BLE service), no pairing needed.
Useful when the classic Bluetooth / COM port link is broken.

    powershell -NoProfile -ExecutionPolicy Bypass -File zble.ps1 -CmdFile cmds.txt

`cmds.txt` holds one SGD command per line, e.g.

    getvar "bluetooth"
    getvar "wlan"
    setvar "bluetooth.minimum_security_mode" "3"

Notes
- First run compiles ZBle.cs with the .NET Framework csc against the Windows SDK winmd (needs the Windows 10/11 SDK installed).
- Replies frequently arrive one command late; read them offset by one, or send a trailing getvar.
- Reports "Unreachable" while Windows is busy retrying the classic Bluetooth link; wait for it to go idle.
