const fs = require('node:fs');
const path = require('node:path');

/* 1. Verificação: os arquivos existem e estão referenciados no shell. */

const required = ['index.html','styles/actuar-design-system.css','js/actuar-fields.js','js/attendance-clock.js','js/performance-domain.js','js/manager-experience.js','js/priority-rotation.js','js/pieces-operations.js','js/pieces-ui.js','js/actask-auth.js','js/performance-platform.js','supabase/migrations/202608100001_performance_platform.sql'];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) { console.error(`Arquivos ausentes: ${missing.join(', ')}`); process.exit(1); }
const html = fs.readFileSync('index.html', 'utf8');
for (const asset of ['styles/actuar-design-system.css','js/actuar-fields.js','js/attendance-clock.js','js/performance-domain.js','js/manager-experience.js','js/priority-rotation.js','js/pieces-operations.js','js/pieces-ui.js','js/actask-auth.js','js/performance-platform.js']) {
  if (!html.includes(asset)) { console.error(`Asset não referenciado: ${asset}`); process.exit(1); }
}
/* 1b. Todo asset local precisa de versão na URL.
   Sem isso o navegador continua servindo a cópia antiga do arquivo e a correção
   simplesmente não chega em quem usa — foi o que aconteceu com manager-experience.js. */

const referencias = [...html.matchAll(/(?:src|href)="((?:js|styles)\/[^"]+)"/g)].map(match => match[1]);
const semVersao = referencias.filter(ref => !/\?v=[^"]+$/.test(ref));
if (semVersao.length) {
  console.error(`Asset local sem versão na URL: ${semVersao.join(', ')}. Acrescente ?v=<versão> para invalidar o cache.`);
  process.exit(1);
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

// Em ambientes sem permissão de remoção (sandbox, volume montado) a limpeza falha:
// seguir sobrescrevendo é melhor do que derrubar o build por causa disso.
try { fs.rmSync(OUTPUT, { recursive: true, force: true }); }
catch (error) { console.warn(`Aviso: não foi possível limpar ${OUTPUT}/ (${error.code}); os arquivos serão sobrescritos.`); }
fs.mkdirSync(OUTPUT, { recursive: true });

const published = [];
for (const { item, allow } of PUBLISH) {
  if (!fs.existsSync(item)) continue;
  copy(item, path.join(OUTPUT, item), allow);
  published.push(item);
}

if (!fs.existsSync(path.join(OUTPUT, 'index.html'))) { console.error('index.html não foi copiado para public/.'); process.exit(1); }

/* 3. Cache-busting por conteúdo.
   A versão escrita à mão no `?v=` depende de alguém lembrar de trocá-la. Duas vezes
   neste projeto um arquivo mudou sem a versão mudar junto, e o navegador continuou
   servindo o antigo — o código estava certo e ninguém via o resultado. Aqui o
   endereço publicado passa a carregar o hash do próprio arquivo: se o conteúdo muda,
   a URL muda; se não muda, o cache continua valendo. */
const crypto = require('node:crypto');
function contentHash(file) {
  return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 10);
}

const publicado = path.join(OUTPUT, 'index.html');
let marcados = 0;
const carimbado = fs.readFileSync(publicado, 'utf8').replace(/((?:js|styles)\/[^"?]+)\?v=[^"]*/g, (trecho, asset) => {
  if (!fs.existsSync(asset)) return trecho;
  marcados += 1;
  return `${asset}?v=${contentHash(asset)}`;
});
fs.writeFileSync(publicado, carimbado);

console.log(`Build estático verificado. public/ gerado com ${count(OUTPUT)} arquivo(s): ${published.join(', ')}. ${marcados} asset(s) versionado(s) por conteúdo.`);
