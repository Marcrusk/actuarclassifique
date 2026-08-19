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

test('nenhuma função do shell é declarada duas vezes', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    /* `deletePriorityRequest` existia duas vezes no MESMO escopo: a auditada (motivo,
       senha, estorno e registro no Histórico) e uma anterior que só filtrava o array.
       Declaração de função não avisa — a última vence, em silêncio —, então o botão
       "Excluir lançamento" chamava a antiga: nada de motivo, nada de estorno, nada no
       Histórico, e lançamentos já avaliados recusados. A exclusão auditada inteira era
       código inalcançável.

       Os testes de string não pegam isso: recortam por `indexOf(...)`, que acha a
       PRIMEIRA definição — justamente a que nunca roda. Só contando pega. */
    const nomes = [];
    for (const [, corpo] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        for (const [, nome] of corpo.matchAll(/^\s{8}(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm)) nomes.push(nome);
    }
    assert.ok(nomes.length > 400, 'a varredura não encontrou as funções do shell; revise a expressão');

    const repetidas = [...new Set(nomes.filter((nome, i) => nomes.indexOf(nome) !== i))];
    assert.deepEqual(repetidas, [], `função declarada mais de uma vez (a última vence): ${repetidas.join(', ')}`);
});

test('excluir lançamento de prioridade pede motivo digitado, e é a versão auditada', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const excluir = html.slice(html.indexOf('async function deletePriorityRequest(id)'), html.indexOf('async function decidePriorityReview('));

    // Campo de digitação para o motivo, antes de qualquer coisa acontecer.
    assert.match(excluir, /input: \{ label: 'Motivo da exclusão', placeholder: '[^']+' \}/);
    assert.match(excluir, /if \(!motivo\) return;/);
    // O motivo é o que alimenta o registro auditável — não fica só na tela.
    assert.match(excluir, /PriorityRotation\.deletionEntry\(request, currentAdminId, motivo, logs\)/);
    // E a senha vem depois do motivo: confirmar sem saber o porquê seria confirmar no escuro.
    assert.ok(excluir.indexOf("label: 'Motivo da exclusão'") < excluir.indexOf('Senha do seu acesso de gestão'));
});

/* ==========================================================================
   A EXCLUSÃO ABERTA NA AUDITORIA
   `deletionEntry` sempre guardou o lançamento inteiro em `record` — é para isso que
   ele existe. Mas a auditoria mostrava uma linha: "Prioridade PR-2026-77 · motivo".
   Conferir uma exclusão dependia de acreditar nesse resumo.
   ========================================================================== */

// Avalia o renderizador real do shell, com o resto do mundo dublado.
function montarDetalhe(entry, usuarios = {}) {
    const trechos = ['function historyDetailPair(', 'function renderDeletedPriorityDetail('].map(assinatura => {
        const inicio = html.indexOf(assinatura);
        assert.ok(inicio > -1, `${assinatura} não existe mais no shell`);
        const fim = html.indexOf('\n        }', inicio) + '\n        }'.length;
        return html.slice(inicio, fim);
    }).join('\n');

    const escapeHtml = (valor) => String(valor ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const fabrica = new Function(
        'escapeHtml', 'getStore', 'defaultUsers', 'teamLabel', 'priorityStatusLabel', 'fullMomentTitle', 'renderPriorityAttendanceEvidence', 'PriorityRotation',
        `${trechos}\nreturn renderDeletedPriorityDetail;`
    );
    return fabrica(
        escapeHtml,
        () => ({ users: usuarios }),
        {},
        (t) => (t === 'Sistema' ? 'Software' : t),
        (s) => ({ aprovado: 'Aprovado', pendente: 'Aguardando aprovação' }[s] || s),
        (ts) => `data(${ts})`,
        (registro) => `<ficha tentativas="${(registro.contactAttempts || []).length}" notas="${(registro.attendanceNotes || []).length}" desfecho="${registro.resolution || ''}">`,
        rotation
    )(entry);
}

test('a exclusão abre com tudo que o chamado tinha registrado', () => {
    const registro = {
        ...base,
        justificativa: 'Cliente parado desde a manhã',
        timestamp: 1_700_000_000_000,
        rotationAttendanceId: 'att-1',
        dispatchedBy: 'gestor',
        rotationBriefing: { clientName: 'Theron Fit', clientId: 'C-1', phone: '5599', demand: 'Catraca travada', instructions: 'Ligar antes das 18h' },
        resolution: 'unresolved', resolutionReason: 'no_answer', resolutionDetail: 'Três contatos sem resposta.',
        contactAttempts: [{ channel: 'call', result: 'no_answer', at: 1 }, { channel: 'whatsapp', result: 'no_answer', at: 2 }],
        attendanceNotes: [{ text: 'Cliente pediu retorno.', at: 3 }],
        evaluationHistory: [{ id: 'e1', status: 'aprovado', points: 50, note: 'Atendimento conferido.', authorId: 'gestor', createdAt: 1_700_000_100_000 }]
    };
    const entrada = rotation.deletionEntry(registro, 'gestor', 'Lançamento duplicado na homologação.', logs, 1_700_000_200_000);
    const saida = montarDetalhe(entrada, { dyego: { name: 'Dyego' }, gestor: { name: 'Marco' } });

    // As quatro perguntas de uma exclusão.
    assert.match(saida, /Excluído por[\s\S]*?Marco/, 'quem excluiu');
    assert.match(saida, /Lançamento duplicado na homologação\./, 'motivo declarado');
    assert.match(saida, /pts retirados do extrato e do ranking/, 'pontuação perdida');
    assert.match(saida, /data\(1700000200000\)/, 'quando');

    // E o conteúdo do chamado, que antes não tinha tela.
    assert.match(saida, /PR-2026-77/);
    assert.match(saida, /Dyego/);
    assert.match(saida, /Cliente parado desde a manhã/, 'justificativa do analista');
    assert.match(saida, /Theron Fit[\s\S]*?5599/, 'briefing do encaminhamento');
    assert.match(saida, /Catraca travada/);
    assert.match(saida, /Ligar antes das 18h/);
    assert.match(saida, /Rodízio de prioridades/, 'origem');
    assert.match(saida, /Atendimento conferido\./, 'parecer da gestão');
    assert.match(saida, /Marco · data\(1700000100000\) · 50 pts/, 'autor, data e pontos do parecer');

    /* A ficha do atendimento usa o MESMO renderizador da tela de aprovação. Duplicar a
       montagem faria a auditoria e a aprovação divergirem na primeira mudança. */
    assert.match(saida, /<ficha tentativas="2" notas="1" desfecho="unresolved">/);
});

test('exclusão sem pontos e sem ficha não inventa dado', () => {
    const entrada = rotation.deletionEntry({ ...base, status: 'pendente' }, 'gestor', 'Teste criado por engano.', [], 1_700_000_300_000);
    const saida = montarDetalhe(entrada, { dyego: { name: 'Dyego' }, gestor: { name: 'Marco' } });

    assert.match(saida, /Nenhum ponto havia sido creditado/);
    assert.match(saida, /Aguardando aprovação/, 'situação no momento da exclusão');
    assert.match(saida, /Fora do rodízio/);
    // Sem briefing o bloco do encaminhamento nem aparece, em vez de sair vazio.
    assert.ok(!saida.includes('Encaminhado pela gestão'));
    assert.ok(!saida.includes('Pareceres da gestão'));
});

test('a linha da auditoria carrega o registro e sabe expandir', () => {
    // Sem isto a tela teria só o resumo, e o `record` seguiria gravado sem leitor.
    assert.match(html, /deletion: item,/);
    assert.match(html, /function toggleHistoryRow\(id\)/);
    assert.match(html, /row\.deletion && aberto[\s\S]{0,160}renderDeletedPriorityDetail\(row\.deletion\)/);
    assert.match(html, /Ver tudo que foi registrado/);
    // Expandir é estado da tela, não da base: recarregar não deve deixar linhas abertas.
    assert.match(html, /let expandedHistoryRows = new Set\(\);/);
});
