'use strict';

const { execFileSync } = require('node:child_process');
const { tsharkPath } = require('./sniffer');

// IP que o Windows dá a si mesmo quando o "Ponto de acesso móvel" está ligado.
const HOTSPOT_HOST_IP = '192.168.137.1';
const HOTSPOT_PREFIX = '192.168.137.';

function ps(command) {
  // Força saída em UTF-8: nomes de placa com acento ("Conexão") vêm corrompidos
  // na codepage padrão do console e quebram qualquer comparação por texto.
  const full = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ' + command;
  return execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', full], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10000,
  });
}

/**
 * GUID e nome da placa do hotspot, ou null se o hotspot estiver desligado.
 * Casamos pelo GUID (ASCII) para não depender do nome acentuado.
 */
function hotspotAdapter() {
  try {
    const out = ps(
      `$i=(Get-NetIPAddress -AddressFamily IPv4 -IPAddress '${HOTSPOT_HOST_IP}' -ErrorAction SilentlyContinue).InterfaceIndex;` +
        `if($i){$a=Get-NetAdapter -InterfaceIndex $i -ErrorAction SilentlyContinue; "$($a.InterfaceGuid)|$($a.InterfaceAlias)"}`
    ).trim();
    if (!out || !out.includes('|')) return null;
    const [guid, alias] = out.split('|');
    if (!guid) return null;
    return { guid: guid.trim().toLowerCase(), alias: (alias || 'hotspot').trim() };
  } catch {
    return null;
  }
}

/** Índice no `tshark -D` cujo device path contém o GUID informado. */
function tsharkIndexForGuid(guid) {
  const out = execFileSync(tsharkPath(), ['-D'], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^(\d+)\.\s+(\S+)/);
    if (m && m[2].toLowerCase().includes(guid)) return Number(m[1]);
  }
  return null;
}

/**
 * Descobre a interface do hotspot pronta para o tshark.
 * @returns {{ ok: true, index: number, alias: string, hostIp: string, prefix: string }
 *          | { ok: false, reason: 'desligado' | 'sem-interface' }}
 */
function detectHotspot() {
  const adapter = hotspotAdapter();
  if (!adapter) return { ok: false, reason: 'desligado' };
  let index;
  try {
    index = tsharkIndexForGuid(adapter.guid);
  } catch {
    // tshark/Wireshark não instalado ou inacessível.
    return { ok: false, reason: 'sem-tshark' };
  }
  if (index == null) return { ok: false, reason: 'sem-interface' };
  return { ok: true, index, alias: adapter.alias, hostIp: HOTSPOT_HOST_IP, prefix: HOTSPOT_PREFIX };
}

module.exports = { detectHotspot, HOTSPOT_HOST_IP, HOTSPOT_PREFIX };
