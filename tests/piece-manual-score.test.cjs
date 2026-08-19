const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

/* ==========================================================================
   NOTA DE PEÇAS — LANÇAMENTO MANUAL
   A central de peças pontua pelo fluxo inteiro (solicitação, validação, aprovação),
   e o ciclo atual abriu antes dela entrar em uso. Sem uma porta manual, a nota de
   peças deste mês não teria como ser lançada e o analista de catraca ficaria sem a
   métrica no ranking. É ponte, não módulo: sai quando o próximo ciclo começar.
   ========================================================================== */

const html = fs.readFileSync('index.html', 'utf8');

test('a área fica acima da central, dentro do painel de peças da gestão', () => {
    const painel = html.slice(html.indexOf('id="admPanelPecas"'), html.indexOf('<!-- FIM PAINEL PEÇAS CATRACA -->'));
    assert.ok(painel.includes('class="piece-manual-score"'), 'a área não está no painel de peças');
    assert.ok(painel.indexOf('piece-manual-score') < painel.indexOf('id="admPiecesModule"'), 'a ponte precisa vir acima da central');

    // Três campos e nada mais: analista, nota e observação.
    for (const id of ['pieceManualAnalyst', 'pieceManualScore', 'pieceManualNote']) {
        assert.ok(painel.includes(`id="${id}"`), `campo ausente: ${id}`);
    }
    // Só analista de catraca — a lista vem do mesmo filtro que já existia.
    assert.match(html, /populateCatracaAnalystOptions\('pieceManualAnalyst'\)/);
});

test('lançar nota exige gestão, escopo e faixa válida', () => {
    const fn = html.slice(html.indexOf('async function submitManualPieceScore(event)'), html.indexOf('function renderPiecesExperience('));

    /* O formulário existe no DOM da página inteira, não só dentro do Modo Gestão: quem
       concede ponto confere permissão de novo. */
    assert.match(fn, /if \(!isAdminLoggedIn\) \{ showToast\('Somente a gestão lança nota de peças\.', 'error'\); return; \}/);
    assert.match(fn, /if \(!analystId \|\| !canManagerViewAnalyst\(analystId\)\)/);
    assert.match(fn, /if \(!Number\.isFinite\(nota\) \|\| nota < 0 \|\| nota > 100\)/);
});

test('o lançamento é um log PECA carimbado, e a falha de salvamento não deixa ponto solto', () => {
    const fn = html.slice(html.indexOf('async function submitManualPieceScore(event)'), html.indexOf('function renderPiecesExperience('));

    // Soma em pecasPts como qualquer peça — a agregação não distingue origem.
    assert.match(fn, /type: 'PECA', userId: analystId, value: Math\.round\(nota\)/);
    /* `manualEntry` é o que vai permitir separar o que veio da ponte do que veio da
       central quando o próximo ciclo começar, sem depender de olhar a data. */
    assert.match(fn, /manualEntry: true, registradoPor: currentAdminId/);
    assert.match(fn, /tipo: 'Nota de peças \(lançamento manual\)'/);

    // Não salvou, não pontuou: o log sai do array antes de o gestor achar que entrou.
    assert.match(fn, /appStore\.logs = \(appStore\.logs \|\| \[\]\)\.filter\(log => log\.id !== registro\.id\);/);
    assert.ok(fn.indexOf('const ok = await persistStore();') < fn.indexOf('showToast(`Nota de'), 'o aviso de sucesso vem depois do salvamento');
});

test('lançar de novo para a mesma pessoa avisa que soma, em vez de substituir', () => {
    const fn = html.slice(html.indexOf('async function submitManualPieceScore(event)'), html.indexOf('function renderPiecesExperience('));
    /* Nota lançada duas vezes vira o dobro de pontos sem nenhum sinal. O aviso diz o que
       de fato acontece e aponta o caminho da correção. */
    assert.match(fn, /const jaTem = manualPieceScoreLogs\(\)\.find\(log => log\.userId === analystId\);/);
    assert.match(fn, /Lançar de novo SOMA ao total, não substitui/);
});

test('o que já foi lançado fica à vista, e a observação chega à auditoria', () => {
    assert.match(html, /function renderManualPieceScore\(\)/);
    assert.match(html, /id="pieceManualRecent"/);
    // Recarrega junto com o painel de peças.
    assert.match(html, /if \(activeAdminTab === 'pecas'\) renderManagerPanel\('peças', renderPiecesExperience\);\s*\n\s*renderManualPieceScore\(\);/);
    // A lista respeita o escopo do gestor, como o resto da tela.
    assert.match(html, /log\.type === 'PECA' && log\.manualEntry && canManagerViewAnalyst\(log\.userId\)/);
    // E o Histórico mostra a observação: ponto concedido à mão sem pista do porquê é pior que nenhum.
    assert.match(html, /\$\{log\.note \? ` · \$\{escapeHtml\(log\.note\)\}` : ''\}/);
});

test('os formulários de peça que a central substituiu não sobraram pela metade', () => {
    /* Sobravam três funções — submitPecaScore, addPecaScoreAdmin e renderAdminPecaLogs —
       procurando sete campos que nenhum HTML tinha mais. Ao lado de um lançamento manual
       novo, três sósias mortas fariam qualquer um mexer no lugar errado. */
    for (const morta of ['submitPecaScore', 'addPecaScoreAdmin', 'renderAdminPecaLogs']) {
        assert.ok(!html.includes(morta), `função órfã ressuscitou: ${morta}`);
    }
    for (const campo of ['pecaTargetUser', 'admPecaTargetUser', 'admPecaTipo', 'admPecaClientId', 'admPecaPoints', 'admPecaLogsTable']) {
        assert.ok(!html.includes(campo), `referência a campo inexistente: ${campo}`);
    }
});

/* ==========================================================================
   PEÇA É TRABALHO DE CATRACA
   O analista de Software via "Solicitações de peças" na sidebar, entrava na tela
   e só descobria lá dentro que não podia solicitar — `canRequestPieces()` recusa
   quem não é de Catraca. Ainda carregava um contador que nunca teria número.
   ========================================================================== */

const nav = require('../js/actuar-navigation.js');
const rotulos = (arvore) => arvore.flatMap(grupo => grupo.items.map(item => item.label));

test('peça sai do menu do analista de Software e fica no de Catraca', () => {
    const software = rotulos(nav.build({ mode: 'analyst', publicTabs: { tasks: true, pecas: false } }));
    const catraca = rotulos(nav.build({ mode: 'analyst', publicTabs: { envio: true, coleta: true, pecas: true } }));

    assert.ok(!software.includes('Solicitações de peças'), 'Software não solicita peça');
    assert.ok(!software.some(item => /peça|peças/i.test(item)), `sobrou item de peça: ${software.join(' · ')}`);
    assert.ok(catraca.includes('Solicitações de peças'));

    // O acesso operacional é de peça por definição: a tela de trabalho dele não pode sumir.
    assert.ok(rotulos(nav.build({ mode: 'operations', publicTabs: { envio: true, coleta: true, pecas: true } })).includes('Operação de peças'));
});

test('esconder o item não basta: a rota também recusa', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    /* A rota vive no endereço. Sem entrar na lista guardada, quem colasse #/pecas sendo do
       Software entraria na tela assim mesmo — foi por isso que a lista passou a existir. */
    assert.match(html, /const OPERATION_TABS = \['envio', 'coleta', 'tasks', 'pecas'\];/);
    assert.match(html, /return \{ envio: catraca, coleta: catraca, tasks: equipe === 'Sistema', pecas: catraca \};/);
    // E o operador de peça continua com a própria tela de trabalho.
    assert.match(html, /if \(operador\) return \{ envio: true, coleta: true, tasks: false, pecas: true \};/);
    // A guarda que devolve ao dashboard é a mesma de sempre, agora cobrindo pecas.
    assert.match(html, /if \(OPERATION_TABS\.includes\(currentRoute\.name\) && !acesso\[currentRoute\.name\]\) \{\s*\n\s*navigateTo\('dashboard', \{ replace: true \}\);/);
});

test('o dashboard do Software não fala em peça numa métrica que ele nunca terá', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /label: isSistema \? 'Monitoramento de Qualidade' : 'Monitoramento & Peças'/);
    assert.match(html, /hint: isSistema \? 'Avaliação de qualidade dos atendimentos' : 'Avaliação de qualidade \+ envio\/coleta'/);
});
