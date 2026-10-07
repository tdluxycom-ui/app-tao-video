$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

$python = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    throw "Backend virtual environment is missing. Install backend dependencies first."
}
if (Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8787 is already in use. Stop the existing backend and retry."
}

$passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%*-_"
$passwordCharacters = [char[]]::new(28)
$randomGenerator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$randomByte = [byte[]]::new(1)
$maxRandomValue = [math]::Floor(256 / $passwordAlphabet.Length) * $passwordAlphabet.Length
for ($index = 0; $index -lt $passwordCharacters.Length; $index++) {
    do {
        $randomGenerator.GetBytes($randomByte)
    } while ($randomByte[0] -ge $maxRandomValue)
    $passwordCharacters[$index] = $passwordAlphabet[$randomByte[0] % $passwordAlphabet.Length]
}
$randomGenerator.Dispose()
$generatedPassword = -join $passwordCharacters
$securePassword = ConvertTo-SecureString $generatedPassword -AsPlainText -Force
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
$password = $null
$backendProcess = $null
$stdoutLog = Join-Path $env:TEMP ("tdluxy-backend-" + [guid]::NewGuid() + ".log")
$stderrLog = Join-Path $env:TEMP ("tdluxy-backend-" + [guid]::NewGuid() + ".log")

try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    if ($password.Length -lt 12) {
        throw "The password must contain at least 12 characters."
    }

    Write-Host "Building the web app..."
    & npm.cmd run export:web
    if ($LASTEXITCODE -ne 0) {
        throw "Web export failed."
    }

    $cloudflared = Join-Path $env:LOCALAPPDATA "TDLUXY\cloudflared.exe"
    if (-not (Test-Path $cloudflared)) {
        $cloudflaredDirectory = Split-Path -Parent $cloudflared
        New-Item -ItemType Directory -Force -Path $cloudflaredDirectory | Out-Null
        Write-Host "Downloading cloudflared from the official Cloudflare release..."
        Invoke-WebRequest `
            -Uri "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe" `
            -OutFile $cloudflared
    }

    $signature = Get-AuthenticodeSignature -FilePath $cloudflared
    if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Subject -notmatch "Cloudflare") {
        Remove-Item -LiteralPath $cloudflared -Force -ErrorAction SilentlyContinue
        throw "Could not verify the Cloudflare signature. Refusing to run cloudflared."
    }

    $env:TDLUXY_ACCESS_PASSWORD = $password
    $env:MUSE_BRIDGE_HOST = "127.0.0.1"
    $env:MUSE_BRIDGE_PORT = "8787"
    $certBundle = "C:\temp\certs\cacert.pem"
    $certSource = Join-Path $root "backend\.venv\Lib\site-packages\certifi\cacert.pem"
    $certDirectory = Split-Path -Parent $certBundle
    if (-not (Test-Path $certDirectory)) {
        New-Item -ItemType Directory -Force -Path $certDirectory | Out-Null
    }
    if (-not (Test-Path $certBundle)) {
        Copy-Item -LiteralPath $certSource -Destination $certBundle
    }
    if (Test-Path $certBundle) {
        $env:SSL_CERT_FILE = $certBundle
        $env:REQUESTS_CA_BUNDLE = $certBundle
    }
    Remove-Item Env:MUSE_BRIDGE_TOKEN -ErrorAction SilentlyContinue

    $backendProcess = Start-Process `
        -FilePath $python `
        -ArgumentList @("-X", "utf8", "-u", "backend\run.py") `
        -WorkingDirectory $root `
        -WindowStyle Hidden `
        -PassThru `
        -RedirectStandardOutput $stdoutLog `
        -RedirectStandardError $stderrLog

    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($backendProcess.HasExited) {
            $details = Get-Content -LiteralPath $stderrLog -Raw -ErrorAction SilentlyContinue
            throw "Backend failed to start. $details"
        }
        try {
            $status = Invoke-RestMethod -Uri "http://127.0.0.1:8787/api/access/status" -TimeoutSec 2
            if ($status.required -and -not $status.authenticated) {
                $ready = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 750
        }
    }
    if (-not $ready) {
        throw "Backend did not become ready within 30 seconds."
    }

    Write-Host ""
    Write-Host "Tunnel is starting. Share the HTTPS URL printed below and the password."
    Write-Host "Share password: $generatedPassword"
    Write-Host "Keep this window open. Press Ctrl+C to stop the tunnel and backend."
    Write-Host ""
    & $cloudflared tunnel --url http://127.0.0.1:8787
    if ($LASTEXITCODE -ne 0) {
        throw "cloudflared exited with code $LASTEXITCODE."
    }
}
finally {
    if ($backendProcess -and -not $backendProcess.HasExited) {
        Stop-Process -Id $backendProcess.Id -ErrorAction SilentlyContinue
        Wait-Process -Id $backendProcess.Id -Timeout 10 -ErrorAction SilentlyContinue
    }
    Remove-Item Env:TDLUXY_ACCESS_PASSWORD -ErrorAction SilentlyContinue
    Remove-Item Env:MUSE_BRIDGE_HOST -ErrorAction SilentlyContinue
    Remove-Item Env:MUSE_BRIDGE_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:SSL_CERT_FILE -ErrorAction SilentlyContinue
    Remove-Item Env:REQUESTS_CA_BUNDLE -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $stdoutLog, $stderrLog -Force -ErrorAction SilentlyContinue
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    $securePassword.Dispose()
    [Array]::Clear($passwordCharacters, 0, $passwordCharacters.Length)
    $generatedPassword = $null
}
