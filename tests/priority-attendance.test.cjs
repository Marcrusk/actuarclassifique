const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const R = require('../js/priority-rotation.js');

/* ==========================================================================
   FICHA DO ATENDIMENTO PRIORITÁRIO
   Encerrar um atendimento pedia protocolo e justificativa — dois campos de uma
   linha, num card solto que nem sabia qual atendimento estava em curso. Nada do
   que aconteceu no meio tinha onde ser escrito, e a gestão aprovava pontos
   sabendo só o número do protocolo. O manual pedia "até 3 tentativas de contato"
   numa regra que nenhuma tela conseguia cumprir nem conferir.
   ========================================================================== */

const html = () => fs.readFileSync('index.html', 'utf8');
const AGORA = 1_700_000_000_000;
const BRIEFING = { demand: 'Catraca travada', product: 'Toletus', clientName: 'Theron Fit', clientId: 'TZ2345', phone: '(62) 99999-9999', instructions: 'Ligar antes das 18h' };

function emAtendimento() {
    let r = R.create('Sistema', ['ana', 'bruno', 'caio'], AGORA);
    return R.assign(r, 'ana', 'gestor', BRIEFING, AGORA);
}
const DESFECHO_OK = { resolution: 'resolved', reason: 'guidance', detail: 'Cliente orientado por telefone.' };

test('encerrar exige desfecho: sem ele, volta a ser um protocolo sem história', () => {
    const r = emAtendimento();
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA), /Escolha se o atendimento foi resolvido/);
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, { resolution: 'resolved' }), /Escolha como o atendimento foi resolvido/);
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, { resolution: 'unresolved', reason: 'third_party' }), /pelo menos 10 caracteres/);
});

test('resolvido pergunta COMO; não resolvido pergunta POR QUÊ, e os motivos não se cruzam', () => {
    const r = emAtendimento();
    // "sem retorno do cliente" não pode ser oferecido a quem acabou de resolver.
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, { resolution: 'resolved', reason: 'no_answer', detail: 'texto suficiente' }),
        /Escolha como o atendimento foi resolvido/);
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, { resolution: 'unresolved', reason: 'guidance', detail: 'texto suficiente' }),
        /Escolha por que o atendimento não foi resolvido/);

    assert.deepEqual(R.RESOLUTION_REASONS.resolved, ['guidance', 'fix_applied', 'part_dispatched', 'forwarded']);
    assert.deepEqual(R.RESOLUTION_REASONS.unresolved, ['no_answer', 'third_party', 'out_of_scope', 'rescheduled']);
    // Todo motivo tem rótulo: um select com a chave crua vazaria o vocabulário interno.
    for (const chave of [...R.RESOLUTION_REASONS.resolved, ...R.RESOLUTION_REASONS.unresolved]) {
        assert.ok(R.RESOLUTION_REASON_LABEL[chave], `motivo sem rótulo: ${chave}`);
    }
});

test('dar o cliente como sem retorno exige as 3 tentativas do manual', () => {
    let r = emAtendimento();
    const semRetorno = { resolution: 'unresolved', reason: 'no_answer', detail: 'Cliente não respondeu em nenhum canal.' };

    assert.equal(R.NO_ANSWER_MIN_ATTEMPTS, 3);
    assert.deepEqual(R.noAnswerProgress(R.activeOf(r, 'ana')), { done: 0, required: 3, missing: 3, allowed: false });
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, semRetorno), /Registre 3 tentativas de contato .* Há 0\./);

    r = R.logContact(r, 'ana', { channel: 'call', result: 'no_answer' }, AGORA + 1);
    r = R.logContact(r, 'ana', { channel: 'whatsapp', result: 'no_answer' }, AGORA + 2);
    assert.deepEqual(R.noAnswerProgress(R.activeOf(r, 'ana')), { done: 2, required: 3, missing: 1, allowed: false });
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, semRetorno), /Há 2\./);

    r = R.logContact(r, 'ana', { channel: 'email', result: 'no_answer' }, AGORA + 3);
    const fim = R.complete(r, 'ana', 'p1', AGORA + 4, semRetorno);
    assert.equal(fim.lastCompleted.resolutionReason, 'no_answer');
});

test('a exigência das tentativas vale só para "sem retorno" — os outros sete não dependem de ligar', () => {
    const r = emAtendimento();
    for (const reason of ['third_party', 'out_of_scope', 'rescheduled']) {
        const fim = R.complete(r, 'ana', `p-${reason}`, AGORA, { resolution: 'unresolved', reason, detail: 'Descrição suficiente do caso.' });
        assert.equal(fim.lastCompleted.resolutionReason, reason);
    }
    const resolvido = R.complete(r, 'ana', 'p-ok', AGORA, DESFECHO_OK);
    assert.equal(resolvido.lastCompleted.resolution, 'resolved');
});

test('só o dono escreve na ficha, e tentativa precisa de canal e resultado válidos', () => {
    const r = emAtendimento();
    assert.throws(() => R.logContact(r, 'bruno', { channel: 'call', result: 'no_answer' }, AGORA), /pertence a outro analista/);
    assert.throws(() => R.addNote(r, 'bruno', 'nota', AGORA), /pertence a outro analista/);
    assert.throws(() => R.logContact(r, 'ana', { channel: 'pombo', result: 'no_answer' }, AGORA), /Escolha o canal do contato/);
    assert.throws(() => R.logContact(r, 'ana', { channel: 'call', result: 'talvez' }, AGORA), /Escolha o resultado do contato/);
    assert.throws(() => R.addNote(r, 'ana', '  ', AGORA), /Escreva a nota antes de salvar/);

    // Sem atendimento em andamento não há ficha para escrever.
    const parado = R.create('Sistema', ['ana'], AGORA);
    assert.throws(() => R.logContact(parado, 'ana', { channel: 'call', result: 'no_answer' }, AGORA), /Não existe atendimento em andamento/);
});

test('tentativas e notas ficam no atendimento concluído, com autor e horário', () => {
    let r = emAtendimento();
    r = R.logContact(r, 'ana', { channel: 'call', result: 'no_answer', note: 'caixa postal' }, AGORA + 1);
    r = R.addNote(r, 'ana', 'Cliente pediu retorno depois das 15h.', AGORA + 2);

    const [tentativa] = R.attemptsOf(R.activeOf(r, 'ana'));
    assert.equal(tentativa.channel, 'call');
    assert.equal(tentativa.note, 'caixa postal');
    assert.equal(tentativa.byId, 'ana');
    assert.equal(tentativa.at, AGORA + 1);

    /* `complete()` limpa `rotation.current`, então o que a ficha reuniu tem de sobreviver
       em `lastCompleted` — é de lá que o lançamento copia para chegar à gestão. */
    const fim = R.complete(r, 'ana', 'p1', AGORA + 3, DESFECHO_OK);
    assert.deepEqual(R.activeList(fim), [], 'concluir tira o atendimento da lista de abertos');
    assert.equal(R.attemptsOf(fim.lastCompleted).length, 1);
    assert.equal(R.notesOf(fim.lastCompleted).length, 1);
    assert.equal(fim.lastCompleted.resolutionDetail, DESFECHO_OK.detail);
});

test('cada escrita na ficha vira evento auditável do rodízio', () => {
    let r = emAtendimento();
    r = R.logContact(r, 'ana', { channel: 'call', result: 'answered' }, AGORA + 1);
    r = R.addNote(r, 'ana', 'Combinado retorno amanhã.', AGORA + 2);
    const tipos = r.events.map(e => e.type);
    assert.ok(tipos.includes('contact_attempted'));
    assert.ok(tipos.includes('attendance_noted'));
    // O evento diz o que foi tentado, para o histórico não depender de abrir a ficha.
    assert.equal(r.events.find(e => e.type === 'contact_attempted').reason, 'Ligação · Falou com o cliente');
});

test('a ficha substitui o formulário solto e só abre para quem está atendendo', () => {
    const doc = html();

    assert.match(doc, /id="priorityAttendanceModal"/);
    assert.match(doc, /onclick="openPriorityAttendanceRecord\(\)"><i class="fi fi-rr-clipboard-list"><\/i>Abrir ficha do atendimento/);
    assert.ok(!doc.includes('focusPriorityForm'), 'a função que rolava até o card solto sobrou');

    /* A guarda da tela não substitui a do domínio: serve para não OFERECER o que seria
       recusado depois. Quem está em Modo Gestão não escreve na ficha de ninguém. */
    const dono = doc.slice(doc.indexOf('function currentOwnAttendance()'), doc.indexOf('function openPriorityAttendanceRecord()'));
    assert.match(dono, /if \(isAdminLoggedIn\) return null;/);
    assert.match(dono, /PriorityRotation\.activeOf\(rotation, currentActiveUser\)/);

    // Se o atendimento acabar por fora, a ficha fecha em vez de mostrar botões mortos.
    const render = doc.slice(doc.indexOf('function renderPriorityAttendanceRecord()'), doc.indexOf('function syncAttendanceResolutionReasons()'));
    assert.match(render, /if \(!atendimento\) \{ closePriorityAttendanceRecord\(\); return; \}/);
    // E o progresso das tentativas aparece antes de barrar.
    assert.match(render, /\$\{progresso\.done\} de \$\{progresso\.required\} registradas/);
});

test('o desfecho viaja com o lançamento até a gestão', () => {
    const doc = html();
    const envio = doc.slice(doc.indexOf('async function submitPriorityRequest('), doc.indexOf('let analystPriorityQuery'));

    assert.match(envio, /PriorityRotation\.complete\(rotationBefore, currentActiveUser, requestId, Date\.now\(\), desfecho\)/);
    for (const campo of ['request.resolution', 'request.resolutionReason', 'request.resolutionDetail', 'request.contactAttempts', 'request.attendanceNotes']) {
        assert.ok(envio.includes(campo), `o lançamento não leva ${campo}`);
    }
    /* A cópia lê o atendimento de ANTES da conclusão: concluir tira o registro de
       `rotation.active`, e ler depois traria vazio. */
    assert.match(envio, /deepClone\(PriorityRotation\.attemptsOf\(meuAtendimento\)\)/);

    // E a gestão vê isso na revisão, em vez de decidir só pelo protocolo.
    assert.match(doc, /function renderPriorityAttendanceEvidence\(request\)/);
    assert.match(doc, /\$\{renderPriorityAttendanceEvidence\(request\)\}/);
    // Lançamento anterior à ficha não finge ter dado.
    assert.match(doc, /Sem ficha de atendimento/);
});

test('a pontuação é decidida na aprovação, com padrão em constante', () => {
    const doc = html();
    assert.match(doc, /const PRIORITY_DEFAULT_POINTS = 50;/);
    assert.match(doc, /id="priorityReviewPoints"/);
    assert.match(doc, /async function approvePriorityRequest\(id, decisionNote = '', points = PRIORITY_DEFAULT_POINTS\)/);
    // Valor inválido cai no padrão em vez de gravar NaN no extrato de alguém.
    assert.match(doc, /const creditados = Number\.isFinite\(Number\(points\)\) && Number\(points\) >= 0 \? Math\.round\(Number\(points\)\) : PRIORITY_DEFAULT_POINTS;/);
    assert.match(doc, /if \(!Number\.isFinite\(pontos\) \|\| pontos < 0\) \{ showToast\('Informe uma pontuação válida\.', 'error'\); return; \}/);
});

test('a ficha trava o corpo da página, como as outras camadas do rodízio', () => {
    const doc = html();
    assert.match(doc, /const ids = \['priorityAttendanceModal', 'priorityRotationDrawer'/);
});

/* ==========================================================================
   ENCAMINHAMENTO: PRODUTO E FORMATO DOS CAMPOS
   O modal de despacho tinha inputs livres — "dgwegw" entrava como ID de cliente e
   "wetewtewtw" como telefone. E não perguntava a marca, embora o Portal de
   Prioridades já perguntasse: o mesmo atendimento chegava identificado pelo portal
   e anônimo pelo despacho interno.
   ========================================================================== */

const campos = require('../js/actuar-fields.js');

test('o produto é fechado em lista, e a lista mora no domínio', () => {
    assert.deepEqual(R.BRANDS, ['Actuar', 'Ediz', 'Toletus', 'Fácil Fit']);

    const r = R.create('Catraca', ['ana', 'bruno'], AGORA);
    const semProduto = { ...BRIEFING };
    delete semProduto.product;
    assert.throws(() => R.assign(r, 'ana', 'gestor', semProduto, AGORA), /Escolha o produto do atendimento/);
    /* Digitada livre, "Facil Fit", "fácil-fit" e "FÁCIL FIT" viram três produtos
       diferentes no primeiro relatório que agrupar por marca. */
    for (const errada of ['Facil Fit', 'fácil fit', 'FÁCIL FIT', 'Outra']) {
        assert.throws(() => R.assign(r, 'ana', 'gestor', { ...BRIEFING, product: errada }, AGORA), /Escolha o produto do atendimento/);
    }
    assert.equal(R.activeOf(R.assign(r, 'ana', 'gestor', BRIEFING, AGORA), 'ana').briefing.product, 'Toletus');
});

test('as marcas do Portal e as do despacho são as mesmas', () => {
    const doc = html();
    /* O Portal escreveu as dela à mão no HTML. Enquanto for assim, este teste é o que
       impede as duas telas da mesma empresa de discordarem sobre quais marcas existem. */
    const noPortal = [...doc.matchAll(/data-brand="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(noPortal, R.BRANDS);
    // E o despacho não escreve lista nenhuma: monta a partir do domínio.
    assert.match(doc, /PriorityRotation\.BRANDS\.map\(marca => `<option value="\$\{escapeHtml\(marca\)\}">/);
});

test('ID do cliente é sempre duas letras e quatro números', () => {
    assert.equal(campos.format('clientId', 'tz 23 45'), 'TZ2345');
    assert.equal(campos.validate('clientId', 'TZ2345').valid, true);

    /* A máscara CORRIGE o que dá para corrigir em vez de recusar: minúsculas viram
       maiúsculas e o excedente é cortado. Só sobra erro quando não há como formar
       duas letras e quatro números. */
    assert.equal(campos.format('clientId', 'TZ23456'), 'TZ2345', 'o excedente é cortado');
    assert.equal(campos.format('clientId', 'dgwegw'), 'DG', 'sem dígitos, sobram só as letras');

    for (const invalido of ['dgwegw', 'T2345', 'TZ234', '123456']) {
        const r = campos.validate('clientId', invalido);
        assert.equal(r.valid, false, `"${invalido}" deveria ser recusado`);
        assert.match(r.message, /duas letras e quatro números/);
    }
    // O campo do despacho está ligado à mesma regra, e não a uma cópia.
    assert.match(html(), /<input id="priorityDispatchClientId" data-field="clientId" required/);
});

test('telefone é sempre com DDD e 9', () => {
    assert.equal(campos.format('phone', '62999999999'), '(62) 99999-9999');
    assert.equal(campos.validate('phone', '(62) 99999-9999').valid, true);
    // Celular sem o 9, DDD que não existe, e número incompleto.
    assert.equal(campos.validate('phone', '(62) 8999-9999').valid, false);
    assert.equal(campos.validate('phone', '(00) 99999-9999').valid, false);
    assert.match(campos.validate('phone', '(62) 9999').message, /telefone com DDD/);

    /* Texto sem dígito nenhum — como o "wetewtewtw" que entrava antes — some na
       máscara e cai na exigência de preenchimento, porque o campo é `required` e
       `check()` lê isso do próprio input. */
    assert.equal(campos.format('phone', 'wetewtewtw'), '');
    assert.equal(campos.validate('phone', 'wetewtewtw', { required: true }).message, 'Preencha este campo.');

    assert.match(html(), /<input id="priorityDispatchPhone" data-field="phone" required/);
    assert.match(html(), /<input id="priorityDispatchClient" data-field="text" required/);
});

test('o despacho confere o formato antes de chegar ao domínio, e instruções ficam por último', () => {
    const doc = html();
    const confirma = doc.slice(doc.indexOf('async function confirmPriorityRotationDispatch('), doc.indexOf('function closePriorityRotationDrawer('));

    // O erro precisa aparecer NO campo; um toast genérico não diz qual está errado.
    assert.match(confirma, /ActuarFields\.validateScope\(document\.getElementById\('priorityRotationDispatchModal'\)\)/);
    assert.ok(confirma.indexOf('validateScope') < confirma.indexOf('const details ='), 'a checagem tem de vir antes do envio');
    assert.match(confirma, /product: document\.getElementById\('priorityDispatchProduct'\)\.value,/);
    // Sem bind() as máscaras não se ligam aos campos ao abrir.
    assert.match(doc, /if \(window\.ActuarFields\?\.bind\) ActuarFields\.bind\(modal\);/);

    // Ordem do formulário: demanda, produto, cliente, ID, telefone e instruções no fim.
    const form = doc.slice(doc.indexOf('id="priorityRotationDispatchModal"'), doc.indexOf('<!-- MODAL DE INTERVENÇÃO GERENCIAL NO RODÍZIO -->'));
    const ordem = ['priorityDispatchDemand', 'priorityDispatchProduct', 'priorityDispatchClient', 'priorityDispatchClientId', 'priorityDispatchPhone', 'priorityDispatchInstructions'];
    const posicoes = ordem.map(id => form.indexOf(`id="${id}"`));
    assert.deepEqual(posicoes, [...posicoes].sort((a, b) => a - b), 'a ordem dos campos do encaminhamento mudou');
});

test('o produto acompanha o atendimento até a auditoria', () => {
    const doc = html();
    // Card do rodízio, ficha do analista, revisão da gestão e detalhe da exclusão.
    assert.match(doc, /<small>Produto<\/small><strong>\$\{escapeHtml\(briefing\.product\)\}/);
    assert.match(doc, /\['Produto', briefing\.product\]/);
    assert.match(doc, /<dt>Produto<\/dt><dd>\$\{escapeHtml\(briefing\.product \|\| '—'\)\}/);
    assert.match(doc, /historyDetailPair\('Produto', briefing\.product\)/);
    // E o lançamento carrega o produto, senão ele morre com a vez concluída.
    assert.match(doc, /request\.product = meuAtendimento\.briefing\.product;/);
});

/* ==========================================================================
   ATENDIMENTOS SIMULTÂNEOS
   O rodízio guardava UM atendimento e `assign` recusava com "Já existe um
   atendimento em andamento". Numa hora de pico isso trava a operação: chegam
   vários chamados prioritários e o segundo espera o primeiro acabar, mesmo
   havendo gente livre na fila.
   ========================================================================== */

const TIME = ['ana', 'bruno', 'caio', 'duda'];
const fila = () => R.create('Sistema', TIME, AGORA);
const brief = (n) => ({ ...BRIEFING, demand: `demanda ${n}`, clientId: `TZ000${n}` });

test('vários analistas atendem ao mesmo tempo, e a vez anda para o próximo livre', () => {
    let r = fila();
    assert.equal(R.nextId(r), 'ana');

    r = R.assign(r, 'ana', 'gestor', brief(1), AGORA + 1);
    assert.equal(R.nextId(r), 'bruno', 'a vez precisa andar sem esperar ana concluir');
    r = R.assign(r, 'bruno', 'gestor', brief(2), AGORA + 2);
    r = R.assign(r, 'caio', 'gestor', brief(3), AGORA + 3);

    assert.deepEqual(R.activeList(r).map(item => item.analystId), ['ana', 'bruno', 'caio']);
    assert.equal(R.nextId(r), 'duda');
});

test('o limite é por pessoa: ninguém recebe um segundo chamado antes de fechar o primeiro', () => {
    let r = R.assign(fila(), 'ana', 'gestor', brief(1), AGORA + 1);
    assert.throws(() => R.assign(r, 'ana', 'gestor', brief(9), AGORA + 2), /Este analista já está com um atendimento em andamento/);
    assert.throws(() => R.start(r, 'ana', AGORA + 2), /Você já está com um atendimento em andamento/);
    // E continua valendo a ordem: não dá para saltar para o terceiro da fila.
    assert.throws(() => R.assign(r, 'caio', 'gestor', brief(9), AGORA + 2), /só pode ser encaminhado ao próximo da fila/);
});

test('com todos ocupados não há próximo, e a fila diz isso em vez de escolher alguém', () => {
    let r = fila();
    TIME.forEach((id, i) => { r = R.assign(r, id, 'gestor', brief(i), AGORA + i + 1); });
    assert.equal(R.nextId(r), null);
    assert.deepEqual(R.view(r).upcoming, []);
});

test('cada um escreve só na própria ficha, mesmo com várias abertas', () => {
    let r = R.assign(R.assign(fila(), 'ana', 'gestor', brief(1), AGORA + 1), 'bruno', 'gestor', brief(2), AGORA + 2);
    r = R.logContact(r, 'bruno', { channel: 'call', result: 'no_answer' }, AGORA + 3);
    r = R.addNote(r, 'ana', 'Nota da ana.', AGORA + 4);

    assert.equal(R.attemptsOf(R.activeOf(r, 'bruno')).length, 1);
    assert.equal(R.attemptsOf(R.activeOf(r, 'ana')).length, 0, 'a tentativa do bruno não pode cair na ficha da ana');
    assert.equal(R.notesOf(R.activeOf(r, 'ana')).length, 1);
    assert.equal(R.notesOf(R.activeOf(r, 'bruno')).length, 0);
});

test('concluir fecha só o próprio atendimento e devolve só a própria vez', () => {
    let r = R.assign(R.assign(fila(), 'ana', 'gestor', brief(1), AGORA + 1), 'bruno', 'gestor', brief(2), AGORA + 2);
    r = R.complete(r, 'bruno', 'p-bruno', AGORA + 3, DESFECHO_OK);

    assert.deepEqual(R.activeList(r).map(item => item.analystId), ['ana'], 'o atendimento da ana continua aberto');
    assert.equal(r.queue[r.queue.length - 1], 'bruno', 'só quem concluiu vai para o fim da fila');
    assert.equal(r.lastCompleted.analystId, 'bruno');
    // E ana segue no lugar dela, que ainda não concluiu.
    assert.equal(r.queue[0], 'ana');
});

test('a gestão encerra o atendimento de alguém sem tocar nos outros', () => {
    let r = R.assign(R.assign(fila(), 'ana', 'gestor', brief(1), AGORA + 1), 'bruno', 'gestor', brief(2), AGORA + 2);
    const alvo = R.activeOf(r, 'ana').id;

    /* Sem o id, "encerrar o atual" não identifica um: o domínio recusa em vez de escolher
       por conta própria qual dos dois fechar. */
    assert.throws(() => R.resolveCurrent(r, 'end_move', 'gestor', 'motivo suficiente', AGORA + 3), /escolha qual encerrar/);

    const fim = R.resolveCurrent(r, 'end_move', 'gestor', 'cliente desistiu', AGORA + 3, alvo);
    assert.deepEqual(R.activeList(fim).map(item => item.analystId), ['bruno']);

    // Pular e pausar também miram o atendimento da pessoa, e só o dela.
    const pulado = R.skip(r, 'ana', 'gestor', 'ausente do posto', AGORA + 3);
    assert.deepEqual(R.activeList(pulado).map(item => item.analystId), ['bruno']);
    const pausado = R.pauseParticipant(r, 'ana', 'gestor', 'saiu mais cedo', AGORA + 3, 'cancel');
    assert.deepEqual(R.activeList(pausado).map(item => item.analystId), ['bruno']);
});

test('rodízio gravado antes da concorrência continua abrindo', () => {
    /* Há rodízios salvos com `current` único. Ler isso como lista vazia perderia o
       atendimento em curso de quem estivesse trabalhando na virada. */
    const antigo = { ...fila(), current: { id: 'a1', analystId: 'ana', status: 'in_progress', startedAt: AGORA } };
    assert.deepEqual(R.activeList(antigo).map(item => item.analystId), ['ana']);
    assert.equal(R.nextId(antigo), 'bruno');
    assert.equal(R.view(antigo).active.length, 1);

    // E a primeira escrita já grava no formato novo, sem deixar as duas fontes convivendo.
    const migrado = R.assign(antigo, 'bruno', 'gestor', brief(2), AGORA + 1);
    assert.equal(migrado.current, undefined, 'o `current` antigo precisa sumir na escrita');
    assert.deepEqual(migrado.active.map(item => item.analystId), ['ana', 'bruno']);
});

test('a tela mostra os atendimentos no plural, e a ficha só no cartão do dono', () => {
    const doc = html();
    assert.match(doc, /function renderPriorityAttendanceCard\(attendance\)/);
    assert.match(doc, /const abertos = view\.active \|\| \[\];/);
    assert.match(doc, /\$\{abertos\.length\} atendimentos em andamento ao mesmo tempo/);

    /* Com vários cartões, o botão da ficha não pode aparecer em todos: cada analista vê o
       dele e em mais nenhum. */
    assert.match(doc, /const meu = !isAdminLoggedIn && attendance\.analystId === currentActiveUser;/);
    assert.match(doc, /const acao = meu \? `<button[^`]*openPriorityAttendanceRecord\(\)/);

    // Encaminhar deixou de exigir fila parada; só exige alguém livre.
    assert.match(doc, /if \(view\.status !== 'active' \|\| !view\.next\) \{ showToast\(view\.status !== 'active' \? 'O rodízio está pausado\.' : 'Todos os analistas da fila já estão em atendimento\.'/);
    /* Sem comentários: eles citam `view.current` para explicar por que ele saiu. O que não
       pode voltar é a LEITURA. */
    const semComentarios = doc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(semComentarios, /view\.current/, 'sobrou leitura do atendimento único na tela');

    // Encerrar passou para a linha do participante, que escala para N atendimentos.
    assert.match(doc, /\$\{isCurrent \? `<button onclick="openPriorityRotationAction\('resolve','\$\{id\}'\)">Encerrar atendimento<\/button>` : ''\}/);
});

test('o botão da ficha vive no cartão de quem atende, nunca no cartão do próximo', () => {
    const doc = html();

    /* REGRESSÃO: quando os cartões viraram vários, a ação principal — que incluía "Abrir
       ficha do atendimento" do analista em atendimento — continuou sendo despejada no
       cartão do PRÓXIMO. O analista via a ficha dele oferecida em cima do nome do colega,
       e a tela dava a entender que ele podia abrir o atendimento de outra pessoa. */
    const acaoDoProximo = doc.slice(doc.indexOf("let nextAction = '';"), doc.indexOf('card.innerHTML = `'));
    assert.doesNotMatch(acaoDoProximo, /openPriorityAttendanceRecord\(\)/, 'a ficha voltou para o cartão do próximo');
    assert.match(acaoDoProximo, /if \(view\.status === 'active' && selfNext\)/, 'iniciar continua sendo do próprio próximo');
    assert.match(acaoDoProximo, /else if \(canManage && view\.next && view\.status === 'active'\)/, 'encaminhar continua sendo da gestão');

    // Quem monta a ficha é o cartão do atendimento, e ele confere o dono.
    const cartao = doc.slice(doc.indexOf('function renderPriorityAttendanceCard(attendance)'), doc.indexOf('function renderPriorityRotationPrimary(view'));
    assert.match(cartao, /const meu = !isAdminLoggedIn && attendance\.analystId === currentActiveUser;/);
    assert.match(cartao, /const acao = meu \? `<button[^`]*openPriorityAttendanceRecord\(\)/);
    assert.match(doc, /\$\{renderPriorityRotationPrimary\(view, nextAction\)\}/);
});

test('encaminhar e administrar a fila continuam fechados para o analista', () => {
    const doc = html();
    // A permissão de encaminhar depende de estar em Modo Gestão, não só do papel.
    assert.match(doc, /function canManagePriorityRotation\(team\) \{\s*\n\s*return isAdminLoggedIn && window\.PriorityRotation\?\.canManage/);

    // Nenhuma das três portas de encaminhamento existe sem canManage.
    for (const trecho of [
        /const contextualAction = canManage && view\.status === 'active' && view\.next/,
        /else if \(canManage && view\.next && view\.status === 'active'\) nextAction =/,
        /const fallbackAction = canManage \?/
    ]) assert.match(doc, trecho);

    // Na fila completa, o menu de ações de cada participante também é só da gestão.
    assert.match(doc, /const actions = canManage \? `<details class="rotation-actions-menu"/);
    // E a ficha continua recusando quem não é o dono, mesmo que um botão escape.
    const abrir = doc.slice(doc.indexOf('function openPriorityAttendanceRecord()'), doc.indexOf('function closePriorityAttendanceRecord()'));
    assert.match(abrir, /if \(!currentOwnAttendance\(\)\) \{/);
});

test('o menu do analista conta o que está em aberto para ele', () => {
    const doc = html();
    const nav = fs.readFileSync('js/actuar-navigation.js', 'utf8');
    const pecas = fs.readFileSync('js/pieces-ui.js', 'utf8');

    // Lugar no menu: Prioridades (que ramifica) e Solicitações de peças.
    assert.match(nav, /route: rota\('priorities'\), badgeId: 'myPriorityOpenBadge'/);
    assert.match(nav, /route: rota\('pecas'\), badgeId: 'myPiecesOpenBadge'/);
    /* Grupo fechado escondia o contador: o badge só era desenhado nas folhas, e Prioridades
       tem filhos. Agora o próprio grupo mostra o dele. */
    assert.match(doc, /<span>\$\{escapeHtml\(item\.label\)\}<\/span>\$\{navBadgeMarkup\(item\.badgeId\)\}\s*\n\s*<i class="fi fi-rr-angle-small-down actuar-nav-chevron"/);

    const conta = doc.slice(doc.indexOf('function updateAnalystNavBadges()'), doc.indexOf('function renderGlobalNav()'));
    // Conta o que ainda depende de alguém — aprovada e reprovada não contam.
    assert.match(conta, /\['pendente', 'ajuste_solicitado'\]\.includes\(item\.status\)/);
    assert.match(conta, /PriorityRotation\.activeOf\(ensurePriorityRotation\(currentPriorityRotationTeam\(\)\), eu\) \? 1 : 0/);
    // E some em Modo Gestão, onde "as minhas" não quer dizer nada.
    assert.match(conta, /if \(isAdminLoggedIn \|\| isPecaLoggedIn \|\| !eu\) \{ badge\.classList\.add\('hidden'\); return; \}/);

    // Peças: quem tem os dados é quem conta, como já era para a gestão.
    assert.match(pecas, /const OPEN_REQUEST_STATUSES = \['draft', 'pending_lab_review', 'pending_manager_check', 'pending_review', 'correction_requested'\];/);
    assert.match(pecas, /window\.updateMyPiecesBadge = updateAnalystOpenBadge;/);
    assert.match(conta, /window\.updateMyPiecesBadge\?\.\(\);/);
    // Recalculado a cada desenho do menu, senão só apareceria depois de abrir a tela.
    assert.match(doc, /restoreNavBadges\(contadores\);[\s\S]{0,220}updateAnalystNavBadges\(\);/);
});
