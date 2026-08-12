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
    assert.deepEqual(validated.labReview.corrections, ['client']);
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
    assert.match(html, /id="admTabBtnPecas">\s*<i class="fa-solid fa-box me-1"><\/i> Peças <span id="admPiecesPendingBadge"/);
    assert.doesNotMatch(html, /Peças Catraca/);
    assert.match(html, /id="admPiecesPendingBadge" class="hidden ml-1 bg-amber-500 text-black rounded-full px-1\.5 text-\[10px\]"/);

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
    assert.match(html, /enterLocalPecaPreview\('Toletus Lab'\)/);
    assert.match(ui, /mode: user\?\.role === LAB_ROLE \? 'lab' : 'logistics'/);
    assert.match(ui, /if \(mode === 'lab'\) return \[\['validation', 'Validar e pontuar'\], \['followup', 'Acompanhamento'\]/);

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
