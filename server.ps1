# BAFS Scholarship Interview Assessment - Lightweight Local Server & Real-time API
[System.Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$port = 8080
$rootDir = $PSScriptRoot
if (-not $rootDir) { $rootDir = (Get-Location).Path }

# Data persistence file
$dataFile = Join-Path $rootDir "assessment_data.json"
$globalState = @{
    candidates = @()
    activeCandidateId = ""
    evaluations = @{}
    timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
}

# Load existing state if available
if (Test-Path $dataFile) {
    try {
        $raw = Get-Content $dataFile -Raw -Encoding UTF8
        $globalState = $raw | ConvertFrom-Json
        Write-Host "[INFO] Loaded existing assessment data from assessment_data.json" -ForegroundColor Green
    }
    catch {
        Write-Host "[WARN] Could not load assessment_data.json, starting fresh" -ForegroundColor Yellow
    }
}

# Find local IPv4 address for multi-device room access
$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.InterfaceAlias -notmatch "vEthernet|Virtual|Loopback|WSL" -and $_.IPAddress -notmatch "^169\.254|^127\."
} | Select-Object -First 1).IPAddress

if (-not $localIp) { $localIp = "127.0.0.1" }

# Start HttpListener
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://*:$port/")

try {
    $listener.Start()
}
catch {
    Write-Host "[WARN] Could not bind to http://*:$port/, falling back to localhost..." -ForegroundColor Yellow
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
}

Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host "  BAFS Group - ระบบประเมินการสัมภาษณ์ผู้ขอรับทุนศึกษา (Real-Time Server)" -ForegroundColor White -BackgroundColor Blue
Write-Host "================================================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host " [ เครื่องนี้ (Local): ]   http://localhost:$port/" -ForegroundColor Green
Write-Host " [ สำหรับ iPad / อื่นๆ: ]  http://${localIp}:$port/" -ForegroundColor Yellow
Write-Host ""
Write-Host " * ให้คณะกรรมการในห้องประชุมเชื่อมต่อ Wi-Fi เดียวกันและเข้าลิงก์ด้านบน *" -ForegroundColor Gray
Write-Host " * กด Ctrl + C เพื่อหยุดการทำงานของเซิร์ฟเวอร์ *" -ForegroundColor DarkGray
Write-Host "================================================================================" -ForegroundColor Cyan

# Open default browser
Start-Process "http://localhost:$port/"

# Request handling loop
while ($listener.IsListening) {
    $context = $listener.GetContext()
    $request = $context.Request
    $response = $context.Response
    $urlPath = $request.Url.LocalPath

    # CORS Headers
    $response.Headers.Add("Access-Control-Allow-Origin", "*")
    $response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    $response.Headers.Add("Access-Control-Allow-Headers", "Content-Type")

    if ($request.HttpMethod -eq "OPTIONS") {
        $response.StatusCode = 200
        $response.Close()
        continue
    }

    try {
        # REST API Routes
        if ($urlPath -eq "/api/state" -and $request.HttpMethod -eq "GET") {
            $json = $globalState | ConvertTo-Json -Depth 10
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        if ($urlPath -eq "/api/sync" -and $request.HttpMethod -eq "POST") {
            $reader = New-Object System.IO.StreamReader($request.InputStream, [System.Text.Encoding]::UTF8)
            $body = $reader.ReadToEnd()
            $reader.Close()

            if ($body) {
                $parsed = $body | ConvertFrom-Json
                if ($parsed.evaluations) {
                    $globalState.evaluations = $parsed.evaluations
                }
                if ($parsed.candidates) {
                    $globalState.candidates = $parsed.candidates
                }
                if ($parsed.activeCandidateId) {
                    $globalState.activeCandidateId = $parsed.activeCandidateId
                }
                $globalState.timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

                # Save to disk
                [System.IO.File]::WriteAllText($dataFile, ($globalState | ConvertTo-Json -Depth 10), [System.Text.Encoding]::UTF8)
            }

            $resJson = '{"status":"ok"}'
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
            $response.ContentType = "application/json; charset=utf-8"
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
            $response.Close()
            continue
        }

        # Static File Serving
        $filePath = $urlPath.TrimStart('/')
        if ([string]::IsNullOrWhiteSpace($filePath)) {
            $filePath = "index.html"
        }

        $fullPath = Join-Path $rootDir $filePath
        if (Test-Path $fullPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($fullPath).ToLower()
            $contentType = switch ($ext) {
                ".html" { "text/html; charset=utf-8" }
                ".js"   { "application/javascript; charset=utf-8" }
                ".css"  { "text/css; charset=utf-8" }
                ".json" { "application/json; charset=utf-8" }
                ".png"  { "image/png" }
                ".jpg"  { "image/jpeg" }
                ".svg"  { "image/svg+xml" }
                default { "application/octet-stream" }
            }

            $bytes = [System.IO.File]::ReadAllBytes($fullPath)
            $response.ContentType = $contentType
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
        }
        else {
            $response.StatusCode = 404
            $msg = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($msg, 0, $msg.Length)
        }
    }
    catch {
        $response.StatusCode = 500
        $errBytes = [System.Text.Encoding]::UTF8.GetBytes("Server Error: $_")
        $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
    }
    finally {
        $response.Close()
    }
}
