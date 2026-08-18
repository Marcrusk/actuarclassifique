const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rotation = require('../js/priority-rotation.js');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

function bloco(inicio, fim) {
    const start = html.indexOf(inicio);
    const end = html.indexOf(fim, start + 1);
    assert.ok(start > -1 && end > start, `bloco não encontrado: ${inicio}`);
    return html.slice(start, end);
}

/* A validação de transferências era uma tabela sem recorte nenhum e com dois links de texto.
   Aprovação de Prioridades já tinha status, analista, busca e SLA — duas telas que decidem a
   mesma coisa não podem exigir que a gestão aprenda dois jeitos. */

test('a aprovação de transferências tem os mesmos recortes da de prioridades', () => {
    const painel = bloco('id="admPanelTransferencias"', 'FIM PAINEL TRANSFERÊNCIAS');
    for (const campo of ['transferApprovalStatus', 'transferApprovalAnalyst', 'transferApprovalSearch', 'transferApprovalSla']) {
        assert.ok(painel.includes(`id="${campo}"`), `filtro ausente: ${campo}`);
    }
    assert.match(painel, /id="transferApprovalSummary"/, 'os atalhos por status vêm antes da tabela');
    assert.match(painel, /id="transferApprovalCount"/, 'o recorte precisa dizer quantos sobraram');
    assert.match(painel, /Aprovação de Transferências/);

    // O mesmo componente de filtros da tela de prioridades, não uma barra paralela.
    assert.match(painel, /class="priority-approval-filters"/);
    assert.match(painel, /class="actuar-field priority-approval-search"/);
});

test('o status de transferência usa a mesma fonte de verdade das prioridades', () => {
    // pendente/aprovado/reprovado são os três estados da transferência.
    for (const status of ['pendente', 'aprovado', 'reprovado']) {
        const meta = rotation.statusMeta(status);
        assert.ok(meta.label && meta.tone && meta.icon, `metadados incompletos para ${status}`);
    }
    assert.equal(rotation.statusMeta('pendente').tone, 'warning');
    assert.equal(rotation.statusMeta('aprovado').tone, 'success');
    assert.equal(rotation.statusMeta('reprovado').tone, 'danger');
    // Estado desconhecido não quebra a tela nem inventa cor.
    assert.equal(rotation.statusMeta('inexistente').tone, 'neutral');

    const render = bloco('function renderAdminTransferRequests()', 'async function approveTransferRequest');
    assert.match(render, /priorityStatusTag\(request\.status/);
    assert.match(render, /priorityRowClass\(request\.status\)/);
    // As cores cruas do Tailwind saíram das duas listagens de transferência.
    assert.doesNotMatch(render, /text-emerald-400|text-amber-400|bg-red-500\/10/);
});

test('a busca de transferências normaliza como a de prioridades', () => {
    const linhas = bloco('function transferApprovalRows()', 'function populateTransferAnalystFilter()');
    assert.match(linhas, /PriorityRotation\?\.filterBySearch/);
    assert.match(linhas, /analystName: usersList\[request\.userId\]\?\.name/);
    assert.match(linhas, /justificativa: request\.justificativa/, 'a justificativa também é campo de busca');
});

test('o SLA de 24h só vale para quem ainda espera decisão', () => {
    // Marcar "acima de 24h" e ver transferências já decididas seria ruído: elas não esperam nada.
    const linhas = bloco('function transferApprovalRows()', 'function populateTransferAnalystFilter()');
    assert.match(linhas, /soAtrasadas && !\(request\.status === 'pendente' && Date\.now\(\) - Number\(request\.timestamp \|\| 0\) >= 86400000\)/);
});

test('o contador do menu segue o escopo, não o filtro da tela', () => {
    // Filtrar por "aprovadas" não pode zerar o aviso de que há transferência esperando.
    const render = bloco('function renderAdminTransferRequests()', 'async function approveTransferRequest');
    assert.match(render, /const pendentes = visiveis\.filter\(request => request\.status === 'pendente'\)\.length;/);
    assert.match(render, /badge\.classList\.toggle\('hidden', pendentes === 0\)/);
});

test('a gestão só enxerga transferências do escopo autorizado', () => {
    const linhas = bloco('function transferApprovalRows()', 'function populateTransferAnalystFilter()');
    assert.match(linhas, /canManagerViewAnalyst\(request\.userId\)/);
});

test('a lista de analistas do filtro sai de quem tem transferência', () => {
    const popula = bloco('function populateTransferAnalystFilter()', 'function renderTransferApprovalSummary(');
    assert.match(popula, /transferApprovalRows\(\)\.visiveis\.map\(request => request\.userId\)/);
    assert.match(popula, /localeCompare/);
});

test('o analista vê o mesmo estado, com a mesma cor da gestão', () => {
    const render = bloco('function renderMyTransferRequests()', 'function renderAdminTransferRequests()');
    assert.match(render, /priorityStatusTag\(r\.status/);
    assert.match(render, /priorityPointsCell\(r\.status === 'aprovado' \? 1 : 0\)/, 'o +1 pt aparece como pontuação, não no texto do status');
    // Protocolo, justificativa e motivo entravam crus no template.
    assert.match(render, /escapeHtml\(r\.protocolo\)/);
    assert.match(render, /escapeHtml\(r\.justificativa\)/);
    assert.match(render, /escapeHtml\(r\.rejectReason\)/);
});

test('as tags e faixas de status existem no Design System, sem cor solta', () => {
    assert.match(css, /\.actuar-badge-neutral \{/, 'o tom neutro era usado sem existir');
    for (const tom of ['success', 'warning', 'danger', 'primary', 'neutral']) {
        assert.ok(css.includes(`.priority-row--${tom}`), `faixa ausente para o tom ${tom}`);
    }
    assert.match(css, /\.priority-reason \{/);
    assert.match(css, /\.priority-points--granted \{ color: var\(--actuar-success\); \}/);

    // Tudo por token: nada de hex solto nas regras novas.
    const novas = css.slice(css.indexOf('.priority-row {'), css.indexOf('.priority-status-cell'));
    assert.doesNotMatch(novas, /#[0-9a-fA-F]{3,6}/, `cor fixa nas regras de status: ${novas.match(/#[0-9a-fA-F]{3,6}/g)}`);
});
