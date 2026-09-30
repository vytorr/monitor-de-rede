# Monitor de Rede

Monitor de rede local para Windows. Mostra, em um painel web, quais **sites e
aplicativos** são acessados pelos dispositivos conectados ao **Wi-Fi do
computador**, destacando conteúdo adulto, apostas e sites arriscados. Nada
precisa ser instalado no dispositivo monitorado.

## Como funciona

O computador cria uma rede Wi-Fi própria (**Ponto de acesso móvel** do Windows),
o dispositivo monitorado conecta-se a ela e **todo** o tráfego passa pelo PC. O
monitor lê o **SNI** — o nome do site que aparece em texto puro no início de cada
conexão HTTPS (o *ClientHello* do TLS).

```
Dispositivo ─(conecta no Wi-Fi do PC)─► Monitor (este PC)
                                        │ tshark captura o ClientHello na interface do hotspot
                                        │ extrai o SNI (nome do site) + IP do aparelho
                                        └─► classifica, registra e alerta
```

**Por que SNI e não só DNS?** Dispositivos modernos resolvem DNS de forma
criptografada (DoH/DoT), o que contorna um monitor de DNS na rede. O SNI aparece
na *conexão* ao site, não na consulta de DNS — por isso é visível mesmo quando o
DNS é criptografado.

O servidor **DNS** roda como complemento (registra tráfego não criptografado e
aplica SafeSearch/bloqueio para dispositivos que usam DNS comum), mas é opcional:
se a porta 53 estiver ocupada (o Windows costuma usá-la no modo hotspot), o
monitor segue apenas com o SNI.

**Não enxerga:** o conteúdo das páginas (apenas o nome do site), buscas ou qual
vídeo do YouTube; e uso por **dados móveis (4G/5G)** ou por outra rede Wi-Fi que
não seja a do computador.

### Dependência: Wireshark / tshark

A captura de SNI usa o **tshark** (incluído no Wireshark) sobre o **Npcap**. O
instalador (`Instalar_Atalho_e_Firewall.bat`) o instala automaticamente; para
uso em desenvolvimento:

```powershell
winget install -e --id WiresharkFoundation.Wireshark
```

### Classificação

1. **Lista local** ([src/classify/categories.js](src/classify/categories.js)): centenas de domínios conhecidos (jogos, redes sociais, vídeo, adulto, apostas, IA, sistema, anúncios…).
2. **TLD / palavra-chave**: `.xxx`, `.bet.br`, "porn", "tigrinho" etc.
3. **Verificação online**: para domínios desconhecidos, consulta o filtro de segurança da Cloudflare (1.1.1.3 e 1.1.1.2). Bloqueado no primeiro e não no segundo = **adulto**; nos dois = **perigoso**.
4. **Correção manual** no painel (sempre tem prioridade).

Tráfego automático dos dispositivos (Google, Apple, CDNs, anúncios) fica oculto por padrão.

**"Minutos com atividade"** = quantidade de minutos distintos com ao menos um
acesso àquele site. É uma estimativa de tempo de uso, não um cronômetro exato.

## Instalação (usuário final)

1. Baixe e extraia o pacote **`MonitorDeRede.zip`**.
2. Execute **`Instalar_Atalho_e_Firewall.bat`** como administrador. Ele instala o
   componente de captura (Wireshark/Npcap) se necessário, libera o firewall, cria
   um atalho **"Monitor de Rede"** na Área de Trabalho e abre o painel.
3. O programa liga o **Ponto de acesso móvel** e exibe o nome e a senha da rede
   Wi-Fi. Conecte o dispositivo monitorado a essa rede uma única vez.

> Como o executável não é assinado, o Windows pode exibir "O Windows protegeu o
> seu computador" — clique em **Mais informações → Executar assim mesmo**.

## Recursos

- **Captura por SNI:** registra os sites acessados por aparelho, mesmo com DNS criptografado.
- **Alertas de segurança:** destaca acessos a conteúdo adulto, apostas e sites arriscados.
- **Bloqueio por palavra e por site** (via DNS, para dispositivos sem DNS criptografado).
- **SafeSearch e YouTube restrito** forçados via DNS quando aplicável.
- **Painel web** com visão geral, registro ao vivo, gestão de aparelhos e filtros por período.
- **Tema claro/escuro** e interface responsiva.

## Rodar em desenvolvimento

Requer Node.js 22.13+ (usa `node:sqlite` embutido) e o Wireshark/tshark para a
captura de SNI. Não há dependências npm de execução.

Antes de iniciar, ligue o **Ponto de acesso móvel** do Windows e conecte um
dispositivo de teste a ele. Então:

```powershell
npm start                # painel em http://127.0.0.1:8484; liga o hotspot e captura SNI
npm run dev              # DNS em porta alta, sem abrir o navegador
npm test                 # testes unitários + integração + SNI
npm run build            # gera dist/MonitorInfantil.exe (Node SEA)
```

Opções: `--dns-port N`, `--web-port N`, `--data-dir PASTA`, `--no-browser`.
Os dados e a configuração ficam em `%LOCALAPPDATA%\MonitorInfantil\` (criados na
primeira execução — o pacote distribuído não contém dados).

## Estrutura

| Arquivo | Papel |
|---|---|
| [src/main.js](src/main.js) | Inicia SNI + DNS + Web, liga o hotspot e abre o navegador |
| [src/sni/hotspotControl.js](src/sni/hotspotControl.js) | Liga o Ponto de acesso móvel (WinRT) e lê rede/senha |
| [src/sni/hotspot.js](src/sni/hotspot.js) | Detecta a interface do Ponto de acesso móvel (casa por GUID) |
| [src/sni/sniffer.js](src/sni/sniffer.js) | Captura ClientHellos TLS via tshark e extrai o SNI |
| [src/sni/collector.js](src/sni/collector.js) | Classifica o SNI, deduplica e grava no banco |
| [src/block.js](src/block.js) | Decisão de bloqueio (manual, palavra-chave, categoria) |
| [src/dns/](src/dns/) | Servidor DNS complementar (registro, SafeSearch, bloqueio, forward) |
| [src/classify/](src/classify/) | Classificador, regras de TLD/palavras e verificação online |
| [src/db.js](src/db.js) | SQLite: consultas, agregações e histórico |
| [src/web/server.js](src/web/server.js) | API REST local (127.0.0.1) e entrega do painel |
| [src/network.js](src/network.js) | Detecção de IP local e tabela ARP (MACs) |
| [public/](public/) | Painel web (HTML/CSS/JavaScript, sem dependências) |
| [scripts/build.js](scripts/build.js) | Gera o executável `.exe` independente (Node SEA) |

## Limitações e privacidade

- Vê apenas o tráfego que passa pelo Wi-Fi do computador; não cobre dados móveis nem outras redes.
- Não inspeciona o conteúdo das páginas — apenas o nome do site (SNI).
- Todos os dados capturados ficam **somente no computador local** (SQLite em `%LOCALAPPDATA%`).

## Aviso legal

O monitoramento de dispositivos deve respeitar a legislação aplicável e ser
realizado apenas em redes e dispositivos próprios ou com autorização adequada.
