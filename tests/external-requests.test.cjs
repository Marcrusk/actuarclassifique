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

test('o quadro tem as etapas do processo, e encerradas fora delas', () => {
    assert.equal(ext.STAGES.length, 8);
    /* "Sem retorno do cliente" é etapa própria: sem ela, um chamado parado há dias esperando
       o cliente ficava indistinguível de trabalho em andamento — e cobrava o analista por
       algo que não depende dele. */
    assert.deepEqual(ext.STAGE_IDS, ['nova', 'triagem', 'aguardando_info', 'aguardando_distribuicao', 'em_atendimento', 'sem_retorno', 'aguardando_aprovacao', 'concluida']);
    assert.equal(ext.stageMeta('sem_retorno').tone, 'warning');
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
    assert.match(assign, /analystId: view\.next/);
    assert.match(assign, /attendanceId: rodizio\.current\?\.id/);
});

test('fila ocupada faz a solicitação esperar, não furar', () => {
    const painel = html.slice(html.indexOf('function externalDistributionPanel(item)'), html.indexOf('async function externalAssign()'));
    assert.match(painel, /if \(view\.current\)/, 'com atendimento em andamento não se distribui');
    assert.match(painel, /aguarda a vez ficar livre/);
    // Cada impedimento se explica: pausado, sem fila e sem elegível dizem coisas diferentes.
    assert.match(painel, /Rodízio pausado/);
    assert.match(painel, /Rodízio indisponível/);
    assert.match(painel, /Ninguém disponível/);
});

test('a exceção é pular com motivo, não escolher fora da ordem', () => {
    /* O rodízio recusa destino que não seja o próximo (`not_next`). Furar isso em código
       seria desfazer, por conveniência, a regra que dá confiança à fila. */
    const skip = html.slice(html.indexOf('async function externalSkipNext()'), html.indexOf('function externalActions('));
    assert.match(skip, /PriorityRotation\.skip\(/);
    assert.match(skip, /input: \{ label: 'Por que pular\?'/, 'pular sem motivo não pode');
    assert.match(skip, /não perde a vez/, 'quem é pulado vai para o fim, não perde a vez');
    assert.doesNotMatch(html, /assign\([^)]*escolhido/, 'não deve existir caminho para furar a fila');
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
    const brief = html.slice(html.indexOf('const briefing = view.current.briefing;'), html.indexOf('return `<section class="rotation-ops-primary is-current">'));
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
    assert.match(html, /appStore\.priorityRotations\[team\] = completed;[\s\S]{0,700}vincularSolicitacaoExterna\(rotationBefore\.current\.id, requestId\)/);
});

test('a aprovação fecha a solicitação junto, sem pontuação paralela', () => {
    const aprova = html.slice(html.indexOf('async function approvePriorityRequest('), html.indexOf('showToast("Prioridade aprovada!'));
    assert.match(aprova, /concluirSolicitacaoExterna\(req\.id, true\)/);
    // O crédito continua sendo o de sempre: mesma prioridade, mesma régua.
    assert.match(aprova, /type: "PRIORITY", userId: req\.userId, value: 50/);
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
