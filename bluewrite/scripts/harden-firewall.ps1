#Requires -RunAsAdministrator
# BlueWrite — close the MySQL firewall hole on the server PC.
# Disables the inbound "Port 3306" / "Port 33060" allow rules so other
# devices on the Wi-Fi cannot reach MySQL directly. Loopback traffic
# bypasses Windows Firewall, so the app on this PC keeps working —
# only the LAN door closes. Clients use the browser on port 8099.
$names = @('Port 3306', 'Port 33060')
foreach ($n in $names) {
    $r = netsh advfirewall firewall show rule name="$n" 2>&1 | Out-String
    if ($r -match 'No rules match') { Write-Output "[$n] not present — nothing to do."; continue }
    netsh advfirewall firewall set rule name="$n" new enable=no | Out-Null
    $after = netsh advfirewall firewall show rule name="$n" 2>&1 | Out-String
    if ($after -match 'Enabled:\s*No') { Write-Output "[$n] disabled." }
    else { Write-Output "[$n] STILL ENABLED — check manually." }
}
