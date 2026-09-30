'use strict';

// O módulo node:sqlite ainda emite um aviso "experimental"; não queremos
// assustar a usuária com ele no console.
const defaultWarning = process.listeners('warning');
process.removeAllListeners('warning');
process.on('warning', (w) => {
  if (w.name !== 'ExperimentalWarning') defaultWarning.forEach((fn) => fn(w));
});

const path = require('node:path');
const { execFile } = require('node:child_process');
const { Config, dataDir, parseArgs } = require('./config');
const { Store } = require('./db');
const { DnsServer } = require('./dns/server');
const { ProbeQueue } = require('./classify/familyFilter');
const { createWebServer } = require('./web/server');
const { localAddresses, startArpRefresh } = require('./network');
const { detectHotspot } = require('./sni/hotspot');
const { ensureHotspotOn } = require('./sni/hotspotControl');
const { SNISniffer } = require('./sni/sniffer');
const { SNICollector } = require('./sni/collector');

function openBrowser(url) {
  if (process.platform === 'win32') execFile('cmd', ['/c', 'start', '', url], { windowsHide: true });
  else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [url]);
}

function tryConfigureFirewall() {
  if (process.platform === 'win32') {
    execFile(
      'netsh',
      ['advfirewall', 'firewall', 'add', 'rule', 'name=Monitor Infantil DNS', 'dir=in', 'action=allow', 'protocol=UDP', 'localport=53'],
      { windowsHide: true },
      () => {} // Ignora silenciosamente se não for admin
    );
  }
}

function fatal(message) {
  console.error('\n[ERRO] ' + message + '\n');
  if (process.stdin.isTTY) {
    console.error('Pressione Enter para fechar.');
    process.stdin.resume();
    process.stdin.once('data', () => process.exit(1));
  } else {
    process.exit(1);
  }
}

/**
 * Liga o hotspot (se preciso) e inicia a captura de SNI. Nunca é fatal.
 * Preenche `runtime` com a rede/senha para o painel mostrar à mãe.
 */
function startSniIfAvailable(collector, runtime) {
  // 1. Tenta ligar o Ponto de acesso automaticamente (API do Windows).
  const power = ensureHotspotOn();
  if (power.ok) {
    runtime.hotspotOn = true;
    runtime.ssid = power.ssid;
    runtime.passphrase = power.passphrase;
    console.log('');
    console.log('  [OK] Ponto de acesso móvel LIGADO automaticamente.');
    console.log(`       Conecte o dispositivo monitorado à rede:  ${power.ssid}`);
    console.log(`       Senha:  ${power.passphrase}`);
  } else {
    console.log('');
    console.log(`  [!] Não consegui ligar o Ponto de acesso automaticamente (${power.error}).`);
    console.log('      Ligue manualmente: Configurações do Windows > Rede e Internet > Ponto de acesso móvel.');
  }

  // 2. Detecta a interface do hotspot e começa a capturar o SNI.
  const hs = detectHotspot();
  if (!hs.ok) {
    if (hs.reason === 'sem-tshark') {
      console.log('  [!] Captura de SNI DESLIGADA: o Wireshark/Npcap não está instalado.');
      console.log('      Rode o "Instalar_Atalho_e_Firewall.bat" (ele instala sozinho) e abra o monitor de novo.');
    } else {
      console.log('  [!] Captura de SNI aguardando: o Ponto de acesso ainda não está ativo. Ligue-o e reabra o monitor.');
    }
    return null;
  }
  const sniffer = new SNISniffer(
    hs.index,
    (ev) => collector.handle(ev),
    (err) => console.error('[sni] ' + err.message)
  );
  sniffer.start();
  console.log(`  [OK] Captura de SNI ATIVA (rede "${hs.alias}"). Tudo que os aparelhos acessarem será registrado.`);
  return { sniffer, hotspot: hs };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dir = args.dataDir || dataDir();
  const config = new Config(dir);
  const dnsPort = args.dnsPort || config.get('dnsPort');
  const webPort = args.webPort || config.get('webPort');
  const panelUrl = `http://127.0.0.1:${webPort}/`;

  const store = new Store(path.join(dir, 'monitor.db'));
  const probeQueue = new ProbeQueue((site, category) => store.applyProbeResult(site, category));
  const dns = new DnsServer({ store, config, probeQueue });
  const collector = new SNICollector({ store, config, probeQueue });

  // Dados do hotspot (rede/senha) preenchidos ao ligá-lo; expostos ao painel.
  const runtime = { hotspotOn: false, ssid: null, passphrase: null };
  const web = createWebServer({
    store,
    config,
    dnsServer: dns,
    dnsPort,
    webPort,
    sniStatus: () => ({ ...collector.stats, hotspot: runtime }),
  });

  try {
    await web.listen();
  } catch (err) {
    if (err.code === 'EADDRINUSE') {
      console.log('O monitor já está aberto. Abrindo o painel...');
      if (args.openBrowser) openBrowser(panelUrl);
      return;
    }
    throw err;
  }

  // O DNS é um complemento (registra tráfego não-criptografado e permite bloqueio).
  // No modo hotspot o Windows costuma ocupar a porta 53, então uma falha aqui
  // não é fatal — o SNI é a fonte principal.
  let dnsOn = false;
  try {
    tryConfigureFirewall();
    await dns.start(dnsPort);
    dnsOn = true;
  } catch (err) {
    if (err.code === 'EADDRINUSE' || err.code === 'EACCES') {
      console.log('  [i] Filtro de DNS complementar inativo (normal quando o Ponto de acesso do Windows está ligado).');
    } else {
      await web.close();
      throw err;
    }
  }

  if (config.get('onlineCheck')) store.unknownSites().forEach((s) => probeQueue.push(s));

  startArpRefresh(store);
  const purge = () => {
    const n = store.purgeOlderThan(config.get('retentionDays'));
    if (n) console.log(`[limpeza] ${n} registros antigos removidos`);
  };
  purge();
  setInterval(purge, 6 * 60 * 60_000).unref();

  let sni = null;
  try {
    sni = startSniIfAvailable(collector, runtime);
  } catch (err) {
    console.log('  [!] Não foi possível iniciar a captura de SNI: ' + err.message);
    console.log('      O painel continua funcionando; instale/reabra o Wireshark e reinicie se necessário.');
  }

  console.log('====================================================');
  console.log(' Monitor de Rede em execução');
  console.log('====================================================');
  console.log(` Painel:      ${panelUrl}`);
  console.log(` Dados em:    ${dir}`);
  if (dnsOn) {
    console.log(` DNS ativo na porta ${dnsPort}. Endereços deste computador:`);
    for (const a of localAddresses()) console.log(`   -> ${a.address}   (${a.interface})`);
  }
  console.log(' Mantenha esta janela aberta. Para encerrar, feche-a ou use Ctrl+C.');
  console.log('====================================================');

  if (args.openBrowser) openBrowser(panelUrl);

  const shutdown = async () => {
    collector.stop();
    await Promise.allSettled([sni ? sni.sniffer.stop() : null, dns.stop(), web.close()]);
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => fatal(err.stack || String(err)));
