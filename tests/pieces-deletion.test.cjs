const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pieces = require('../js/pieces-operations.js');

const html = fs.readFileSync('index.html', 'utf8');
const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

const registro = {
    id: 'piece_1', protocol: 'PC-001', analystId: 'dyego', department: 'Catraca',
    requestStatus: 'approved', scoring: { final: 12 }, client: { id: 'C1' }, products: []
};

const logs = [
    { id: 'log_a', type: 'PECA', userId: 'dyego', value: 12, relatedPieceRequestId: 'piece_1' },
    { id: 'log_b', type: 'PECA', userId: 'dyego', value: 8, relatedPieceRequestId: 'piece_2' },
    { id: 'log_c', type: 'PRIORIDADE', userId: 'dyego', value: 50, relatedPieceRequestId: 'piece_1' },
    { id: 'log_d', type: 'PECA', userId: 'dyego', value: 4, relatedPieceRequestId: 'piece_1' }
];

test('só os lançamentos de peça da própria solicitação são estornados', () => {
    // Errar aqui tira ponto de prioridade ou de outra solicitação junto.
    const encontrados = pieces.pointLogsOf(logs, 'piece_1');
    assert.deepEqual(encontrados.map(log => log.id), ['log_a', 'log_d']);
});

test('a exclusão registra autor, motivo e a pontuação estornada', () => {
    const entrada = pieces.deletionEntry(registro, 'marco_adm', '  chamado de teste  ', pieces.pointLogsOf(logs, 'piece_1'), 1755000000000);
    assert.equal(entrada.id, 'piece_1');
    assert.equal(entrada.protocol, 'PC-001');
    assert.equal(entrada.analystId, 'dyego');
    assert.equal(entrada.deletedBy, 'marco_adm');
    assert.equal(entrada.deletedAt, 1755000000000);
    assert.equal(entrada.reason, 'chamado de teste');
    assert.equal(entrada.removedPoints, 16);
    assert.deepEqual(entrada.removedLogIds, ['log_a', 'log_d']);
});

test('a solicitação inteira é preservada, e desligada do original', () => {
    // O snapshot é o que permite conferir depois e desfazer um engano.
    const entrada = pieces.deletionEntry(registro, 'marco_adm', 'teste', []);
    assert.deepEqual(entrada.record, registro);
    entrada.record.scoring.final = 999;
    assert.equal(registro.scoring.final, 12, 'o arquivo não pode compartilhar referência com o store');
});

test('exclusão sem motivo ou sem autor é recusada no domínio', () => {
    assert.throws(() => pieces.deletionEntry(registro, 'marco_adm', '   ', []), /motivo/i);
    assert.throws(() => pieces.deletionEntry(registro, '', 'teste', []), /não identificado/i);
});

test('solicitação sem pontuação não inventa estorno', () => {
    const entrada = pieces.deletionEntry({ ...registro, id: 'piece_9' }, 'marco_adm', 'duplicada', pieces.pointLogsOf(logs, 'piece_9'));
    assert.equal(entrada.removedPoints, 0);
    assert.deepEqual(entrada.removedLogIds, []);
});

test('a auditoria viaja no diff do store, senão o merge a descarta', () => {
    // applyStoreDiff parte de deepClone(serverData): chave não declarada some no primeiro
    // salvamento concorrente, levando junto o registro da exclusão.
    assert.match(html, /deletedPieceOperations: diffKeyedArray\(base\.deletedPieceOperations, local\.deletedPieceOperations\)/);
    assert.match(html, /merged\.deletedPieceOperations = applyKeyedArrayDiff\(merged\.deletedPieceOperations, diff\.deletedPieceOperations\)/);
    // E a remoção precisa propagar de fato.
    assert.match(html, /diff\.removed\.forEach\(id => map\.delete\(id\)\)/);
    // Store novo e store antigo nascem com a chave, para ninguém testar existência ao ler.
    assert.match(html, /deletedPieceOperations: \[\]/);
    assert.match(html, /if \(!appStore\.deletedPieceOperations\) appStore\.deletedPieceOperations = \[\]/);
});

test('excluir exige senha conferida no banco e devolve o estado se o salvamento falhar', () => {
    const funcao = ui.slice(ui.indexOf('async function deleteRecord('), ui.indexOf('async function saveRecord('));
    assert.match(funcao, /verifyLoginRemote\(context\.actorId, password\)/, 'a senha é a do gestor logado');
    assert.match(funcao, /Senha incorreta\. Nada foi excluído\./);
    assert.match(funcao, /if \(!canDelete\(record\)\) throw/, 'a permissão é conferida na execução, não só no botão');
    // Rollback: a tela não pode mostrar exclusão que não chegou ao banco.
    assert.match(funcao, /const previous = \{ operations:[\s\S]*logs:[\s\S]*deleted:/);
    assert.match(funcao, /if \(!ok\) \{[\s\S]*store\(\)\.pieceOperations = previous\.operations;[\s\S]*store\(\)\.logs = previous\.logs;[\s\S]*store\(\)\.deletedPieceOperations = previous\.deleted;/);
    // Os pontos saem junto com o registro.
    assert.match(funcao, /previous\.logs\.filter\(log => !removedIds\.has\(log\.id\)\)/);
});

test('excluir é da gestão, e só dentro do alcance que ela já administra', () => {
    assert.match(ui, /function canDelete\(record\) \{ return Boolean\(record\) && currentContext\(\)\.mode === 'manager' && canView\(record\); \}/);
    // O botão não aparece para analista, Lab nem logística.
    const acoes = ui.slice(ui.indexOf('function detailActions('), ui.indexOf('function openAction('));
    assert.match(acoes, /if \(canDelete\(record\)\) buttons\.push/);
});

test('a auditoria de exclusões é restrita a quem alcança todas as equipes', () => {
    // O critério é alcançar todas as equipes, e não a flag crua allTeamsAccess: ela não é
    // definida nos usuários padrão nem tem campo na ficha, então esconderia tudo de todos.
    const gate = html.slice(html.indexOf('function canAuditDeletedPieces()'), html.indexOf('function renderDeletedPiecesPanel()'));
    assert.match(gate, /todas\.every\(team => alcance\.includes\(team\)\)/);
    assert.match(gate, /getManagerAuthorizedTeams\(\)/);
    assert.doesNotMatch(gate, /getCurrentManager\(\)\?\.allTeamsAccess === true/);

    // As linhas de exclusão só entram na tabela sob essa permissão.
    const linhas = html.slice(html.indexOf('function historyRows()'), html.indexOf('function filteredHistoryRows()'));
    assert.match(linhas, /if \(canAuditDeletedPieces\(\)\) \{[\s\S]*deletedPieceOperations/);
});

test('a exclusão aparece no Histórico e auditoria, sem aba paralela', () => {
    // O gestor foi procurar em Histórico/Auditoria: manter uma aba separada só obrigava
    // a adivinhar onde a informação tinha sido guardada.
    assert.doesNotMatch(html, /admPanelExcluidos|admTabBtnExcluidos|admDeletedPiecesBody/, 'a aba paralela não deve voltar');
    assert.match(html, /DELETED: \{ label: 'Excluído'/);
    assert.match(html, /<option value="DELETED">Excluído<\/option>/, 'e é filtrável por tipo');
});

test('a tela de exclusão mostra a consequência antes de confirmar', () => {
    const form = ui.slice(ui.indexOf("if (action === 'delete')"), ui.indexOf("if (action === 'labValidate')"));
    assert.match(form, /ponto\(s\)<\/strong> lançados por ela são estornados/, 'o gestor precisa ver quantos pontos caem');
    assert.match(form, /paDeleteReason/);
    assert.match(form, /paDeletePassword/);
    assert.match(form, /required/);
});

test('o CSS da exclusão acompanha a versão publicada dos assets', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(css, /\.pieces-confirm\.is-danger/);
    assert.match(css, /\.pieces-detail-actions \.pieces-delete-action/);

    // Sem bump de versão a folha nova não chega a quem já tem a antiga em cache.
    const referencias = [...html.matchAll(/(?:src|href)="((?:js|styles)\/[^"]+)"/g)].map(match => match[1]);
    const versoes = [...new Set(referencias.map(ref => ref.split('?v=')[1]))];
    assert.equal(versoes.length, 1, `versões divergentes: ${versoes.join(', ')}`);
    assert.notEqual(versoes[0], '20260814-abas-por-equipe-2', 'a versão precisa mudar quando o CSS muda');
});
