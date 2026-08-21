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
const nav = require('../js/actuar-navigation.js');
const rotulos = (arvore) => arvore.flatMap(grupo => grupo.items.map(item => item.label));

test('a área fica acima da central, dentro do painel de peças da gestão', () => {
    const painel = html.slice(html.indexOf('id="admPanelPecas"'), html.indexOf('<!-- FIM PAINEL PEÇAS CATRACA -->'));
    assert.ok(painel.includes('id="admManualPieceScore"'), 'o lugar da ponte não está no painel de peças');
    assert.ok(painel.indexOf('admManualPieceScore') < painel.indexOf('id="admPiecesModule"'), 'a ponte precisa vir acima da central');

    /* A ficha é montada por JS porque o MESMO formulário atende a gestão e o Toletus Lab.
       Duas cópias no HTML seriam duas regras de pontuação para manter em dia. */
    assert.match(html, /function manualPieceScoreMarkup\(\)/);
    assert.match(html, /const MANUAL_PIECE_MOUNTS = \['admManualPieceScore', 'labManualPieceScore'\];/);

    // Três campos e nada mais: analista, nota e observação.
    const markup = html.slice(html.indexOf('function manualPieceScoreMarkup()'), html.indexOf('function renderManualPieceScore('));
    for (const id of ['pieceManualAnalyst', 'pieceManualScore', 'pieceManualNote', 'pieceManualRecent']) {
        assert.ok(markup.includes(`id="${id}"`), `campo ausente: ${id}`);
    }
    // Só analista de catraca — a lista vem do mesmo filtro que já existia.
    assert.match(html, /populateCatracaAnalystOptions\('pieceManualAnalyst'\)/);
});

/* ==========================================================================
   A PONTE TAMBÉM É DO TOLETUS LAB
   Quem valida a peça na entrada é o Lab (Antônio e Jeremias). A nota avulsa do
   analista, porém, só saía do Modo Gestão: eles validavam e ficavam dependendo
   de a gestão abrir a tela para o ponto entrar.
   ========================================================================== */

test('o Lab tem tela própria para a nota de peças, com a MESMA ficha da gestão', () => {
    assert.ok(html.includes('<div id="viewPontuacaoPecas" class="hidden space-y-6">'), 'tela do Lab ausente');
    assert.ok(html.includes('id="labManualPieceScore"'), 'a tela do Lab precisa do lugar onde a ficha é montada');

    // Uma rota de verdade: o endereço sobrevive à recarga, como as demais telas públicas.
    assert.match(html, /pontuacao: \{ title: 'Pontuação de peças'/);
    assert.match(html, /pontuacao: 'viewPontuacaoPecas'/);

    // Um formulário só no DOM: os ids são únicos e getElementById devolveria o errado.
    const render = html.slice(html.indexOf('function renderManualPieceScore()'), html.indexOf('async function submitManualPieceScore'));
    assert.match(render, /if \(outro && \(!acesso \|\| acesso\.mount !== id\)\) outro\.replaceChildren\(\);/);
    /* Redesenhar a ficha a cada render() apagaria o que a pessoa está digitando — a tela
       se redesenha sozinha quando o store sincroniza. */
    assert.match(render, /if \(!mount\.querySelector\('\.piece-manual-score'\)\) mount\.innerHTML = manualPieceScoreMarkup\(\);/);
});

test('o menu do Lab abre a pontuação, e nenhum outro papel de peça a enxerga', () => {
    const doLab = rotulos(nav.build({ mode: 'operations', publicTabs: { envio: true, coleta: true, pecas: true, pontuacao: true } }));
    const daLogistica = rotulos(nav.build({ mode: 'operations', publicTabs: { envio: true, coleta: true, pecas: true, pontuacao: false } }));

    assert.ok(doLab.includes('Pontuação de peças'), 'o Lab precisa alcançar a tela pelo menu');
    assert.ok(!daLogistica.includes('Pontuação de peças'), 'quem opera a peça não pontua o analista');
    // E o analista nunca vê: pontuação de peça não é tela de quem recebe o ponto.
    assert.ok(!rotulos(nav.build({ mode: 'analyst', publicTabs: { envio: true, coleta: true, pecas: true } })).includes('Pontuação de peças'));
});

/* A regra de quem lança e de quem cada um alcança vive no script inline: extrai o trecho
   e executa de verdade, com os globais que ele lê. Conferir só o texto do arquivo diria que
   a linha existe, não que ela decide certo. */
function loadManualPieceScoreScope({ isAdminLoggedIn, currentAdminId, isPecaLoggedIn, currentPecaUserId, store, gerenciados = [] }) {
    const inicio = html.indexOf('function isCatracaAnalyst(user)');
    const fim = html.indexOf('const MANUAL_PIECE_MOUNTS');
    assert.ok(inicio > -1 && fim > inicio, 'a regra precisa continuar no shell do index.html');
    const fabrica = new Function(
        'isAdminLoggedIn', 'currentAdminId', 'isPecaLoggedIn', 'currentPecaUserId',
        'getStore', 'defaultUsers', 'canManagerViewAnalyst', 'LAB_ROLE_NAME',
        `${html.slice(inicio, fim)}; return { manualPieceScoreAccess, manualPieceScoreLogs };`
    );
    return fabrica(
        isAdminLoggedIn, currentAdminId, isPecaLoggedIn, currentPecaUserId,
        () => store, store.users, id => gerenciados.includes(id), 'Toletus Lab'
    );
}

const equipe = {
    users: {
        marco_adm: { name: 'Marco', team: 'Sistema', role: 'Gestor Adm', active: true },
        dyego: { name: 'Dyego', team: 'Catraca', role: 'Analista de catraca', active: true },
        vitor: { name: 'Vitor', team: 'Catraca', role: 'Analista de catraca', active: true },
        saida: { name: 'Saída', team: 'Catraca', role: 'Analista de catraca', active: false },
        lucas: { name: 'Lucas', team: 'Sistema', role: 'Analista de sistema', active: true },
        jeremias: { name: 'Jeremias', team: 'Catraca', role: 'Toletus Lab', active: true },
        sarah: { name: 'Sarah', team: 'Catraca', role: 'Logística/Faturamento', active: true }
    },
    logs: [
        { id: 'a', type: 'PECA', manualEntry: true, userId: 'dyego', value: 80, timestamp: 10 },
        { id: 'b', type: 'PECA', manualEntry: true, userId: 'vitor', value: 90, timestamp: 30 },
        { id: 'c', type: 'PECA', userId: 'dyego', value: 70, timestamp: 20 },
        { id: 'd', type: 'PRIORITY', manualEntry: true, userId: 'dyego', value: 5, timestamp: 40 }
    ]
};

test('o Toletus Lab lança nota; os demais papéis de peça, não', () => {
    const lab = loadManualPieceScoreScope({
        isAdminLoggedIn: false, currentAdminId: null, isPecaLoggedIn: true, currentPecaUserId: 'jeremias', store: equipe
    });
    const acesso = lab.manualPieceScoreAccess();
    assert.equal(acesso.mount, 'labManualPieceScore');
    // O carimbo de auditoria é quem lançou de verdade, não um gestor genérico.
    assert.equal(acesso.actorId, 'jeremias');

    // Logística opera a peça, mas não pontua ninguém: sem acesso, sem ficha e sem log.
    const logistica = loadManualPieceScoreScope({
        isAdminLoggedIn: false, currentAdminId: null, isPecaLoggedIn: true, currentPecaUserId: 'sarah', store: equipe
    });
    assert.equal(logistica.manualPieceScoreAccess(), null);
    assert.deepEqual(logistica.manualPieceScoreLogs(), []);

    // E o analista que RECEBE o ponto nunca o concede a si mesmo.
    const analista = loadManualPieceScoreScope({
        isAdminLoggedIn: false, currentAdminId: null, isPecaLoggedIn: false, currentPecaUserId: null, store: equipe
    });
    assert.equal(analista.manualPieceScoreAccess(), null);
});

test('cada perfil enxerga o que alcança: a gestão o escopo dela, o Lab a catraca ativa', () => {
    /* Gestor com escopo restrito continua restrito: a porta nova é do Lab, não uma
       forma de ampliar o alcance de quem já lançava. */
    const gestor = loadManualPieceScoreScope({
        isAdminLoggedIn: true, currentAdminId: 'marco_adm', isPecaLoggedIn: false, currentPecaUserId: null,
        store: equipe, gerenciados: ['dyego']
    });
    assert.equal(gestor.manualPieceScoreAccess().actorId, 'marco_adm');
    assert.deepEqual(gestor.manualPieceScoreLogs().map(log => log.id), ['a'], 'a nota de Vitor está fora do escopo dele');

    const lab = loadManualPieceScoreScope({
        isAdminLoggedIn: false, currentAdminId: null, isPecaLoggedIn: true, currentPecaUserId: 'jeremias', store: equipe
    });
    // Mais recente primeiro, e só o que é lançamento manual de peça.
    assert.deepEqual(lab.manualPieceScoreLogs().map(log => log.id), ['b', 'a']);

    const alcance = lab.manualPieceScoreAccess();
    assert.ok(alcance.canSee('dyego'));
    assert.ok(!alcance.canSee('lucas'), 'peça é métrica de Catraca');
    assert.ok(!alcance.canSee('saida'), 'quem saiu não recebe ponto novo');
    assert.ok(!alcance.canSee('jeremias'), 'o próprio Lab não entra no ranking de peça');
});

test('escopo: a gestão alcança quem gerencia, o Lab alcança os analistas de catraca', () => {
    const escopo = html.slice(html.indexOf('function manualPieceScoreAccess()'), html.indexOf('function manualPieceScoreLogs()'));
    assert.match(escopo, /if \(isAdminLoggedIn\) return \{ mount: 'admManualPieceScore', actorId: currentAdminId, canSee: id => canManagerViewAnalyst\(id\) \};/);
    // Só o Lab: Faturamento, Expedição e Envio/Coleta operam a peça, mas não pontuam.
    assert.match(escopo, /operador\.role === LAB_ROLE_NAME/);
    assert.match(escopo, /canSee: id => isCatracaAnalyst\(usuarios\[id\]\)/);
    // Sem perfil que lance, não há ficha nem lançamento.
    assert.match(escopo, /return null;\s*\n\s*\}/);

    /* A lista oferecida é a mesma que o envio aceita. Enquanto o select tinha regra própria
       e o envio conferia outra, dava para escolher alguém e levar erro ao lançar. */
    const opcoes = html.slice(html.indexOf('function populateCatracaAnalystOptions(selectId)'), html.indexOf('function syncAnalystTeamControl('));
    assert.match(opcoes, /if \(!isCatracaAnalyst\(usersList\[id\]\)\) return;/);
    assert.match(opcoes, /if \(acesso && !acesso\.canSee\(id\)\) return;/);
});

test('lançar nota exige perfil que pontue, escopo e faixa válida', () => {
    const fn = html.slice(html.indexOf('async function submitManualPieceScore(event)'), html.indexOf('function renderPiecesExperience('));

    /* O formulário existe no DOM da página inteira, não só dentro do Modo Gestão: quem
       concede ponto confere permissão de novo. */
    assert.match(fn, /const acesso = manualPieceScoreAccess\(\);/);
    assert.match(fn, /if \(!acesso\) \{ showToast\('Somente a gestão e o Toletus Lab lançam nota de peças\.', 'error'\); return; \}/);
    // Perfil não basta: o analista escolhido tem de estar ao alcance de quem lança.
    assert.match(fn, /if \(!analystId \|\| !acesso\.canSee\(analystId\)\)/);
    assert.match(fn, /if \(!Number\.isFinite\(nota\) \|\| nota < 0 \|\| nota > 100\)/);
});

test('o lançamento é um log PECA carimbado, e a falha de salvamento não deixa ponto solto', () => {
    const fn = html.slice(html.indexOf('async function submitManualPieceScore(event)'), html.indexOf('function renderPiecesExperience('));

    // Soma em pecasPts como qualquer peça — a agregação não distingue origem.
    assert.match(fn, /type: 'PECA', userId: analystId, value: Math\.round\(nota\)/);
    /* `manualEntry` é o que vai permitir separar o que veio da ponte do que veio da
       central quando o próximo ciclo começar, sem depender de olhar a data. */
    // Carimba QUEM lançou: gestor ou Toletus Lab, é o mesmo campo de auditoria.
    assert.match(fn, /manualEntry: true, registradoPor: acesso\.actorId/);
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
    /* Recarrega em qualquer rota do perfil, não só no painel de peças da gestão: a
       mesma ficha atende o Modo Gestão e a tela do Lab. */
    assert.match(html, /if \(!syncPublicTabAccess\(\)\) return;[\s\S]{0,400}?renderManagerPanel\('a nota de peças', renderManualPieceScore\);/);
    // A lista respeita o escopo de quem está olhando, como o resto da tela.
    assert.match(html, /log\.type === 'PECA' && log\.manualEntry && acesso\.canSee\(log\.userId\)/);
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
    assert.match(html, /const OPERATION_TABS = \['envio', 'coleta', 'tasks', 'pecas', 'pontuacao'\];/);
    assert.match(html, /return \{ envio: catraca, coleta: catraca, tasks: equipe === 'Sistema', pecas: catraca, pontuacao: false \};/);
    // E o operador de peça continua com a própria tela de trabalho.
    assert.match(html, /if \(operador\) return \{ envio: true, coleta: true, tasks: false, pecas: true, pontuacao: operador\.role === LAB_ROLE_NAME \};/);
    // A guarda que devolve ao dashboard é a mesma de sempre, agora cobrindo pecas.
    assert.match(html, /if \(OPERATION_TABS\.includes\(currentRoute\.name\) && !acesso\[currentRoute\.name\]\) \{\s*\n\s*navigateTo\('dashboard', \{ replace: true \}\);/);
});

test('o dashboard do Software não fala em peça numa métrica que ele nunca terá', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /label: isSistema \? 'Monitoramento de Qualidade' : 'Monitoramento & Peças'/);
    assert.match(html, /hint: isSistema \? 'Avaliação de qualidade dos atendimentos' : 'Avaliação de qualidade \+ envio\/coleta'/);
});
