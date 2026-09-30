'use strict';

// Gera dist/MonitorInfantil.exe: um único arquivo com o Node.js, o código do
// monitor e o painel embutidos (Node "Single Executable Application").
//
//   npm install      (uma vez, instala esbuild e postject)
//   npm run build

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const esbuild = require('esbuild');
const { inject } = require('postject');

const ROOT = path.join(__dirname, '..');
const BUILD = path.join(ROOT, 'build');
const DIST = path.join(ROOT, 'dist');
const EXE_NAME = process.platform === 'win32' ? 'MonitorInfantil.exe' : 'MonitorInfantil';

async function main() {
  fs.rmSync(BUILD, { recursive: true, force: true });
  fs.mkdirSync(BUILD, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  console.log('1/4 Empacotando o código...');
  const bundle = path.join(BUILD, 'bundle.js');
  await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'main.js')],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22',
    outfile: bundle,
    logLevel: 'warning',
  });

  console.log('2/4 Gerando o blob SEA...');
  // O Node embute o caminho absoluto do script principal dentro do blob. Para não
  // vazar "C:\Users\<seu-usuario>" no executável distribuído, geramos o blob a
  // partir de uma pasta NEUTRA (C:\Users\Public), sem o nome de usuário.
  const neutralBase = process.platform === 'win32' ? path.join('C:\\', 'Users', 'Public') : os.tmpdir();
  const seaDir = fs.mkdtempSync(path.join(neutralBase, 'mrede-sea-'));
  let blobData;
  try {
    fs.copyFileSync(bundle, path.join(seaDir, 'bundle.js'));
    for (const f of ['index.html', 'app.js', 'style.css']) {
      fs.copyFileSync(path.join(ROOT, 'public', f), path.join(seaDir, f));
    }
    const seaConfig = {
      main: 'bundle.js',
      output: 'sea-prep.blob',
      disableExperimentalSEAWarning: true,
      useSnapshot: false,
      useCodeCache: false,
      assets: { 'index.html': 'index.html', 'app.js': 'app.js', 'style.css': 'style.css' },
    };
    fs.writeFileSync(path.join(seaDir, 'sea-config.json'), JSON.stringify(seaConfig, null, 2));
    execFileSync(process.execPath, ['--experimental-sea-config', 'sea-config.json'], { stdio: 'inherit', cwd: seaDir });
    blobData = fs.readFileSync(path.join(seaDir, 'sea-prep.blob'));
  } finally {
    fs.rmSync(seaDir, { recursive: true, force: true });
  }

  console.log('3/4 Copiando o Node.js...');
  const exe = path.join(DIST, EXE_NAME);
  fs.copyFileSync(process.execPath, exe);

  console.log('4/4 Injetando o monitor no executável...');
  await inject(exe, 'NODE_SEA_BLOB', blobData, {
    sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
  });

  const mb = (fs.statSync(exe).size / 1024 / 1024).toFixed(1);
  console.log(`\nPronto: ${path.relative(ROOT, exe)} (${mb} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
