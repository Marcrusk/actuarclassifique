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
const BRIEFING = { demand: 'Catraca travada', clientName: 'Theron Fit', clientId: 'C-1', phone: '5599', instructions: 'Ligar antes das 18h' };

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
    assert.deepEqual(R.noAnswerProgress(r.current), { done: 0, required: 3, missing: 3, allowed: false });
    assert.throws(() => R.complete(r, 'ana', 'p1', AGORA, semRetorno), /Registre 3 tentativas de contato .* Há 0\./);

    r = R.logContact(r, 'ana', { channel: 'call', result: 'no_answer' }, AGORA + 1);
    r = R.logContact(r, 'ana', { channel: 'whatsapp', result: 'no_answer' }, AGORA + 2);
    assert.deepEqual(R.noAnswerProgress(r.current), { done: 2, required: 3, missing: 1, allowed: false });
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

    const [tentativa] = R.attemptsOf(r.current);
    assert.equal(tentativa.channel, 'call');
    assert.equal(tentativa.note, 'caixa postal');
    assert.equal(tentativa.byId, 'ana');
    assert.equal(tentativa.at, AGORA + 1);

    /* `complete()` limpa `rotation.current`, então o que a ficha reuniu tem de sobreviver
       em `lastCompleted` — é de lá que o lançamento copia para chegar à gestão. */
    const fim = R.complete(r, 'ana', 'p1', AGORA + 3, DESFECHO_OK);
    assert.equal(fim.current, null);
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
    assert.match(dono, /rotation\?\.current\?\.analystId === currentActiveUser \? rotation\.current : null/);

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
    /* A cópia lê `rotationBefore.current`, não `completed.current`: concluir a vez zera o
       atendimento corrente, e ler de lá traria vazio. */
    assert.match(envio, /deepClone\(PriorityRotation\.attemptsOf\(rotationBefore\.current\)\)/);

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
