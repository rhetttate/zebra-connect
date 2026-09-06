' Starts the Zebra Connect label server hidden in the background.
' A copy of this file in the Windows Startup folder launches it at logon.
Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = "C:\Users\rober\zebra connect"
shell.Run """C:\Program Files\nodejs\node.exe"" src\server.js", 0, False
