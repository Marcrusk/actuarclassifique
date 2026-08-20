const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/external-requests.js');
const R = require('../js/priority-rotation.js');

/* ==========================================================================
   O PROCESSO INTEIRO, PONTA A PONTA
   Os outros testes cobrem cada peça. Este percorre o caminho que uma pessoa
   percorre — Portal, triagem, rodízio, ficha do analista, aprovação — porque foi
   entre duas peças certas que o processo travou: o produto era exigido pelo
   rodízio e ninguém passava a marca que o Portal já tinha coletado.

   As chamadas espelham as que o shell faz em cada passo.
   ========================================================================== */

const T = 1_700_000_000_000;
const solicitacao = (extra = {}) => ({
    id: 'ext1', protocol: 'PRI-2026-90001', status: 'aguardando_triagem',
    clientName: 'Academia Teste', clientId: 'TX1231', phone: '(62) 93523-5255',
    brand: 'Actuar', team: 'Sistema', requesterDepartment: 'Comercial',
    need: 'Catraca travando na virada do dia.', createdAt: T, events: [], ...extra
});
const briefingDe = (item) => ({
    demand: item.need, product: item.brand, clientName: item.clientName,
    clientId: item.clientId, phone: item.phone,
    instructions: `Solicitação ${item.protocol}, registrada pela área ${item.requesterDepartment}.`
});

test('do registro no Portal até a pontuação, sem bloqueio no meio', () => {
    let t = T;
    const mv = (item, proximo, opcoes = {}) => E.transition(item, proximo, { now: ++t, actorName: 'Gestão', ...opcoes });

    // 1. O Portal grava 'aguardando_triagem'; o quadro traduz para a primeira coluna.
    let externa = solicitacao();
    assert.equal(E.stageOf(externa), 'nova');

    // 2. A gestão tria e valida.
    externa = mv(externa, 'triagem');
    externa = mv(externa, 'aguardando_distribuicao');
    assert.equal(E.stageOf(externa), 'aguardando_distribuicao');

    // 3. Encaminha pelo rodízio. Foi aqui que travava: a marca do Portal É o produto.
    let rodizio = R.create('Sistema', ['arthur', 'pedro_m', 'pedro_g'], t);
    const proximo = R.view(rodizio).next;
    assert.equal(proximo, 'arthur');
    rodizio = R.assign(rodizio, proximo, 'gestor', briefingDe(externa), ++t);
    const atendimento = R.activeOf(rodizio, 'arthur');
    assert.equal(atendimento.briefing.product, 'Actuar', 'o produto tem de chegar do Portal');
    externa = mv(externa, 'em_atendimento', { patch: { analystId: 'arthur', attendanceId: atendimento.id } });

    // 4. O analista registra o andamento na ficha — e só na dele.
    rodizio = R.logContact(rodizio, 'arthur', { channel: 'call', result: 'no_answer', note: 'caixa postal' }, ++t);
    rodizio = R.logContact(rodizio, 'arthur', { channel: 'whatsapp', result: 'answered', note: 'mensagem sobre a integração' }, ++t);
    rodizio = R.addNote(rodizio, 'arthur', 'Orientado a atualizar o firmware.', ++t);
    assert.equal(R.activeOf(rodizio, 'pedro_m'), null, 'ninguém escreve na ficha de outro');

    // 5. Conclui. O que a ficha reuniu tem de sobreviver à saída do rodízio.
    const antes = R.activeOf(rodizio, 'arthur');
    rodizio = R.complete(rodizio, 'arthur', 'pr1', ++t, { resolution: 'resolved', reason: 'guidance', detail: 'Cliente orientado e catraca normalizada.' });
    assert.equal(R.activeOf(rodizio, 'arthur'), null);
    assert.equal(rodizio.queue[rodizio.queue.length - 1], 'arthur', 'quem concluiu vai para o fim da fila');
    const lancamento = {
        id: 'pr1', userId: 'arthur', protocolo: '202608-4455', status: 'pendente',
        contactAttempts: R.attemptsOf(antes), attendanceNotes: R.notesOf(antes),
        resolution: rodizio.lastCompleted.resolution
    };
    assert.equal(lancamento.contactAttempts.length, 2);
    assert.equal(lancamento.attendanceNotes.length, 1);

    /* Vai para aprovação, não para concluída: o analista não aprova a própria pontuação. */
    externa = mv(externa, 'aguardando_aprovacao', { patch: { priorityRequestId: lancamento.id }, actorName: 'Arthur' });
    assert.equal(E.stageOf(externa), 'aguardando_aprovacao');

    // 6. A gestão aprova, e a solicitação fecha junto com o lançamento.
    assert.equal(externa.priorityRequestId, lancamento.id, 'é por esta chave que a aprovação acha a solicitação');
    externa = mv(externa, 'concluida');
    assert.equal(E.stageOf(externa), 'concluida');

    // 7. A área acompanhou tudo, e no fim não age mais.
    assert.ok(E.belongsToArea(externa, 'Comercial'));
    assert.equal(E.canAreaCancel(externa), false);
    assert.equal(E.canAreaRespond(externa), false);
    assert.equal(externa.events.length, 5, 'cada passo deixou um evento na linha do tempo');

    // E o quadro mostra a solicitação numa coluna só, do início ao fim.
    const quadro = E.board([externa]);
    assert.deepEqual(quadro.stages.filter(coluna => coluna.items.length).map(coluna => coluna.id), ['concluida']);
});

test('devolver para complemento fecha o ciclo sem ninguém avisar por fora', () => {
    let t = T;
    const mv = (item, proximo, opcoes = {}) => E.transition(item, proximo, { now: ++t, actorName: 'Gestão', ...opcoes });
    let externa = mv(mv(solicitacao(), 'triagem'), 'aguardando_info', { reason: 'Falta o número de série.', reasonRequired: true });

    assert.equal(E.canAreaRespond(externa), true, 'é a área que responde o que a gestão pediu');
    externa = mv(externa, 'triagem', { actorName: 'Kamilla · Comercial', reason: 'Série 998877', reasonRequired: true });
    assert.equal(E.stageOf(externa), 'triagem', 'e a resposta devolve à triagem');
});

test('cliente some e volta: o analista não perde a vez', () => {
    let t = T;
    const mv = (item, proximo, opcoes = {}) => E.transition(item, proximo, { now: ++t, actorName: 'Gestão', ...opcoes });
    let rodizio = R.create('Sistema', ['arthur', 'pedro'], t);
    let externa = mv(mv(solicitacao(), 'triagem'), 'aguardando_distribuicao');
    rodizio = R.assign(rodizio, 'arthur', 'gestor', briefingDe(externa), ++t);
    externa = mv(externa, 'em_atendimento', { patch: { analystId: 'arthur', attendanceId: R.activeOf(rodizio, 'arthur').id } });

    externa = mv(externa, 'sem_retorno', { reason: 'duas ligações sem resposta', reasonRequired: true });
    assert.notEqual(R.activeOf(rodizio, 'arthur'), null, 'a espera é do cliente: o atendimento dele segue aberto');
    assert.equal(E.canAreaCancel(externa), false, 'e a área não cancela o que já está com o analista');

    externa = mv(externa, 'em_atendimento', { text: 'O cliente respondeu. Atendimento retomado.' });
    assert.equal(E.stageOf(externa), 'em_atendimento');

    /* Concluir de dentro de "sem retorno" também precisa vincular — o cliente pode ter
       voltado a responder sem que ninguém movesse o card de volta na mão. */
    const daquela = mv(solicitacao({ status: 'sem_retorno', attendanceId: 'att1' }), 'aguardando_aprovacao', { patch: { priorityRequestId: 'pr9' }, actorName: 'Arthur' });
    assert.equal(E.stageOf(daquela), 'aguardando_aprovacao');
});

test('reprovar devolve ao atendimento, e cancelar sai do quadro', () => {
    let t = T;
    const mv = (item, proximo, opcoes = {}) => E.transition(item, proximo, { now: ++t, actorName: 'Gestão', ...opcoes });

    let reprovada = mv(solicitacao({ status: 'aguardando_aprovacao', priorityRequestId: 'pr9' }), 'em_atendimento', { reason: 'protocolo errado' });
    assert.equal(E.stageOf(reprovada), 'em_atendimento', 'reprovar não descarta: devolve para o analista');

    const cancelada = mv(solicitacao(), 'cancelada', { actorName: 'Kamilla · Comercial', reason: 'cliente resolveu por outro canal', reasonRequired: true });
    const quadro = E.board([cancelada]);
    assert.equal(quadro.closed.length, 1);
    assert.ok(quadro.stages.every(coluna => !coluna.items.length), 'encerrada não ocupa coluna do funil');
});

test('dois chamados do Portal andam ao mesmo tempo', () => {
    let t = T;
    let rodizio = R.create('Sistema', ['arthur', 'pedro'], t);
    const brief = n => briefingDe(solicitacao({ clientId: `TX000${n}`, need: `demanda ${n}` }));

    rodizio = R.assign(rodizio, 'arthur', 'gestor', brief(1), ++t);
    assert.equal(R.view(rodizio).next, 'pedro', 'com Arthur ocupado, a vez anda');
    rodizio = R.assign(rodizio, 'pedro', 'gestor', brief(2), ++t);
    assert.equal(R.activeList(rodizio).length, 2, 'o segundo não espera o primeiro acabar');
});

test('sem retorno é esteira, não conclusão: o card espera a gestão', () => {
    let t = T;
    const mv = (item, proximo, opcoes = {}) => E.transition(item, proximo, { now: ++t, actorName: 'Gestão', ...opcoes });

    let rodizio = R.create('Sistema', ['arthur', 'pedro'], t);
    let externa = mv(mv(solicitacao(), 'triagem'), 'aguardando_distribuicao');
    rodizio = R.assign(rodizio, 'arthur', 'gestor', briefingDe(externa), ++t);
    const atendimento = R.activeOf(rodizio, 'arthur');
    externa = mv(externa, 'em_atendimento', { patch: { analystId: 'arthur', attendanceId: atendimento.id } });

    /* Era aqui que o caso descarrilava: sem porta própria, o analista concluía com "sem
       retorno" e concluir manda para APROVAÇÃO — o chamado terminava aprovado e pontuado
       sem ninguém ter falado com o cliente. */
    assert.throws(() => R.complete(rodizio, 'arthur', 'p1', ++t, { resolution: 'unresolved', reason: 'no_answer', detail: 'não respondeu' }),
        /use "Marcar sem retorno" na ficha/);

    for (let i = 1; i <= 3; i += 1) {
        rodizio = R.logContact(rodizio, 'arthur', { channel: 'whatsapp', result: 'no_answer', note: `mensagem ${i} sobre a integração` }, ++t);
    }
    rodizio = R.markNoAnswer(rodizio, 'arthur', ++t);
    externa = mv(externa, 'sem_retorno', { actorName: 'Arthur', reason: '3 tentativas sem resposta', reasonRequired: true });

    assert.equal(E.stageOf(externa), 'sem_retorno', 'o card cai na esteira certa');
    assert.notEqual(R.activeOf(rodizio, 'arthur'), null, 'e o atendimento continua com ele');
    assert.equal(E.board([externa]).stages.find(coluna => coluna.id === 'sem_retorno').items.length, 1);

    // Saída 1: o cliente respondeu — retoma com quem já conduzia.
    const retomado = R.resumeFromNoAnswer(rodizio, 'arthur', ++t);
    assert.equal(R.activeOf(retomado, 'arthur').noAnswerAt, undefined);
    assert.equal(E.stageOf(mv(externa, 'em_atendimento')), 'em_atendimento');

    // Saída 2: a gestão valida as tentativas e conclui, pontuando o trabalho feito.
    const fechado = R.resolveCurrent(rodizio, 'end_move', 'gestor', 'tentativas suficientes', ++t, atendimento.id);
    assert.equal(R.activeOf(fechado, 'arthur'), null, 'a vez dele é fechada, senão fica preso na fila');
    assert.equal(E.stageOf(mv(externa, 'concluida', { reason: 'tentativas suficientes' })), 'concluida');

    // Saída 3: encerrar sem pontuação continua existindo, e sai do funil.
    assert.ok(E.isClosed(E.stageOf(mv(externa, 'cancelada', { reason: 'cliente não retornou' }))));
});
