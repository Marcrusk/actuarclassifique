const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
for (const [index, source] of scripts.entries()) {
  try { new vm.Script(source, { filename: `index.html:inline-${index + 1}` }); }
  catch (error) { console.error(error.message); process.exit(1); }
}
console.log(`JavaScript inline válido (${scripts.length} blocos).`);
