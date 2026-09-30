'use strict';

const { execFileSync } = require('node:child_process');

// Liga (e lê) o "Ponto de acesso móvel" do Windows pela API WinRT — a mesma
// que o botão das Configurações usa. Não exige administrador.
const SCRIPT = `
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$ProgressPreference='SilentlyContinue'
$ErrorActionPreference='Stop'
try {
  [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager,Windows.Networking.NetworkOperators,ContentType=WindowsRuntime] | Out-Null
  [Windows.Networking.Connectivity.NetworkInformation,Windows.Networking.Connectivity,ContentType=WindowsRuntime] | Out-Null
  $prof = [Windows.Networking.Connectivity.NetworkInformation]::GetInternetConnectionProfile()
  if (-not $prof) { Write-Output 'ERROR|sem conexao de internet neste computador'; exit }
  $mgr = [Windows.Networking.NetworkOperators.NetworkOperatorTetheringManager]::CreateFromConnectionProfile($prof)
  if ([int]$mgr.TetheringOperationalState -ne 1) {
    $mgr.StartTetheringAsync() | Out-Null
    # A operação assíncrona não reporta status de forma confiável no PowerShell;
    # observamos o estado real do hotspot até ligar (até ~24s).
    $spins = 0
    while ([int]$mgr.TetheringOperationalState -ne 1 -and $spins -lt 120) { Start-Sleep -Milliseconds 200; $spins++ }
    if ([int]$mgr.TetheringOperationalState -ne 1) { Write-Output ('ERROR|nao foi possivel ligar (estado ' + [int]$mgr.TetheringOperationalState + ')'); exit }
  }
  $cfg = $mgr.GetCurrentAccessPointConfiguration()
  Write-Output ('OK|' + [int]$mgr.TetheringOperationalState + '|' + $cfg.Ssid + '|' + $cfg.Passphrase)
} catch {
  Write-Output ('ERROR|' + $_.Exception.Message)
}
`;

/**
 * Garante que o hotspot esteja ligado.
 * @returns {{ ok: boolean, ssid?: string, passphrase?: string, error?: string }}
 */
function ensureHotspotOn() {
  if (process.platform !== 'win32') return { ok: false, error: 'apenas Windows' };
  try {
    const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');
    const out = execFileSync(
      'powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { encoding: 'utf8', windowsHide: true, timeout: 40000 }
    ).trim();

    const last = out.split(/\r?\n/).filter(Boolean).pop() || '';
    if (last.startsWith('OK|')) {
      const [, , ssid, passphrase] = last.split('|');
      return { ok: true, ssid: (ssid || '').trim(), passphrase: (passphrase || '').trim() };
    }
    return { ok: false, error: last.replace(/^ERROR\|/, '') || 'resposta inesperada' };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

module.exports = { ensureHotspotOn };
