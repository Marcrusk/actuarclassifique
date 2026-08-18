const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const rotation = require('../js/priority-rotation.js');

const html = fs.readFileSync('index.html', 'utf8');

/* Mesma régua da exclusão de peça: apagar o lançamento sem tirar os pontos mantém o erro
   que a exclusão existe para desfazer. E apagar sem rastro impede conferir depois. */

const base = { id: 'r1', protocolo: 'PR-2026-77', userId: 'dyego', team: 'Catraca', status: 'aprovado' };
const logs = [
    { id: 'credito', type: 'PRIORITY', value: 50, relatedRequestId: 'r1' },
    { id: 'ajuste', type: 'PRIORITY_ADJUSTMENT', value: -10, relatedRequestId: 'r1' },
    { id: 'peca', type: 'PECA', value: 12, relatedRequestId: 'r1' },
    { id: 'outro', type: 'PRIORITY', value: 50, relatedRequestId: 'r2' }
];

test('o estorno soma o crédito e os ajustes feitos sobre ele', () => {
    /* Prioridade credita por PRIORITY e pode receber PRIORITY_ADJUSTMENT em cima. Levar só o
       crédito deixaria no extrato um ajuste sobre algo que não existe mais. */
    assert.deepEqual(rotation.pointLogsOf(logs, 'r1').map(l => l.id), ['credito', 'ajuste']);
    const entrada = rotation.deletionEntry(base, 'marco', 'lançamento de teste', rotation.pointLogsOf(logs, 'r1'), 1000);
    assert.equal(entrada.removedPoints, 40, '50 de crédito menos 10 de ajuste');
    assert.deepEqual(entrada.removedLogIds, ['credito', 'ajuste']);
    // Log de peça e de outra prioridade ficam de fora.
    assert.ok(!entrada.removedLogIds.includes('peca'));
    assert.ok(!entrada.removedLogIds.includes('outro'));
});

test('a exclusão registra autor, motivo e o lançamento inteiro', () => {
    const entrada = rotation.deletionEntry(base, 'marco_adm', '  teste  ', [], 5000);
    assert.equal(entrada.deletedBy, 'marco_adm');
    assert.equal(entrada.deletedAt, 5000);
    assert.equal(entrada.reason, 'teste');
    assert.equal(entrada.protocol, 'PR-2026-77');
    assert.equal(entrada.analystId, 'dyego');
    assert.equal(entrada.removedPoints, 0, 'lançamento sem pontos não inventa estorno');
    // O snapshot é desligado do original: é ele que permite conferir e desfazer depois.
    assert.deepEqual(entrada.record, base);
    entrada.record.status = 'mexido';
    assert.equal(base.status, 'aprovado');
});

test('exclusão sem motivo ou sem autor é recusada no domínio', () => {
    assert.throws(() => rotation.deletionEntry(base, 'marco', '  ', []), /motivo/i);
    assert.throws(() => rotation.deletionEntry(base, '', 'teste', []), /não identificado/i);
    assert.throws(() => rotation.deletionEntry(null, 'marco', 'teste', []), /inválido/i);
});

test('excluir exige motivo, senha e permissão de acesso total', () => {
    const excluir = html.slice(html.indexOf('async function deletePriorityRequest(id)'), html.indexOf('async function decidePriorityReview('));
    assert.match(excluir, /if \(!canDeletePriorityRequest\(\)\)/, 'a permissão é conferida na execução, não só no botão');
    assert.match(excluir, /input: \{ label: 'Motivo da exclusão'/);
    assert.match(excluir, /verifyLoginRemote\(currentAdminId, senha\)/, 'a senha é a do gestor logado');
    assert.match(excluir, /Senha incorreta\. Nada foi excluído\./);
    // Mesma regra da auditoria de peças: alcance sobre todas as equipes.
    assert.match(html, /function canDeletePriorityRequest\(\) \{ return canAuditDeletedPieces\(\); \}/);
});

test('a exclusão devolve o estado se o salvamento falhar', () => {
    // Uma exclusão que não chegou ao banco não pode ficar na tela como se tivesse chegado.
    const excluir = html.slice(html.indexOf('async function deletePriorityRequest(id)'), html.indexOf('async function decidePriorityReview('));
    assert.match(excluir, /const anterior = \{[\s\S]*pedidos:[\s\S]*logs:[\s\S]*excluidos:/);
    assert.match(excluir, /appStore\.priorityRequests = anterior\.pedidos;[\s\S]*appStore\.logs = anterior\.logs;[\s\S]*appStore\.deletedPriorityRequests = anterior\.excluidos;/);
    // Os pontos saem junto com o lançamento.
    assert.match(excluir, /anterior\.logs\.filter\(log => !removidos\.has\(log\.id\)\)/);
});

test('a auditoria viaja no diff do store', () => {
    // Chave não declarada some no primeiro salvamento concorrente, levando o registro junto.
    assert.match(html, /deletedPriorityRequests: diffKeyedArray\(base\.deletedPriorityRequests, local\.deletedPriorityRequests\)/);
    assert.match(html, /merged\.deletedPriorityRequests = applyKeyedArrayDiff\(merged\.deletedPriorityRequests, diff\.deletedPriorityRequests\)/);
    assert.match(html, /deletedPriorityRequests: \[\]/);
    assert.match(html, /if \(!appStore\.deletedPriorityRequests\) appStore\.deletedPriorityRequests = \[\]/);
});

test('peça e prioridade dividem a mesma linha de auditoria', () => {
    /* São entidades diferentes, mas a pergunta de quem audita é uma só: o que foi apagado,
       por quem, e quanto ponto voltou. */
    const linhas = html.slice(html.indexOf('function historyRows()'), html.indexOf('function filteredHistoryRows()'));
    assert.match(linhas, /deletedPriorityRequests \|\| \[\]\)\.forEach/);
    assert.match(linhas, /detail: `Prioridade \$\{escapeHtml\(item\.protocol/);
    assert.match(linhas, /detail: `Peça \$\{escapeHtml\(item\.protocol/, 'a linha precisa dizer o que foi excluído');
    // As duas só aparecem com permissão de auditoria.
    assert.match(linhas, /if \(canAuditDeletedPieces\(\)\) \{[\s\S]*deletedPriorityRequests[\s\S]*deletedPieceOperations/);
});

test('o botão de excluir fica longe das decisões', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(html, /priority-delete-action" onclick="deletePriorityRequest/);
    assert.match(html, /actuar-btn-danger priority-delete-action/, 'vermelho: reprova ou destrói');
    assert.match(css, /\.priority-review-actions \.priority-delete-action \{ margin-right: auto; \}/);
});
