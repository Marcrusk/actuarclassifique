const fs = require('node:fs');
const required = ['index.html','styles/actuar-design-system.css','js/actuar-fields.js','js/performance-domain.js','js/manager-experience.js','js/priority-rotation.js','js/pieces-operations.js','js/pieces-ui.js','js/performance-platform.js','supabase/migrations/202608100001_performance_platform.sql'];
const missing = required.filter(file => !fs.existsSync(file));
if (missing.length) { console.error(`Arquivos ausentes: ${missing.join(', ')}`); process.exit(1); }
const html = fs.readFileSync('index.html', 'utf8');
for (const asset of ['styles/actuar-design-system.css','js/actuar-fields.js','js/performance-domain.js','js/manager-experience.js','js/priority-rotation.js','js/pieces-operations.js','js/pieces-ui.js','js/performance-platform.js']) {
  if (!html.includes(asset)) { console.error(`Asset não referenciado: ${asset}`); process.exit(1); }
}
console.log('Build estático verificado.');
