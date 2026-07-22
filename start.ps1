# InterviewX 启动脚本(非 Docker 版)
# 用法:在项目根目录执行 .\start.ps1
# 前置:需自行安装 Node.js v20+(https://nodejs.org/)
# 首次运行自动安装依赖 + 下载 better-sqlite3 预编译二进制

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# ========== 1. Node.js 检测 ==========
$nodeExe = $null
try {
    $nodeExe = (Get-Command node -ErrorAction Stop).Source
} catch {
    # 尝试常见安装路径
    $candidates = @(
        "$env:ProgramFiles\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe",
        "$env:APPDATA\npm\node.exe"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) { $nodeExe = $p; break }
    }
}

if (-not $nodeExe) {
    Write-Host ""
    Write-Host "[error] 未检测到 Node.js!" -ForegroundColor Red
    Write-Host ""
    Write-Host "        请安装 Node.js v20+ 后重试:" -ForegroundColor Yellow
    Write-Host "          官方下载:https://nodejs.org/(推荐 LTS 版)" -ForegroundColor Yellow
    Write-Host "          或使用 winget:winget install OpenJS.NodeJS.LTS" -ForegroundColor Yellow
    Write-Host ""
    exit 1
}

$nodeVer = & $nodeExe --version
$nodeMajor = [int]($nodeVer -replace '^v(\d+)\..*','$1')
if ($nodeMajor -lt 20) {
    Write-Host "[error] Node.js 版本过低($nodeVer),需要 v20+" -ForegroundColor Red
    Write-Host "        请从 https://nodejs.org/ 升级" -ForegroundColor Yellow
    exit 1
}
Write-Host "[ok] Node.js $nodeVer ($nodeExe)" -ForegroundColor Green

$npmCmd = $nodeExe -replace 'node\.exe$','npm.cmd'
if (-not (Test-Path $npmCmd)) { $npmCmd = "npm" }

# ========== 2. 数据目录 ==========
$dataDir = Join-Path $root "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Force -Path $dataDir | Out-Null }

# ========== 3. 端口检测 ==========
function Test-Port($port) {
    try { $c = New-Object System.Net.Sockets.TcpClient("localhost", $port); $c.Close(); return $true }
    catch { return $false }
}
if (Test-Port 3001) {
    Write-Host "[warn] 端口 3001 被占用,请检查是否有其他实例在运行" -ForegroundColor Yellow
    $confirm = Read-Host "是否继续? (y/N)"
    if ($confirm -ne "y" -and $confirm -ne "Y") {
        Write-Host "[error] 端口冲突,无法启动" -ForegroundColor Red; exit 1
    }
}

# ========== 4. 安装依赖(首次) ==========
$serverDeps = Join-Path $root "server\node_modules"
$webDeps = Join-Path $root "web\node_modules"

if (-not (Test-Path $serverDeps)) {
    Write-Host "[setup] 安装 server 依赖..." -ForegroundColor Cyan
    Push-Location "$root\server"; & $npmCmd install --ignore-scripts; Pop-Location

    # better-sqlite3 预编译二进制(等价替换:跳过本地 C++ 编译,直接下载预编译 .node)
    $bsqlDir = "$root\server\node_modules\better-sqlite3"
    if ((Test-Path $bsqlDir) -and -not (Test-Path "$bsqlDir\build\Release\better_sqlite3.node")) {
        Write-Host "[setup] 下载 better-sqlite3 预编译二进制..." -ForegroundColor Cyan
        $tmpDir = Join-Path $env:TEMP "bsql-tmp"
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        $abi = & $nodeExe -p "process.versions.modules"
        $ver = (Get-Content "$bsqlDir\package.json" | ConvertFrom-Json).version
        $url = "https://github.com/WiseLibs/better-sqlite3/releases/download/v$ver/better-sqlite3-v$ver-node-v$abi-win32-x64.tar.gz"
        try {
            Invoke-WebRequest -Uri $url -OutFile "$tmpDir\bsql.tar.gz" -UseBasicParsing -TimeoutSec 60
            Push-Location $tmpDir; tar -xzf bsql.tar.gz; Pop-Location
            New-Item -ItemType Directory -Force -Path "$bsqlDir\build\Release" | Out-Null
            Copy-Item "$tmpDir\build\Release\better_sqlite3.node" "$bsqlDir\build\Release\" -Force
            Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
            Write-Host "[setup] better-sqlite3 二进制就绪" -ForegroundColor Green
        } catch {
            Write-Host "[error] better-sqlite3 下载失败: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "        备选:手动从 https://github.com/WiseLibs/better-sqlite3/releases 下载" -ForegroundColor Yellow
            Write-Host "        或安装 C++ 编译工具链后运行 npm rebuild better-sqlite3" -ForegroundColor Yellow
        }
    }
}
if (-not (Test-Path $webDeps)) {
    Write-Host "[setup] 安装 web 依赖..." -ForegroundColor Cyan
    Push-Location "$root\web"; & $npmCmd install --ignore-scripts; Pop-Location
}

# ========== 5. 启动 ==========
$env:DB_DIR = $dataDir
$env:PORT = "3001"
Write-Host ""
Write-Host "[start] 后端: http://localhost:3001" -ForegroundColor Green
Write-Host "[start] 前端: http://localhost:5173" -ForegroundColor Green
Write-Host "[start] 按 Ctrl+C 停止前端(后端在新窗口运行)" -ForegroundColor Gray
Write-Host ""

Start-Process -WindowStyle Normal -FilePath $nodeExe -ArgumentList "index.js" -WorkingDirectory "$root\server"
Push-Location "$root\web"; & $npmCmd run dev; Pop-Location
