const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const clock = require('../js/attendance-clock.js');

/* Uma quarta-feira, para a jornada de segunda a sexta valer. */
const DIA = new Date(2026, 7, 12, 0, 0, 0).getTime();
const at = (hora, minuto = 0, segundo = 0) => new Date(2026, 7, 12, hora, minuto, segundo).getTime();

const PERFIS = {
    leonardo: { tracked: true, shift: { start: '09:00', end: '19:00', days: [1, 2, 3, 4, 5], toleranceMin: 5 } },
    bruna: { tracked: true, shift: { start: '08:00', end: '17:00', days: [1, 2, 3, 4, 5], toleranceMin: 5 } },
    marco: { tracked: false }
};
const USUARIOS = {
    leonardo: { name: 'Leonardo', team: 'Catraca', active: true },
    bruna: { name: 'Bruna', team: 'Catraca', active: true },
    carla: { name: 'Carla', team: 'Sistema', active: true },
    marco: { name: 'Marco', team: 'Catraca', active: true }
};

test('só entra na métrica quem foi marcado na ficha', () => {
    assert.equal(clock.isTracked(PERFIS, 'leonardo'), true);
    assert.equal(clock.isTracked(PERFIS, 'marco'), false, 'perfil sem controle não pode ser medido');
    assert.equal(clock.isTracked(PERFIS, 'carla'), false, 'quem não tem ficha de ponto fica de fora');
});

test('o ponto abre no primeiro login do dia e não é reescrito por um refresh', () => {
    const state = {};
    const primeiro = clock.registerLogin(state, 'leonardo', at(9, 14));
    assert.equal(primeiro.opened, true);

    const segundo = clock.registerLogin(state, 'leonardo', at(11, 30));
    assert.equal(segundo.opened, false, 'o segundo login do dia não reabre o ponto');
    assert.equal(clock.dayOf(state, 'leonardo', DIA).login, at(9, 14), 'o horário da manhã tem que sobreviver ao refresh');
});

test('o atraso é medido contra a jornada cadastrada, com tolerância', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 14));
    const resumo = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(12, 0));
    assert.equal(resumo.late, true);
    assert.equal(Math.round(resumo.lateMs / clock.MINUTE), 9, '14 minutos de atraso menos 5 de tolerância');

    const pontual = {};
    clock.registerLogin(pontual, 'leonardo', at(9, 3));
    const ok = clock.daySummary(pontual, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(12, 0));
    assert.equal(ok.late, false, 'dentro da tolerância não é atraso');
});

test('sem jornada no dia não existe atraso a cobrar', () => {
    const sabado = new Date(2026, 7, 15, 10, 0, 0).getTime();
    const state = {};
    clock.registerLogin(state, 'leonardo', sabado);
    const resumo = clock.daySummary(state, 'leonardo', sabado, clock.profileOf(PERFIS, 'leonardo'), sabado + 3600000);
    assert.equal(resumo.scheduledToday, false);
    assert.equal(resumo.lateMs, 0, 'cobrar atraso em dia fora da escala seria erro');
});

test('almoço e lanche são direito; o resto é ociosidade, em tempo e em quantidade', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 0));

    clock.startBreak(state, 'leonardo', 'almoco', at(12, 0));
    clock.endBreak(state, 'leonardo', at(13, 12));          // 72 min, no limite
    clock.startBreak(state, 'leonardo', 'lanche', at(15, 0));
    clock.endBreak(state, 'leonardo', at(15, 15));          // 15 min, no limite
    clock.startBreak(state, 'leonardo', 'banheiro', at(10, 0));
    clock.endBreak(state, 'leonardo', at(10, 8));           // 8 min de ociosidade
    clock.startBreak(state, 'leonardo', 'particular', at(11, 0));
    clock.endBreak(state, 'leonardo', at(11, 12));          // 12 min de ociosidade
    clock.startBreak(state, 'leonardo', 'reuniao', at(16, 0));
    clock.endBreak(state, 'leonardo', at(16, 30));          // 30 min de ociosidade

    const resumo = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(17, 0));
    assert.equal(resumo.restMs / clock.MINUTE, 87, 'almoço + lanche ficam fora da ociosidade');
    assert.equal(resumo.idleMs / clock.MINUTE, 50, 'banheiro + particular + reunião');
    assert.equal(resumo.idleCount, 3, 'a quantidade de paradas conta tanto quanto o tempo');
    assert.equal(resumo.overMs, 0, 'no limite não é estouro');
});

test('estouro de almoço e de lanche é medido; os outros tipos não têm teto inventado', () => {
    const state = {};
    clock.registerLogin(state, 'bruna', at(8, 0));
    clock.startBreak(state, 'bruna', 'almoco', at(12, 0));
    clock.endBreak(state, 'bruna', at(13, 30));             // 90 min: 18 além de 1h12
    clock.startBreak(state, 'bruna', 'lanche', at(15, 0));
    clock.endBreak(state, 'bruna', at(15, 25));             // 25 min: 10 além de 15
    clock.startBreak(state, 'bruna', 'reuniao', at(16, 0));
    clock.endBreak(state, 'bruna', at(18, 0));              // 2h, sem teto: não é estouro

    const resumo = clock.daySummary(state, 'bruna', DIA, clock.profileOf(PERFIS, 'bruna'), at(18, 0));
    assert.equal(resumo.overMs / clock.MINUTE, 28);
    assert.equal(resumo.byType.almoco.overMs / clock.MINUTE, 18);
    assert.equal(resumo.byType.lanche.overMs / clock.MINUTE, 10);
    assert.equal(resumo.byType.reuniao.overMs, 0);
});

test('almoço e lanche são uma vez por dia; os demais podem repetir', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 0));
    clock.startBreak(state, 'leonardo', 'almoco', at(12, 0));
    clock.endBreak(state, 'leonardo', at(13, 0));

    const repetido = clock.startBreak(state, 'leonardo', 'almoco', at(17, 0));
    assert.equal(repetido.ok, false);
    assert.equal(repetido.code, 'break_limit_reached');

    clock.startBreak(state, 'leonardo', 'banheiro', at(14, 0));
    clock.endBreak(state, 'leonardo', at(14, 5));
    assert.equal(clock.startBreak(state, 'leonardo', 'banheiro', at(16, 0)).ok, true, 'banheiro pode repetir');
});

test('duas pausas ao mesmo tempo não existem, e pausa sem ponto aberto também não', () => {
    const state = {};
    const semPonto = clock.startBreak(state, 'leonardo', 'banheiro', at(9, 30));
    assert.equal(semPonto.ok, false);
    assert.equal(semPonto.code, 'clock_not_open');

    clock.registerLogin(state, 'leonardo', at(9, 0));
    clock.startBreak(state, 'leonardo', 'banheiro', at(9, 30));
    const sobreposta = clock.startBreak(state, 'leonardo', 'particular', at(9, 35));
    assert.equal(sobreposta.ok, false);
    assert.equal(sobreposta.code, 'break_in_progress');
});

test('a pausa aberta conta o tempo correndo e o logout fecha o que ficou aberto', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 0));
    clock.startBreak(state, 'leonardo', 'banheiro', at(10, 0));

    const correndo = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(10, 7));
    assert.equal(correndo.status, 'pausa');
    assert.equal(correndo.openBreak.ms / clock.MINUTE, 7, 'pausa aberta conta desde o início');
    assert.equal(correndo.idleMs / clock.MINUTE, 7, 'a ociosidade já corre durante a pausa');

    clock.registerLogout(state, 'leonardo', at(18, 0));
    const fechado = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(20, 0));
    assert.equal(fechado.openBreak, null, 'sair da plataforma não deixa pausa aberta a noite toda');
    assert.equal(fechado.status, 'encerrado');
});

test('o painel da gestão ordena por ociosidade e fecha os totais do time', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 20));       // atrasado
    clock.startBreak(state, 'leonardo', 'particular', at(10, 0));
    clock.endBreak(state, 'leonardo', at(10, 40));           // 40 min ocioso
    clock.registerLogin(state, 'bruna', at(8, 0));           // pontual
    clock.startBreak(state, 'bruna', 'banheiro', at(9, 0));  // segue em pausa

    const { rows, totals } = clock.teamSummary(state, PERFIS, USUARIOS, DIA, { team: 'Catraca', reference: at(9, 10) });
    assert.deepEqual(rows.map(row => row.userId), ['leonardo', 'bruna'], 'maior ociosidade primeiro');
    assert.equal(totals.analistas, 2, 'Marco não é controlado e Carla não tem ficha');
    assert.equal(totals.emPausa, 1);
    assert.equal(totals.atrasos, 1);
    assert.equal(totals.idleMs / clock.MINUTE, 50);
    assert.equal(totals.idleCount, 2);
});

test('a escala é rascunho até a gestão publicar, e o analista só vê o publicado', () => {
    const schedule = {};
    const semana = clock.weekKey(DIA);

    const vazia = clock.publishWeek(schedule, semana, 'Catraca', 'marco', DIA);
    assert.equal(vazia.ok, false, 'publicar quadro vazio não avisa ninguém de nada');
    assert.equal(vazia.code, 'empty_schedule');

    clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'almoco', '12:00', 'marco');
    clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'lanche', '15:30', 'marco');
    assert.equal(clock.board(schedule, semana, 'Catraca').status, 'draft');
    assert.equal(clock.slotFor(schedule, semana, 'Catraca', 'leonardo', 3), null, 'rascunho não chega ao analista');

    assert.equal(clock.publishWeek(schedule, semana, 'Catraca', 'marco', DIA).ok, true);
    assert.deepEqual(clock.slotFor(schedule, semana, 'Catraca', 'leonardo', 3), { almoco: '12:00', lanche: '15:30' });

    // Mexer depois de publicado volta para rascunho: a equipe precisa ser avisada de novo.
    clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'almoco', '13:00', 'marco');
    assert.equal(clock.board(schedule, semana, 'Catraca').status, 'draft');
    assert.equal(clock.slotFor(schedule, semana, 'Catraca', 'leonardo', 3), null);
});

test('a escala é por time: o quadro da Catraca não vaza para o Sistema', () => {
    const schedule = {};
    const semana = clock.weekKey(DIA);
    clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'almoco', '12:00');
    clock.publishWeek(schedule, semana, 'Catraca', 'marco', DIA);
    assert.deepEqual(clock.board(schedule, semana, 'Sistema').slots, {});
    assert.equal(clock.slotFor(schedule, semana, 'Sistema', 'leonardo', 3), null);
});

test('horário inválido na escala é recusado antes de virar dado', () => {
    const schedule = {};
    const semana = clock.weekKey(DIA);
    assert.equal(clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'almoco', '25:00').ok, false);
    assert.equal(clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'almoco', 'meio-dia').code, 'invalid_time');
    assert.equal(clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'banheiro', '10:00').code, 'unscheduled_type', 'só almoço e lanche entram na escala');
});

test('a aderência compara a janela publicada com o que aconteceu', () => {
    const schedule = {};
    const semana = clock.weekKey(DIA);
    clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'almoco', '12:00');
    clock.setSlot(schedule, semana, 'Catraca', 'leonardo', 3, 'lanche', '15:30');
    clock.publishWeek(schedule, semana, 'Catraca', 'marco', DIA);

    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 0));
    clock.startBreak(state, 'leonardo', 'almoco', at(12, 5));
    clock.endBreak(state, 'leonardo', at(13, 17));

    const resumo = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(16, 0));
    const leitura = clock.adherence(resumo, clock.slotFor(schedule, semana, 'Catraca', 'leonardo', 3));
    assert.equal(leitura.find(item => item.type === 'almoco').status, 'no_horario', '5 minutos está na tolerância');
    assert.equal(leitura.find(item => item.type === 'lanche').status, 'nao_registrada');

    const atrasado = { ...resumo, breaks: [{ type: 'almoco', startedAt: at(13, 10) }] };
    assert.equal(clock.adherence(atrasado, clock.slotFor(schedule, semana, 'Catraca', 'leonardo', 3))[0].status, 'atrasada');
});

test('sem escala publicada não se cobra aderência de ninguém', () => {
    const resumo = { login: at(9, 0), breaks: [] };
    assert.deepEqual(clock.adherence(resumo, null), [], 'cobrar horário que nunca foi combinado seria injusto');
});

test('a semana começa na segunda e devolve os sete dias na ordem da parede', () => {
    assert.equal(clock.weekKey(DIA), '2026-08-10', 'quarta cai na semana que abre em 10/08, uma segunda');
    assert.equal(clock.weekKey(new Date(2026, 7, 10, 0, 1).getTime()), '2026-08-10');
    assert.equal(clock.weekKey(new Date(2026, 7, 16, 23, 59).getTime()), '2026-08-10', 'domingo ainda é a semana que começou na segunda');
    const dias = clock.weekDates('2026-08-10');
    assert.deepEqual(dias.map(item => item.short), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']);
    assert.equal(dias[0].key, '2026-08-10');
    assert.equal(dias[6].key, '2026-08-16');
});

test('quem está em pausa aparece na lista que o rodízio consulta', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 0));
    clock.registerLogin(state, 'bruna', at(9, 0));
    clock.startBreak(state, 'leonardo', 'almoco', at(12, 0));
    assert.deepEqual(clock.pausedNow(state, at(12, 30)), ['leonardo']);
    clock.endBreak(state, 'leonardo', at(13, 0));
    assert.deepEqual(clock.pausedNow(state, at(13, 30)), [], 'quem voltou não pode continuar fora da fila');
});

test('os limites combinados são os do processo: 1h12 de almoço e 15min de lanche', () => {
    assert.equal(clock.BREAK_TYPES.almoco.limitMin, 72);
    assert.equal(clock.BREAK_TYPES.lanche.limitMin, 15);
    assert.equal(clock.BREAK_TYPES.almoco.idle, false);
    assert.equal(clock.BREAK_TYPES.lanche.idle, false);
    for (const key of ['banheiro', 'particular', 'reuniao', 'feedback']) {
        assert.equal(clock.BREAK_TYPES[key].idle, true, `${key} precisa contar como ociosidade`);
        assert.equal(clock.BREAK_TYPES[key].limitMin, null, `${key} não recebe teto inventado`);
    }
});

test('duração é escrita para leitura humana', () => {
    assert.equal(clock.formatDuration(72 * clock.MINUTE), '1h 12min');
    assert.equal(clock.formatDuration(15 * clock.MINUTE), '15min');
    assert.equal(clock.formatDuration(0), '0min');
    assert.equal(clock.formatClock(65000), '01:05');
    assert.equal(clock.formatClock(3725000), '01:02:05');
});

test('o módulo está carregado no shell e publicado no build', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /js\/attendance-clock\.js\?v=/, 'sem cache-buster a correção não chega ao navegador');
    const build = fs.readFileSync('scripts/build-check.cjs', 'utf8');
    assert.match(build, /js\/attendance-clock\.js/, 'o build precisa exigir o módulo');
});

/* ----- contrato com a interface -----
   Estes testes olham o shell porque o módulo sozinho não prova que a tela usa a
   regra certa. Já aconteceu de a correção existir no domínio e não chegar ao
   navegador. */

test('a ficha do usuário é onde se decide quem é controlado', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="inputUserTracked"/, 'sem a chave na ficha não há como escolher quem entra');
    for (const campo of ['inputUserShiftStart', 'inputUserShiftEnd', 'inputUserShiftTolerance', 'inputUserShiftDays']) {
        assert.match(html, new RegExp(`id="${campo}"`), `jornada incompleta: falta ${campo}`);
    }
    // Salvar e editar precisam levar e trazer o perfil, senão a marcação se perde.
    assert.match(html, /applyShiftProfile\(editId\)/);
    assert.match(html, /applyShiftProfile\(newId\)/);
    assert.match(html, /fillShiftForm\(id\)/);
    // Desmarcar apaga o perfil em vez de deixar tracked:false órfão.
    assert.match(html, /else delete appStore\.workProfiles\[userId\]/);
});

test('o ponto abre no login do analista e fecha no logout', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /await openAttendanceClock\(selectedId\)/, 'o login precisa abrir o ponto');
    assert.match(html, /closeAttendanceClock\(currentActiveUser\)/, 'sair não pode deixar pausa aberta a noite toda');
    assert.match(html, /AttendanceClock\.registerLogin\(attendanceState\(\)/);
});

test('a pausa tira o analista da fila e o retorno o recoloca no fim', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /function syncRotationWithBreak\(userId, entrando/);
    assert.match(html, /PriorityRotation\.pauseParticipant\(rotation, userId, userId/);
    assert.match(html, /PriorityRotation\.reactivateParticipant\(rotation, userId, userId\)/);
    assert.match(html, /syncRotationWithBreak\(userId, true/, 'entrar em pausa precisa avisar o rodízio');
    assert.match(html, /syncRotationWithBreak\(userId, false\)/, 'voltar precisa devolver a pessoa à fila');
});

test('ponto, jornada e escala entram na sincronização sem uma pessoa apagar a outra', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /workProfiles: diffNestedMap\(base\.workProfiles, local\.workProfiles, 1\)/);
    assert.match(html, /timeClock: diffNestedMap\(base\.timeClock, local\.timeClock, 2\)/, 'o ponto precisa ser comparado por dia E por usuário');
    assert.match(html, /breakSchedule: diffNestedMap\(base\.breakSchedule, local\.breakSchedule, 2\)/);
    for (const chave of ['workProfiles', 'timeClock', 'breakSchedule']) {
        assert.match(html, new RegExp(`merged\\.${chave} = applyNestedMapDiff`), `${chave} não é aplicado no merge`);
    }
});

test('a gestão tem aba, painel e escala publicável', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    // A porta de entrada saiu da barra horizontal e virou item da sidebar global.
    assert.match(fs.readFileSync('js/actuar-navigation.js', 'utf8'), /label: 'Ponto e pausas'[\s\S]*?section: 'ponto'|route: rota\('admin', 'ponto'\)/);
    assert.match(html, /id="admPanelPonto"/);
    assert.match(html, /ponto: 'admPanelPonto'/, 'a aba precisa estar no mapa de painéis');
    assert.match(html, /if \(tab === 'ponto'\) renderAttendanceManager\(\)/);
    assert.match(html, /onclick="publishBreakSchedule\(\)"/);
    assert.match(html, /onclick="stepAttendanceWeek\(-1\)"/);
});

test('a barra de pausas só existe para quem tem controle marcado', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="attendanceBar"/);
    assert.match(html, /const visivel = isAnalystLoggedIn && isAttendanceTracked\(userId\)/);
    assert.match(html, /renderAttendanceBar\(\);/);
    // Um único cronômetro para a tela toda.
    assert.match(html, /function syncAttendanceTicker\(\)/);
    assert.match(html, /data-attendance-since/);
});

test('a paleta separa pausa de direito de pausa que conta como ociosidade', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(css, /\.attendance-status\.is-paused \{/);
    assert.match(css, /\.attendance-break-btn--success i \{ color: #087a4b/);
    assert.match(css, /\.attendance-break-btn--warning i \{ color: #a15c00/);
    assert.match(css, /\.attendance-schedule-badge\.is-draft \{/);
});

test('o analista enxerga a semana inteira, não só a janela de hoje', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    // O rodízio de pausas muda o horário a cada dia: ver só hoje não deixa planejar.
    assert.match(html, /function renderMyWeekSchedule\(userId\)/);
    assert.match(html, /\$\{renderMyWeekSchedule\(userId\)\}/, 'a barra precisa montar a faixa da semana');
    assert.match(html, /if \(!dias\.some\(dia => dia\.slot\)\) return '';/, 'sem escala publicada a faixa não aparece');
    assert.match(css, /\.attendance-week-day\.is-today \{/);
});

test('semana da escala é identificada por mês, ordem e posição relativa', () => {
    const ref = new Date(2026, 7, 12).getTime();   // quarta, 12/08/2026

    const atual = clock.weekInfo(clock.weekKey(ref), ref);
    assert.equal(atual.title, '2ª semana de agosto');
    assert.equal(atual.range, '10/08 a 14/08');
    assert.equal(atual.relativo, 'Semana atual');
    assert.equal(atual.isCurrent, true);

    const anterior = clock.weekInfo(clock.weekKey(new Date(2026, 7, 5).getTime()), ref);
    assert.equal(anterior.relativo, 'Semana anterior');
    assert.equal(anterior.title, '1ª semana de agosto');

    const proxima = clock.weekInfo(clock.weekKey(new Date(2026, 7, 19).getTime()), ref);
    assert.equal(proxima.relativo, 'Próxima semana');

    assert.equal(clock.weekInfo(clock.weekKey(new Date(2026, 7, 26).getTime()), ref).relativo, 'Em 2 semanas');
    assert.equal(clock.weekInfo(clock.weekKey(new Date(2026, 6, 29).getTime()), ref).relativo, 'Há 2 semanas');

    // Agosto de 2026 começa num sábado: a contagem tem de partir da primeira
    // segunda dentro do mês, senão a âncora cai em julho e infla a ordem.
    assert.deepEqual([3, 10, 17, 24, 31].map(d => clock.weekOfMonth(clock.weekKey(new Date(2026, 7, d).getTime()))), [1, 2, 3, 4, 5]);
    assert.deepEqual([6, 27].map(d => clock.weekOfMonth(clock.weekKey(new Date(2026, 6, d).getTime()))), [1, 4]);

    // Semana que vira o mês é sinalizada, mas continua pertencendo ao mês do início.
    const virada = clock.weekInfo(clock.weekKey(new Date(2026, 7, 31).getTime()), ref);
    assert.equal(virada.title, '5ª semana de agosto');
    assert.equal(virada.crossesMonth, true);
    assert.equal(clock.weekInfo(clock.weekKey(new Date(2026, 7, 24).getTime()), ref).crossesMonth, false);
});

test('escala publicada chega ao analista com a semana identificada', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Navegação entre semanas, com atalho de volta que só aparece fora da atual.
    assert.match(html, /onclick="stepAttendanceWeek\(-1\)"/);
    assert.match(html, /onclick="stepAttendanceWeek\(1\)"/);
    assert.match(html, /id="attendanceWeekToday"[^>]*onclick="goToCurrentAttendanceWeek\(\)"/);
    // As setas são ícone puro: o texto competia com o nome da semana e quebrava a barra.
    assert.match(html, /class="attendance-week-arrow" onclick="stepAttendanceWeek\(-1\)" title="Semana anterior" aria-label="Semana anterior"/);
    assert.doesNotMatch(html, /stepAttendanceWeek\(1\)">Próxima semana/);
    assert.match(html, /btnHoje\.classList\.toggle\('hidden', info\.isCurrent\)/);

    // Rótulo com ordem no mês, intervalo e posição relativa.
    assert.match(html, /const info = AttendanceClock\.weekInfo\(semana\);/);
    assert.match(html, /escapeHtml\(info\.title\)[\s\S]{0,120}escapeHtml\(info\.range\)[\s\S]{0,160}escapeHtml\(info\.relativo\)/);

    // A publicação continua sendo o que libera a escala para o analista.
    assert.match(html, /onclick="publishBreakSchedule\(\)"/);
    assert.match(html, /nenhum analista enxerga esta escala ainda/);

    // Do lado do analista, a faixa diz de que semana é a escala exibida.
    assert.match(html, /Minha escala · \$\{escapeHtml\(AttendanceClock\.weekInfo\(semana\)\.title\)\}/);

    // A tela precisa dizer onde preencher, não só o que acontece ao publicar.
    assert.match(html, /Preencha o horário de almoço e de lanche de cada analista na tabela abaixo/);

    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(css, /\.attendance-week-nav \{[^}]*display: inline-flex/);
    assert.match(css, /\.attendance-week-arrow \{[^}]*width: 30px/);
});

/* ----- expediente por pessoa -----
   A operação tem turnos diferentes (07–17, 08–18, 09–19). Nada pode assumir um
   horário comum: o único horário compartilhado é o padrão do cadastro novo. */

test('cada pessoa tem o seu expediente, e a jornada é medida em cima dele', () => {
    const perfis = {
        cedo: { tracked: true, shift: { start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5], toleranceMin: 5 } },
        meio: { tracked: true, shift: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5], toleranceMin: 5 } },
        tarde: { tracked: true, shift: { start: '09:00', end: '19:00', days: [1, 2, 3, 4, 5], toleranceMin: 5 } }
    };
    assert.equal(clock.shiftLabel(clock.profileOf(perfis, 'cedo')), '07:00–17:00');
    assert.equal(clock.shiftLabel(clock.profileOf(perfis, 'tarde')), '09:00–19:00');
    for (const id of ['cedo', 'meio', 'tarde']) {
        assert.equal(clock.shiftSpanMinutes(clock.profileOf(perfis, id)), 600, `${id} trabalha 10h`);
    }

    // O mesmo login às 08:10 é atraso para quem entra às 07h e adiantamento para
    // quem entra às 09h. É por isso que o horário não pode ser global.
    const state = {};
    clock.registerLogin(state, 'cedo', at(8, 10));
    clock.registerLogin(state, 'tarde', at(8, 10));
    assert.equal(clock.daySummary(state, 'cedo', DIA, clock.profileOf(perfis, 'cedo'), at(12, 0)).late, true);
    assert.equal(clock.daySummary(state, 'tarde', DIA, clock.profileOf(perfis, 'tarde'), at(12, 0)).late, false);
});

test('a escala avisa quando a janela cai fora do expediente da pessoa', () => {
    const cedo = clock.profileOf({ x: { tracked: true, shift: { start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5] } } }, 'x');
    const tarde = clock.profileOf({ x: { tracked: true, shift: { start: '09:00', end: '19:00', days: [1, 2, 3, 4, 5] } } }, 'x');

    assert.equal(clock.withinShift(cedo, '12:00'), true);
    assert.equal(clock.withinShift(cedo, '17:30'), false, 'lanche às 17:30 tira do ar quem sai às 17h');
    assert.equal(clock.withinShift(tarde, '17:30'), true, 'o mesmo horário serve para quem sai às 19h');
    assert.equal(clock.withinShift(tarde, '08:00'), false, 'antes de entrar também é fora do expediente');

    // Jornada que atravessa a meia-noite continua sendo uma jornada.
    const noturno = clock.profileOf({ x: { tracked: true, shift: { start: '22:00', end: '06:00', days: [1, 2, 3, 4, 5] } } }, 'x');
    assert.equal(clock.withinShift(noturno, '23:30'), true);
    assert.equal(clock.withinShift(noturno, '02:00'), true);
    assert.equal(clock.withinShift(noturno, '12:00'), false);
    assert.equal(clock.shiftSpanMinutes(noturno), 480);

    // Sem jornada cadastrada não se acusa erro nenhum.
    assert.equal(clock.withinShift(null, '17:30'), true);
});

test('os turnos de atalho são exatamente os que a operação usa — nem um a mais', () => {
    const rotulos = clock.SHIFT_PRESETS.map(preset => preset.label);
    assert.deepEqual(rotulos, ['07–17', '08–18', '09–19'], 'oferecer um turno que não existe convida ao cadastro errado');
    for (const preset of clock.SHIFT_PRESETS) {
        assert.ok(clock.parseTime(preset.start) && clock.parseTime(preset.end), `turno ${preset.label} com horário inválido`);
    }

    // O padrão de um cadastro novo tem que ser um turno real, senão toda pessoa
    // criada já nasce com um horário que não existe.
    const padrao = clock.SHIFT_PRESETS.find(p => p.start === clock.DEFAULT_SHIFT.start && p.end === clock.DEFAULT_SHIFT.end);
    assert.ok(padrao, `o padrão ${clock.DEFAULT_SHIFT.start}–${clock.DEFAULT_SHIFT.end} não é um turno da operação`);
});

test('turno gravado fora dos padrões fica sinalizado em vez de passar despercebido', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /const foraDoPadrao = ligado && !atalhos\.some\(preset => preset\.start === jornada\.start && preset\.end === jornada\.end\)/);
    assert.match(html, /attendance-shift-custom/);
    // A ficha de cadastro precisa abrir no mesmo padrão do domínio.
    assert.match(html, /id="inputUserShiftStart" value="08:00"/);
    assert.match(html, /id="inputUserShiftEnd" value="18:00"/);
});

test('a gestão edita as jornadas num quadro só, sem abrir ficha por ficha', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="attendanceShiftsTable"/);
    assert.match(html, /function renderTeamShifts\(\)/);
    // O quadro lista TODO analista do departamento — é daqui que se liga o controle.
    assert.match(html, /function attendanceTeamAnalysts\(\)/);
    assert.match(html, /onchange="toggleShiftControl\('\$\{id\}',this\.checked\)"/);
    assert.match(html, /updateTeamShift\('\$\{id\}','start'/);
    assert.match(html, /updateTeamShift\('\$\{id\}','end'/);
    assert.match(html, /applyShiftPreset\('\$\{id\}'/);
    assert.match(html, /toggleShiftDay\('\$\{id\}'/);
    // Desligar apaga o perfil; a jornada nunca fica órfã.
    assert.match(html, /else delete appStore\.workProfiles\[userId\];/);
    // Uma jornada sem nenhum dia não existe.
    assert.match(html, /if \(!dias\.size\) \{ showToast\('A jornada precisa de ao menos um dia\.'/);
});

test('o expediente de cada pessoa aparece onde a decisão é tomada', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    // Na escala e na tabela de ociosidade, ao lado do nome.
    assert.equal((html.match(/attendance-shift-tag/g) || []).length, 2, 'o turno precisa estar visível na escala e na tabela de ociosidade');
    assert.match(html, /AttendanceClock\.shiftLabel\(attendanceProfile\(row\.userId\)\)/);
    // Dia fora da jornada não recebe campo de horário.
    assert.match(html, /if \(!trabalhaEm\(dia\.day\)\) return `<td class="is-off/);
    assert.match(html, /const fora = valor && !AttendanceClock\.withinShift\(perfil, valor\)/);
    assert.match(css, /\.attendance-slot\.is-outside span \{ color: #c3271c/);
});

test('a marcação de janela fora do expediente vence a regra base de input do DS', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    // A regra base tem !important e especificidade (0,4,2): um seletor curto perde.
    assert.match(css, /body\.actuar-app \.attendance-slot\.is-outside input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="file"\]\) \{ border-color: #f04438 !important/);
});

test('escala oferece grade de horários em vez de exigir digitação', () => {
    // A janela de cada pausa vem do domínio, com passo de 15 minutos.
    const almoco = clock.slotOptions('almoco');
    assert.equal(almoco[0], '11:00');
    assert.equal(almoco.at(-1), '15:00');
    assert.equal(almoco[1], '11:15');
    assert.equal(almoco.length, 17);

    const lanche = clock.slotOptions('lanche');
    assert.equal(lanche[0], '09:00');
    assert.equal(lanche.at(-1), '17:30');
    assert.ok(lanche.length > almoco.length, 'a janela do lanche cobre manhã e tarde');

    // Toda opção é um horário válido para o próprio parser da escala.
    for (const hora of almoco.concat(lanche)) assert.ok(clock.parseTime(hora), `horário inválido na grade: ${hora}`);
    // Tipo desconhecido não quebra a tela.
    assert.deepEqual(clock.slotOptions('xpto'), almoco);

    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // A grade alimenta as sugestões do campo de tempo, sem substituir a digitação.
    // A grade agora alimenta o seletor modal, já marcada contra o expediente da pessoa.
    assert.match(html, /AttendanceClock\.slotChoices\(type, perfil\)/);
    // Nenhum resquício do seletor flutuante, que dependia de listener global e posicionamento.
    for (const resto of ['breakSlotPicker', 'openBreakSlotPicker', 'pickBreakSlot']) {
        assert.ok(!html.includes(resto), `resquício do seletor flutuante: ${resto}`);
    }

    // Repetir na semana virou ação da linha e só age nos dias em que a pessoa trabalha.
    assert.match(html, /async function applyBreakSlotToWeek\(userId, type\)/);
    // `worksOn` recebe um instante, não um número de dia da semana — comparar direto
    // com os dias da jornada é o que faz a ação agir nos dias certos.
    assert.match(html, /if \(perfil && !perfil\.shift\.days\.includes\(dia\)\) continue;/);
    // Repetir na semana deixou de ser pílula na linha: mora dentro do seletor, onde a
    // pessoa já está decidindo o horário.
    assert.match(html, /if \(repetir && valor\) await applyBreakSlotToWeek\(alvo\.userId, alvo\.type\);/);
    assert.match(css, /\.attendance-schedule \.attendance-slot input\[type="time"\] \{/);
});

test('cronômetro da pausa amarra escala publicada, saída e limite do tipo', () => {
    const saida = new Date(2026, 7, 13, 12, 7).getTime();       // combinado 12:00, saiu 12:07
    const agora = new Date(2026, 7, 13, 12, 35).getTime();
    const w = clock.breakWatch({ type: 'almoco', startedAt: saida }, '12:00', agora);

    assert.equal(w.scheduledAt, '12:00');
    assert.equal(w.startDelayMin, 7);
    // 7 minutos cabem na tolerância de 15 — a mesma que libera a saída na tela do
    // analista. Dois números diferentes fariam o sistema avisar uma coisa e
    // mostrar outra para a gestão.
    assert.equal(w.startStatus, 'no_horario');
    assert.equal(clock.SCHEDULE_TOLERANCE_MIN, 15);
    assert.equal(w.elapsedMs, 28 * 60000);
    assert.equal(w.limitMs, 72 * 60000, 'almoço tem limite de 72 minutos');
    assert.equal(w.remainingMs, 44 * 60000);
    assert.equal(w.exceeded, false);

    // Estouro do limite é sinalizado, com o excedente disponível para exibir.
    const estourou = clock.breakWatch({ type: 'lanche', startedAt: saida }, '12:00', saida + 20 * 60000);
    assert.equal(estourou.exceeded, true);
    assert.equal(estourou.remainingMs, -5 * 60000, 'lanche de 15 min excedido em 5');

    // Tolerância de 15 minutos para os dois lados antes de marcar atraso ou adiantamento.
    assert.equal(clock.breakWatch({ type: 'almoco', startedAt: saida }, '12:05', agora).startStatus, 'no_horario');
    assert.equal(clock.breakWatch({ type: 'almoco', startedAt: saida }, '11:45', agora).startStatus, 'atrasado', '22 minutos depois já é fora da janela');
    assert.equal(clock.breakWatch({ type: 'almoco', startedAt: saida }, '12:30', agora).startStatus, 'adiantado', '23 minutos antes também');

    // Sem escala publicada o cronômetro continua valendo; só não há o que comparar.
    const semEscala = clock.breakWatch({ type: 'almoco', startedAt: saida }, '', agora);
    assert.equal(semEscala.startStatus, 'sem_escala');
    assert.equal(semEscala.startDelayMin, null);
    assert.equal(semEscala.elapsedMs, 28 * 60000);

    // Pausa sem limite não inventa folga negativa.
    const livre = clock.breakWatch({ type: 'banheiro', startedAt: saida }, '', agora);
    assert.equal(livre.limitMs, null);
    assert.equal(livre.remainingMs, null);
    assert.equal(livre.exceeded, false);

    assert.equal(clock.breakWatch(null, '12:00', agora), null);

    const html = fs.readFileSync('index.html', 'utf8');
    // A célula da escala virou botão: escolher numa grade é um clique, digitar
    // hh:mm no campo nativo é quatro teclas e erra fácil.
    assert.match(html, /onclick="openAttendanceSlotModal\('\$\{id\}',\$\{dia\.day\},'\$\{tipo\}'\)"/);
    assert.doesNotMatch(html, /<input type="time" list="attendanceSlots/);
    assert.ok(!html.includes('attendanceSlots-almoco'), 'datalist órfão precisa sair junto com o campo que o usava');
    assert.doesNotMatch(html, /<select onchange="updateBreakSlot/);
    // Painel ao vivo usa a regra do domínio e um cronômetro só para a tela toda.
    assert.match(html, /const watch = AttendanceClock\.breakWatch\(row\.openBreak, programado\);/);
    assert.match(html, /data-attendance-since="\$\{row\.openBreak\.startedAt\}"/);
});

test('preencher, publicar e liberar a escala para o analista', () => {
    const schedule = {}, semana = clock.weekKey(new Date(2026, 7, 12).getTime()), time = 'Catraca', gestor = 'marco_adm';

    assert.equal(clock.publishWeek(schedule, semana, time, gestor, 1000).ok, false, 'não publica escala vazia');

    for (const dia of [1, 2, 3, 4, 5]) {
        clock.setSlot(schedule, semana, time, 'watson', dia, 'almoco', '12:00', gestor);
        clock.setSlot(schedule, semana, time, 'watson', dia, 'lanche', '15:30', gestor);
    }
    assert.equal(clock.board(schedule, semana, time).status, 'draft');
    assert.equal(clock.slotFor(schedule, semana, time, 'watson', 1), null, 'rascunho não chega ao analista');

    const publicada = clock.publishWeek(schedule, semana, time, gestor, 2000);
    assert.equal(publicada.ok, true);
    assert.equal(publicada.slots, 5);
    assert.equal(publicada.board.publishedBy, gestor);
    assert.deepEqual(clock.slotFor(schedule, semana, time, 'watson', 1), { almoco: '12:00', lanche: '15:30' });
    assert.equal(clock.slotFor(schedule, semana, time, 'outro', 1), null);

    // Alterar depois de publicar volta a rascunho: a equipe não vê meia escala.
    clock.setSlot(schedule, semana, time, 'watson', 2, 'almoco', '12:30', gestor);
    assert.equal(clock.board(schedule, semana, time).status, 'draft');
    assert.equal(clock.slotFor(schedule, semana, time, 'watson', 1), null);

    // A tela precisa passar o gestor da sessão. "currentAdminUser" nunca foi declarada:
    // a referência lançava ReferenceError e derrubava salvar e publicar sem aviso nenhum.
    const html = fs.readFileSync('index.html', 'utf8');
    assert.ok(!html.includes('currentAdminUser'), 'variável inexistente de volta no caminho da escala');
    assert.match(html, /publishWeek\(attendanceSchedule\(\), semana, attendanceFilters\.team, currentAdminId/);
    assert.match(html, /setSlot\(attendanceSchedule\(\), semana, attendanceFilters\.team, userId, weekday, type, value, currentAdminId\)/);
});

/* ----- preenchimento da escala ----- */

test('a distribuição escalona as janelas dentro do expediente de cada pessoa', () => {
    const perfis = {
        cedo: { tracked: true, shift: { start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5] } },
        meio: { tracked: true, shift: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] } },
        tarde: { tracked: true, shift: { start: '09:00', end: '19:00', days: [1, 2, 3, 4, 5] } }
    };
    const ids = ['cedo', 'meio', 'tarde'];
    const plano = clock.distributeWeek(perfis, ids, '2026-08-10', { rotate: 0 });

    for (const id of ids) {
        assert.deepEqual(Object.keys(plano[id]).map(Number).sort(), [1, 2, 3, 4, 5], `${id} precisa dos cinco dias`);
        for (const dia of [1, 2, 3, 4, 5]) {
            const janela = plano[id][dia];
            // Toda janela gerada tem que caber no expediente da própria pessoa.
            assert.ok(clock.withinShift(clock.profileOf(perfis, id), janela.almoco), `almoço de ${id} na ${dia} caiu fora do turno`);
            assert.ok(clock.withinShift(clock.profileOf(perfis, id), janela.lanche), `lanche de ${id} na ${dia} caiu fora do turno`);
            // Lanche sempre depois do almoço, com folga.
            assert.ok(clock.parseTime(janela.lanche).minutes > clock.parseTime(janela.almoco).minutes);
        }
    }

    // Quem entra mais cedo almoça mais cedo: a âncora é o próprio turno.
    assert.ok(clock.parseTime(plano.cedo[1].almoco).minutes < clock.parseTime(plano.tarde[1].almoco).minutes);
});

test('o rodízio muda o horário ao longo da semana e entre as semanas', () => {
    const perfis = { a: { tracked: true, shift: { start: '08:00', end: '18:00', days: [1, 2, 3, 4, 5] } } };
    const plano = clock.distributeWeek(perfis, ['a', 'b', 'c', 'd'], '2026-08-10', { rotate: 0 });
    const horarios = [1, 2, 3, 4, 5].map(dia => plano.a[dia].almoco);
    assert.ok(new Set(horarios).size > 1, 'horário fixo a semana toda não é rodízio');

    // A mesma pessoa, na mesma segunda, muda de faixa quando a semana muda.
    const semana1 = clock.distributeWeek(perfis, ['a', 'b', 'c', 'd'], '2026-08-10', { rotate: 0 });
    const semana2 = clock.distributeWeek(perfis, ['a', 'b', 'c', 'd'], '2026-08-17', { rotate: 1 });
    assert.notEqual(semana1.a[1].almoco, semana2.a[1].almoco);

    // O giro padrão vem da própria semana, sem precisar de parâmetro.
    assert.notEqual(clock.rotationSeed('2026-08-10'), clock.rotationSeed('2026-08-17'));
});

test('a distribuição respeita os dias de jornada e ignora quem não é controlado', () => {
    const perfis = {
        semSexta: { tracked: true, shift: { start: '08:00', end: '18:00', days: [1, 2, 3, 4] } },
        solto: { tracked: false }
    };
    const plano = clock.distributeWeek(perfis, ['semSexta', 'solto', 'inexistente'], '2026-08-10', { rotate: 0 });
    assert.deepEqual(Object.keys(plano[semSextaKey()]).map(Number).sort(), [1, 2, 3, 4], 'sexta não pode entrar');
    assert.equal(plano.solto, undefined, 'quem não é controlado fica fora');
    assert.equal(plano.inexistente, undefined);
    function semSextaKey() { return 'semSexta'; }
});

test('copiar a semana anterior traz as janelas e mantém o quadro em rascunho', () => {
    const schedule = {};
    const anterior = '2026-08-03';
    const atual = '2026-08-10';
    clock.setSlot(schedule, anterior, 'Catraca', 'leonardo', 1, 'almoco', '12:00');
    clock.setSlot(schedule, anterior, 'Catraca', 'leonardo', 2, 'lanche', '15:30');
    clock.publishWeek(schedule, anterior, 'Catraca', 'marco', DIA);

    const resultado = clock.copyWeek(schedule, anterior, atual, 'Catraca', 'marco');
    assert.equal(resultado.ok, true);
    assert.equal(resultado.aplicados, 2);
    assert.equal(clock.board(schedule, atual, 'Catraca').slots.leonardo[1].almoco, '12:00');
    assert.equal(clock.board(schedule, atual, 'Catraca').slots.leonardo[2].lanche, '15:30');
    assert.equal(clock.board(schedule, atual, 'Catraca').status, 'draft', 'copiar não pode publicar sozinho');
    // A origem continua publicada e intacta.
    assert.equal(clock.board(schedule, anterior, 'Catraca').status, 'published');
});

test('copiar de uma semana vazia avisa em vez de apagar o que já existe', () => {
    const schedule = {};
    clock.setSlot(schedule, '2026-08-10', 'Catraca', 'leonardo', 1, 'almoco', '12:00');
    const resultado = clock.copyWeek(schedule, '2026-08-03', '2026-08-10', 'Catraca', 'marco');
    assert.equal(resultado.ok, false);
    assert.equal(resultado.code, 'empty_source');
    assert.equal(clock.board(schedule, '2026-08-10', 'Catraca').slots.leonardo[1].almoco, '12:00', 'o que já estava preenchido não pode sumir');
});

test('repetir na semana usa o perfil certo e o dia certo — o botão não pode ser um nada', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    // profileOf lê workProfiles, não users; worksOn espera um instante, não um weekday.
    assert.doesNotMatch(html, /AttendanceClock\.profileOf\(getStore\(\)\?\.users/, 'profileOf com a lista de usuários devolve null e o botão não aplica nada');
    assert.match(html, /const perfil = attendanceProfile\(userId\);\s*\n\s*let aplicados = 0;/);
    assert.match(html, /if \(perfil && !perfil\.shift\.days\.includes\(dia\)\) continue;/);
});

test('os atalhos preenchem o rascunho e não publicam por conta própria', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /onclick="copyPreviousBreakWeek\(\)"/);
    assert.match(html, /onclick="distributeBreakWeek\(\)"/);
    // Os dois atalhos ficam agrupados sob um rótulo próprio, longe do publicar.
    assert.match(html, /<span class="attendance-assist-label">Preencher rascunho<\/span>/);
    // Substituir trinta campos preenchidos exige confirmação.
    assert.match(html, /Refazer a distribuição\?/);
    assert.match(html, /Trazer a semana anterior\?/);
    assert.doesNotMatch(html, /distributeBreakWeek[\s\S]{0,900}publishWeek/, 'distribuir não pode publicar');
});

/* ==========================================================================
   O ANALISTA MARCA, A GESTÃO MEDE
   ========================================================================== */

test('a janela de saída é o horário combinado mais ou menos a tolerância única', () => {
    const janela = clock.scheduleWindow('12:30');
    assert.deepEqual(janela, { scheduledAt: '12:30', from: '12:15', to: '12:45', toleranceMin: 15 });
    // A tolerância é a mesma que o breakWatch usa depois. Uma regra, um número.
    assert.equal(janela.toleranceMin, clock.SCHEDULE_TOLERANCE_MIN);
    assert.equal(clock.scheduleWindow(null), null);
    assert.equal(clock.scheduleWindow('25:00'), null);
});

test('sair dentro da janela é direto; fora dela o sistema para e pergunta', () => {
    const combinado = '12:30';
    const dentro = clock.windowCheck('almoco', combinado, at(12, 28));
    assert.equal(dentro.status, 'no_horario');
    assert.equal(dentro.offSchedule, false, 'no horário não pode pedir justificativa');

    const cedo = clock.windowCheck('almoco', combinado, at(11, 40));
    assert.equal(cedo.status, 'adiantado');
    assert.equal(cedo.offSchedule, true);
    assert.equal(cedo.deltaMin, -50);
    assert.equal(cedo.scheduledAt, '12:30');

    const tarde = clock.windowCheck('almoco', combinado, at(13, 20));
    assert.equal(tarde.status, 'atrasado');
    assert.equal(tarde.deltaMin, 50);

    // A borda exata da tolerância ainda é "no horário".
    assert.equal(clock.windowCheck('almoco', combinado, at(12, 45)).status, 'no_horario');
    assert.equal(clock.windowCheck('almoco', combinado, at(12, 46)).status, 'atrasado');
});

test('pausa sem hora combinada nunca vira aviso', () => {
    // Banheiro, particular, reunião e feedback não entram na escala.
    for (const tipo of ['banheiro', 'particular', 'reuniao', 'feedback']) {
        const check = clock.windowCheck(tipo, '12:30', at(18, 0));
        assert.equal(check.offSchedule, false, `${tipo} não tem horário combinado`);
        assert.equal(check.status, 'sem_escala');
    }
    // Sem escala publicada também não há o que cobrar.
    assert.equal(clock.windowCheck('almoco', null, at(18, 0)).status, 'sem_escala');
    assert.equal(clock.windowCheck('almoco', null, at(18, 0)).offSchedule, false);
});

test('o desvio só é gravado com justificativa escrita, e viaja até a gestão', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(9, 0));

    // Sem motivo, nada de desvio: o registro não pode nascer acusando sem contraditório.
    clock.startBreak(state, 'leonardo', 'banheiro', at(10, 0), { offSchedule: { scheduledAt: '12:30', deltaMin: -50, reason: '  ' } });
    assert.equal(clock.dayOf(state, 'leonardo', DIA).breaks[0].offSchedule, undefined);
    clock.endBreak(state, 'leonardo', at(10, 5));

    clock.startBreak(state, 'leonardo', 'almoco', at(11, 40), {
        offSchedule: { scheduledAt: '12:30', deltaMin: -50, status: 'adiantado', reason: 'cliente liberou mais cedo' }
    });
    const registro = clock.dayOf(state, 'leonardo', DIA).breaks[1].offSchedule;
    assert.equal(registro.reason, 'cliente liberou mais cedo');
    assert.equal(registro.deltaMin, -50);
    assert.equal(registro.scheduledAt, '12:30');
    assert.equal(registro.status, 'adiantado');

    const resumo = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(12, 0));
    assert.equal(resumo.offScheduleCount, 1);
    assert.equal(resumo.offSchedule[0].reason, 'cliente liberou mais cedo');

    const lista = clock.offScheduleToday(state, DIA);
    assert.equal(lista.length, 1);
    assert.equal(lista[0].userId, 'leonardo');
    assert.equal(lista[0].label, 'Almoço');
    assert.equal(lista[0].reason, 'cliente liberou mais cedo');
});

test('a tela do analista não entrega número de desempenho', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    // Comentários explicam a regra e citam as palavras; o que vale é o que a função
    // realmente renderiza. Sem tirá-los, o teste acusaria a própria justificativa.
    const semComentarios = trecho => trecho.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const barra = semComentarios(html.slice(html.indexOf('function renderAttendanceBar()'), html.indexOf('function attendanceClockNow(')));

    // O que ele vê: hora real, situação, botões e a escala dele.
    assert.match(barra, /data-attendance-clock-seconds/, 'falta o relógio em tempo real');
    assert.match(barra, /renderMyWeekSchedule\(userId\)/);
    assert.match(barra, /Você está em \$\{escapeHtml\(aberta\.spec\.label\.toLowerCase\(\)\)\}/);

    // O que ele NÃO vê: ociosidade, acumulados e tempo em atendimento.
    for (const vazamento of ['idleMs', 'idleCount', 'restMs', 'overMs', 'onlineMs', 'Ociosidade']) {
        assert.ok(!barra.includes(vazamento), `a barra do analista não pode mostrar ${vazamento}`);
    }
    assert.ok(!barra.includes('lateMs'), 'atraso é leitura da gestão');

    // Voltar da pausa também não pode ecoar a duração.
    const volta = semComentarios(html.slice(html.indexOf('async function endAttendanceBreak()'), html.indexOf('function syncAttendanceTicker()')));
    assert.match(volta, /De volta ao atendimento\./);
    assert.ok(!volta.includes('formatDuration(duracao)'), 'quanto durou o almoço é leitura da gestão');
});

test('o fluxo de saída fora da janela pede o porquê antes de registrar', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /const verificacao = AttendanceClock\.windowCheck\(type, janela\?\.\[type\] \|\| null, Date\.now\(\)\)/);
    assert.match(html, /if \(!motivo\) return;/, 'desistir do diálogo não pode iniciar a pausa');
    assert.match(html, /AttendanceClock\.startBreak\(attendanceState\(\), userId, type, Date\.now\(\), \{ offSchedule: desvio \}\)/);
    // Justificativa vazia não libera o botão.
    assert.match(html, /confirmar\.disabled = campo\.value\.trim\(\)\.length < 4;/);
    assert.match(html, /id="attendanceOffScheduleModal"/);
    // Diálogo na identidade do sistema, não do navegador.
    assert.ok(!html.includes('window.prompt('), 'nada de prompt do navegador');
});

test('a gestão ganha relógio, indicador e o motivo escrito pelo analista', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    assert.match(html, /class="attendance-header-clock"/);
    assert.match(html, /rotulo: 'Fora da janela'/);
    assert.match(html, /AttendanceClock\.offScheduleToday\(attendanceState\(\)\)\.filter\(item => doTime\.has\(item\.userId\)\)/, 'o indicador é por departamento');
    // O motivo continua no tooltip, agora junto do horário combinado e do que aconteceu:
    // "-364min" sozinho era lido como duração da pausa, que é outra coisa.
    assert.match(html, /attendance-adherence is-fora" title="\$\{escapeHtml\(`[^`]*Motivo: \$\{item\.reason\}`\)\}/, 'o motivo precisa estar à mão de quem lê');
    assert.match(html, /combinado para \$\{item\.scheduledAt \|\| '—'\}; saiu \$\{AttendanceClock\.formatDelta\(item\.deltaMin\)\}/);
    assert.match(html, /data-attendance-since="\$\{row\.login\}"/, 'a gestão vê há quanto tempo a pessoa está no ponto');
    assert.match(css, /\.attendance-table tr\.has-offschedule td:first-child \{ box-shadow: inset 3px 0 0 #f79009/);
});

test('um único laço de tempo atualiza relógio e contagem regressiva', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ticker = html.slice(html.indexOf('function syncAttendanceTicker()'), html.indexOf('function attendanceScheduleToday('));
    assert.equal((ticker.match(/setInterval/g) || []).length, 1, 'um cronômetro para a tela inteira');
    for (const alvo of ['data-attendance-since', 'data-attendance-clock', 'data-attendance-clock-seconds', 'data-attendance-countdown']) {
        assert.ok(ticker.includes(alvo), `o laço precisa atualizar ${alvo}`);
    }
});

test('a coluna da escala não repete o mesmo desvio duas vezes', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const linha = html.slice(html.indexOf("const [rotulo, tom] = situacoes[row.status];"), html.indexOf('renderTeamShifts();'));
    // `desvios` é usado no cálculo de `escala`: declarar depois seria ReferenceError.
    assert.ok(linha.indexOf('const desvios =') < linha.indexOf('const escala = row.slot'), 'desvios precisa ser declarado antes de escala');
    assert.match(linha, /!justificados\.has\(item\.type\)/, 'aderência simples não pode repetir o que o desvio já diz');
});

test('analista entende a pausa antes de marcar, mesmo com o botão bloqueado', () => {
    // A janela combinada já existe no domínio e traz a tolerância dos dois lados.
    const janela = clock.scheduleWindow('12:00');
    assert.equal(janela.scheduledAt, '12:00');
    assert.ok(janela.from < janela.scheduledAt && janela.to > janela.scheduledAt, 'a tolerância cerca o horário combinado');

    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // O tooltip diz o horário, a duração e a janela sem justificativa.
    assert.match(html, /const janelaCombinada = combinado \? AttendanceClock\.scheduleWindow\(combinado\) : null;/);
    assert.match(html, /está combinado para as \$\{janelaCombinada\.scheduledAt\}/);
    assert.match(html, /Pode marcar entre \$\{janelaCombinada\.from\} e \$\{janelaCombinada\.to\} sem justificar/);
    assert.match(html, /Ainda não há escala publicada para hoje/);

    // Botão bloqueado não usa `disabled`: no Chrome ele não dispararia o title.
    assert.match(html, /aria-disabled="\$\{bloqueado\}" title="\$\{escapeHtml\(explicacao\)\}"/);
    assert.doesNotMatch(html, /attendance-break-btn[^`]*\$\{aberta \|\| esgotado \? 'disabled' : ''\}/);
    assert.match(css, /\.attendance-break-btn\.is-blocked \{[^}]*cursor: help/);

    // E o clique no bloqueado responde, em vez de ignorar.
    assert.match(html, /if \(resumoAtual\.openBreak\) return showToast\(/);
    assert.match(html, /if \(spec\.perDay && resumoAtual\.byType\[type\]\.count >= spec\.perDay\) return showToast\(/);
});

test('o desvio da escala é escrito para ser lido, não em minutos crus', () => {
    const state = {};
    clock.registerLogin(state, 'leonardo', at(0, 24));
    clock.startBreak(state, 'leonardo', 'lanche', at(0, 25));
    clock.endBreak(state, 'leonardo', at(0, 30));
    const resumo = clock.daySummary(state, 'leonardo', DIA, clock.profileOf(PERFIS, 'leonardo'), at(1, 0));

    const leitura = clock.adherence(resumo, { lanche: '15:00' });
    assert.equal(leitura[0].deltaMin, -875);
    // "-875min" não se lê; acima de 90 minutos o desvio vira horas.
    assert.equal(leitura[0].deltaLabel, '14h 35min antes');
    assert.equal(leitura[0].status, 'adiantada');

    // Desvio pequeno continua em minutos, com sinal.
    const perto = clock.adherence({ login: at(9, 0), breaks: [{ type: 'almoco', startedAt: at(12, 20) }] }, { almoco: '12:00' });
    assert.equal(perto[0].deltaLabel, '+20min');
    assert.equal(perto[0].status, 'atrasada');
});

test('a aderência usa a mesma tolerância do resto do sistema', () => {
    const base = { login: at(9, 0), breaks: [{ type: 'almoco', startedAt: at(12, 12) }] };
    // 12 minutos: fora dos 10 antigos, dentro dos 15 combinados.
    assert.equal(clock.adherence(base, { almoco: '12:00' })[0].status, 'no_horario');
    assert.equal(clock.adherence(base, { almoco: '12:00' })[0].deltaMin, 12);
    const fora = { login: at(9, 0), breaks: [{ type: 'almoco', startedAt: at(12, 20) }] };
    assert.equal(clock.adherence(fora, { almoco: '12:00' })[0].status, 'atrasada');
});

test('a gestão tem uma coluna para o tempo trabalhado, não só para as pausas', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /<th>Situação<\/th><th class="num">No ponto<\/th>/);
    // Enquanto o ponto está aberto o número corre; encerrado, congela.
    assert.match(html, /\$\{row\.logout \? '' : `data-attendance-since="\$\{row\.login\}"`\}/);
    assert.match(html, /formatDuration\(row\.availableMs\)\} disponível/);
    assert.match(html, /colspan="10"/, 'a linha vazia precisa acompanhar o número de colunas');
});

test('o mural de presença mostra todo mundo, não só quem está em pausa', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    assert.match(html, /function renderAttendancePresence\(rows, usuarios\)/);
    // A pergunta que a tela responde é "onde a pessoa está", então quem está em
    // atendimento e quem não bateu ponto também precisam de cartão.
    assert.match(html, /if \(row\.status === 'disponivel'\)/);
    assert.match(html, /if \(row\.status === 'encerrado'\)/);
    assert.match(html, /Sem login/);
    // Ordem por urgência de leitura: pausa primeiro, offline por último.
    assert.match(html, /const ATTENDANCE_PRESENCE_ORDER = \{ pausa: 0, disponivel: 1, encerrado: 2, offline: 3 \}/);
    assert.match(html, /\(b\.openBreak\?\.ms \|\| 0\) - \(a\.openBreak\?\.ms \|\| 0\)/, 'dentro da pausa, quem está fora há mais tempo vem antes');
    // Cronômetro correndo em cada cartão de quem está fora ou atendendo.
    assert.match(html, /class="attendance-presence-timer num-mono" data-attendance-since/);
    for (const estado of ['is-live', 'is-rest', 'is-idle', 'is-danger', 'is-off']) {
        assert.match(css, new RegExp(`\\.attendance-presence-card\\.${estado} \\{`), `falta o estado ${estado}`);
    }
});

test('desvio da escala usa a mesma formatação nas duas leituras da gestão', () => {
    // Havia dois caminhos para o mesmo dado: adherence() formatava, a lista de
    // justificados imprimia o número cru — daí saía "-364min · justificado".
    assert.equal(clock.formatDelta(-364), '6h 4min antes');
    assert.equal(clock.formatDelta(-875), '14h 35min antes');
    assert.equal(clock.formatDelta(95), '1h 35min depois');
    assert.equal(clock.formatDelta(-20), '-20min');
    assert.equal(clock.formatDelta(20), '+20min');
    assert.equal(clock.formatDelta(0), 'no horário');
    assert.equal(clock.formatDelta(null), '');
    assert.equal(clock.formatDelta(undefined), '');

    // adherence() passou a delegar, então as duas leituras não podem divergir.
    const leitura = clock.adherence({ login: at(9, 0), breaks: [{ type: 'almoco', startedAt: at(12, 20) }] }, { almoco: '12:00' });
    assert.equal(leitura[0].deltaLabel, clock.formatDelta(leitura[0].deltaMin));

    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /escapeHtml\(AttendanceClock\.formatDelta\(item\.deltaMin\)\)\} · justificado/);
    assert.doesNotMatch(html, /\$\{item\.deltaMin > 0 \? `\+\$\{item\.deltaMin\}` : item\.deltaMin\}min/, 'minuto cru de volta na tela');
    // O tooltip explica que o número é distância do combinado, não duração da pausa.
    assert.match(html, /não a duração da pausa/);
});

test('a grade do seletor já vem marcada contra o expediente da pessoa', () => {
    const cedo = clock.profileOf({ x: { tracked: true, shift: { start: '07:00', end: '17:00', days: [1, 2, 3, 4, 5] } } }, 'x');
    const opcoes = clock.slotChoices('lanche', cedo);
    assert.equal(opcoes.length, clock.slotOptions('lanche').length, 'a grade não encolhe: a exceção continua possível');
    assert.equal(opcoes.find(o => o.time === '14:00').withinShift, true);
    assert.equal(opcoes.find(o => o.time === '17:30').withinShift, false, '17:30 não serve para quem sai às 17h');
    // Sem jornada cadastrada nada é acusado.
    assert.ok(clock.slotChoices('almoco', null).every(o => o.withinShift));
});

test('o seletor de horário é modal, aplica em um clique e não deixa listener solto', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    assert.match(html, /id="attendanceSlotModal"/);
    assert.match(html, /function openAttendanceSlotModal\(userId, weekday, type\)/);
    // Escolher aplica e fecha: pedir confirmação em cada uma das trinta células
    // seria pior que digitar.
    assert.match(html, /async function chooseAttendanceSlot\(valor\)/);
    assert.match(html, /closeAttendanceSlotModal\(\);\s*\n\s*await updateBreakSlot\(alvo\.userId, alvo\.weekday, alvo\.type, valor\);/);
    // Repetir na semana passou para dentro do seletor; as pílulas da linha saíram.
    assert.match(html, /if \(repetir && valor\) await applyBreakSlotToWeek\(alvo\.userId, alvo\.type\);/);
    assert.ok(!html.includes('attendance-row-actions'), 'as pílulas da linha foram substituídas pelo seletor');
    // Limpar a semana inteira a partir de uma célula seria destrutivo demais.
    assert.match(html, /if \(repetir && valor\)/);
    // Fechar pelo fundo, sem listener global — foi o que quebrou a tentativa anterior.
    assert.match(html, /layer\.onclick = evento => \{ if \(evento\.target === layer\) closeAttendanceSlotModal\(\); \};/);
    assert.match(css, /\.attendance-slot-option\.is-selected \{/);
    assert.match(css, /\.attendance-schedule \.attendance-slot\.is-empty \{ border-style: dashed/);
});

test('gestão filtra por dia e compara dois dias em ponto e pausas', () => {
    const users = { lucas: { name: 'Lucas', team: 'Catraca', active: true }, dyego: { name: 'Dyego', team: 'Catraca', active: true } };
    const perfis = { lucas: { tracked: true }, dyego: { tracked: true } };
    const segunda = new Date(2026, 7, 10, 9, 0).getTime();
    const terca = new Date(2026, 7, 11, 9, 0).getTime();
    const state = {};

    clock.registerLogin(state, 'lucas', segunda);
    clock.startBreak(state, 'lucas', 'almoco', segunda + 3 * 3600e3);
    clock.endBreak(state, 'lucas', segunda + 3 * 3600e3 + 70 * 60e3);
    clock.registerLogin(state, 'lucas', terca);
    clock.startBreak(state, 'lucas', 'almoco', terca + 3 * 3600e3);
    clock.endBreak(state, 'lucas', terca + 3 * 3600e3 + 40 * 60e3);
    clock.registerLogin(state, 'dyego', terca);   // só aparece na terça

    const cmp = clock.compareDays(state, perfis, users, segunda, terca, { team: 'Catraca' });
    assert.equal(cmp.dateA, '2026-08-10');
    assert.equal(cmp.dateB, '2026-08-11');

    const lucas = cmp.rows.find(row => row.userId === 'lucas');
    assert.equal(lucas.a.restMs, 70 * 60e3);
    assert.equal(lucas.b.restMs, 40 * 60e3);
    assert.equal(lucas.delta.restMs, -30 * 60e3, 'a diferença é B menos A');

    // Quem tem ponto só num dos dias aparece com o outro lado zerado, não ausente:
    // sumir da comparação esconderia justamente quem faltou.
    const dyego = cmp.rows.find(row => row.userId === 'dyego');
    assert.equal(dyego.a.login, null, 'sem ponto na segunda');
    assert.equal(dyego.a.onlineMs, 0);
    assert.ok(dyego.b.login, 'com ponto na terça');

    // Totais somam as linhas: teamSummary().totals só agrega parte dos campos e
    // devolvia zero em restMs, availableMs e onlineMs.
    assert.equal(cmp.totals.restMs.a, 70 * 60e3);
    assert.equal(cmp.totals.restMs.b, 40 * 60e3);
    assert.equal(cmp.totals.restMs.delta, -30 * 60e3);

    // Num dia passado "agora" é o fim daquele dia, não o relógio de hoje: uma pausa
    // esquecida em aberto na terça contaria até este instante e inventaria horas.
    const fim = new Date(clock.endOfDayReference(segunda));
    assert.equal(clock.dateKey(fim.getTime()), '2026-08-10');
    assert.ok(fim.getHours() >= 18);
    assert.ok(Math.abs(clock.endOfDayReference(Date.now()) - Date.now()) < 1000, 'hoje continua sendo agora');

    const html = fs.readFileSync('index.html', 'utf8');
    assert.match(html, /id="attendanceDayFilter" onchange="updateAttendanceFilter\('date',this\.value\)"/);
    assert.match(html, /id="attendanceCompareFilter" onchange="updateAttendanceFilter\('compare',this\.value\)"/);
    assert.match(html, /reference: AttendanceClock\.endOfDayReference\(referencia\)/);
    assert.match(html, /function renderAttendanceComparison\(usuarios\)/);
});
