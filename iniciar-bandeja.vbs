' Sobe o Drop Tracker CS2 na bandeja do sistema, sem janela preta nenhuma.
'
' E o que os atalhos da Area de Trabalho / Menu Iniciar executam.
' Para desligar: parar-app.bat (ou botao direito no icone > Sair).

Option Explicit

Dim sh, fso, base, script, comando

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
script = base & "\tray\drop-tracker-tray.ps1"

If Not fso.FileExists(script) Then
    MsgBox "Nao encontrei o arquivo:" & vbCrLf & vbCrLf & script, 16, "Drop Tracker CS2"
    WScript.Quit 1
End If

sh.CurrentDirectory = base

' 0 = janela oculta, False = nao esperar terminar
comando = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """ -Open"
sh.Run comando, 0, False
