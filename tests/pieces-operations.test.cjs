const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pieces = require('../js/pieces-operations.js');

const users = {
    lucas: { name: 'Lucas', team: 'Catraca', role: 'Analista de catraca', active: true },
    gestor: { name: 'Gestor', team: 'Catraca', role: 'Gestor Adm', active: true },
    logistica: { name: 'Logística', team: 'Catraca', role: 'Envio/Coleta', active: true },
    lab: { name: 'Toletus Lab', team: 'Catraca', role: 'Toletus Lab', active: true }
};

function validDraft(movement = 'Envio', reason = 'Garantia') {
    return pieces.createDraft({
        sourceTicket: '45353', protocol: '45353', analystId: 'lucas', department: 'Catraca', targetManagerId: 'gestor', movement, reason,
        requestedPriority: 'Alta', priorityReason: 'Operação do cliente parada',
        client: { brand: 'Actuar', id: 'KM7552', name: 'Academia Modelo', city: 'Goiânia', state: 'GO' },
        products: [{ id: 'item1', code: 'PF-01', name: 'Placa facial', category: 'Placa facial', quantity: 1, condition: 'Novo' }],
        description: 'Substituição necessária para restabelecer o acesso.',
        conditional: reason === 'Garantia' ? { defect: 'Sem leitura', diagnosis: 'Falha confirmada em bancada' } : reason === 'Venda de peça' ? { saleOrder: 'PV-10' } : {}
    }, 'lucas', 1000);
}

// O Lab valida e pontua antes da gestão; o check da gestão é que aprova e credita os pontos.
function labValidated(movement = 'Envio', reason = 'Garantia', options = {}) {
    const draft = validDraft(movement, reason);
    const submitted = pieces.submit(draft, 'lucas', draft.version, 2000);
    return pieces.labReview(submitted, 'validate', 'lab', {
        expectedVersion: submitted.version, pointsPerCriterion: 4,
        criteria: [{ label: 'Cliente correto', met: true }, { label: 'Produto correto', met: true }],
        ...options
    }, 2500);
}

function approved(movement = 'Envio') {
    const validated = labValidated(movement);
    return pieces.evaluate(validated, 'approve', 'gestor', {
        expectedVersion: validated.version, priority: 'Alta', invoiceRequired: true
    }, 3000);
}

test('migra log PECA legado sem apagar pontuação ou origem', () => {
    const rows = pieces.bootstrap({ logs: [{ id: 'old1', type: 'PECA', userId: 'lucas', clientId: '123', tipo: 'Coleta', value: 12, registradoPor: 'gestor', timestamp: 500 }] }, users);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].legacy, true);
    assert.equal(rows[0].movement, 'Coleta');
    assert.equal(rows[0].scoring.final, 12);
    assert.equal(pieces.operationalStatus(rows[0]), 'Concluído');
});

test('movimento e motivo são campos independentes e obrigatórios', () => {
    const draft = validDraft('Envio', 'Garantia');
    assert.equal(draft.movement, 'Envio');
    assert.equal(draft.reason, 'Garantia');
    assert.equal(pieces.validateForSubmit(draft), true);
});

test('criação e envio não concedem pontos e caem no Toletus Lab', () => {
    const draft = validDraft();
    const submitted = pieces.submit(draft, 'lucas', draft.version, 2000);
    assert.equal(submitted.requestStatus, 'pending_lab_review');
    assert.equal(submitted.scoring.final, 0);
    assert.equal(submitted.movements.length, 0);
    assert.equal(pieces.nextAction(submitted).area, 'Toletus Lab');
    assert.equal(submitted.assignments.at(-1).area, 'Toletus Lab');
});

test('Lab corrige os dados em vez de devolver ao analista e a pontuação reflete o que recebeu', () => {
    const submitted = pieces.submit(validDraft(), 'lucas', 1, 2000);

    // Corrigir sem explicar o que mudou é barrado; o histórico precisa do motivo.
    assert.throws(() => pieces.labReview(submitted, 'validate', 'lab', {
        expectedVersion: submitted.version, corrections: { client: { ...submitted.client, city: 'Anápolis' } },
        criteria: [{ label: 'Cliente correto', met: false }]
    }), /Descreva o que foi corrigido/);

    const validated = pieces.labReview(submitted, 'validate', 'lab', {
        expectedVersion: submitted.version, correctionNote: 'Cidade do cliente estava errada.',
        corrections: { client: { ...submitted.client, city: 'Anápolis' } },
        criteria: [{ label: 'Cliente correto', met: false }, { label: 'Produto correto', met: true }], pointsPerCriterion: 4
    }, 2500);

    assert.equal(validated.requestStatus, 'pending_manager_check');
    assert.equal(validated.client.city, 'Anápolis');
    assert.equal(validated.scoring.calculated, 4, 'critério não atendido reduz a pontuação do analista');
    assert.equal(validated.scoring.final, 4);
    /* A correção passou a guardar o antes e o depois: "o Lab mexeu no cliente" não
       responde nada na auditoria; "a cidade era Goiânia e virou Anápolis" responde. */
    assert.deepEqual(validated.labReview.corrections.map(item => item.field), ['client']);
    assert.equal(validated.labReview.corrections[0].label, 'Cliente');
    assert.equal(validated.labReview.corrections[0].before.city, 'Goiânia');
    assert.equal(validated.labReview.corrections[0].after.city, 'Anápolis');
    assert.equal(validated.assignments.at(-1).area, 'Gestão');
    assert.equal(pieces.nextAction(validated).area, 'Gestão');
    // Nenhum estado do fluxo devolve a solicitação ao analista.
    assert.notEqual(validated.requestStatus, 'correction_requested');
});

test('depois da postagem o acompanhamento volta ao Lab até a conclusão', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'issue', 'logistica', { expectedVersion: record.version, number: '1234' }, 4000);
    const tracked = pieces.registerTracking(issued, issued.movements[0].id, 'logistica', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', tracking: [{ code: 'BR123' }] }, 5000);
    const movementId = tracked.movements[0].id;

    // Envio/Coleta ainda embala e posta.
    assert.equal(pieces.nextAction(tracked).area, 'Envio/Coleta');
    const packing = pieces.updateMovement(tracked, movementId, 'pack', 'antonio', { expectedVersion: tracked.version }, 6000);
    const ready = pieces.updateMovement(packing, movementId, 'ready', 'antonio', { expectedVersion: packing.version }, 7000);
    assert.equal(pieces.nextAction(ready).area, 'Envio/Coleta');

    // Postada a peça, o chamado passa a ser do Lab, com as etapas segmentadas até fechar.
    const posted = pieces.updateMovement(ready, movementId, 'post', 'antonio', { expectedVersion: ready.version }, 8000);
    assert.equal(posted.movements[0].status, 'in_transit');
    assert.equal(pieces.operationalStatus(posted), 'Em trânsito');
    assert.deepEqual(pieces.nextAction(posted), { label: 'Acompanhar entrega', area: 'Toletus Lab' });

    const delivered = pieces.updateMovement(posted, movementId, 'deliver', 'lab', { expectedVersion: posted.version }, 9000);
    assert.equal(pieces.operationalStatus(delivered), 'Entregue');
    assert.deepEqual(pieces.nextAction(delivered), { label: 'Instruir o cliente e acompanhar', area: 'Toletus Lab' });

    const followup = pieces.updateMovement(delivered, movementId, 'followup', 'lab', { expectedVersion: delivered.version }, 10000);
    assert.equal(followup.movements[0].status, 'client_followup');
    assert.equal(pieces.operationalStatus(followup), 'Em acompanhamento');
    assert.deepEqual(pieces.nextAction(followup), { label: 'Concluir chamado', area: 'Toletus Lab' });

    const done = pieces.updateMovement(followup, movementId, 'complete', 'lab', { expectedVersion: followup.version, outcome: 'Cliente instruído na troca; equipamento operando.' }, 11000);
    assert.equal(pieces.operationalStatus(done), 'Concluído');
    assert.equal(done.conclusion.closedBy, 'lab');
    assert.equal(done.scoring.final, 8, 'o acompanhamento não altera a pontuação da avaliação');
});

test('registros do fluxo anterior migram para a fila do Lab sem se perder', () => {
    const antigo = { ...pieces.submit(validDraft(), 'lucas', 1, 2000), flowVersion: 2, requestStatus: 'pending_review' };
    const emAjuste = { ...pieces.submit(validDraft(), 'lucas', 1, 2000), flowVersion: 2, requestStatus: 'correction_requested' };
    const migrados = pieces.bootstrap({ pieceOperations: [antigo, emAjuste], logs: [] }, users);

    assert.equal(migrados.length, 2);
    for (const row of migrados) {
        assert.equal(row.flowVersion, 3);
        assert.equal(row.requestStatus, 'pending_lab_review');
        assert.equal(pieces.nextAction(row).area, 'Toletus Lab');
        assert.equal(row.assignments.at(-1).area, 'Toletus Lab');
        assert.equal(row.events.at(-1).type, 'flow_migrated');
    }
    // Migrar duas vezes não duplica evento nem tarefa.
    const denovo = pieces.bootstrap({ pieceOperations: migrados, logs: [] }, users);
    assert.equal(denovo[0].events.filter(item => item.type === 'flow_migrated').length, 1);
    assert.equal(denovo[0].assignments.length, migrados[0].assignments.length);
});

test('Lab reprova o que não deveria virar peça', () => {
    const submitted = pieces.submit(validDraft(), 'lucas', 1, 2000);
    assert.throws(() => pieces.labReview(submitted, 'reject', 'lab', { expectedVersion: submitted.version }), /motivo da reprovação/);
    const rejected = pieces.labReview(submitted, 'reject', 'lab', { expectedVersion: submitted.version, note: 'Chamado duplicado do 45352.' }, 2500);
    assert.equal(rejected.requestStatus, 'rejected');
    assert.equal(rejected.review.stage, 'lab');
    assert.equal(rejected.scoring.final, 0);
    assert.ok(!rejected.assignments.some(task => ['pending', 'processing'].includes(task.status)));
});

test('gestão devolve ao Lab, nunca ao analista, e a solicitação volta para o check', () => {
    const validated = labValidated();

    assert.throws(() => pieces.evaluate(validated, 'correction', 'gestor', { expectedVersion: validated.version, note: 'x' }), /não volta para o analista/);
    assert.throws(() => pieces.evaluate(validated, 'return', 'gestor', { expectedVersion: validated.version }), /o Lab precisa revisar/);

    const returned = pieces.evaluate(validated, 'return', 'gestor', { expectedVersion: validated.version, note: 'Revisar o critério de endereço.' }, 3000);
    assert.equal(returned.requestStatus, 'pending_lab_review');
    assert.equal(returned.events.at(-1).type, 'returned_to_lab');
    assert.equal(returned.assignments.at(-1).area, 'Toletus Lab');
    assert.equal(returned.managerReturn.note, 'Revisar o critério de endereço.');

    // Depois da revisão do Lab a solicitação passa de novo pelo check antes de ir à logística.
    const revalidated = pieces.labReview(returned, 'validate', 'lab', {
        expectedVersion: returned.version, criteria: [{ label: 'Endereço confirmado', met: true }], pointsPerCriterion: 4
    }, 3500);
    assert.equal(revalidated.requestStatus, 'pending_manager_check');
    assert.equal(pieces.nextAction(revalidated).area, 'Gestão');

    const confirmed = pieces.evaluate(revalidated, 'confirm', 'gestor', { expectedVersion: revalidated.version }, 4000);
    assert.equal(confirmed.requestStatus, 'approved');
    assert.equal(confirmed.assignments.at(-1).area, 'Logística/Faturamento');
});

test('aprovação calcula pontos e cria handoff automático para faturamento', () => {
    const record = approved();
    assert.equal(record.requestStatus, 'approved');
    assert.equal(record.scoring.final, 8);
    assert.equal(record.fiscal.status, 'awaiting_invoice');
    assert.equal(record.assignments[0].area, 'Logística/Faturamento');
    assert.equal(record.events.at(-1).type, 'approved_handoff');
});

test('gestão pode alterar a pontuação do Lab, mas só com justificativa', () => {
    const validated = labValidated();
    assert.equal(validated.scoring.calculated, 8);

    assert.throws(() => pieces.evaluate(validated, 'approve', 'gestor', { expectedVersion: validated.version, finalPoints: 30 }), /Justifique/);

    const adjusted = pieces.evaluate(validated, 'approve', 'gestor', {
        expectedVersion: validated.version, finalPoints: 12, scoreReason: 'Reincidência tratada no mesmo chamado.'
    }, 3000);
    assert.equal(adjusted.scoring.calculated, 8, 'o cálculo do Lab fica preservado no histórico');
    assert.equal(adjusted.scoring.final, 12);
    assert.equal(adjusted.scoring.adjustmentReason, 'Reincidência tratada no mesmo chamado.');
    assert.equal(adjusted.scoring.reviewedBy, 'lab');
    assert.equal(adjusted.scoring.approvedBy, 'gestor');
});

test('troca cria envio e coleta relacionados com estados independentes', () => {
    const record = approved('Troca');
    assert.deepEqual(record.movements.map(item => item.kind), ['Envio', 'Coleta']);
    assert.notEqual(record.movements[0].id, record.movements[1].id);
});

test('atribuição evita processamento duplicado e valida versão', () => {
    const record = approved();
    const claimed = pieces.claim(record, 'logistica', 'Logística/Faturamento', record.version, 4000);
    assert.throws(() => pieces.claim(claimed, 'outra_pessoa', 'Logística/Faturamento', claimed.version, 5000), /processamento/);
    assert.throws(() => pieces.claim(claimed, 'logistica', 'Logística/Faturamento', record.version, 5000), /atualizada/);
});

test('NF emitida encaminha para geração de etiqueta e rastreio', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'issue', 'logistica', { expectedVersion: record.version, number: '1234', issuedAt: 4000, value: 500 }, 4000);
    assert.equal(issued.fiscal.status, 'issued');
    assert.equal(issued.movements[0].status, 'awaiting_tracking');
    assert.equal(pieces.nextAction(issued).area, 'Logística/Faturamento');
});

test('rastreio gera handoff para Envio/Coleta e postagem inicia acompanhamento', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'issue', 'logistica', { expectedVersion: record.version, number: '1234', issuedAt: 4000 }, 4000);
    assert.throws(() => pieces.registerTracking(issued, issued.movements[0].id, 'logistica', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', tracking: [] }), /rastreio/);
    const tracked = pieces.registerTracking(issued, issued.movements[0].id, 'logistica', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', tracking: [{ code: 'BR123' }] }, 5000);
    assert.equal(tracked.movements[0].status, 'awaiting_packing');
    assert.equal(tracked.assignments.at(-1).area, 'Envio/Coleta');
    const packing = pieces.updateMovement(tracked, tracked.movements[0].id, 'pack', 'antonio', { expectedVersion: tracked.version }, 6000);
    const ready = pieces.updateMovement(packing, packing.movements[0].id, 'ready', 'antonio', { expectedVersion: packing.version }, 7000);
    const posted = pieces.updateMovement(ready, ready.movements[0].id, 'post', 'antonio', { expectedVersion: ready.version }, 8000);
    assert.equal(posted.movements[0].status, 'in_transit');
});

test('Logística pode devolver informação para Gestão ou Envio e retomar após resposta', () => {
    const record = approved();
    const returned = pieces.returnForInformation(record, 'logistica', { expectedVersion: record.version, targetArea: 'Gestão', note: 'Confirmar endereço de entrega' }, 4000);
    assert.equal(pieces.nextAction(returned).area, 'Gestão');
    assert.equal(returned.assignments.at(-1).area, 'Gestão');
    const answered = pieces.resolveInformation(returned, 'gestor', 'Endereço confirmado com o cliente.', returned.version, 5000);
    assert.equal(answered.informationRequest.status, 'answered');
    assert.equal(answered.assignments.at(-1).area, 'Logística/Faturamento');
});

test('Envio/Coleta confirma entrega e conclui o chamado sem alterar a avaliação', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'issue', 'logistica', { expectedVersion: record.version, number: '1234' }, 4000);
    const tracked = pieces.registerTracking(issued, issued.movements[0].id, 'logistica', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', tracking: [{ code: 'BR123' }] }, 5000);
    const packing = pieces.updateMovement(tracked, tracked.movements[0].id, 'pack', 'antonio', { expectedVersion: tracked.version }, 6000);
    const ready = pieces.updateMovement(packing, packing.movements[0].id, 'ready', 'antonio', { expectedVersion: packing.version }, 7000);
    const posted = pieces.updateMovement(ready, ready.movements[0].id, 'post', 'antonio', { expectedVersion: ready.version }, 8000);
    const delivered = pieces.updateMovement(posted, posted.movements[0].id, 'deliver', 'antonio', { expectedVersion: posted.version }, 9000);
    const completed = pieces.updateMovement(delivered, delivered.movements[0].id, 'complete', 'antonio', { expectedVersion: delivered.version, outcome: 'Peça entregue e instalada no cliente.' }, 10000);
    assert.equal(pieces.operationalStatus(completed), 'Concluído');
    assert.equal(completed.scoring.final, record.scoring.final);
});

test('ocorrência não substitui status operacional principal', () => {
    const record = approved();
    const withOccurrence = pieces.addOccurrence(record, 'logistica', { expectedVersion: record.version, type: 'Atrasado', description: 'Transportadora sem atualização' }, 5000);
    assert.equal(withOccurrence.movements[0].status, 'awaiting_invoice');
    assert.equal(pieces.operationalStatus(withOccurrence), 'Com ocorrência');
});

test('fila respeita prioridade antes da data', () => {
    const normal = { ...approved(), id: 'normal', approvedPriority: 'Normal', approvedAt: 1000 };
    const critical = { ...approved(), id: 'critical', approvedPriority: 'Crítica', approvedAt: 5000 };
    assert.deepEqual(pieces.sortQueue([normal, critical]).map(item => item.id), ['critical', 'normal']);
});

test('taxa de garantia usa denominador vendido ou instalado e não volume absoluto', () => {
    const record = approved();
    assert.equal(pieces.guaranteeRate([record], 'PF-01', 20), 0.05);
    assert.equal(pieces.guaranteeRate([record], 'PF-01', 0), null);
});

test('pendências obrigatórias são agrupadas por etapa sem bloquear o rascunho', () => {
    assert.deepEqual(pieces.pendingRequirements(validDraft()), []);

    const draft = pieces.createDraft({ movement: 'Envio', reason: 'Garantia', requestedPriority: 'Alta', client: { brand: 'Actuar' } }, 'lucas', 1000);
    const pending = pieces.pendingRequirements(draft);
    const steps = [...new Set(pending.map(item => item.step))];

    assert.deepEqual(steps.sort(), ['client', 'details', 'origin', 'products']);
    assert.equal(pending[0].step, 'origin');
    assert.equal(pending[0].message, 'Informe o chamado ou protocolo de origem.');
    assert.ok(pending.some(item => item.step === 'origin' && item.field === 'priorityReason'));
    assert.ok(pending.some(item => item.step === 'client' && item.field === 'client.id'));
    assert.ok(pending.some(item => item.step === 'products' && item.field === 'products'));
    assert.ok(pending.some(item => item.step === 'details' && item.field === 'conditional.defect'));

    // O rascunho continua editável; a validação só barra o envio.
    assert.equal(pieces.updateDraft(draft, { description: 'Parcial' }, 'lucas', 1).description, 'Parcial');
    assert.throws(() => pieces.submit(draft, 'lucas', 1), /Informe o chamado ou protocolo de origem\./);
});

test('etapas do wizard navegam livremente e só o envio exige os obrigatórios', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    assert.match(ui, /window\.goToPiecesWizardStep = goToStep/);
    assert.match(ui, /function moveWizard\(direction\) \{ goToStep\(state\.wizardStep \+ direction\); \}/);
    assert.match(ui, /onclick="goToPiecesWizardStep\(\$\{index\}\)"/);
    assert.doesNotMatch(ui, /Confirme o cliente antes de continuar/);
    assert.match(ui, /const pending = wizardPending\(\);\s*\n\s*if \(pending\.length\) \{/);
    assert.match(css, /\.pieces-wizard-step:focus-visible/);
    assert.match(css, /\.pieces-review-status\.is-blocked/);
});

test('interface inclui navegação, wizard, ficha, fiscal, logística e responsividade', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    for (const marker of ['admPiecesModule', 'piecesAnalystEntry', 'Nova solicitação de peça', 'Solicitações de peças', 'Acesso operacional', 'piecesModuleStandalone', 'piecesRequestModal', 'piecesDetailDrawer', 'piecesActionModal', 'pieces-operations.js', 'pieces-ui.js']) assert.match(html, new RegExp(marker));
    for (const marker of ['Validar e pontuar', 'Acompanhamento', 'Devolver ao Lab', 'Confirmar e encaminhar', 'Minha operação', 'Notas fiscais', 'Expedição', 'Coletas', 'Em trânsito', 'Ocorrências', 'Concluídos', 'Confirmar e encaminhar', 'Registrar etiqueta e rastreio', 'Registrar frete e volumes', 'Encerrar ocorrência', 'Concluir chamado', 'Pontuação final', 'Mais filtros', 'Filtros aplicados']) assert.match(ui, new RegExp(marker));
    for (const marker of ['pieces-sla', 'pieces-filter-advanced', 'pieces-applied-filters', 'pieces-metric-list', 'Garantia por produto', 'Desempenho por analista']) assert.match(ui, new RegExp(marker));
    assert.match(css, /pieces-kpi-grid/);
    assert.match(css, /@media\(max-width:768px\)/);
});

test('SLA usa a prioridade aprovada e sinaliza atraso por etapa', () => {
    const record = approved();
    const inWindow = pieces.sla(record, record.approvedAt + 3600000);
    assert.equal(inWindow.state, 'on_track');
    assert.equal(inWindow.priority, 'Alta');
    assert.equal(inWindow.dueAt, pieces.sla(record, record.approvedAt).startedAt + pieces.SLA_TARGETS.Alta);
    assert.equal(pieces.sla(record, record.approvedAt + 7 * 3600000).state, 'due_soon');
    assert.equal(pieces.sla(record, record.approvedAt + 9 * 3600000).state, 'late');
    assert.equal(pieces.isLate(record, record.approvedAt + 9 * 3600000), true);
});

test('prazo prometido ao cliente antecipa o vencimento do SLA', () => {
    const draft = { ...validDraft(), promisedAt: 2000 };
    const sent = pieces.submit(draft, 'lucas', draft.version, 2000);
    const validated = pieces.labReview(sent, 'validate', 'lab', { expectedVersion: sent.version, criteria: [{ label: 'ok', met: true }] }, 2500);
    const evaluated = pieces.evaluate(validated, 'approve', 'gestor', { expectedVersion: validated.version }, 3000);
    const result = pieces.sla(evaluated, 3000);
    assert.equal(result.basis, 'promised');
    assert.equal(result.state, 'late');
});

test('solicitação concluída não gera cobrança de SLA', () => {
    const record = approved();
    const done = { ...record, movements: record.movements.map(item => ({ ...item, status: 'completed' })), fiscal: { ...record.fiscal, status: 'not_required' } };
    assert.equal(pieces.sla(done, done.approvedAt + 999999999).state, 'completed');
});

test('ocorrência pode ser encerrada e deixa de bloquear o status operacional', () => {
    const record = approved();
    const withOccurrence = pieces.addOccurrence(record, 'logistica', { expectedVersion: record.version, type: 'Atrasado', description: 'Transportadora sem coleta' }, 5000);
    assert.equal(pieces.operationalStatus(withOccurrence), 'Com ocorrência');
    assert.throws(() => pieces.resolveOccurrence(withOccurrence, withOccurrence.occurrences[0].id, 'logistica', { expectedVersion: withOccurrence.version }), /resolvida/);
    const resolved = pieces.resolveOccurrence(withOccurrence, withOccurrence.occurrences[0].id, 'logistica', { expectedVersion: withOccurrence.version, resolution: 'Coleta reagendada e confirmada' }, 6000);
    assert.equal(resolved.occurrences[0].status, 'resolved');
    assert.equal(resolved.occurrences[0].resolvedBy, 'logistica');
    assert.notEqual(pieces.operationalStatus(resolved), 'Com ocorrência');
    assert.throws(() => pieces.resolveOccurrence(resolved, resolved.occurrences[0].id, 'logistica', { expectedVersion: resolved.version, resolution: 'De novo' }), /já foi encerrada/);
});

test('etapas de aguardando transportadora, retorno e inspeção são alcançáveis', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'not_required', 'logistica', { expectedVersion: record.version }, 4000);
    const tracked = pieces.registerTracking(issued, issued.movements[0].id, 'logistica', { expectedVersion: issued.version, carrier: 'Jadlog', modality: 'Expresso', tracking: [{ code: 'JD1' }] }, 5000);
    const waiting = pieces.updateMovement(tracked, tracked.movements[0].id, 'await_carrier', 'antonio', { expectedVersion: tracked.version }, 6000);
    assert.equal(waiting.movements[0].status, 'awaiting_carrier');
    const collection = pieces.updateMovement(waiting, waiting.movements[0].id, 'return', 'antonio', { expectedVersion: waiting.version }, 7000);
    assert.equal(collection.movements[0].status, 'returning');
    const inspection = pieces.updateMovement(collection, collection.movements[0].id, 'await_inspection', 'antonio', { expectedVersion: collection.version }, 8000);
    assert.equal(inspection.movements[0].status, 'awaiting_inspection');
});

test('registro de frete grava custos sem avançar a etapa logística', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'not_required', 'logistica', { expectedVersion: record.version }, 4000);
    const before = issued.movements[0].status;
    assert.throws(() => pieces.updateMovement(issued, issued.movements[0].id, 'freight', 'logistica', { expectedVersion: issued.version, carrier: 'Correios' }), /modalidade/i);
    const freight = pieces.updateMovement(issued, issued.movements[0].id, 'freight', 'logistica', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', quotedCost: 80, actualCost: 92, weight: '2kg', costCenter: 'Suporte' }, 5000);
    assert.equal(freight.movements[0].status, before);
    assert.equal(freight.movements[0].quotedCost, 80);
    assert.equal(freight.movements[0].costCenter, 'Suporte');
});

test('filtros cobrem marca, transportadora, UF, NF, rastreio e SLA', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'issue', 'logistica', { expectedVersion: record.version, number: '999', issuedAt: 4000 }, 4000);
    const tracked = pieces.registerTracking(issued, issued.movements[0].id, 'logistica', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', tracking: [{ code: 'BR9' }] }, 5000);
    const rows = [tracked];
    assert.equal(pieces.filter(rows, { brand: 'Actuar' }).length, 1);
    assert.equal(pieces.filter(rows, { brand: 'Toletus' }).length, 0);
    assert.equal(pieces.filter(rows, { carrier: 'Correios' }).length, 1);
    assert.equal(pieces.filter(rows, { carrier: 'Jadlog' }).length, 0);
    assert.equal(pieces.filter(rows, { state: 'go' }).length, 1);
    assert.equal(pieces.filter(rows, { invoice: 'yes' }).length, 1);
    assert.equal(pieces.filter(rows, { invoice: 'no' }).length, 0);
    assert.equal(pieces.filter(rows, { tracking: 'yes' }).length, 1);
    assert.equal(pieces.filter(rows, { occurrence: 'no' }).length, 1);
    assert.equal(pieces.filter(rows, { category: 'Placa facial' }).length, 1);
    assert.equal(pieces.filter(rows, { from: 999999999999 }).length, 0);
});

test('indicadores de operação, qualidade, frete e garantia usam bases reais', () => {
    // "Devolvida" virou "o Lab precisou corrigir": mesmo sinal de qualidade do que o analista enviou.
    const corrigida = pieces.labReview(pieces.submit(validDraft(), 'lucas', 1, 2000), 'validate', 'lab', {
        correctionNote: 'Faltou evidência', corrections: { evidence: ['anexo-1.png'] }, criteria: [{ label: 'Evidências suficientes', met: false }]
    }, 3000);
    const approvedRow = approved();
    const rows = [corrigida, approvedRow];

    const quality = pieces.qualityMetrics(rows);
    assert.equal(quality.returned, 1);
    assert.equal(quality.reviewed, 2);
    assert.equal(quality.returnReasons['Faltou evidência'], 1);
    assert.equal(quality.returnRate, 0.5);
    assert.equal(quality.firstTryRate, 0.5);
    assert.ok(quality.byAnalyst.lucas.total >= 1);

    const operation = pieces.operationMetrics(rows, approvedRow.approvedAt + 9 * 3600000);
    assert.equal(operation.late, 2);
    assert.equal(operation.onTimeRate, 0);
    assert.ok(operation.submitToApproval > 0);

    const freighted = pieces.updateMovement(pieces.updateFiscal(approvedRow, 'not_required', 'logistica', { expectedVersion: approvedRow.version }, 4000), approvedRow.movements[0].id, 'freight', 'logistica', { expectedVersion: approvedRow.version + 1, carrier: 'Correios', modality: 'PAC', quotedCost: 100, actualCost: 130 }, 5000);
    const freight = pieces.freightMetrics([freighted]);
    assert.equal(freight.total, 130);
    assert.equal(freight.quotedVsActual, 30);
    assert.equal(freight.byCarrier.Correios.count, 1);

    const warranty = pieces.warrantyMetrics(rows, { 'PF-01': 20 });
    assert.equal(warranty.requests, 2);
    assert.equal(warranty.byProduct['PF-01'].quantity, 2);
    assert.equal(warranty.byProduct['PF-01'].rate, 0.1);
    assert.equal(pieces.warrantyMetrics(rows, {}).byProduct['PF-01'].rate, null);
});

test('analista escolhe o gestor avaliador e a pendência é endereçada a ele', () => {
    const semGestor = pieces.createDraft({ sourceTicket: '1', movement: 'Envio', reason: 'Outro', client: { brand: 'Actuar', id: 'K', name: 'C' }, products: [{ name: 'P', quantity: 1 }], description: 'x' }, 'lucas', 1000);
    assert.ok(pieces.pendingRequirements(semGestor).some(item => item.field === 'targetManagerId'));
    assert.throws(() => pieces.submit(semGestor, 'lucas', 1), /gestor que vai avaliar/);

    const draft = { ...validDraft(), targetManagerId: 'gestor' };
    const sent = pieces.submit(draft, 'lucas', draft.version, 2000);
    // O gestor escolhido só entra depois do Lab; a primeira parada é sempre a validação.
    assert.equal(pieces.nextAction(sent).area, 'Toletus Lab');

    const validated = pieces.labReview(sent, 'validate', 'lab', { expectedVersion: sent.version, criteria: [{ label: 'ok', met: true }] }, 2500);
    assert.equal(pieces.nextAction(validated).area, 'Gestão');
    assert.equal(pieces.nextAction(validated).assigneeId, 'gestor');
    assert.equal(pieces.filter([sent], { targetManagerId: 'gestor' }).length, 1);
    assert.equal(pieces.filter([sent], { targetManagerId: 'outro' }).length, 0);
});

test('conclusão do chamado exige o desfecho da demanda e é registrada na solicitação', () => {
    const record = approved();
    const issued = pieces.updateFiscal(record, 'not_required', 'ana', { expectedVersion: record.version }, 4000);
    const tracked = pieces.registerTracking(issued, issued.movements[0].id, 'ana', { expectedVersion: issued.version, carrier: 'Correios', modality: 'PAC', tracking: [{ code: 'BR1' }] }, 5000);
    const id = tracked.movements[0].id;
    assert.throws(() => pieces.updateMovement(tracked, id, 'complete', 'antonio', { expectedVersion: tracked.version }), /desfecho/);
    const done = pieces.updateMovement(tracked, id, 'complete', 'antonio', { expectedVersion: tracked.version, outcome: 'Peça trocada e equipamento validado no cliente.' }, 6000);
    assert.equal(done.movements[0].status, 'completed');
    assert.equal(done.conclusion.outcome, 'Peça trocada e equipamento validado no cliente.');
    assert.equal(done.conclusion.closedBy, 'antonio');
    assert.equal(pieces.operationalStatus(done), 'Concluído');
    assert.equal(pieces.sla(done, 999999999999).state, 'completed');
});

test('todo drawer usa a estrutura de camada, backdrop e painel do Design System', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    const layers = [...html.matchAll(/<div id="(\w+)"[^>]*class="[^"]*rotation-drawer-layer[^"]*"[^>]*>([\s\S]*?)\n\s*<\/div>/g)];

    assert.ok(layers.length >= 2, 'esperava ao menos dois drawers no shell');
    for (const [, id, inner] of layers) {
        assert.match(inner, /class="rotation-drawer-backdrop"/, `${id} não tem backdrop clicável`);
        assert.match(inner, /class="rotation-drawer-panel/, `${id} não usa .rotation-drawer-panel`);
    }
    // A classe .rotation-drawer (sem sufixo) não existe no Design System e deixaria o painel sem layout.
    assert.doesNotMatch(html, /class="rotation-drawer /);
    // A ficha de peças deixou de ser drawer lateral: agora é modal central, como o wizard e as ações.
    assert.doesNotMatch(html, /id="piecesDetailDrawer"[^>]*rotation-drawer-layer/);
    assert.match(html, /id="piecesDetailDrawer" class="hidden rotation-modal-layer pieces-modal-layer pieces-detail-layer"/);
    assert.match(html, /class="rotation-modal-card pieces-detail-drawer"/);
    assert.match(css, /\.rotation-modal-card\.pieces-detail-drawer \{ display: flex;/);
    assert.match(css, /\.rotation-modal-card\.pieces-detail-drawer \.pieces-detail-actions \{ position: sticky/);
});

test('ficha e overlays secundários nunca ficam empilhados', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // A ficha recua ao abrir wizard de correção ou modal de ação, e volta quando eles fecham.
    assert.match(ui, /function openRequest\(recordId\) \{[\s\S]{0,420}state\.detailSuspended = suspendDetail\(\);/);
    assert.match(ui, /state\.actionContext = contextId \|\| null; state\.detailSuspended = suspendDetail\(\);/);
    assert.match(ui, /function closeRequest\(\) \{[^}]*resumeDetail\(\);/);
    assert.match(ui, /function closeAction\(\) \{[^}]*resumeDetail\(\);/);
    // Fechar a ficha de vez limpa o estado suspenso, para não reabrir sozinha depois.
    assert.match(ui, /function closeDetail\(\) \{[^}]*state\.detailSuspended = false;/);

    // O wizard vem antes da ficha no DOM; sem z-index explícito a ficha o cobriria.
    assert.ok(html.indexOf('id="piecesRequestModal"') < html.indexOf('id="piecesDetailDrawer"'));
    assert.match(css, /\.pieces-detail-layer \{ z-index: 140; \}/);
    assert.match(css, /\.pieces-modal-layer:not\(\.pieces-detail-layer\) \{ z-index: 150; \}/);
});

test('rótulo de checkbox não reusa a classe da caixa do input', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // .actuar-checkbox é a caixa de 16x16 que enhanceReusableComponents aplica ao input.
    // Usá-la no <label> espremia o rótulo inteiro em 16px e vazava o texto por cima do formulário.
    assert.doesNotMatch(html, /<label class="actuar-checkbox["\s]/);
    assert.doesNotMatch(ui, /<label class="actuar-checkbox["\s]/);
    assert.match(html, /<label class="actuar-checkbox-field/);
    assert.match(ui, /<label class="actuar-checkbox-field/);
    assert.match(css, /\.actuar-checkbox-field \{[^}]*display: flex/);
    assert.match(css, /\.pieces-criteria \{[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
    assert.match(css, /\.rotation-modal-card \.actuar-form-grid \.actuar-field \+ \.actuar-field \{ margin-top: 0; \}/);
});

test('aba de peças mostra quantas solicitações aguardam o check da gestão', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    // Rótulo enxuto e badge no mesmo padrão já usado por Transferências.
    // O contador mudou de lugar — da barra horizontal para o item Peças da sidebar —,
    // mas continua sendo o mesmo elemento que pieces-ui preenche.
    assert.match(fs.readFileSync('js/actuar-navigation.js', 'utf8'), /label: 'Peças'[\s\S]{0,160}badgeId: 'admPiecesPendingBadge'/);
    assert.match(html, /navBadgeMarkup\(item\.badgeId\)/);
    assert.doesNotMatch(html, /Peças Catraca/);
    // O visual do contador agora é do design system (.actuar-nav-badge), não mais
    // classes soltas do Tailwind na barra antiga.
    assert.match(html, /<span id="\$\{id\}" class="actuar-nav-badge hidden">0<\/span>/);

    // Contagem no escopo do gestor, escondida quando não há pendência, e atualizada a cada render.
    assert.match(ui, /if \(currentContext\(\)\.mode !== 'manager'\) return 0;/);
    assert.match(ui, /allowedRecords\(\)\.filter\(row => row\.requestStatus === 'pending_manager_check'\)\.length/);
    assert.match(ui, /badge\.classList\.toggle\('hidden', count === 0\)/);
    assert.match(ui, /initStore\(\);\s*\n\s*updatePendingBadge\(\);/);
    assert.match(ui, /window\.updatePiecesPendingBadge = updatePendingBadge;/);
    assert.match(html, /window\.updatePiecesPendingBadge\?\.\(\);/);
});

test('interface reflete o fluxo Lab → Gestão → Logística → Lab', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    // O Lab é um perfil operacional próprio, com modo e abas dedicadas.
    assert.match(html, /PIECES_OPERATION_ROLES = new Set\(\[[^\]]*'Toletus Lab'\]\)/);
    // Chega-se ao Lab pelo login com o papel do cadastro — não por atalho de
    // visualização na tela de entrada, que deixava qualquer um abrir a operação.
    assert.match(html, /<option value="Toletus Lab">/);
    for (const atalho of ['enterLocalPecaPreview', 'ACTUAR_LOCAL_PIECES_ROLE', 'pecaLocalPreviewButton', 'Visualizar como']) {
        assert.ok(!html.includes(atalho), `atalho de visualização de volta na tela de login: ${atalho}`);
        assert.ok(!ui.includes(atalho), `atalho de visualização de volta no módulo de peças: ${atalho}`);
    }
    assert.match(ui, /mode: user\?\.role === LAB_ROLE \? 'lab' : 'logistics'/);
    // O Lab acompanha do começo ao fim e ainda embala e posta: a fila de validação
    // abre a tela, e o resto é a visão da gestão inteira.
    assert.match(ui, /if \(mode === 'lab'\) return \[\['validation', 'Validar e pontuar'\], \['overview', 'Visão geral'\], \['requests', 'Solicitações'\]/);

    // Filas de cada etapa.
    assert.match(ui, /state\.tab === 'validation'.*requestStatus === 'pending_lab_review'/);
    assert.match(ui, /state\.tab === 'followup'.*nextAction\(row\)\.area === LAB_ROLE/);

    // Ações por perfil: o Lab valida/reprova, a gestão confere e devolve ao Lab.
    assert.match(ui, /openPiecesAction\('labValidate'\)/);
    assert.match(ui, /openPiecesAction\('labReject'\)/);
    assert.match(ui, /openPiecesAction\('returnToLab'\)/);
    assert.match(ui, /requestStatus === 'pending_manager_check'\) buttons\.push/);

    // Nada volta para o analista: o botão de corrigir some da ficha dele.
    assert.doesNotMatch(ui, /mode === 'analyst' && record\.requestStatus === 'correction_requested'/);
    // O Lab corrige pelo próprio wizard, sem sair da fila de validação.
    assert.match(ui, /domain\(\)\.labCorrect\(original, corrections, context\.actorId/);
});

test('erro do wizard nasce colado no campo, e não só num aviso solto', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Cada regra do domínio tem um input correspondente na tela.
    const mapped = [...ui.matchAll(/'([a-zA-Z.]+)': 'pw[A-Za-z]+'/g)].map(match => match[1]);
    const draft = pieces.createDraft({ movement: 'Envio', reason: 'Garantia', requestedPriority: 'Alta', client: { brand: 'Actuar' } }, 'lucas', 1000);
    for (const item of pieces.pendingRequirements(draft)) {
        if (item.field.startsWith('products')) continue; // produtos têm editor próprio, sem input fixo
        assert.ok(mapped.includes(item.field), `regra ${item.field} não aponta para nenhum campo da tela`);
    }

    assert.match(ui, /function paintPendingErrors\(pending\)/);
    assert.match(ui, /window\.ActuarFields\.showError\(input, item\.message\)/);
    assert.match(ui, /target\?\.scrollIntoView\?\.\(\{ block: 'center'/);
    assert.match(ui, /campos precisam de correção\. Comece por/);
    assert.match(css, /\.actuar-field-error \{/);
});

test('cliente pode ser pessoa física, com CPF e rótulos próprios', () => {
    const pj = { brand: 'Actuar', id: 'KM7552', name: 'Academia Modelo' };
    const pf = { ...pj, personType: 'Física' };

    assert.equal(pieces.documentTypeOf(pj), 'cnpj');
    assert.equal(pieces.documentTypeOf(pf), 'cpf');
    assert.equal(pieces.documentLabelOf(pf), 'CPF');
    assert.equal(pieces.nameLabelOf(pf), 'Nome completo');
    assert.equal(pieces.nameLabelOf(pj), 'Razão social');
    // Sem tipo declarado, o cliente continua sendo pessoa jurídica.
    assert.equal(pieces.personTypeOf({}), 'Jurídica');
    assert.equal(pieces.personTypeOf(undefined), 'Jurídica');

    const comDoc = client => pieces.pendingRequirements({ ...validDraft(), client: { ...validDraft().client, ...client } }).map(item => item.message);
    assert.ok(comDoc({ personType: 'Física', document: '11.222.333/0001-81' }).some(m => m.includes('CPF inválido')));
    assert.ok(comDoc({ document: '529.982.247-25' }).some(m => m.includes('CNPJ inválido')));
    assert.deepEqual(comDoc({ personType: 'Física', document: '529.982.247-25' }), []);

    // Registros antigos guardavam o documento em client.cnpj; a migração move sem perder.
    const antigo = { ...pieces.submit(validDraft(), 'lucas', 1, 2000), flowVersion: 2 };
    antigo.client = { ...antigo.client, cnpj: '11.222.333/0001-81' };
    const [migrado] = pieces.bootstrap({ pieceOperations: [antigo], logs: [] }, users);
    assert.equal(migrado.client.document, '11.222.333/0001-81');
    assert.equal(migrado.client.personType, 'Jurídica');
    assert.equal(pieces.documentOf(migrado.client), '11.222.333/0001-81');
});

test('solicitação de peça é rotina de Catraca: Sistema não vê o botão nem abre o modal', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    const html = fs.readFileSync('index.html', 'utf8');

    // Uma regra só, consultada pelo cabeçalho do módulo, pela chamada do analista e pelo próprio modal.
    assert.match(ui, /function canRequestPieces\(\) \{[\s\S]*?return context\.user\?\.team === 'Catraca';\s*\}/);
    assert.match(ui, /if \(context\.mode === 'logistics' \|\| context\.mode === 'lab'\) return false;/);
    assert.match(ui, /if \(context\.mode === 'manager'\) return !context\.teams\.length \|\| context\.teams\.includes\('Catraca'\);/);
    assert.match(ui, /\$\{canRequestPieces\(\) \? `<button class="actuar-btn actuar-btn-primary" onclick="openPiecesRequestModal\(\)"/);
    assert.match(ui, /if \(!record && !canRequestPieces\(\)\) return showToast\('Solicitações de peça são uma rotina da equipe de Catraca\.', 'error'\);/);
    assert.match(ui, /window\.canRequestPieces = canRequestPieces;/);
    assert.match(html, /piecesAnalystEntry'\)\?\.classList\.toggle\('hidden', isPecaLoggedIn \|\| window\.canRequestPieces\?\.\(\) === false\)/);

    // O Lab continua abrindo o wizard para corrigir uma solicitação existente.
    assert.match(ui, /openPiecesRequestModal\('\$\{record\.id\}'\)">Corrigir dados/);
});

test('analista entra com o próprio usuário e a URL não troca mais a identidade', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Login por usuário, com a senha conferida no banco pela mesma RPC já usada pelos outros acessos.
    assert.match(html, /<select id="analystUserSelect" required><\/select>/);
    assert.match(html, /if \(!await verifyLoginRemote\(selectedId, pass\)\) return showLoginError\('analyst', "Senha incorreta!"\);/);
    assert.match(html, /isAnalystLoggedIn = true;\s*\n\s*currentActiveUser = selectedId;/);
    // Nenhuma senha no frontend: só a checagem remota e o flag de "tem senha".
    assert.doesNotMatch(html, /password:\s*['"][^'"]+['"]/);
    assert.match(html, /if \(!user\.hasPassword\) return showLoginError\('analyst',/);

    // A identidade vem da sessão; ?analyst= deixou de valer para não permitir personificação.
    assert.match(html, /userId: analystSession,/);
    assert.doesNotMatch(html, /userId: query\.get\('analyst'\)/);
    // A persistência passou para a sessão unificada, que sobrevive à recarga.
    assert.match(html, /saveSession\('analyst', selectedId\);/);
    assert.match(html, /function logoutAnalyst\(\) \{[\s\S]{0,120}clearSession\(\);/);

    // Primeiro acesso: senha aleatória por pessoa, gravada pela RPC, nunca fixa no código.
    assert.match(html, /crypto\.getRandomValues\(values\)/);
    assert.match(html, /if \(!await setUserPasswordRemote\(id, password\)\) continue;/);
    // Cobre todo mundo ativo sem senha, e não só quem entra no ranking: o Toletus Lab
    // e os papéis de peça ficavam sem caminho de volta ao acesso.
    assert.match(html, /const pending = Object\.keys\(usersList\)\.filter\(id => usersList\[id\]\.active !== false && !usersList\[id\]\.hasPassword\)/);
});

test('acesso mockado de gestão foi removido do produto', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    for (const marker of ['__local_jg__', 'localManagerProfile', 'loginLocalManager', 'ensureLocalJoaoManager',
                          'findJoaoManagerId', 'restoreLocalManagerSession', 'LOCAL_MANAGER_SESSION_KEY',
                          'localManagerAccessButton', 'actuar-local-access-button']) {
        assert.ok(!html.includes(marker), `resquício do acesso mockado no HTML: ${marker}`);
    }
    assert.ok(!css.includes('actuar-local-access-button'), 'CSS órfão do acesso mockado');

    // Gestão passa a ter um caminho só: usuário cadastrado com senha conferida no banco.
    assert.match(html, /function loginAdmin\(e\)/);
    assert.match(html, /return isAdminLoggedIn \? currentAdminId : currentActiveUser;/);
});

test('sem sessão a aplicação fica no portão de acesso', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // O portão cobre a aplicação enquanto ninguém estiver autenticado.
    assert.match(html, /id="loginGate"/);
    assert.match(html, /function hasAnySession\(\) \{ return isAnalystLoggedIn \|\| isAdminLoggedIn \|\| isPecaLoggedIn; \}/);
    /* O portal externo é a única exceção, e é estreita: quem abre #/portal-prioridades não
       tem conta no ActuarClassifique, então exigir sessão ali negaria a razão dele existir.
       Qualquer outra rota continua trancada. */
    assert.match(html, /const locked = !hasAnySession\(\) && !isPortalRoute\(\);/);
    assert.match(html, /function isPortalRoute\(\) \{ return currentRoute\?\.name === 'portal-prioridades'; \}/);
    assert.match(html, /gate\.classList\.toggle\('hidden', !locked\);/);
    // Reavaliado a cada render, então qualquer logout cai no portão.
    assert.match(html, /function render\(\) \{\s*\n\s*syncLoginGate\(\);/);
    // Sair não deixa mais o dashboard de outra pessoa aparecendo atrás do modal.
    assert.match(html, /function logoutAnalyst\(\) \{[\s\S]*?closeAnalystModal\(\);[\s\S]*?syncLoginGate\(\);/);

    // As três portas ficam no portão e expandem no lugar, sem abrir outra camada por cima.
    for (const door of ['analyst', 'admin', 'peca']) {
        assert.ok(html.includes(`onclick="toggleLoginDoor('${door}')"`), `porta ausente no portão: ${door}`);
        assert.ok(html.includes(`data-door="${door}"`), `porta sem grupo expansível: ${door}`);
        assert.ok(html.includes(`data-login-error="${door}"`), `porta sem área de erro no formulário: ${door}`);
    }
    for (const modal of ['analystModal', 'adminModal', 'pecaModal']) {
        assert.ok(!html.includes(`id="${modal}"`), `${modal} voltou: o acesso é inline, dentro do portão`);
    }
    // Os campos moram no portão, uma única vez cada.
    for (const campo of ['analystUserSelect', 'analystPass', 'adminUserSelect', 'adminPass', 'pecaUserSelect', 'pecaPass']) {
        assert.equal((html.match(new RegExp(`id="${campo}"`, 'g')) || []).length, 1, `${campo} duplicado ou ausente`);
    }
    assert.match(css, /body\.actuar-locked \{ overflow: hidden; \}/);

    // Sem sessão o portão cobre a aplicação, mas nunca o carregamento inicial.
    const zOf = id => {
        const found = html.match(new RegExp(`id="${id}" class="([^"]*)"`));
        const z = found && (found[1].match(/z-\[(\d+)\]/) || found[1].match(/\bz-(\d+)\b/));
        return z ? Number(z[1]) : null;
    };
    const gate = zOf('loginGate');
    assert.ok(gate, 'portão sem z-index declarado');
    assert.ok(gate < zOf('loadingOverlay'), 'o portão não pode cobrir o carregamento inicial');

    // Identidade visual e as três portas descritas.
    assert.match(html, /actuar-login-gate-brand[\s\S]{0,300}assets\/actuar\/logos\/actuar-group\.svg/);
    for (const label of ['Sou analista', 'Modo Gestão', 'Acesso operacional']) {
        assert.ok(html.includes(`<strong>${label}</strong>`), `porta sem rótulo: ${label}`);
    }
    assert.match(css, /\.actuar-login-door:focus-visible/);
    assert.match(css, /\.actuar-login-door-group\.is-open \.actuar-login-panel \{ grid-template-rows: 1fr; \}/);
    assert.match(css, /\.actuar-login-error \{/);
});

test('gestão redefine a senha de qualquer perfil pela linha do usuário', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Ação por linha, com rótulo que distingue criar de redefinir.
    assert.match(html, /onclick="resetUserPassword\('\$\{id\}'\)"/);
    assert.match(html, /\$\{u\.hasPassword \? 'Redefinir senha' : 'Criar senha'\}/);

    // Não exige a senha antiga: sobrescreve no banco pela mesma RPC da gestão.
    assert.match(html, /async function resetUserPassword\(userId\) \{/);
    assert.match(html, /if \(!await setUserPasswordRemote\(userId, password\)\) return;/);
    assert.match(html, /const password = makeTempPassword\(\);/);
    assert.match(html, /await actuarConfirm\(\{\s*\n\s*tone: 'danger', icon: 'lock',\s*\n\s*title: `\$\{acao\} de \$\{user\.name\}\?`/);

    // Uma única função exibe as senhas geradas, no lote e no individual.
    assert.match(html, /function showGeneratedPasswords\(created\) \{/);
    assert.ok(html.match(/showGeneratedPasswords\(/g).length >= 3, 'exibição deveria ser reaproveitada pelos dois caminhos');
    // A senha nunca é persistida no JSON sincronizado: só o sinalizador.
    assert.match(html, /user\.hasPassword = true;/);
    assert.doesNotMatch(html, /usersList\[userId\]\.password\s*=/);
});

test('sessão sobrevive à recarga e só cai no logout explícito', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // Uma única sessão persistida cobre os três perfis, em localStorage: sobrevive a
    // recarregar e a fechar a aba. Antes só o analista guardava algo, em sessionStorage,
    // então qualquer reload derrubava gestão e operacional.
    assert.match(html, /const SESSION_STORAGE_KEY = 'actuar-classifique-session-v1';/);
    assert.match(html, /localStorage\.setItem\(SESSION_STORAGE_KEY, JSON\.stringify\(\{ kind, userId \}\)\)/);

    for (const [kind, call] of [['manager', "saveSession('manager', selectedId)"], ['operations', "saveSession('operations', selectedId)"], ['analyst', "saveSession('analyst', selectedId)"]]) {
        assert.ok(html.includes(call), `login de ${kind} não persiste a sessão`);
    }
    // Os três logouts limpam.
    assert.ok(html.match(/clearSession\(\);/g).length >= 3, 'algum logout não limpa a sessão');

    // A restauração acontece depois da base carregar e reconfere o perfil,
    // para uma pessoa inativada ou com função trocada não voltar com o papel antigo.
    assert.match(html, /const restored = restoreSession\(\);/);
    assert.match(html, /if \(!user \|\| user\.active === false\) \{ clearSession\(\); return false; \}/);
    assert.match(html, /saved\.kind === 'manager' && user\.role === 'Gestor Adm'/);
    assert.match(html, /saved\.kind === 'operations' && isPiecesOperatorRole\(user\.role\)/);
    assert.match(html, /saved\.kind === 'analyst' && isRankableUser\(user\)/);
});

test('confirmação usa o diálogo do sistema, não o do navegador', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // O diálogo do navegador ignora tema, tipografia e vocabulário do produto — e trava a página.
    // O lookbehind já ignora window.confirm — o fallback interno para quando o diálogo não existe no DOM.
    const nativos = html.match(/(?<![.\w])(?:confirm|alert|prompt)\(/g) || [];
    assert.equal(nativos.length, 0, `ainda existem ${nativos.length} diálogo(s) do navegador`);
    assert.equal((html.match(/window\.confirm\(/g) || []).length, 1, 'o fallback deveria ser único');

    assert.match(html, /function actuarConfirm\(options = \{\}\)/);
    assert.match(html, /function actuarAlert\(title, message, options = \{\}\)/);
    assert.match(html, /id="actuarConfirmDialog"/);

    // Toda decisão destrutiva precisa de tom próprio e rótulo que diga o que vai acontecer.
    // "Excluir usuário" saiu de propósito: desligar alguém agora é inativar o acesso,
    // porque a ficha precisa continuar rastreável nos chamados que a pessoa assinou.
    for (const rotulo of ['Inativar acesso', 'Excluir lançamento', 'Excluir protocolo', 'Fechar mês']) {
        assert.ok(html.includes(`confirmLabel: '${rotulo}'`), `ação destrutiva sem rótulo próprio: ${rotulo}`);
    }
    assert.ok((html.match(/tone: 'danger'/g) || []).length >= 5, 'ações destrutivas deveriam usar o tom de perigo');

    // Fecha por Esc e pelo fundo, e devolve o foco para quem abriu.
    assert.match(html, /if \(event\.key !== 'Escape'\) return;/);
    assert.match(html, /if \(event\.target\?\.id === 'actuarConfirmDialog'\) closeActuarConfirm\(false\);/);
    assert.match(html, /layer\.dataset\.returnFocus = ativo\.id;/);

    assert.match(css, /\.actuar-confirm-card\.tone-danger \.actuar-confirm-icon/);
});

test('ranking geral e consulta de analista vivem DENTRO do Modo Gestão', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    /* Antes, "Ranking geral" mandava o gestor para a rota pública: outra barra de
       abas, outro cabeçalho e um botão de voltar. Parecia outro acesso. Agora é
       uma seção do próprio Modo Gestão. */
    assert.match(fs.readFileSync('js/actuar-navigation.js', 'utf8'), /id: 'rankingGeral'[\s\S]{0,140}route: rota\('admin', 'rankingGeral'\)/);
    assert.ok(!html.includes('openManagerGeneralRanking'), 'a função que saía da gestão não pode sobrar');

    // As duas seções entram no mapa de painéis sem painel próprio: o conteúdo é o
    // mesmo bloco que o analista usa, exibido abaixo da navegação da gestão.
    assert.match(html, /rankingGeral: null, analista: null \};/);
    assert.match(html, /const analistaNaGestao = secao === 'analista';/);
    assert.match(html, /document\.getElementById\('viewRanking'\)\?\.classList\.toggle\('hidden', !noRanking\);/);
    assert.match(html, /if \(analistaNaGestao\) renderAnalystDashboard\(user, usersList, metrics\);/);
    // Seção sem painel não pode ser confundida com aba inválida e cair na visão geral.
    assert.match(html, /if \(!\(tab in panels\)\) tab = activeAdminTab = 'visao';/);

    // Consultar um analista deixou de trocar de rota.
    assert.match(html, /navigateTo\(\{ name: 'admin', section: 'analista' \}\);/);

    // A barra de abas do analista nunca aparece para quem está no Modo Gestão.
    // A barra pública deixou de existir: dentro da gestão não há o que esconder,
    // porque a navegação é a sidebar e ela é a mesma em toda tela.
    assert.ok(!html.includes('publicTabsContainer'), 'a barra pública voltou ao Modo Gestão');

    // A trilha substitui a faixa roxa: mesma informação, uma linha.
    assert.match(html, /function renderManagerSectionHeader\(\)/);
    assert.match(html, /Somente leitura · você é \$\{escapeHtml\(getCurrentManager\(\)\?\.name \|\| 'gestor'\)\}/);
    assert.match(html, /onclick="switchAdminTab\('rankingGeral'\)"><i class="fi fi-rr-cross-small"><\/i>Fechar consulta/);

    /* A faixa continua existindo para quem cai numa rota pública por link antigo ou
       por recarregar com a URL de antes — sem ela, ficaria sem caminho de volta. */
    const banner = html.indexOf('id="managerConsultationBanner"');
    const agent = html.indexOf('id="viewAgent"');
    assert.ok(banner > 0 && banner < agent, 'o banner precisa ficar fora do viewAgent');
    assert.equal(html.split('id="managerConsultationBanner"').length - 1, 1);
    assert.match(html, /const rotasPublicas = \['dashboard', 'ranking', 'envio', 'coleta', 'tasks', 'faq', 'priorities', 'pecas'\];/);
    assert.match(html, /Voltar à gestão/);

    // O ranking oferece as duas equipes, independentemente da equipe do gestor.
    assert.match(html, /<select id="rankingViewSelect"[\s\S]{0,200}value="Sistema"[\s\S]{0,120}value="Catraca"/);
});

test('histórico de prioridades pode ser buscado por protocolo, status e analista', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');

    // Os três controles pedidos, no histórico da equipe.
    assert.match(html, /id="priorityHistorySearch"[^>]*placeholder="Protocolo ou analista"/);
    assert.match(html, /id="priorityHistoryAnalyst" onchange="updatePriorityHistoryFilter\('analyst', this\.value\)"/);
    assert.match(html, /id="priorityHistoryStatus"/);
    for (const status of ['aprovado', 'reprovado', 'pendente', 'ajuste_solicitado']) {
        assert.ok(html.includes(`<option value="${status}">`), `status ausente no filtro: ${status}`);
    }

    // A busca cobre protocolo e nome, sem diferenciar maiúsculas.
    assert.match(html, /const alvo = `\$\{record\.request\?\.protocolo \|\| ''\} \$\{users\[record\.analystId\]\?\.name \|\| ''\}`;/);
    assert.match(html, /toLocaleLowerCase\('pt-BR'\)\.includes\(search\)/);

    // Atendimento do rodízio sem lançamento vinculado não tem status próprio.
    assert.match(html, /const status = record\.request\?\.status \|\| 'sem_registro';/);

    // Os filtros valem só para o histórico da equipe; o do analista já é a visão dele.
    assert.match(html, /renderPriorityHistoryInto\('priorityManagerHistoryBody', 'priorityManagerHistorySubtitle', team, true\)/);
    assert.match(html, /renderPriorityHistoryInto\('priorityInlineHistoryBody', 'priorityInlineHistorySubtitle', currentPriorityRotationTeam\(\)\)/);

    // Estado vazio e contagem quando há filtro aplicado.
    assert.match(html, /Nenhum atendimento encontrado com esses filtros\./);
    assert.match(html, /\$\{records\.length\} de \$\{todos\.length\} atendimento\(s\)/);
    assert.match(css, /\.priority-history-empty \{/);
});

test('gestão acompanha a operação de peças por etapa', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    // A gestão ganhou a leitura por etapa que logística e Lab já tinham.
    const linha = ui.split('\n').find(line => line.includes("['evaluations', 'Avaliações']"));
    assert.ok(linha, 'linha das abas da gestão não encontrada');
    for (const tab of ["['shipping', 'A embalar']", "['transit', 'Em trânsito']", "['occurrences', 'Ocorrências']", "['completed', 'Concluídos']"]) {
        assert.ok(linha.includes(tab), `aba ausente para a gestão: ${tab}`);
    }

    // As filas reaproveitam o filtro que já existia, sem regra nova.
    assert.match(ui, /state\.tab === 'transit'.*\['in_transit', 'returning', 'out_for_delivery'\]/);
    assert.match(ui, /state\.tab === 'completed'.*operationalStatus\(row\) === 'Concluído'/);

    // Contadores nas abas novas.
    assert.match(ui, /shipping: summary\.readyToShip, transit: summary\.inTransit/);
});

test('modo TV não repete o botão de fechar', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // A seta "Ranking" fazia exatamente o que o X ao lado já faz.
    assert.ok(!html.includes('btnReturnManagerRanking'), 'botão redundante do modo TV ainda presente');
    // O X continua sendo a única saída da apresentação, junto com Esc.
    assert.equal(html.split('onclick="closeRankingPresentation()"').length - 1, 1);
    assert.match(html, /title="Fechar apresentação \(Esc\)"/);
    // O botão de atualizar também saiu: o modo TV já redesenha sozinho.
    assert.ok(!html.includes('btnRefreshManagerTv'), 'botão de atualizar ainda presente');
    assert.ok(!html.includes('refreshManagerTv'), 'função órfã do botão de atualizar');

    // Os controles que permanecem.
    for (const id of ['btnPresentationFullscreen', 'btnAutoRotatePresentation']) {
        assert.ok(html.includes(id), `controle do modo TV removido por engano: ${id}`);
    }
});

test('lupa da busca de peças não invade o texto digitado', () => {
    const css = fs.readFileSync('styles/actuar-design-system.css', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    // Estrutura: ícone e input irmãos dentro do controle posicionado.
    assert.match(ui, /<div class="pieces-search-control"><i class="fi fi-rr-search"><\/i><input id="piecesSearch"/);

    // O ícone tem caixa própria, então não cresce com a fonte herdada do bloco.
    assert.match(css, /\.pieces-search-control > i \{[\s\S]*?width: 16px;[\s\S]*?height: 16px;/);
    assert.match(css, /\.pieces-search-control > i \{[\s\S]*?pointer-events: none;/);

    // O recuo do texto precisa VENCER a base do design system, que também é
    // !important. A tentativa anterior (.pieces-filters .pieces-search-control > input)
    // vinha depois na cascata, mas perdia na especificidade — e a lupa continuou por
    // cima do texto na tela. Por isso aqui a comparação é de peso, não de ordem.
    const peso = (seletor) => {
        const ids = (seletor.match(/#[\w-]+/g) || []).length;
        const classes = (seletor.match(/\.[\w-]+/g) || []).length + (seletor.match(/\[[^\]]+\]/g) || []).length;
        const elementos = (seletor.replace(/\[[^\]]+\]/g, '').replace(/[.#][\w-]+/g, '').match(/[a-z]+/g) || []).filter(t => t !== 'not').length;
        return ids * 10000 + classes * 100 + elementos;
    };
    const cadeia = ':not([type="checkbox"]):not([type="radio"]):not([type="file"])';
    const base = `body.actuar-app input${cadeia}`;
    assert.ok(css.includes(base), 'a base do design system mudou; revise o recuo da lupa');
    for (const alvo of [`body.actuar-app .pieces-search-control > input${cadeia}`, `body.actuar-app .actuar-input-icon > input${cadeia}`]) {
        assert.ok(css.includes(alvo), `regra do recuo ausente: ${alvo}`);
        assert.ok(peso(alvo) > peso(base), `${alvo} perde para a base e o recuo não será aplicado`);
    }
    assert.match(css, /padding-left: 38px !important;/);
});


test('recarregar devolve a mesma tela e os mesmos filtros', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    // A rota vive no endereço e é reaplicada depois que a sessão volta. A navegação
    // inicial roda antes da sessão existir, então sem reaplicar a tela ficava deslogada;
    // e navegar incondicionalmente descartava a rota, jogando todo mundo em Prioridades.
    // "dashboard" é o destino genérico de quem chega sem rota, inclusive de links
    // antigos: ele não pode sequestrar a home de gestão nem da operação.
    // A rota precisa ser copiada ANTES de initApp(): a navegação inicial roda sem sessão,
    // applyRoute rejeita rota de gestão de quem não está logado e reescreve o endereço
    // para /dashboard. Relendo depois, o destino original já se perdeu — era isso que
    // devolvia /admin/visao a quem recarregava em /admin/ponto.
    const onload = html.slice(html.indexOf('window.onload = async'), html.indexOf('await PerformancePlatform.init'));
    assert.ok(onload.indexOf('const rotaPretendida = routeFromLocation();') < onload.indexOf('await initApp();'),
        'a rota tem de ser lida antes de initApp()');
    assert.ok(!onload.slice(onload.indexOf('await initApp();')).includes('routeFromLocation()'),
        'depois do initApp o endereço já foi reescrito: reler traz a rota errada');
    assert.match(html, /const rotaEscolhida = rotaPretendida\.name !== 'dashboard' \? rotaPretendida : null;/);
    assert.match(html, /if \(rotaEscolhida\) applyRoute\(rotaEscolhida, \{ replace: true \}\);/);
    assert.match(html, /const home = \{ manager: \{ name: 'admin', section: activeAdminTab \|\| 'visao' \}, operations: 'pecas', analyst: 'dashboard' \}\[restored\];/);
    assert.match(html, /else navigateTo\(home, \{ replace: true \}\);/);

    // A seção do admin faz parte do endereço, então "Ponto e pausas" é restaurável.
    assert.match(html, /return `#\/\$\{clean\.name\}\$\{clean\.section \? '\/' \+ clean\.section : ''\}`;/);
    assert.match(html, /history\.pushState\(nextState, '', routeUrl\(next\)\)/);

    // Filtros e contexto passam a durar o mesmo que a sessão.
    assert.match(html, /localStorage\.setItem\(VIEW_CONTEXT_STORAGE_KEY/);
    assert.match(html, /localStorage\.setItem\(MANAGER_FILTER_STORAGE_KEY/);
    assert.doesNotMatch(html, /sessionStorage\.setItem\(MANAGER_FILTER_STORAGE_KEY/);
    // E são apagados no logout, para ninguém herdar o filtro do colega.
    assert.match(html, /localStorage\.removeItem\(VIEW_CONTEXT_STORAGE_KEY\);[\s\S]{0,140}localStorage\.removeItem\(MANAGER_FILTER_STORAGE_KEY\);/);
});

test('a consulta de analista continua acesa no menu, porque é filha do ranking', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    // Sem isto o menu ficava sem nenhum item destacado durante a consulta, e o gestor
    // perdia a referência de onde estava.
    assert.match(html, /rankingGeral: 'admNavRankingGeral', analista: 'admNavRankingGeral' \};/);
    // A seção vem da rota: applyRoute chama render() antes de switchAdminTabView.
    assert.match(html, /function managerSection\(\) \{/);
    assert.match(html, /return \(currentRoute\.name === 'admin' && currentRoute\.section\) \|\| activeAdminTab \|\| 'visao';/);
    assert.match(html, /function syncManagerSectionViews\(\)/);
});

test('o conteúdo encaixado fica ABAIXO da navegação da gestão, e sabe voltar', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    // viewRanking e viewAgent vêm antes do viewAdmin no documento: sem mover, o
    // conteúdo apareceria acima do menu da gestão.
    assert.ok(html.indexOf('id="viewRanking"') < html.indexOf('id="viewAdmin"'), 'premissa do encaixe mudou');
    assert.match(html, /id="managerSectionHost"/);
    assert.match(html, /function parkManagerView\(id, dentro\)/);
    // Âncora para devolver ao lugar de origem.
    assert.match(html, /ancora\.id = `\$\{id\}Anchor`;/);
    assert.match(html, /if \(!dentro && node\.parentNode === host\) ancora\.parentNode\.insertBefore\(node, ancora\.nextSibling\);/);
});

test('a barra de filtros só aparece onde filtra alguma coisa', () => {
    const html = fs.readFileSync('index.html', 'utf8');

    assert.match(html, /const TOOLBAR_SCOPE = \{/);
    assert.match(html, /function toolbarScope\(\)/);
    assert.match(html, /id="filterPeriodGroup"/, 'sem id não há como esconder o grupo Período');

    // Cadastro, peças e ponto não filtram por mês nem por analista.
    for (const secao of ['cadastros', 'pecas', 'ponto']) {
        assert.match(html, new RegExp(`${secao}:\\s*\\{ periodo: false, contexto: false \\}`), `${secao} não deveria mostrar filtro`);
    }
    // Ciclos é por mês; métricas operacionais tem o próprio seletor de departamento.
    assert.match(html, /ciclos:\s*\{ periodo: true,  contexto: false \}/);
    assert.match(html, /lancamentos:\s*\{ periodo: true,  contexto: false \}/);
    // Onde há resultado por pessoa, os dois grupos aparecem.
    for (const secao of ['rankingGeral', 'analista']) {
        assert.match(html, new RegExp(`${secao}:\\s*\\{ periodo: true,  contexto: true  \\}`), `${secao} precisa dos dois grupos`);
    }
    // Sem nenhum grupo, a faixa inteira sai.
    assert.match(html, /document\.querySelector\('\.actuar-toolbar'\)\?\.classList\.toggle\('hidden', !escopo\.periodo && !contexto\);/);
    // Fora do mapa, o padrão é não mostrar.
    assert.match(html, /return TOOLBAR_SCOPE\[managerSection\(\)\] \|\| \{ periodo: false, contexto: false \};/);
});

test('escolher o analista no filtro abre os resultados dele', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const trecho = html.slice(html.indexOf('function switchAgent(val)'), html.indexOf('function changeMonthView'));
    // Antes só trocava a variável e re-renderizava a tela atual: nada mudava à vista.
    assert.match(trecho, /if \(managerSection\(\) === 'analista'\) \{ render\(\); return; \}/);
    assert.match(trecho, /switchAdminTab\('analista'\);/);
    // O departamento acompanha a pessoa escolhida.
    assert.match(trecho, /activeRankingTab = selected\?\.team \|\| activeRankingTab;/);
});

test('o funil de etapas aparece para quem opera peças, e não para o analista', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    assert.match(ui, /function renderPipeline\(/);
    // Hoje o funil é de quem decide o caminho do chamado: Lab e Gestão.
    assert.match(ui, /\$\{\['lab', 'manager'\]\.includes\(context\.mode\) \? renderPipeline\(allowedRecords\(\)\) : ''\}/);
    // O handler precisa estar exposto, senão o clique na etapa quebra.
    assert.match(ui, /window\.setPiecesPipeline = setPipeline;/);
    // As funções do domínio existem de verdade.
    const dominio = fs.readFileSync('js/pieces-operations.js', 'utf8');
    assert.match(dominio, /function pipelineStage\(record\)/);
    assert.match(dominio, /function pipelineSummary\(records\)/);
});

test('o endereço publicado carrega o hash do próprio arquivo', () => {
    const build = fs.readFileSync('scripts/build-check.cjs', 'utf8');
    /* Duas vezes neste projeto um .js mudou sem o `?v=` mudar junto: o código estava
       certo e o navegador continuava servindo o antigo. Depender de alguém lembrar de
       trocar a versão à mão não é uma solução. */
    assert.match(build, /function contentHash\(file\)/);
    assert.match(build, /createHash\('sha1'\)\.update\(fs\.readFileSync\(file\)\)/);
    assert.match(build, /\.replace\(\/\(\(\?:js\|styles\)\\\/\[\^"\?\]\+\)\\\?v=\[\^"\]\*\/g/);
    assert.match(build, /fs\.writeFileSync\(publicado, carimbado\);/);
});

test('o papel que valida e pontua pode ser atribuído no cadastro', () => {
    const html = fs.readFileSync('index.html', 'utf8');
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    /* Todo o fluxo de validação depende do papel 'Toletus Lab' — é ele que abre a aba
       "Validar e pontuar". Ele existia no domínio e no login, mas não no formulário de
       cadastro: dava para o processo existir e ninguém conseguir ocupar a primeira
       etapa dele. */
    assert.match(ui, /const LAB_ROLE = 'Toletus Lab';/);
    assert.match(ui, /if \(mode === 'lab'\) return \[\['validation', 'Validar e pontuar'\]/);
    assert.match(html, /<option value="Toletus Lab">/, 'sem a opção no cadastro, ninguém chega ao modo lab');
    // O papel continua exigindo senha, como os demais perfis operacionais.
    assert.match(html, /const PIECES_OPERATION_ROLES = new Set\(\['Envio\/Coleta', 'Faturamento', 'Expedição', 'Logística\/Faturamento', 'Toletus Lab'\]\);/);
    // E a porta de acesso operacional lista qualquer perfil operacional.
    assert.match(html, /filter\(id => isPiecesOperatorRole\(usersList\[id\]\.role\) && usersList\[id\]\.active !== false\)/);
});

test('o Lab acompanha o chamado do começo ao fim, com visão geral e comentários', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    /* O Lab abre e fecha o processo: valida na entrada e conclui com o cliente. Sem a
       visão geral ele via só a própria fila, e não o que estava represado antes ou
       depois dele. */
    const abas = ui.match(/if \(mode === 'lab'\) return \[([^\]]*\])+/)[0];
    for (const aba of ['validation', 'overview', 'followup', 'movements', 'completed']) {
        assert.ok(abas.includes(`'${aba}'`), `o Lab precisa da aba ${aba}`);
    }
    // A aba de trabalho continua sendo a primeira ao entrar.
    assert.match(ui, /function defaultTab\(mode\) \{ return mode === 'logistics' \? 'operation' : mode === 'lab' \? 'validation' : 'overview'; \}/);

    // Comentário é registro, não decisão: vive na ficha, fora da modal de ação.
    assert.match(ui, /async function submitComment\(event\)/);
    assert.match(ui, /window\.submitPiecesComment = submitComment;/);
    assert.match(ui, /onsubmit="return submitPiecesComment\(event\)"/);
    // O analista lê, mas não escreve.
    assert.match(ui, /\$\{context\.mode === 'analyst' \? '' : `<form class="pieces-comment-form"/);
});

test('comentar registra autor, texto e evento — e recusa texto vazio', () => {
    const dominio = require('../js/pieces-operations.js');
    const base = { id: 'op-1', version: 3, events: [], comments: [] };

    const comentado = dominio.comment(base, 'jeremias', '  cliente pediu entrega após as 14h  ', 1000);
    assert.equal(comentado.comments.length, 1);
    assert.equal(comentado.comments[0].text, 'cliente pediu entrega após as 14h', 'o texto é aparado');
    assert.equal(comentado.comments[0].actorId, 'jeremias');
    assert.equal(comentado.comments[0].createdAt, 1000);
    // Entra na auditoria como qualquer outro movimento.
    assert.equal(comentado.events.at(-1).type, 'commented');
    assert.equal(comentado.version, 4, 'comentar versiona o registro');
    // E não altera o original.
    assert.equal(base.comments.length, 0);

    for (const vazio of ['', '   ', null, undefined]) {
        assert.throws(() => dominio.comment(base, 'jeremias', vazio), /Escreva o comentário/, `"${vazio}" não pode virar comentário`);
    }
});

test('o cabeçalho diz quem está logado e em qual papel', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    /* A tela de peças muda inteira conforme o papel: o Lab valida e pontua, o
       Envio/Coleta embala e posta. Sem a identidade no cabeçalho, dava para achar que
       a tela estava errada quando na verdade o cadastro é que estava. */
    assert.match(ui, /class="pieces-identity"/);
    assert.match(ui, /<b>\$\{e\(context\.user\.name\)\}<\/b><i>\$\{e\(context\.user\.role \|\| 'Sem papel definido'\)\}<\/i>/);
    assert.match(ui, /Modo Gestão → Pessoas e Acessos → Editar/);
    // E o título do Lab deixou de colidir com o nome do outro papel.
    assert.match(ui, /context\.mode === 'lab' \? 'Validação técnica e acompanhamento'/);
});

test('o Lab tem a tela cheia de peças: valida, embala, posta, acompanha e conclui', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');

    /* Antônio e Jeremias são o Lab E quem embala e posta. Recortar abas obrigaria a
       trocar de perfil no meio do próprio trabalho. */
    const abas = ui.match(/if \(mode === 'lab'\) return \[[^;]*/)[0];
    for (const aba of ['validation', 'overview', 'requests', 'evaluations', 'shipping', 'collections', 'followup', 'transit', 'occurrences', 'completed', 'movements', 'indicators']) {
        assert.ok(abas.includes(`'${aba}'`), `falta a aba ${aba} para o Lab`);
    }

    // As ações operacionais (assumir, embalar, postar, frete, ocorrência) valem para
    // o Lab do mesmo jeito que para a logística.
    assert.match(ui, /if \(\['logistics', 'lab'\]\.includes\(context\.mode\) && record\.requestStatus === 'approved'\) \{/);
    assert.match(ui, /\['logistics', 'lab'\]\.includes\(context\.mode\) \? `<button[^`]*resolveOccurrence/);

    // Mas a nota fiscal continua sendo da Logística — regra do processo.
    assert.match(ui, /if \(role === LAB_ROLE\) return area !== 'Faturamento';/);

    // E "Registrar ocorrência" não pode aparecer duas vezes na mesma ficha.
    const blocoLab = ui.slice(ui.indexOf("if (context.mode === 'lab' && record.requestStatus === 'approved')"), ui.indexOf("if (['logistics', 'lab'].includes(context.mode)"));
    assert.ok(!blocoLab.includes("openPiecesAction('occurrence')"), 'botão de ocorrência duplicado na ficha do Lab');
});

test('a auditoria mostra o campo, o valor anterior e o novo', () => {
    const dominio = require('../js/pieces-operations.js');

    // Objetos são achatados até o pedaço que mudou — não o objeto inteiro.
    const diff = dominio.diffOf({
        field: 'client', label: 'Cliente',
        before: { id: 'TZ2244', name: 'Academia Modelo', city: 'Goiânia' },
        after: { id: 'TZ3353', name: 'Academia Modelo', city: 'Goiânia' }
    });
    assert.equal(diff.length, 1, 'só o que mudou entra na auditoria');
    assert.deepEqual(diff[0], { path: 'id', before: 'TZ2244', after: 'TZ3353' });

    // Campo simples também funciona.
    const simples = dominio.diffOf({ field: 'diagnosis', label: 'Diagnóstico', before: 'Placa solta', after: 'Placa queimada' });
    assert.equal(simples[0].before, 'Placa solta');
    assert.equal(simples[0].after, 'Placa queimada');

    // Campo que não existia antes aparece como traço, não como "undefined".
    const novo = dominio.diffOf({ field: 'diagnosis', label: 'Diagnóstico', before: null, after: 'Placa queimada' });
    assert.equal(novo[0].before, '—');

    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    assert.match(ui, /O que o Toletus Lab corrigiu/);
    assert.match(ui, /domain\(\)\.diffOf\(campo\)/);
    // Registros antigos guardavam só o nome do campo: não podem quebrar a ficha.
    assert.match(ui, /typeof campo === 'string'/);
});

test('a pontuação do Lab aparece antes de salvar e acompanha os critérios', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    /* Antes o total era consequência invisível dos check-boxes: só se descobria
       depois de salvar. */
    assert.match(ui, /id="paScorePreview"/);
    assert.match(ui, /<div class="pieces-criteria" onchange="updatePiecesScorePreview\(\)">/);
    assert.match(ui, /window\.updatePiecesScorePreview = \(\) => \{/);
    assert.match(ui, /critérios atendidos · 4 pontos cada/);
});

test('clicar numa etapa do funil leva a uma lista que consegue mostrá-la', () => {
    const ui = fs.readFileSync('js/pieces-ui.js', 'utf8');
    /* Abas como "Validar e pontuar" filtram por status. Marcar "No check da gestão"
       dentro delas devolvia lista vazia: o número dizia 1 e a tela dizia nada. */
    assert.match(ui, /const PIPELINE_LIST_TAB = \{ manager: 'requests', lab: 'requests', logistics: 'operation', analyst: 'requests' \};/);
    assert.match(ui, /if \(tabsFor\(currentContext\(\)\.mode\)\.some\(\(\[id\]\) => id === destino\)\) state\.tab = destino;/);
    // Desmarcar a etapa não pode arrastar a pessoa para outra aba.
    assert.match(ui, /const desmarcando = state\.pipeline === stage;/);
    assert.match(ui, /if \(!desmarcando\) \{/);
});
