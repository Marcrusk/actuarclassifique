const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ext = require('../js/external-requests.js');

const html = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

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

test('o quadro tem as etapas do processo, e encerradas fora delas', () => {
    assert.equal(ext.STAGES.length, 8);
    /* "Sem retorno do cliente" é etapa própria: sem ela, um chamado parado há dias esperando
       o cliente ficava indistinguível de trabalho em andamento — e cobrava o analista por
       algo que não depende dele. */
    assert.deepEqual(ext.STAGE_IDS, ['nova', 'triagem', 'aguardando_info', 'aguardando_distribuicao', 'em_atendimento', 'sem_retorno', 'aguardando_aprovacao', 'concluida']);
    /* Uma cor por etapa. As oito dividiam quatro tons — três `primary` e três `warning` —,
       então a cor não distinguia nada e achar onde um chamado estava exigia ler os oito
       títulos. O tom é nome de token do Design System, nunca cor. */
    assert.deepEqual(ext.STAGES.map(item => item.tone),
        ['info', 'primary', 'warning', 'teal', 'violet', 'orange', 'pink', 'success']);
    assert.equal(new Set(ext.STAGES.map(item => item.tone)).size, ext.STAGES.length, 'duas etapas voltaram a dividir o mesmo tom');
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
    /* O mínimo deixou de ser fixo: motivo pede três caracteres, senha pede só não estar
       vazia — o diálogo passou a atender os dois desde que a senha ganhou campo próprio. */
    assert.match(dialogo, /const minimo = entrada === segredo \? 1 : 3;/);
    assert.match(dialogo, /texto\.length < minimo/, 'confirmar sem motivo não pode fechar');
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

/* DISTRIBUIÇÃO — não existe segunda fila. A solicitação externa entra na mesma que o
   analista já conhece, com o mesmo briefing que a gestão preenche à mão hoje. */

test('a distribuição reusa o rodízio existente, com o briefing que ele já espera', () => {
    const assign = html.slice(html.indexOf('async function externalAssign()'), html.indexOf('async function externalSkipNext()'));
    assert.match(assign, /PriorityRotation\.assign\(/);
    // O domínio do rodízio exige exatamente estes campos.
    for (const campo of ['demand', 'clientName', 'clientId', 'phone', 'instructions']) {
        assert.match(assign, new RegExp(`${campo}:`), `o briefing precisa levar ${campo}`);
    }
    assert.match(assign, /ensurePriorityRotation\(item\.team\)/, 'a fila é a da equipe escolhida no portal');
});

test('encaminhar move rodízio e solicitação juntos, ou nenhum dos dois', () => {
    /* Meia distribuição deixaria o analista com trabalho que o quadro não reconhece —
       exatamente o descasamento que o portal existe para acabar. */
    const assign = html.slice(html.indexOf('async function externalAssign()'), html.indexOf('async function externalSkipNext()'));
    assert.match(assign, /const rotacaoAnterior = deepClone\(ensurePriorityRotation\(item\.team\)\)/);
    assert.match(assign, /const listaAnterior = deepClone\(getStore\(\)\.externalRequests \|\| \[\]\)/);
    assert.match(assign, /appStore\.priorityRotations\[item\.team\] = rotacaoAnterior;[\s\S]*appStore\.externalRequests = listaAnterior;/,
        'a falha precisa desfazer os dois lados');
    // A solicitação guarda para quem foi e qual atendimento do rodízio a representa.
    // `destinoId` e não `view.next`: com a escolha livre, nem sempre são a mesma pessoa.
    assert.match(assign, /analystId: destinoId/);
    assert.match(assign, /attendanceId: PriorityRotation\.activeOf\(rodizio, destinoId\)\?\.id/);
});

test('fila ocupada faz a solicitação esperar, não furar', () => {
    const painel = html.slice(html.indexOf('function externalDistributionPanel(item)'), html.indexOf('async function externalAssign()'));
    /* "Ocupada" deixou de significar "alguém está atendendo": com atendimentos simultâneos,
       a fila só está ocupada quando NINGUÉM está livre. Antes, um atendimento em curso
       segurava a solicitação mesmo havendo gente parada na fila. */
    assert.match(painel, /if \(!view\.next && \(view\.active \|\| \[\]\)\.length\)/, 'só espera quando ninguém está livre');
    assert.match(painel, /aguarda a próxima vez/);
    // Cada impedimento se explica: pausado, sem fila e sem elegível dizem coisas diferentes.
    assert.match(painel, /Rodízio pausado/);
    assert.match(painel, /Rodízio indisponível/);
    assert.match(painel, /Ninguém disponível/);
});

test('pular continua sendo pular: com motivo, e sem tirar a vez de ninguém', () => {
    const skip = html.slice(html.indexOf('async function externalSkipNext()'), html.indexOf('function externalActions('));
    assert.match(skip, /PriorityRotation\.skip\(/);
    assert.match(skip, /input: \{ label: 'Por que pular\?'/, 'pular sem motivo não pode');
    assert.match(skip, /não perde a vez/, 'quem é pulado vai para o fim, não perde a vez');
});

test('dá para escolher quem recebe direto na fila, sem pular a vez de três para chegar no quarto', () => {
    /* A ordem continua sendo o padrão. O que mudou é que sair dela deixou de custar a
       reorganização da fila inteira: para escolher o quarto, a gestão pulava a vez dos três
       da frente, e cada pulo mandava alguém para o fim por um motivo que não era dele. */
    const lista = html.slice(html.indexOf('function externalQueueList('), html.indexOf('function externalDistributionPanel('));
    assert.match(lista, /onclick="externalPickAssignee\('\$\{escapeHtml\(id\)\}'\)"/);
    assert.match(lista, /aria-pressed="\$\{id === escolhido\}"/, 'seleção precisa ser anunciada, não só colorida');

    // Só é clicável quem pode receber. Ocupado e pausado continuam visíveis — some quem
    // está e some por que a fila anda — mas não respondem ao clique com um erro.
    assert.match(lista, /if \(!selecionavel \|\| ocupado \|\| pausados\.has\(id\)\) return `<li class="\$\{classes\}">\$\{conteudo\}<\/li>`;/);
    assert.match(lista, /const emAtendimento = new Map\(\(view\.active \|\| \[\]\)\.map\(a => \[a\.analystId, a\]\)\);/);
    // Ocupado se identifica como tal: no print que originou isto, três posições apareciam
    // como 1º/2º/3º sem explicar por que a vez tinha pulado para o quarto.
    assert.match(lista, /ocupado \? 'Atendendo' :/);

    /* Duas linhas realçadas não dizem qual vale. Quando a escolha desvia da ordem, o
       destaque é dela e o antigo próximo fica apagado — sem sumir, porque a vez é dele. */
    assert.match(lista, /const preterido = ehProximo && escolhido && escolhido !== id;/);
    assert.match(css, /\.external-queue li\.is-next\.is-superseded \{ border-color: var\(--actuar-border\); background: var\(--actuar-surface\); \}/);
    assert.match(css, /\.external-queue li\.is-picked \{[^}]*var\(--actuar-primary\)/);

    /* A escolha é daquele encaminhamento, não uma preferência guardada: só a fila do painel
       de distribuição é clicável, e as versões de aviso (pausado, ocupado, sem elegível)
       seguem sendo lista de leitura. */
    const painel = html.slice(html.indexOf('function externalDistributionPanel('), html.indexOf('async function externalResumeRotation()'));
    assert.match(painel, /const fila = externalQueueList\(view, users, item, false\);/);
    assert.match(painel, /\$\{externalQueueList\(view, users, item, true\)\}`;/);
});

test('fora da ordem avisa antes, pede motivo e não empurra ninguém para trás', () => {
    const painel = html.slice(html.indexOf('function externalDistributionPanel('), html.indexOf('async function externalResumeRotation()'));
    // O cabeçalho passa a dizer para quem VAI, e destaca quando não é o próximo.
    assert.match(painel, /const foraDaOrdem = destinoId !== view\.next;/);
    assert.match(painel, /Escolhido em \$\{escapeHtml\(teamLabel\(item\.team\)\)\}/);
    assert.match(painel, /fora da ordem, à frente de/);
    // O rótulo do botão não esconde o pedágio, e há caminho de volta em um clique.
    assert.match(painel, /\$\{foraDaOrdem \? 'Encaminhar com motivo' : 'Encaminhar'\}/);
    assert.match(painel, /Voltar à ordem/);

    const assign = html.slice(html.indexOf('async function externalAssign()'), html.indexOf('async function externalSkipNext()'));
    // Motivo pedido ANTES de mexer em qualquer coisa, e desistir ali não deixa rastro.
    assert.match(assign, /input: \{ label: 'Por que esta pessoa\?'/);
    assert.match(assign, /if \(!motivoOrdem\) return;/);
    assert.ok(assign.indexOf("if (!motivoOrdem) return;") < assign.indexOf('const rotacaoAnterior'), 'o motivo vem antes do snapshot');
    assert.match(assign, /continua na frente: ninguém perde a vez/);

    // O destino do encaminhamento é o escolhido, nos três lugares que precisam concordar.
    assert.match(assign, /PriorityRotation\.assign\(deepClone\(rotacaoAnterior\), destinoId, currentAdminId, briefing, Date\.now\(\), null, \{ outOfTurnReason: motivoOrdem \}\)/);
    assert.match(assign, /patch: \{ analystId: destinoId, attendanceId: PriorityRotation\.activeOf\(rodizio, destinoId\)\?\.id \|\| null, assignedAt: Date\.now\(\) \}/);
    assert.match(assign, /Encaminhada para \$\{analista\?\.name \|\| destinoId\} fora da ordem do rodízio: \$\{motivoOrdem\}/);
    assert.doesNotMatch(assign, /view\.next, currentAdminId, briefing/, 'não pode sobrar caminho encaminhando ao próximo por engano');

    // A escolha morre com o encaminhamento e ao trocar de solicitação: a próxima começa
    // pela ordem, e não com alguém escolhido pensando em outro cliente.
    assert.match(html, /if \(externalOpenId !== id\) externalAssigneeId = null;/);
    assert.match(assign, /externalAssigneeId = null;/);
    const escolha = html.slice(html.indexOf('let externalAssigneeId = null;'), html.indexOf('function externalQueueList('));
    assert.match(escolha, /const elegivel = escolhido && \(view\?\.queue \|\| \[\]\)\.includes\(escolhido\) && !ocupados\.has\(escolhido\);/,
        'se a fila mudar embaixo da escolha, ela volta a ser o próximo');
    assert.match(escolha, /return elegivel \? escolhido : \(view\?\.next \|\| null\);/);

    // E o desvio aparece no histórico do rodízio com nome próprio.
    assert.match(html, /turn_overridden: \['Escolha fora da ordem', 'user-add'\]/);
});

test('a tag do card diz por que a solicitação não anda, não o nome da coluna', () => {
    /* Repetir o nome da coluna não acrescenta nada — o card já está dentro dela. O que a
       coluna NÃO diz é se a fila está pausada, ocupada ou pronta, e com quem o atendimento
       está. É isso que precisa caber num relance. */
    const tag = html.slice(html.indexOf('function externalCardTag(item)'), html.indexOf('function externalCard(item)'));
    for (const situacao of ['Rodízio pausado', 'Fila ocupada', 'Sem analista', 'Sem fila', 'Pronta para']) {
        assert.ok(tag.includes(situacao), `a tag não cobre "${situacao}"`);
    }
    // Em atendimento, quem importa é com quem está.
    assert.match(tag, /etapa === 'em_atendimento'[\s\S]*users\[item\.analystId\]/);
    // A cor vem de token, e o card usa a badge do Design System.
    assert.match(html, /actuar-badge-\$\{escapeHtml\(tag\.tone\)\} external-card-tag/);
});

test('a fila aparece dentro da ficha, com posição e quem está pausado', () => {
    const fila = html.slice(html.indexOf('function externalQueueList('), html.indexOf('function externalDistributionPanel('));
    assert.match(fila, /view\.paused/, 'quem está pausado precisa se distinguir de quem espera');
    assert.match(fila, /id === view\.next/, 'o próximo precisa se destacar');
    assert.match(fila, /lastCompleted/, 'saber quem atendeu por último explica a ordem atual');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(css, /\.external-queue li\.is-next/);
});

test('rodízio pausado se resolve na própria ficha', () => {
    /* Mandar a gestão para outra tela e voltar é o vaivém em que a solicitação fica
       esquecida — exatamente o que o quadro existe para acabar. */
    const painel = html.slice(html.indexOf('function externalDistributionPanel(item)'), html.indexOf('async function externalResumeRotation()'));
    assert.match(painel, /onclick="externalResumeRotation\(\)"/);
    const retomar = html.slice(html.indexOf('async function externalResumeRotation()'), html.indexOf('/* Encaminhar move duas coisas'));
    assert.match(retomar, /PriorityRotation\.setPaused\(rodizio, false/);
    assert.match(retomar, /persistPriorityRotationMutation/, 'a retomada usa o caminho com rollback do rodízio');
});

/* O CICLO FECHA PELO CAMINHO QUE JÁ EXISTIA
   O analista não ganha tela nova nem selo de "veio de fora": para ele é um atendimento
   prioritário como qualquer outro, porque o trabalho é o mesmo. A entrega acontece pelo
   briefing do rodízio, e a conclusão pelo registro de prioridade de sempre. */

test('o analista recebe pelo briefing do rodízio, sem experiência paralela', () => {
    const brief = html.slice(html.indexOf('function renderPriorityAttendanceCard(attendance)'), html.indexOf('function renderPriorityRotationPrimary(view'));
    for (const campo of ['demand', 'clientName', 'clientId', 'phone', 'instructions']) {
        assert.ok(brief.includes(`briefing.${campo}`), `o analista precisa ver ${campo}`);
    }
    // Nenhuma tela de analista consulta a lista de solicitações externas.
    const analista = html.slice(html.indexOf('function renderMyPriorityRequests()'), html.indexOf('function renderAdminPriorityRequests()'));
    assert.doesNotMatch(analista, /externalRequests|ExternalRequests/);
});

test('concluir o atendimento leva a solicitação para aprovação, não para concluída', () => {
    /* O analista não aprova a própria pontuação. E sem esta ligação ele concluiria enquanto
       o quadro da gestão seguiria dizendo "em atendimento" para sempre. */
    const vincula = html.slice(html.indexOf('function vincularSolicitacaoExterna('), html.indexOf('/* A aprovação da prioridade fecha'));
    assert.match(vincula, /item\.attendanceId === attendanceId/, 'a ligação é pelo id do atendimento do rodízio');
    // Aceita as duas: o cliente pode ter voltado a responder e o analista concluir dali.
    assert.match(vincula, /\['em_atendimento', 'sem_retorno'\]\.includes\(dominio\.stageOf\(item\)\)/);
    assert.match(vincula, /'aguardando_aprovacao'/);
    assert.match(vincula, /priorityRequestId: requestId/, 'guarda qual prioridade representa a conclusão');
    // E é chamada exatamente onde o rodízio é concluído.
    assert.match(html, /appStore\.priorityRotations\[team\] = completed;[\s\S]{0,900}vincularSolicitacaoExterna\(meuAtendimento\.id, requestId\)/);
});

test('a aprovação fecha a solicitação junto, sem pontuação paralela', () => {
    const aprova = html.slice(html.indexOf('async function approvePriorityRequest('), html.indexOf('function rejectPriorityRequest('));
    assert.match(aprova, /concluirSolicitacaoExterna\(req\.id, true\)/);
    /* O crédito deixou de ser um 50 literal: a gestão decide a pontuação na aprovação, e o
       padrão vive em PRIORITY_DEFAULT_POINTS. Continua sendo UM crédito, do mesmo tipo e
       para o mesmo analista — o que este teste guarda é a ausência de pontuação paralela. */
    assert.match(aprova, /type: "PRIORITY", userId: req\.userId, value: creditados/);
    assert.match(aprova, /const creditados = Number\.isFinite\(Number\(points\)\) && Number\(points\) >= 0 \? Math\.round\(Number\(points\)\) : PRIORITY_DEFAULT_POINTS;/,
        'valor inválido precisa cair no padrão, nunca virar NaN em cima do extrato');
    assert.match(html, /const PRIORITY_DEFAULT_POINTS = 50;/);
    // Falha no salvamento desfaz os dois lados.
    assert.match(aprova, /appStore\.externalRequests = externaAnterior;/);

    const fecha = html.slice(html.indexOf('function concluirSolicitacaoExterna('), html.indexOf('function externalFilters('));
    assert.match(fecha, /aprovada \? 'concluida' : 'em_atendimento'/, 'reprovar devolve ao atendimento, não descarta');
    assert.match(fecha, /stageOf\(item\) === 'aguardando_aprovacao'/, 'só fecha o que está esperando decisão');
});

test('a gestão aprova pela própria tela, mas quem credita é o fluxo de sempre', () => {
    /* Duplicar a concessão de pontos criaria duas verdades sobre a mesma prioridade — e a
       segunda inevitavelmente divergiria da primeira. */
    const aprovar = html.slice(html.indexOf('async function externalApproveWork()'), html.indexOf('async function externalReturnWork()'));
    assert.match(aprovar, /await approvePriorityRequest\(prioridade\.id/);
    assert.doesNotMatch(aprovar, /appStore\.logs\.push/, 'a tela não pode creditar ponto por conta própria');
    assert.match(aprovar, /50 pontos/, 'a confirmação diz o que vai acontecer');

    // Devolver não credita nada e reabre o atendimento.
    const devolver = html.slice(html.indexOf('async function externalReturnWork()'), html.indexOf('function externalActions('));
    assert.match(devolver, /'ajuste_solicitado'/);
    assert.match(devolver, /concluirSolicitacaoExterna\(prioridade\.id, false/);
    assert.match(devolver, /nenhum ponto é creditado/);
    assert.match(devolver, /restorePriorityRequestSnapshot[\s\S]*appStore\.externalRequests = anteriorExterna;/,
        'a falha desfaz os dois lados');

    // As decisões só aparecem na etapa que as espera.
    const acoes = html.slice(html.indexOf('function externalActions(item, dominio)'), html.indexOf('function closeExternalRequest()'));
    assert.match(acoes, /etapa === 'aguardando_aprovacao'[\s\S]*Aprovar e pontuar/);
    assert.match(acoes, /if \(etapa === 'concluida'\) return fechar;/);
});

/* EXCLUSÃO NO QUADRO — mesma régua de peças e lançamentos. */

test('a solicitação excluída arrasta o lançamento e os pontos que gerou', () => {
    /* Apagar só o card deixaria pontuação de um atendimento que não existe mais — o mesmo
       descasamento que a exclusão existe para desfazer. */
    const entrada = ext.deletionEntry(
        { ...base, id: 'e1', priorityRequestId: 'p1', status: 'concluida' },
        'marco', 'solicitação de teste',
        { removedLogs: [{ id: 'l1', value: 50 }, { id: 'l2', value: -10 }], now: 4000 }
    );
    assert.equal(entrada.removedPoints, 40, 'crédito menos ajuste');
    assert.deepEqual(entrada.removedLogIds, ['l1', 'l2']);
    assert.equal(entrada.priorityRequestId, 'p1');
    assert.equal(entrada.deletedAt, 4000);
    assert.equal(entrada.stage, 'concluida');
    // O snapshot preserva a solicitação inteira, desligada do original.
    assert.equal(entrada.record.id, 'e1');
});

test('exclusão sem motivo, sem autor ou sem solicitação é recusada', () => {
    assert.throws(() => ext.deletionEntry(base, 'marco', '  ', {}), /motivo/i);
    assert.throws(() => ext.deletionEntry(base, '', 'teste', {}), /não identificado/i);
    assert.throws(() => ext.deletionEntry(null, 'marco', 'teste', {}), /inválida/i);
    // Sem pontos envolvidos, não inventa estorno.
    assert.equal(ext.deletionEntry(base, 'marco', 'teste', {}).removedPoints, 0);
});

test('excluir do quadro exige motivo, senha e permissão, e desfaz tudo se falhar', () => {
    const excluir = html.slice(html.indexOf('async function externalDelete()'), html.indexOf('function externalActions('));
    assert.match(excluir, /if \(!canAuditDeletedPieces\(\)\)/, 'a permissão é conferida na execução');
    assert.match(excluir, /input: \{ label: 'Motivo da exclusão'/);
    assert.match(excluir, /verifyLoginRemote\(currentAdminId, senha\)/);
    // O aviso muda conforme o caso: pontos, lançamento ligado e atendimento em andamento.
    assert.match(excluir, /um analista está com este atendimento em andamento/);
    assert.match(excluir, /O lançamento de prioridade correspondente também é excluído/);
    // Quatro lados voltam juntos.
    assert.match(excluir, /appStore\.externalRequests = anterior\.externas;[\s\S]*appStore\.priorityRequests = anterior\.pedidos;[\s\S]*appStore\.logs = anterior\.logs;[\s\S]*appStore\.deletedExternalRequests = anterior\.excluidas;/);
});

test('o botão vive na ficha do quadro, e a auditoria no Histórico', () => {
    // Era só na ficha do lançamento; quem trabalha no quadro não o encontrava.
    assert.match(html, /external-delete-action" onclick="externalDelete\(\)/);
    assert.match(html, /actuar-btn-danger external-delete-action/);

    assert.match(html, /deletedExternalRequests: diffKeyedArray\(base\.deletedExternalRequests, local\.deletedExternalRequests\)/);
    assert.match(html, /merged\.deletedExternalRequests = applyKeyedArrayDiff/);
    const linhas = html.slice(html.indexOf('function historyRows()'), html.indexOf('function filteredHistoryRows()'));
    assert.match(linhas, /detail: `Solicitação \$\{escapeHtml\(item\.protocol/);
});

test('sem retorno é sobre o cliente, e tem saída dos dois lados', () => {
    const acoes = html.slice(html.indexOf('function externalActions(item, dominio)'), html.indexOf('function closeExternalRequest()'));
    // De em_atendimento dá para marcar; de sem_retorno dá para voltar ou encerrar.
    assert.match(acoes, /etapa === 'em_atendimento'[\s\S]*externalNoAnswer/);
    assert.match(acoes, /etapa === 'sem_retorno'[\s\S]*externalClientAnswered/);
    assert.match(acoes, /etapa === 'sem_retorno'[\s\S]*externalGiveUp/);

    const marcar = html.slice(html.indexOf('async function externalNoAnswer()'), html.indexOf('async function externalClientAnswered()'));
    assert.match(marcar, /input: \{ label: 'O que foi tentado\?'/, 'as tentativas sustentam encerrar depois sem parecer desistência');
    assert.match(marcar, /reasonRequired: true/);

    const encerrar = html.slice(html.indexOf('async function externalGiveUp()'), html.indexOf('async function externalApproveWork()'));
    assert.match(encerrar, /'cancelada'/, 'encerrar sai do fluxo, não vira conclusão');
    assert.match(encerrar, /sem pontuação/);
    assert.match(encerrar, /não perde a vez do rodízio/, 'a vez dele já foi concluída quando o atendimento começou');

    // E o card mostra o estado sem obrigar a abrir a ficha.
    const tag = html.slice(html.indexOf('function externalCardTag(item)'), html.indexOf('function externalCard(item)'));
    assert.match(tag, /etapa === 'sem_retorno'[\s\S]*Sem retorno/);
});

test('sem retorno não credita ponto: vai para validação da gestão', () => {
    const acao = html.slice(html.indexOf('async function externalConcludeNoAnswer()'), html.indexOf('async function externalGiveUp()'));

    /* A primeira versão desta ação creditava 50 pontos no clique — sem lançamento, sem passar
       pela fila de Aprovações e sem ficar no histórico de decisão. Um chamado em que o
       cliente nunca respondeu é exatamente o caso em que alguém precisa conferir se as
       tentativas aconteceram mesmo. */
    assert.doesNotMatch(acao, /type: 'PRIORITY'/, 'nenhum ponto pode ser creditado aqui');
    assert.doesNotMatch(acao, /appStore\.logs/, 'crédito é da tela de Aprovações, não desta');

    // O lançamento nasce PENDENTE e cai na fila onde a decisão já acontece.
    assert.match(acao, /status: 'pendente',/);
    assert.match(acao, /dominio\.transition\(item, 'aguardando_aprovacao'/);
    assert.match(acao, /patch: \{ priorityRequestId: lancamentoId \}/, 'é por esta chave que a aprovação acha a solicitação');
    assert.match(acao, /Nenhum ponto foi creditado ainda\./);

    /* E leva a ficha junto: é ela que sustenta a decisão de quem vai aprovar — as tentativas
       com a descrição do que foi enviado, e as notas. */
    assert.match(acao, /contactAttempts: deepClone\(tentativas\)/);
    assert.match(acao, /attendanceNotes: atendimento \? deepClone\(PriorityRotation\.notesOf\(atendimento\)\) : \[\]/);
    assert.match(acao, /resolution: 'unresolved', resolutionReason: 'no_answer'/);

    // A vez do analista é fechada: o atendimento ficou aberto só para poder retomar.
    assert.match(acao, /PriorityRotation\.resolveCurrent\(\s*\n?\s*anterior\.rodizio, 'end_move'/);
    // Falha ao salvar devolve os três lados.
    assert.match(acao, /appStore\.priorityRequests = anterior\.lancamentos;/);

    // O botão não promete o que não faz, e por isso não usa o verde de aprovação.
    assert.match(html, /class="actuar-btn actuar-btn-secondary" onclick="externalConcludeNoAnswer\(\)"><i class="fi fi-rr-paper-plane"><\/i>Enviar para aprovação<\/button>/);
});

test('as três saídas da esteira continuam existindo, e nenhuma some sem querer', () => {
    /* Ao reescrever a ação de enviar para aprovação, o recorte engoliu `externalGiveUp` —
       a função sumiu inteira e só um teste existente percebeu. */
    for (const fn of ['externalNoAnswer', 'externalClientAnswered', 'externalGiveUp', 'externalConcludeNoAnswer']) {
        assert.equal((html.match(new RegExp(`function ${fn}\\(`, 'g')) || []).length, 1, `${fn} precisa existir exatamente uma vez`);
    }
    // lastIndexOf: a primeira ocorrência é a das etiquetas do cartão, não a das ações.
    const acoes = html.slice(html.lastIndexOf("if (etapa === 'sem_retorno')"), html.indexOf("if (etapa === 'concluida') return fechar;"));
    for (const fn of ['externalGiveUp', 'externalConcludeNoAnswer', 'externalClientAnswered']) {
        assert.ok(acoes.includes(fn), `a esteira perdeu a saída ${fn}`);
    }
});
