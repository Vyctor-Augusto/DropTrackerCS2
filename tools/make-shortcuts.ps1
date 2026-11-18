# Cria (ou atualiza) o atalho do Drop Tracker na Area de Trabalho e no Menu Iniciar.
# Uso: powershell -NoProfile -ExecutionPolicy Bypass -File tools\make-shortcuts.ps1

$ErrorActionPreference = 'Stop'

$proj = Split-Path -Parent $PSScriptRoot
$target = Join-Path $proj 'iniciar-bandeja.vbs'
$icon = Join-Path $proj 'public\drop-tracker.ico'

if (-not (Test-Path $target)) { throw "Nao encontrei $target" }
if (-not (Test-Path $icon)) { throw "Nao encontrei $icon (rode: node tools/make-icon.mjs)" }

$desktop = [Environment]::GetFolderPath('Desktop')
$programs = [Environment]::GetFolderPath('Programs')

$shell = New-Object -ComObject WScript.Shell

foreach ($dir in @($desktop, $programs)) {
    if (-not (Test-Path $dir)) { Write-Warning "Pasta inexistente: $dir"; continue }
    $linkPath = Join-Path $dir 'Drop Tracker CS2.lnk'

    $shortcut = $shell.CreateShortcut($linkPath)
    $shortcut.TargetPath = $target
    $shortcut.WorkingDirectory = $proj
    $shortcut.IconLocation = "$icon,0"
    $shortcut.Description = 'Acompanha o drop semanal de CS2 nas suas contas'
    $shortcut.WindowStyle = 1   # 1 = normal (o .vbs nao abre janela nenhuma)
    $shortcut.Save()

    Write-Output "criado: $linkPath"
}

Write-Output ''
Write-Output 'verificacao:'
foreach ($dir in @($desktop, $programs)) {
    $linkPath = Join-Path $dir 'Drop Tracker CS2.lnk'
    if (-not (Test-Path $linkPath)) { continue }
    $s = $shell.CreateShortcut($linkPath)
    Write-Output "  $linkPath"
    Write-Output "    destino : $($s.TargetPath)"
    Write-Output "    pasta   : $($s.WorkingDirectory)"
    Write-Output "    icone   : $($s.IconLocation)"
    Write-Output "    janela  : $($s.WindowStyle)"
}
