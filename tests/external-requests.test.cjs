const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ext = require('../js/external-requests.js');

const html = fs.readFileSync('index.html', 'utf8');

/* O que entra pelo Portal de Prioridades não é uma prioridade ainda: é um pedido. Vira
   prioridade quando a gestão tria. Estas etapas são o processo que hoje acontece por
   mensagem — alguém avisa, o gestor interpreta, procura o analista, encaminha e cobra. */

const base = { id: 'r1', protocol: 'PRI-2026-00001', clientId: 'KM7552', clientName: 'Academia Modelo',
    phone: '(62) 99988-7766', brand: 'Actuar', team: 'Catraca', need: 'Catraca travada', status: 'aguardando_triagem', createdAt: 1000 };

test('o vocabulário do portal é traduzido na entrada do quadro', () => {
    // O portal grava 'aguardando_triagem'; traduzir aqui mantém a porta externa ignorante
    // do vocabulário interno.
    assert.equal(ext.stageOf(base), 'nova');
    assert.equal(ext.stageOf({ status: 'em_atendimento' }), 'em_atendimento');
    // Estado desconhecido não some do quadro: cai na primeira coluna, onde alguém olha.
    assert.equal(ext.stageOf({ status: 'coisa_estranha' }), 'nova');
    assert.equal(ext.stageOf({}), 'nova');
});

test('o quadro tem as sete etapas do processo, e encerradas fora delas', () => {
    assert.equal(ext.STAGES.length, 7);
    assert.deepEqual(ext.STAGE_IDS, ['nova', 'triagem', 'aguardando_info', 'aguardando_distribuicao', 'em_atendimento', 'aguardando_aprovacao', 'concluida']);
    // Encerramentos não viram coluna: um quadro com uma coluna por exceção fica ilegível.
    for (const fim of ['rejeitada', 'duplicada', 'cancelada']) {
        assert.ok(ext.isClosed(fim), `${fim} deveria ser encerramento`);
        assert.ok(!ext.STAGE_IDS.includes(fim), `${fim} não pode virar coluna`);
    }
});

test('na fila, quem espera há mais tempo aparece primeiro', () => {
    const quadro = ext.board([
        { ...base, id: 'novo', createdAt: 3000 },
        { ...base, id: 'antigo', createdAt: 1000 },
        { ...base, id: 'meio', createdAt: 2000 }
    ]);
    assert.deepEqual(quadro.stages[0].items.map(item => item.id), ['antigo', 'meio', 'novo']);
});

test('o quadro filtra por equipe e marca sem perder o total', () => {
    const linhas = [base, { ...base, id: 'r2', team: 'Sistema' }, { ...base, id: 'r3', brand: 'Ediz' }];
    assert.equal(ext.board(linhas, { team: 'Catraca' }).total, 2);
    assert.equal(ext.board(linhas, { brand: 'Ediz' }).total, 1);
    assert.equal(ext.board(linhas, { team: 'Todos', brand: 'Todas' }).total, 3);
});

test('duplicidade olha ID e telefone, e ignora o que já encerrou', () => {
    /* Comparar pelos dois cobre quem digitou o ID errado mas o contato certo — e o inverso.
       Uma solicitação encerrada não é duplicidade: o caso dela já acabou. */
    const outras = [
        { ...base, id: 'mesmo-id', clientId: 'KM7552', phone: '(11) 90000-0000' },
        { ...base, id: 'mesmo-fone', clientId: 'ZZ0000', phone: '(62) 99988-7766' },
        { ...base, id: 'outro', clientId: 'AB1234', phone: '(11) 91111-1111' },
        { ...base, id: 'encerrado', clientId: 'KM7552', status: 'rejeitada' }
    ];
    const achadas = ext.duplicatesOf(base, outras).map(item => item.id);
    assert.deepEqual(achadas, ['mesmo-id', 'mesmo-fone']);
    // E não acusa a si mesma.
    assert.equal(ext.duplicatesOf(base, [base]).length, 0);
});

test('toda transição registra quem, quando e por quê', () => {
    const depois = ext.transition(base, 'aguardando_distribuicao', { actorName: 'Marco', now: 5000, reason: 'validado' });
    assert.equal(depois.status, 'aguardando_distribuicao');
    assert.equal(depois.updatedAt, 5000);
    assert.equal(depois.lastReason, 'validado');
    assert.equal(depois.events.at(-1).by, 'Marco');
    assert.match(depois.events.at(-1).text, /Novas solicitações → Aguardando distribuição/);
    // O original não é tocado: quem chama decide quando trocar.
    assert.equal(base.status, 'aguardando_triagem');
});

test('decisão que exige motivo não passa sem ele', () => {
    assert.throws(() => ext.transition(base, 'rejeitada', { reasonRequired: true }), /motivo/i);
    assert.throws(() => ext.transition(base, 'rejeitada', { reasonRequired: true, reason: '  ' }), /motivo/i);
    assert.doesNotThrow(() => ext.transition(base, 'rejeitada', { reasonRequired: true, reason: 'atendimento comum' }));
    // Etapa inexistente e repetição são recusadas.
    assert.throws(() => ext.transition(base, 'inexistente'), /desconhecida/i);
    assert.throws(() => ext.transition(base, 'nova'), /já está/i);
});

test('encerrar carimba a data de encerramento', () => {
    const fechada = ext.transition(base, 'rejeitada', { reason: 'não procede', now: 9000 });
    assert.equal(fechada.closedAt, 9000);
    assert.equal(ext.transition(base, 'triagem', { now: 9000 }).closedAt, undefined);
});

test('o resumo mede o que espera alguém', () => {
    const agora = 10000;
    const resumo = ext.summarize([
        { ...base, id: 'a', createdAt: 1000 },
        { ...base, id: 'b', createdAt: 8000 },
        { ...base, id: 'c', status: 'em_atendimento' },
        { ...base, id: 'd', status: 'rejeitada' }
    ], agora);
    assert.equal(resumo.total, 4);
    assert.equal(resumo.novas, 2);
    assert.equal(resumo.emAtendimento, 1);
    assert.equal(resumo.abertas, 3, 'rejeitada não conta como aberta');
    assert.equal(resumo.esperaMaisLonga, 9000, 'a espera é a da mais antiga sem triagem');
});

test('o quadro tem lugar próprio na gestão, dentro de Prioridades', () => {
    const nav = require('../js/actuar-navigation.js');
    const item = nav.build({ mode: 'manager' }).flatMap(g => g.items).find(i => i.id === 'prioridades');
    const externas = item.children.find(filho => filho.id === 'prioridades-externas');
    assert.ok(externas, 'o item precisa viver junto das outras telas de prioridade');
    assert.deepEqual(externas.route, { name: 'admin', section: 'externas' });
    assert.equal(externas.badgeId, 'admExternalPendingBadge');
    assert.match(html, /externas: 'admPanelExternas'/);
    assert.match(html, /if \(tab === 'externas'\) \{ renderExternalBoard\(\);/);
});

test('a decisão da gestão passa pelo diálogo do produto, com motivo obrigatório', () => {
    /* prompt() ignora tema, tipografia e vocabulário do produto — e trava a página. O
       diálogo ganhou campo opcional para caber "confirme e diga por quê". */
    assert.doesNotMatch(html, /(?<![.\w])prompt\(/);
    assert.match(html, /id="actuarConfirmField"/);
    const dialogo = html.slice(html.indexOf("if (event.target?.closest?.('#actuarConfirmOk'))"), html.indexOf('closeActuarConfirm(true);'));
    assert.match(dialogo, /texto\.length < 3/, 'confirmar sem motivo não pode fechar');
    assert.match(dialogo, /closeActuarConfirm\(texto\)/, 'quem chama recebe o motivo direto');
});

test('a decisão persiste com rollback', () => {
    // Uma triagem que não chegou ao banco não pode ficar na tela como se tivesse chegado.
    const decide = html.slice(html.indexOf('async function externalDecide('), html.indexOf('async function externalApprove('));
    assert.match(decide, /const anterior = deepClone\(getStore\(\)\.externalRequests \|\| \[\]\)/);
    assert.match(decide, /appStore\.externalRequests = anterior;/);
    assert.match(decide, /dominio\.transition\(item, proximo/, 'a transição é do domínio, não da tela');
});

test('o quadro busca do servidor ao abrir, não só ao recarregar a página', () => {
    /* É uma caixa de entrada: o que chega vem de outra aba e de outra pessoa. Sem buscar ao
       abrir, a gestão veria a foto do momento em que carregou a página — e uma solicitação
       registrada agora só apareceria depois de um F5, fazendo o portal parecer quebrado. */
    assert.match(html, /if \(tab === 'externas'\) \{ renderExternalBoard\(\); refreshExternalRequests\(\); \}/);

    const refresh = html.slice(html.indexOf('async function refreshExternalRequests()'), html.indexOf('function externalFilters()'));
    assert.match(refresh, /await loadLegacyStoreRow\(\)/);
    assert.match(refresh, /if \(versao === currentVersion\) return;/, 'sem mudança, não redesenha à toa');
    assert.match(refresh, /lastSyncedSnapshot = deepClone\(appStore\)/, 'o diff seguinte precisa partir do que veio');
    assert.match(refresh, /if \(externalRefreshing/, 'duas buscas ao mesmo tempo disputariam o store');
    assert.match(refresh, /catch \(_\)/, 'sem rede o quadro segue mostrando o que já tinha');

    // E dá para atualizar na mão, sem esperar trocar de seção.
    assert.match(html, /onclick="refreshExternalRequests\(\)"/);
});
