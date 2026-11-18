# Drop Tracker CS2 — icone na bandeja do sistema.
#
# Fica perto do relogio, sobe o servidor do painel escondido (sem janela preta),
# mostra o resumo no tooltip e permite abrir/atualizar/reiniciar/sair pelo menu.
#
# Uso normal: iniciar-bandeja.vbs (sem console, ja abre o painel)
# Diagnostico: powershell -File tray\drop-tracker-tray.ps1 -Status
# Encerrar:    powershell -File tray\drop-tracker-tray.ps1 -Stop

param(
    [switch]$Stop,
    [switch]$Status,
    [switch]$Open
)

$ErrorActionPreference = 'Stop'

$proj      = Split-Path -Parent $PSScriptRoot
$port      = 5179
$baseUrl   = "http://localhost:$port"
$iconPath  = Join-Path $proj 'public\drop-tracker.ico'
$dataDir   = Join-Path $proj 'data'
$nodeEntry = Join-Path $proj 'server\index.js'
$pidFile   = Join-Path $dataDir 'tray.pid'
$logFile   = Join-Path $dataDir 'tray.log'

$script:serverProc = $null
$script:wasDown = $false
$script:notify = $null
$script:timer = $null

if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

function Write-Log([string]$message) {
    try {
        $line = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
        Add-Content -Path $logFile -Value $line -Encoding UTF8
    } catch { }
}

# --- HTTP local, sem proxy do sistema -------------------------------------

function Invoke-Local([string]$path, [string]$method = 'GET') {
    $request = [System.Net.WebRequest]::Create("$baseUrl$path")
    $request.Proxy = $null
    $request.Method = $method
    $request.Timeout = 4000
    $response = $request.GetResponse()
    try {
        $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
        return $reader.ReadToEnd()
    } finally {
        $response.Close()
    }
}

function Test-Server {
    try {
        $null = Invoke-Local '/api/state'
        return $true
    } catch {
        return $false
    }
}

function Get-ServerPids {
    try {
        return @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
            Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {
        return @()
    }
}

# --- servidor --------------------------------------------------------------

function Stop-Server {
    if ($script:serverProc -and -not $script:serverProc.HasExited) {
        try {
            $script:serverProc.Kill()
            Write-Log "servidor (filho) encerrado: pid $($script:serverProc.Id)"
        } catch {
            Write-Log "falha ao encerrar filho: $_"
        }
    }
    foreach ($procId in (Get-ServerPids)) {
        try {
            Stop-Process -Id $procId -Force -ErrorAction Stop
            Write-Log "servidor encerrado pelo pid $procId"
        } catch {
            Write-Log "falha ao encerrar pid ${procId}: $_"
        }
    }
}

function Start-Server {
    $nodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source
    if (-not $nodeExe) { throw 'Node.js nao encontrado no PATH.' }

    $info = New-Object System.Diagnostics.ProcessStartInfo
    $info.FileName = $nodeExe
    $info.Arguments = '"' + $nodeEntry + '"'
    $info.WorkingDirectory = $proj
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true

    $script:serverProc = [System.Diagnostics.Process]::Start($info)
    Write-Log "servidor iniciado: pid $($script:serverProc.Id)"
}

function Ensure-Server {
    if (Test-Server) {
        Write-Log 'servidor ja estava no ar'
        return $true
    }
    Start-Server
    for ($i = 0; $i -lt 40; $i++) {
        Start-Sleep -Milliseconds 350
        if (Test-Server) { return $true }
    }
    Write-Log 'servidor nao respondeu depois de 14s'
    return $false
}

# --- tooltip / resumo ------------------------------------------------------

function Update-Status {
    # Nunca deixa uma excecao escapar daqui: isso rodaria dentro do loop de
    # mensagens do WinForms e poderia derrubar a bandeja inteira.
    try {
        $state = $null
        try {
            $state = Invoke-Local '/api/state' | ConvertFrom-Json
        } catch { }

        if ($state -and $state.counts) {
            $c = $state.counts
            $text = "{0} contas - {1} falta dropar - {2} dropou" -f $c.total, $c.not_dropped, $c.dropped
            if ($text.Length -gt 63) { $text = $text.Substring(0, 63) }
            $script:notify.Text = $text

            if ($script:wasDown) {
                $script:wasDown = $false
                $script:notify.ShowBalloonTip(3000, 'Drop Tracker', 'Servidor voltou ao ar.', 'Info')
            }
        } else {
            $script:notify.Text = 'Drop Tracker CS2 - servidor fora do ar'
            if (-not $script:wasDown) {
                $script:wasDown = $true
                $script:notify.ShowBalloonTip(6000, 'Drop Tracker', 'O servidor caiu. Use "Reiniciar servidor" no menu.', 'Warning')
            }
        }
    } catch {
        Write-Log "falha ao atualizar o tooltip: $_"
    }
}

# --- modos de linha de comando --------------------------------------------

if ($Status) {
    $up = Test-Server
    $stateText = ''
    if ($up) {
        try { $stateText = Invoke-Local '/api/state' } catch { }
    }
    $result = [pscustomobject]@{
        servidor = $up
        porta    = $port
        pids     = ((Get-ServerPids) -join ',')
        trayPid  = $(if (Test-Path $pidFile) { (Get-Content $pidFile -Raw).Trim() } else { $null })
        estado   = $stateText
    }
    $result | ConvertTo-Json -Compress
    exit 0
}

if ($Stop) {
    if (Test-Path $pidFile) {
        $trayPid = 0
        if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$trayPid)) {
            $proc = Get-Process -Id $trayPid -ErrorAction SilentlyContinue
            if ($proc -and $proc.ProcessName -eq 'powershell') {
                Stop-Process -Id $trayPid -Force -ErrorAction SilentlyContinue
                Write-Output "bandeja encerrada (pid $trayPid)"
            }
        }
        Remove-Item $pidFile -ErrorAction SilentlyContinue
    }
    Stop-Server
    Write-Output 'servidor encerrado'
    exit 0
}

# --- instancia unica -------------------------------------------------------

if (Test-Path $pidFile) {
    $oldPid = 0
    if ([int]::TryParse((Get-Content $pidFile -Raw).Trim(), [ref]$oldPid)) {
        $old = Get-Process -Id $oldPid -ErrorAction SilentlyContinue
        if ($old -and $old.ProcessName -eq 'powershell') {
            Write-Log 'ja havia uma bandeja rodando'
            if ($Open) {
                Write-Log 'abrindo o painel'
                Start-Process "$baseUrl/"
            }
            exit 0
        }
    }
}

# --- bandeja ---------------------------------------------------------------

try {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    [System.Windows.Forms.Application]::EnableVisualStyles()
} catch {
    Write-Log "falha ao carregar WinForms: $_"
    [System.Windows.Forms.MessageBox]::Show('Nao consegui carregar a interface do Windows.', 'Drop Tracker') | Out-Null
    exit 1
}

try {
    $script:notify = New-Object System.Windows.Forms.NotifyIcon
    $script:notify.Icon = New-Object System.Drawing.Icon($iconPath)
    $script:notify.Text = 'Drop Tracker CS2'
    $script:notify.Visible = $true

    $menu = New-Object System.Windows.Forms.ContextMenuStrip

    $itemOpen = $menu.Items.Add('Abrir painel')
    $itemOpen.add_Click({ Start-Process "$baseUrl/" })

    $itemRefresh = $menu.Items.Add('Atualizar inventarios')
    $itemRefresh.add_Click({
        $script:notify.ShowBalloonTip(1500, 'Drop Tracker', 'Atualizando inventarios...', 'None')
        [System.Windows.Forms.Application]::DoEvents()
        try {
            $null = Invoke-Local '/api/refresh' 'POST'
            Update-Status
            $script:notify.ShowBalloonTip(2500, 'Drop Tracker', 'Inventarios atualizados.', 'Info')
        } catch {
            Write-Log "falha ao atualizar: $_"
            $script:notify.ShowBalloonTip(4000, 'Drop Tracker', 'Falha ao atualizar os inventarios.', 'Warning')
        }
    })

    $itemData = $menu.Items.Add('Abrir pasta de dados')
    $itemData.add_Click({ Start-Process explorer.exe $dataDir })

    $itemRestart = $menu.Items.Add('Reiniciar servidor')
    $itemRestart.add_Click({
        Stop-Server
        Start-Sleep -Milliseconds 600
        if (-not (Ensure-Server)) {
            $script:notify.ShowBalloonTip(6000, 'Drop Tracker', 'Nao consegui reiniciar o servidor.', 'Error')
        }
        Update-Status
    })

    [void]$menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))

    $itemQuit = $menu.Items.Add('Sair')
    $itemQuit.add_Click({
        if ($script:timer) { $script:timer.Stop() }
        $script:notify.Visible = $false
        $script:notify.Dispose()
        Stop-Server
        Remove-Item $pidFile -ErrorAction SilentlyContinue
        Write-Log 'saindo'
        [System.Windows.Forms.Application]::Exit()
    })

    $script:notify.ContextMenuStrip = $menu
    $script:notify.add_DoubleClick({ Start-Process "$baseUrl/" })

    $script:timer = New-Object System.Windows.Forms.Timer
    $script:timer.Interval = 60000
    $script:timer.add_Tick({ Update-Status })
    $script:timer.Start()

    Set-Content -Path $pidFile -Value $PID -Encoding ASCII
    Write-Log "bandeja iniciada: pid $PID"

    if (-not (Ensure-Server)) {
        $script:notify.ShowBalloonTip(8000, 'Drop Tracker', 'Nao consegui iniciar o servidor. Veja data\tray.log.', 'Error')
    } elseif ($Open) {
        try { Start-Process "$baseUrl/" } catch { Write-Log "nao consegui abrir o navegador: $_" }
    }
    Update-Status

    [void][System.Windows.Forms.Application]::Run()

    if ($script:timer) { $script:timer.Dispose() }
    Remove-Item $pidFile -ErrorAction SilentlyContinue
} catch {
    Write-Log "erro fatal: $_"
    try {
        [System.Windows.Forms.MessageBox]::Show("Erro no Drop Tracker:`n$_`n`nVeja data\tray.log", 'Drop Tracker') | Out-Null
    } catch { }
    try { Stop-Server } catch { }
    exit 1
}
