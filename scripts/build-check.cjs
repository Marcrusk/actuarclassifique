const fs = require('node:fs');
const path = require('node:path');

/* 1. Verificação: os arquivos existem e estão referenciados no shell. */

const required = ['index.html','styles/actuar-design-system.css','js/actuar-fields.js','js/performance-domain.js','js/manager-experience.js','js/priority-rotation.js','js/pieces-operations.js','js/pieces-ui.js','js/performance-platform.js','supabase/migrations/202608100001_performance_platform.sql'];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) { console.error(`Arquivos ausentes: ${missing.join(', ')}`); process.exit(1); }
const html = fs.readFileSync('index.html', 'utf8');
for (const asset of ['styles/actuar-design-system.css','js/actuar-fields.js','js/performance-domain.js','js/manager-experience.js','js/priority-rotation.js','js/pieces-operations.js','js/pieces-ui.js','js/performance-platform.js']) {
  if (!html.includes(asset)) { console.error(`Asset não referenciado: ${asset}`); process.exit(1); }
}

/* 2. Publicação: monta public/ apenas com o que vai para o ar.
   Sem esse diretório a Vercel falha o deploy; e publicar a raiz exporia
   tests/, scripts/, supabase/ e a documentação interna do repositório. */

const OUTPUT = 'public';
// Cada entrada declara o que pode ir para o ar. Sem o filtro, qualquer arquivo
// solto na pasta (um .test.cjs, um rascunho) seria publicado junto.
const PUBLISH = [
  { item: 'index.html' },
  { item: 'styles', allow: /\.css$/ },
  { item: 'js', allow: /\.js$/ },
  { item: 'assets' }
];

function copy(source, destination, allow) {
  const info = fs.statSync(source);
  if (info.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    for (const entry of fs.readdirSync(source)) {
      if (entry === '.DS_Store') continue;
      copy(path.join(source, entry), path.join(destination, entry), allow);
    }
    return;
  }
  if (allow && !allow.test(source)) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function count(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .reduce((total, entry) => total + (entry.isDirectory() ? count(path.join(dir, entry.name)) : 1), 0);
}

fs.rmSync(OUTPUT, { recursive: true, force: true });
fs.mkdirSync(OUTPUT, { recursive: true });

const published = [];
for (const { item, allow } of PUBLISH) {
  if (!fs.existsSync(item)) continue;
  copy(item, path.join(OUTPUT, item), allow);
  published.push(item);
}

if (!fs.existsSync(path.join(OUTPUT, 'index.html'))) { console.error('index.html não foi copiado para public/.'); process.exit(1); }

console.log(`Build estático verificado. public/ gerado com ${count(OUTPUT)} arquivo(s): ${published.join(', ')}.`);
