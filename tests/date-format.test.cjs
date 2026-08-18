const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fields = require('../js/actuar-fields.js');

const html = fs.readFileSync('index.html', 'utf8');

/* `18/08/2026 14:32` obriga a pessoa a converter mentalmente para saber se aquilo é recente.
   Numa lista lida de cima para baixo procurando "o que aconteceu agora", é trabalho jogado
   no leitor. O formato do sistema vai do relativo ao absoluto conforme o registro envelhece. */

const agora = new Date(2026, 7, 18, 14, 30); // 18/ago/2026, 14:30 — terça
const em = (dia, hora = 10, minuto = 0) => new Date(2026, 7, dia, hora, minuto);

test('o que é recente se descreve pela distância', () => {
    assert.equal(fields.formatMoment(new Date(2026, 7, 18, 14, 30), { now: agora }), 'agora');
    assert.equal(fields.formatMoment(new Date(2026, 7, 18, 14, 18), { now: agora }), 'há 12 min');
    assert.equal(fields.formatMoment(new Date(2026, 7, 18, 13, 31), { now: agora }), 'há 59 min');
});

test('passada a hora, vale o dia e o relógio', () => {
    assert.equal(fields.formatMoment(em(18, 9, 5), { now: agora }), 'hoje, 09:05');
    assert.equal(fields.formatMoment(em(17, 16, 40), { now: agora }), 'ontem, 16:40');
    // Dentro da semana, o dia da semana localiza melhor que o número.
    assert.equal(fields.formatMoment(em(14, 11, 0), { now: agora }), 'sex, 11:00');
});

test('passada a semana, vale a data; passado o ano, vale o ano', () => {
    assert.equal(fields.formatMoment(em(3, 8, 15), { now: agora }), '3 ago, 08:15');
    assert.equal(fields.formatMoment(new Date(2025, 11, 24, 20, 0), { now: agora }), '24 dez 2025');
});

test('nenhuma data mostra o formato antigo', () => {
    for (const valor of [em(3), em(17), new Date(2025, 0, 9)]) {
        assert.doesNotMatch(fields.formatMoment(valor, { now: agora }), /\d{2}\/\d{2}\/\d{4}/);
    }
});

test('valor ausente ou inválido não vira "Invalid Date" na tela', () => {
    for (const vazio of [null, undefined, '', 'nao-e-data', NaN]) {
        assert.equal(fields.formatMoment(vazio, { now: agora }), '—');
    }
    assert.equal(fields.formatMoment(null, { now: agora, empty: 'Sem registro' }), 'Sem registro');
});

test('data no futuro não vira "há -3 min"', () => {
    // Agendamento ou relógio adiantado: cai direto no formato de data.
    const futuro = new Date(2026, 7, 18, 15, 0);
    assert.equal(fields.formatMoment(futuro, { now: agora }), 'hoje, 15:00');
    assert.doesNotMatch(fields.formatMoment(futuro, { now: agora }), /há -/);
});

test('formatDay serve onde a hora não acrescenta nada', () => {
    assert.equal(fields.formatDay(em(18), { now: agora }), 'hoje');
    assert.equal(fields.formatDay(em(17), { now: agora }), 'ontem');
    assert.equal(fields.formatDay(em(3), { now: agora }), '3 ago');
    assert.equal(fields.formatDay(new Date(2025, 11, 24), { now: agora }), '24 dez 2025');
});

test('a precisão exata continua acessível pelo title', () => {
    assert.equal(fields.formatFull(em(3, 8, 15)), '03 de ago de 2026 às 08:15');
    assert.equal(fields.formatFull(null), '');
    assert.match(html, /function fullMomentTitle\(value\)/);
    assert.match(html, /title="\$\{escapeHtml\(fullMomentTitle\(row\.timestamp\)\)\}"/,
        'a linha do histórico precisa carregar a data completa no title');
});

test('o formatador central do sistema delega ao formato novo', () => {
    // São onze pontos usando formatRotationTime(x, true): trocar aqui alcança todos.
    const funcao = html.slice(html.indexOf('function formatRotationTime('), html.indexOf('function fullMomentTitle('));
    assert.match(funcao, /ActuarFields\?\.formatMoment/);
    assert.doesNotMatch(funcao, /dateStyle: 'short', timeStyle: 'short'[\s\S]*ActuarFields/,
        'o formato antigo só pode sobrar como fallback, depois da delegação');
    // Só a hora continua sendo hora: no rodízio importa o relógio, não a distância.
    assert.match(funcao, /if \(!withDate\) return new Intl\.DateTimeFormat\('pt-BR', \{ hour: '2-digit', minute: '2-digit' \}\)/);
});

test('o histórico não mantém formatação de data própria', () => {
    const render = html.slice(html.indexOf('function renderAdminLogs()'), html.indexOf('\n        // Uma lista só de departamentos'));
    assert.match(render, /ActuarFields\.formatMoment\(row\.timestamp\)/);
    assert.doesNotMatch(render, /toLocaleDateString\('pt-BR'\)/, 'a tabela voltou a formatar por conta própria');
});

test('as funções de data que a tela usa existem de fato no módulo', () => {
    /* Regressão real: o histórico quebrava com "ActuarFields.formatDay is not a function".
       O arquivo tinha a função, mas o navegador servia a versão anterior — o ?v= não foi
       trocado ao editar o módulo. Este teste garante que o que a tela chama existe. */
    for (const nome of ['formatMoment', 'formatDay', 'formatFull']) {
        assert.equal(typeof fields[nome], 'function', `ActuarFields.${nome} precisa ser exportada`);
    }
    // E que a tela não chame nada que o módulo não exporte.
    const chamadas = [...html.matchAll(/ActuarFields\.(\w+)\(/g)].map(m => m[1]);
    for (const chamada of [...new Set(chamadas)]) {
        assert.equal(typeof fields[chamada], 'function', `index.html chama ActuarFields.${chamada}, que não existe`);
    }
});

test('editar um módulo obriga a trocar a versão dos assets', () => {
    /* O ?v= é a única chave de cache no servidor local: sem trocá-lo, o navegador segue
       servindo o arquivo antigo e a correção não chega. O hash de conteúdo do build-check
       só carimba o public/ publicado. */
    const referencias = [...html.matchAll(/(?:src|href)="((?:js|styles)\/[^"]+)"/g)].map(m => m[1]);
    const versoes = [...new Set(referencias.map(ref => ref.split('?v=')[1]))];
    assert.equal(versoes.length, 1, `versões divergentes entre assets: ${versoes.join(', ')}`);
    assert.notEqual(versoes[0], '20260818-perfil-filtros-1', 'a versão precisa mudar quando um módulo muda');
});
