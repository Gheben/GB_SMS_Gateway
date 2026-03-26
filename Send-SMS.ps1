#Requires -Version 5.1
<#
.SYNOPSIS
    Sends an SMS via the GB SMS Gateway API.

.DESCRIPTION
    Authenticates against the local backend, discovers the device by hostname,
    lists its SIM ports, and sends an SMS to the specified recipient.

.PARAMETER BaseUrl
    Backend base URL. Default: http://localhost:4673

.PARAMETER Username
    Login username. Default: sysadmin

.PARAMETER Password
    Login password (prompted if omitted).

.PARAMETER DeviceHost
    Hostname or IP of the Yeastar device to use.
    Default: vrnowgw-gsm01.net.dla

.PARAMETER Port
    SIM port number on the device (1..16). If omitted the script lists
    available ports and asks you to choose.

.PARAMETER Recipient
    Destination phone number (international format recommended, e.g. +393331234567).

.PARAMETER Message
    Text of the SMS to send (max 1024 chars).

.EXAMPLE
    .\Send-SMS.ps1 -Recipient "+393331234567" -Message "Hello from PowerShell!"

.EXAMPLE
    .\Send-SMS.ps1 -Recipient "+393331234567" -Message "Test" -Port 1 -Username admin
#>
[CmdletBinding()]
param(
    [string]  $BaseUrl    = 'http://localhost:4673',
    [string]  $Username   = 'sysadmin',
    [string]  $Password   = 'Password!',
    [string]  $DeviceHost = 'vrnowgw-gsm01.net.dla',
    [int]     $Port       = 0,
    [Parameter(Mandatory)]
    [string]  $Recipient,
    [Parameter(Mandatory)]
    [string]  $Message
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# --- Helpers -----------------------------------------------------------------

function Write-Step([string]$s) { Write-Host "`n==> $s" -ForegroundColor Cyan }
function Write-Ok([string]$s)   { Write-Host "    [OK]  $s" -ForegroundColor Green }
function Write-Warn([string]$s) { Write-Host "    [!!]  $s" -ForegroundColor Yellow }
function Write-Err([string]$s)  { Write-Host "    [ERR] $s" -ForegroundColor Red }

function Invoke-Api {
    param(
        [string] $Method,
        [string] $Path,
        [object] $Body  = $null,
        [string] $Token = ''
    )
    $uri     = "$BaseUrl$Path"
    $headers = @{ 'Content-Type' = 'application/json' }
    if ($Token) { $headers['Authorization'] = "Bearer $Token" }

    $invokeParams = @{
        Method          = $Method
        Uri             = $uri
        Headers         = $headers
        UseBasicParsing = $true
    }
    if ($Body) { $invokeParams['Body'] = ($Body | ConvertTo-Json -Depth 10) }

    try {
        $resp = Invoke-WebRequest @invokeParams
        return $resp.Content | ConvertFrom-Json
    }
    catch {
        $ex        = $_.Exception
        $errRecord = $_
        if ($ex.Response) {
            $statusCode = [int]$ex.Response.StatusCode
            # PS 5.1: ErrorDetails.Message is populated by Invoke-WebRequest
            $body = ''
            if ($errRecord.ErrorDetails -and $errRecord.ErrorDetails.Message) {
                $body = $errRecord.ErrorDetails.Message
            }
            else {
                try {
                    $stream = $ex.Response.GetResponseStream()
                    $reader = New-Object System.IO.StreamReader($stream)
                    $body   = $reader.ReadToEnd()
                    $reader.Close()
                }
                catch { $body = '' }
            }
            # Try to extract 'error' field from JSON body
            try {
                $parsed = $body | ConvertFrom-Json
                if ($parsed.error) { $body = $parsed.error }
            } catch {}
        }
        else {
            $statusCode = 0
            $body = $ex.Message
        }
        Write-Err "HTTP $statusCode on $Method $Path - $body"
        exit 1
    }
}

# --- 1. Password -------------------------------------------------------------

if (-not $Password) {
    $secPwd   = Read-Host "Password for '$Username'" -AsSecureString
    $bstr     = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secPwd)
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
    [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
}

# --- 2. Login ----------------------------------------------------------------

Write-Step "Authenticating as '$Username' on $BaseUrl"
$login = Invoke-Api -Method POST -Path '/api/auth/login' -Body @{
    username = $Username
    password = $Password
}
$token = $login.token
if (-not $token) { Write-Err "Login response did not contain a token."; exit 1 }
Write-Ok "Authenticated - role: $($login.user.role)"

# --- 3. Find device ----------------------------------------------------------

Write-Step "Looking up device with host '$DeviceHost'"
$devResp    = Invoke-Api -Method GET -Path '/api/devices' -Token $token
$deviceList = if ($devResp -is [array]) { $devResp } else { $devResp.devices }

$device = $deviceList | Where-Object { $_.host -like "*$DeviceHost*" } | Select-Object -First 1

if (-not $device) {
    Write-Warn "Device '$DeviceHost' not found. Available devices:"
    $deviceList | Format-Table id, name, host, ami_port, connected -AutoSize | Out-String | Write-Host
    $deviceId = Read-Host "Enter the device ID to use"
    $device   = $deviceList | Where-Object { $_.id -eq $deviceId } | Select-Object -First 1
    if (-not $device) { Write-Err "Device ID not found."; exit 1 }
}

Write-Ok "Device: $($device.name) - host: $($device.host) - connected: $($device.connected)"
if ($device.connected -eq $false) {
    Write-Warn "The backend is NOT connected to this device (AMI/Telnet connection down)."
    Write-Warn "Sending will fail with HTTP 503. Ensure the backend can reach $($device.host) on AMI port."
    $cont = Read-Host "    Continue anyway? [y/N]"
    if ($cont -notmatch '^[Yy]') { Write-Warn "Aborted."; exit 0 }
}
$deviceId = $device.id

# --- 4. List SIM ports -------------------------------------------------------

Write-Step "Fetching SIM ports for device '$($device.name)'"
$portsResp = Invoke-Api -Method GET -Path "/api/ports?device_id=$deviceId" -Token $token
$portList  = if ($portsResp -is [array]) { $portsResp } else { $portsResp.ports }

$registeredPorts = @($portList | Where-Object { $_.status -eq 'registered' -or $_.status -eq 'READY' })

Write-Host ""
Write-Host "  Port  Status         SIM Number           Carrier" -ForegroundColor White
Write-Host "  ----  -------------  -------------------  ---------------" -ForegroundColor DarkGray
foreach ($p in $portList) {
    $color   = if ($p.status -eq 'registered' -or $p.status -eq 'READY') { 'Green' } else { 'DarkGray' }
    $simNum  = if ($p.sim_number) { $p.sim_number } else { '(not set)' }
    $carrier = if ($p.carrier)    { $p.carrier }    else { '' }
    Write-Host ("  {0,-5} {1,-14} {2,-21} {3}" -f $p.port_number, $p.status, $simNum, $carrier) -ForegroundColor $color
}

# --- 5. Choose SIM port ------------------------------------------------------

if ($Port -eq 0) {
    if ($registeredPorts.Count -eq 1) {
        $Port = [int]$registeredPorts[0].port_number
        Write-Ok "Auto-selected port $Port (only registered port available)"
    }
    elseif ($registeredPorts.Count -gt 1) {
        Write-Host ""
        $Port = [int](Read-Host "Enter port number to use")
    }
    else {
        Write-Err "No registered ports found on this device."
        exit 1
    }
}
else {
    $chosenPort = $portList | Where-Object { $_.port_number -eq $Port }
    if (-not $chosenPort) {
        Write-Warn "Port $Port not found in port list."
    }
    elseif ($chosenPort.status -ne 'registered' -and $chosenPort.status -ne 'READY') {
        Write-Warn "Port $Port status is '$($chosenPort.status)' - SMS may fail."
    }
    else {
        Write-Ok "Using port $Port"
    }
}

# --- 6. Confirm and send -----------------------------------------------------

Write-Host ""
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
Write-Host "  Device    : $($device.name) ($($device.host))"
Write-Host "  SIM port  : $Port"
Write-Host "  Recipient : $Recipient"
Write-Host "  Message   : $Message"
Write-Host "-----------------------------------------" -ForegroundColor DarkGray
Write-Host ""

$confirm = Read-Host "Send? [Y/n]"
if ($confirm -ne '' -and $confirm -notmatch '^[Yy]') {
    Write-Warn "Aborted."
    exit 0
}

Write-Step "Sending SMS..."
$result = Invoke-Api -Method POST -Path '/api/messages/send' -Token $token -Body @{
    device_id = $deviceId
    port      = $Port
    recipient = $Recipient
    message   = $Message
}

Write-Ok "SMS queued successfully!"
Write-Host ""
Write-Host "  Message ID : $($result.id)"      -ForegroundColor White
Write-Host "  Status     : $($result.status)"  -ForegroundColor White
Write-Host "  Timestamp  : $($result.sent_at)" -ForegroundColor White