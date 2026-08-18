(function (root, factory) {
    const shared = (typeof module === 'object' && module.exports) ? require('./actuar-fields.js') : (root && root.ActuarFields);
    const api = factory(shared);
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.PiecesOperations = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (fields) {
    'use strict';

    function fieldOk(type, value) { return !fields || fields.validate(type, value).valid; }

    const MOVEMENTS = ['Envio', 'Coleta', 'Troca', 'Devolução', 'Transferência interna'];
    const REASONS = ['Venda de peça', 'Manutenção paga', 'Garantia', 'Implantação', 'Comodato', 'Substituição preventiva', 'Empréstimo', 'Demonstração', 'Devolução', 'Correção de envio', 'Transferência entre unidades', 'Outro'];
    const PRIORITIES = ['Crítica', 'Alta', 'Normal', 'Baixa'];
    const BRANDS = ['Actuar', 'Ediz', 'Fácil Fit', 'Toletus'];
    const LAB_AREA = 'Toletus Lab';
    const PERSON_TYPES = ['Jurídica', 'Física'];
    function personTypeOf(client) { return client?.personType === 'Física' ? 'Física' : 'Jurídica'; }
    function documentOf(client) { return client?.document ?? client?.cnpj ?? ''; }
    function documentTypeOf(client) { return personTypeOf(client) === 'Física' ? 'cpf' : 'cnpj'; }
    function documentLabelOf(client) { return personTypeOf(client) === 'Física' ? 'CPF' : 'CNPJ'; }
    function nameLabelOf(client) { return personTypeOf(client) === 'Física' ? 'Nome completo' : 'Razão social'; }
    const REQUEST_STATUSES = {
        draft: 'Rascunho', pending_lab_review: 'Aguardando validação do Lab', pending_manager_check: 'Aguardando check da gestão',
        rejected: 'Reprovada', approved: 'Aprovada',
        // Estados do fluxo anterior, preservados para leitura do histórico já registrado.
        pending_review: 'Aguardando avaliação', correction_requested: 'Devolvida para ajuste'
    };
    const FISCAL_STATUSES = {
        not_started: 'Não iniciada', awaiting_invoice: 'Aguardando emissão de NF', processing: 'NF em processamento',
        issued: 'NF emitida', not_required: 'Não exige NF', rejected: 'NF rejeitada', blocked: 'Bloqueada por falta de dados'
    };
    const SHIPPING_STATUSES = {
        awaiting_separation: 'Aguardando separação', separating: 'Em separação', awaiting_invoice: 'Aguardando nota fiscal',
        awaiting_tracking: 'Aguardando etiqueta e rastreio', awaiting_packing: 'Aguardando embalagem', packing: 'Em embalagem',
        ready: 'Pronto para envio', awaiting_dispatch: 'Aguardando postagem', awaiting_carrier: 'Aguardando transportadora', posted: 'Postado', in_transit: 'Em trânsito',
        out_for_delivery: 'Saiu para entrega', delivered: 'Entregue', client_followup: 'Em acompanhamento', awaiting_confirmation: 'Aguardando confirmação', completed: 'Concluído',
        awaiting_schedule: 'Aguardando agendamento', scheduled: 'Coleta agendada', collected: 'Coletado', returning: 'Em trânsito para a empresa',
        received: 'Recebido', awaiting_inspection: 'Aguardando inspeção', inspected: 'Inspecionado'
    };
    const PRIORITY_WEIGHT = { 'Crítica': 0, 'Alta': 1, 'Normal': 2, 'Baixa': 3 };
    const OCCURRENCE_TYPES = ['Atrasado', 'Retido em fiscalização', 'Apreendido', 'Extraviado', 'Avariado', 'Entrega recusada', 'Endereço incorreto', 'Cliente não localizado', 'Devolvido ao remetente', 'Coleta não realizada', 'Cancelado'];
    const CARRIERS = ['Correios', 'Jadlog', 'Azul Cargo', 'LATAM Cargo', 'Motoboy', 'Frota própria', 'Retirada pelo cliente', 'Outra'];
    const MODALITIES = ['PAC', 'Sedex', 'Sedex 10', 'Expresso', 'Econômico', 'Rodoviário', 'Aéreo', 'Coleta programada', 'Logística reversa'];
    const HOUR = 3600000;
    const SLA_TARGETS = { 'Crítica': 4 * HOUR, 'Alta': 8 * HOUR, 'Normal': 24 * HOUR, 'Baixa': 48 * HOUR };
    const SLA_DUE_SOON_RATIO = 0.25;
    const SLA_STATES = { completed: 'Concluído', no_target: 'Sem prazo definido', on_track: 'Dentro do prazo', due_soon: 'Vence em breve', late: 'Atrasado' };

    function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
    function id(prefix = 'piece') { return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`; }
    function now() { return Date.now(); }
    function event(type, actorId, text, metadata, timestamp = now()) {
        return { id: id('evt'), type, actorId: actorId || 'system', text, metadata: metadata || {}, timestamp };
    }
    function normalizeArray(value) { return Array.isArray(value) ? value : []; }
    function requireValue(value, message) { if (value == null || String(value).trim() === '') throw new Error(message); }
    function assertVersion(record, expectedVersion) {
        if (expectedVersion != null && Number(record.version || 0) !== Number(expectedVersion)) {
            const error = new Error('Esta solicitação foi atualizada por outra pessoa. Confira a versão mais recente antes de continuar.');
            error.code = 'PIECE_OPERATION_CONFLICT'; throw error;
        }
    }
    function ensureEditable(record, statuses) {
        if (!statuses.includes(record.requestStatus)) throw new Error('Esta ação não está disponível no estado atual da solicitação.');
    }
    function append(record, type, actorId, text, metadata, timestamp) {
        record.events = [...normalizeArray(record.events), event(type, actorId, text, metadata, timestamp)];
        record.updatedAt = timestamp || now(); record.version = Number(record.version || 0) + 1; return record;
    }
    /* Comentário livre na ficha. Todas as notas que existiam estavam presas a uma
       decisão — motivo da reprovação, resposta à logística. Acompanhar um chamado até
       a entrega exige registrar o que não é decisão: "cliente pediu para entregar
       depois das 14h". Sem isso, esse combinado vive no WhatsApp e some. */
    function comment(input, actorId, text, timestamp = now()) {
        requireValue(text, 'Escreva o comentário antes de enviar.');
        const record = clone(input);
        const texto = String(text).trim();
        record.comments = [...normalizeArray(record.comments), { id: id('cmt'), actorId, text: texto, createdAt: timestamp }];
        return append(record, 'commented', actorId, 'Comentário no acompanhamento.', { comment: texto }, timestamp);
    }

    function handoff(record, area, timestamp, reason) {
        normalizeArray(record.assignments).filter(task => ['pending', 'processing'].includes(task.status)).forEach(task => { task.status = 'completed'; task.completedAt = timestamp; });
        record.assignments = [...normalizeArray(record.assignments), { id: id('task'), area, status: 'pending', assigneeId: null, reason: reason || '', createdAt: timestamp }];
    }

    function legacyToOperation(log, index, users) {
        const timestamp = Number(log.timestamp || now());
        const analyst = users?.[log.userId] || {};
        const movement = log.tipo === 'Coleta' ? 'Coleta' : 'Envio';
        return {
            id: `legacy_piece_${log.id || index}`, legacyLogId: log.id || null, legacy: true, version: 1,
            protocol: log.clientId ? `LEG-${String(log.clientId).replace(/\s+/g, '')}` : `LEG-${index + 1}`,
            sourceTicket: '', analystId: log.userId || null, department: analyst.team || 'Catraca', createdBy: log.registradoPor || log.userId || 'legacy',
            movement, reason: 'Outro', requestedPriority: 'Normal', approvedPriority: 'Normal', requestStatus: 'approved',
            client: { id: log.clientId || '', name: `Cliente ${log.clientId || 'não informado'}`, brand: 'Actuar', city: '', state: '' },
            products: [{ id: id('item'), code: '', name: 'Peça não informada no registro legado', category: 'Outro', quantity: 1, condition: 'Novo', unitValue: 0 }],
            description: 'Registro migrado da tela anterior de Envio/Coleta.', justification: '', evidence: [],
            scoring: { calculated: Number(log.value || 0), final: Number(log.value || 0), rule: 'Registro legado', criteria: [], approvedBy: log.registradoPor || null, approvedAt: timestamp },
            fiscal: { required: null, status: 'not_started' },
            movements: [{ ...createMovement(movement, timestamp), status: 'completed', deliveredAt: timestamp }], occurrences: [], assignments: [],
            createdAt: timestamp, submittedAt: timestamp, approvedAt: timestamp, updatedAt: timestamp,
            events: [event('legacy_imported', 'system', 'Registro anterior preservado e disponibilizado na nova central.', { source: 'PECA', points: Number(log.value || 0) }, timestamp)]
        };
    }

    function createMovement(kind, timestamp = now()) {
        const isCollection = kind === 'Coleta';
        return {
            id: id('mov'), kind, status: isCollection ? 'awaiting_schedule' : 'awaiting_separation', carrier: '', modality: '', paidBy: '', costCompany: '',
            costCenter: '', quotedCost: 0, actualCost: 0, insuredValue: 0, declaredValue: 0, weight: '', volumes: [],
            scheduledAt: null, postedAt: null, deliveredAt: null, tracking: [], proof: '', notes: '', updatedAt: timestamp
        };
    }

    function upgradeOperation(record) {
        let next = clone(record); if (!next || next.legacy) return next;
        if (Number(next.flowVersion || 1) < 2) {
            next.assignments = normalizeArray(next.assignments).map(task => ({ ...task, area: ['Faturamento', 'Logística'].includes(task.area) ? 'Logística/Faturamento' : task.area }));
            normalizeArray(next.movements).forEach(movement => {
                if (movement.status === 'awaiting_separation') movement.status = normalizeArray(movement.tracking).length ? 'awaiting_packing' : 'awaiting_tracking';
                else if (movement.status === 'separating') movement.status = 'packing';
                else if (movement.status === 'ready') movement.status = 'awaiting_dispatch';
            });
            next.flowVersion = 2;
        }
        if (Number(next.flowVersion || 1) < 3) next = upgradeToLabFlow(next);
        return next;
    }

    // Fluxo 3: o Toletus Lab passa a validar antes da gestão, e nada volta para o analista.
    function upgradeToLabFlow(record) {
        const next = record; const timestamp = Number(next.updatedAt || next.createdAt || 0);
        if (['pending_review', 'correction_requested'].includes(next.requestStatus)) {
            const from = next.requestStatus;
            next.requestStatus = 'pending_lab_review';
            normalizeArray(next.assignments).filter(task => ['pending', 'processing'].includes(task.status)).forEach(task => { task.status = 'completed'; task.completedAt = timestamp; });
            next.assignments = [...normalizeArray(next.assignments), { id: id('task'), area: LAB_AREA, status: 'pending', assigneeId: null, reason: 'Validação técnica e pontuação da solicitação.', createdAt: timestamp }];
            next.events = [...normalizeArray(next.events), event('flow_migrated', 'system', from === 'correction_requested'
                ? `Solicitação que aguardava ajuste do analista passou para validação do ${LAB_AREA}.`
                : `Solicitação que aguardava avaliação da gestão passou para validação do ${LAB_AREA}.`, { from, to: 'pending_lab_review' }, timestamp)];
        }
        if (next.client && next.client.document == null) {
            next.client.personType = personTypeOf(next.client);
            next.client.document = next.client.cnpj || '';
        }
        next.flowVersion = 3; return next;
    }

    function bootstrap(store, users) {
        const result = normalizeArray(store?.pieceOperations).map(upgradeOperation);
        const imported = new Set(result.map(item => item.legacyLogId).filter(Boolean));
        normalizeArray(store?.logs).filter(log => log.type === 'PECA' && !imported.has(log.id)).forEach((log, index) => result.push(legacyToOperation(log, index, users)));
        return result;
    }

    function createDraft(input, actorId, timestamp = now()) {
        requireValue(actorId, 'Usuário responsável não identificado.');
        return {
            id: id('piece'), version: 1, flowVersion: 2, legacy: false, protocol: input.protocol || '', sourceTicket: input.sourceTicket || '', analystId: input.analystId || actorId,
            department: input.department || 'Catraca', createdBy: actorId, movement: input.movement || 'Envio', reason: input.reason || 'Garantia',
            requestedPriority: input.requestedPriority || 'Normal', priorityReason: input.priorityReason || '', approvedPriority: null, targetManagerId: input.targetManagerId || null,
            promisedAt: input.promisedAt || null, requestStatus: 'draft', client: clone(input.client || {}), products: clone(input.products || []),
            description: input.description || '', justification: input.justification || '', diagnosis: input.diagnosis || '', evidence: clone(input.evidence || []),
            managerNotes: input.managerNotes || '', logisticsNotes: input.logisticsNotes || '', conditional: clone(input.conditional || {}),
            scoring: { calculated: 0, final: 0, rule: '', criteria: [] }, fiscal: { required: null, status: 'not_started' },
            movements: [], occurrences: [], assignments: [], createdAt: timestamp, submittedAt: null, approvedAt: null, updatedAt: timestamp,
            events: [event('created', actorId, 'Solicitação criada.', {}, timestamp)]
        };
    }

    function filled(value) { return value != null && String(value).trim() !== ''; }

    const SUBMIT_RULES = [
        { step: 'origin', field: 'sourceTicket', message: 'Informe o chamado ou protocolo de origem.', met: record => filled(record.sourceTicket) },
        { step: 'origin', field: 'targetManagerId', message: 'Selecione o gestor que vai avaliar a solicitação.', met: record => filled(record.targetManagerId) },
        { step: 'origin', field: 'movement', message: 'Selecione um movimento logístico válido.', met: record => MOVEMENTS.includes(record.movement) },
        { step: 'origin', field: 'reason', message: 'Selecione um motivo válido.', met: record => REASONS.includes(record.reason) },
        { step: 'client', field: 'client.id', message: 'Selecione o cliente.', met: record => filled(record.client?.id) },
        { step: 'client', field: 'client.name', message: 'Informe o nome do cliente.', met: record => filled(record.client?.name) },
        { step: 'client', field: 'client.personType', message: 'Informe se o cliente é pessoa jurídica ou física.', met: record => PERSON_TYPES.includes(personTypeOf(record.client)) },
        { step: 'client', field: 'client.brand', message: 'Selecione a marca responsável.', met: record => BRANDS.includes(record.client?.brand) },
        { step: 'client', field: 'client.id', message: 'O ID do cliente usa duas letras e quatro números, como TZ2345.', met: record => !filled(record.client?.id) || fieldOk('clientId', record.client.id) },
        { step: 'client', field: 'client.document', message: 'CNPJ inválido: confira os dígitos verificadores.', met: record => personTypeOf(record.client) !== 'Jurídica' || !filled(documentOf(record.client)) || fieldOk('cnpj', documentOf(record.client)) },
        { step: 'client', field: 'client.document', message: 'CPF inválido: confira os dígitos verificadores.', met: record => personTypeOf(record.client) !== 'Física' || !filled(documentOf(record.client)) || fieldOk('cpf', documentOf(record.client)) },
        { step: 'client', field: 'client.state', message: 'Informe uma UF válida, como GO ou SP.', met: record => !filled(record.client?.state) || fieldOk('uf', record.client.state) },
        { step: 'client', field: 'client.phone', message: 'Telefone inválido: informe com DDD.', met: record => !filled(record.client?.phone) || fieldOk('phone', record.client.phone) },
        { step: 'client', field: 'client.email', message: 'Informe um e-mail válido, com @ e domínio.', met: record => !filled(record.client?.email) || fieldOk('email', record.client.email) },
        { step: 'products', field: 'products', message: 'Adicione ao menos um produto.', met: record => normalizeArray(record.products).length > 0 },
        { step: 'products', field: 'products.name', message: 'Informe o nome de todos os produtos.', met: record => normalizeArray(record.products).every(product => filled(product.name)) },
        { step: 'products', field: 'products.quantity', message: 'A quantidade deve ser maior que zero.', met: record => normalizeArray(record.products).every(product => Number(product.quantity || 0) >= 1) },
        { step: 'details', field: 'description', message: 'Descreva a necessidade da movimentação.', met: record => filled(record.description) },
        { step: 'origin', field: 'priorityReason', message: 'Justifique a urgência solicitada.', met: record => record.requestedPriority === 'Normal' || record.requestedPriority === 'Baixa' || filled(record.priorityReason) },
        { step: 'details', field: 'conditional.defect', message: 'Informe o defeito relatado.', met: record => record.reason !== 'Garantia' || filled(record.conditional?.defect) },
        { step: 'details', field: 'conditional.diagnosis', message: 'Informe o diagnóstico técnico da garantia.', met: record => record.reason !== 'Garantia' || filled(record.conditional?.diagnosis) },
        { step: 'details', field: 'conditional.saleOrder', message: 'Informe o número do pedido ou venda.', met: record => record.reason !== 'Venda de peça' || filled(record.conditional?.saleOrder) },
        { step: 'details', field: 'conditional.serviceOrder', message: 'Informe a ordem de serviço.', met: record => record.reason !== 'Manutenção paga' || filled(record.conditional?.serviceOrder) }
    ];

    function pendingRequirements(record) {
        const target = record || {};
        return SUBMIT_RULES.filter(rule => !rule.met(target)).map(rule => ({ step: rule.step, field: rule.field, message: rule.message }));
    }

    function validateForSubmit(record) {
        const pending = pendingRequirements(record);
        if (pending.length) throw new Error(pending[0].message);
        return true;
    }

    function submit(record, actorId, expectedVersion, timestamp = now()) {
        const next = clone(record); assertVersion(next, expectedVersion); ensureEditable(next, ['draft', 'correction_requested']); validateForSubmit(next);
        next.requestStatus = 'pending_lab_review'; next.submittedAt = timestamp;
        handoff(next, LAB_AREA, timestamp, 'Validação técnica e pontuação da solicitação.');
        return append(next, 'submitted', actorId, `Solicitação enviada para validação do ${LAB_AREA}.`, {}, timestamp);
    }

    function scoreFromCriteria(criteria, pointsPerCriterion = 4) {
        return normalizeArray(criteria).filter(item => item.met === true).length * Number(pointsPerCriterion || 0);
    }

    // O Lab corrige o que veio errado em vez de devolver ao analista; a pontuação reflete o que ele recebeu.
    const LAB_EDITABLE_FIELDS = ['sourceTicket', 'protocol', 'movement', 'reason', 'requestedPriority', 'priorityReason', 'promisedAt', 'targetManagerId', 'client', 'products', 'description', 'justification', 'diagnosis', 'evidence', 'conditional', 'managerNotes', 'logisticsNotes'];

    /* Rótulo humano de cada campo editável. "client.id mudou" não responde nada para
       quem lê a auditoria depois; "ID do cliente: TZ2244 → TZ3353" responde. */
    const LAB_FIELD_LABELS = {
        sourceTicket: 'Chamado de origem', protocol: 'Protocolo', movement: 'Movimento', reason: 'Motivo',
        requestedPriority: 'Prioridade', priorityReason: 'Justificativa da prioridade', promisedAt: 'Prazo prometido',
        targetManagerId: 'Gestor avaliador', client: 'Cliente', products: 'Produtos', description: 'Descrição',
        justification: 'Justificativa', diagnosis: 'Diagnóstico', evidence: 'Evidências', conditional: 'Condições',
        managerNotes: 'Notas para a gestão', logisticsNotes: 'Notas para a logística'
    };

    /* Guardar só o nome do campo não conta o que aconteceu. A auditoria precisa do
       valor anterior e do novo — é a diferença entre "o Lab mexeu no cliente" e
       "o ID do cliente era TZ2244 e passou a ser TZ3353". */
    function applyLabCorrections(record, corrections) {
        const applied = [];
        Object.entries(corrections || {}).forEach(([key, value]) => {
            if (!LAB_EDITABLE_FIELDS.includes(key)) return;
            const antes = record[key] ?? null;
            if (JSON.stringify(antes) === JSON.stringify(value ?? null)) return;
            applied.push({ field: key, label: LAB_FIELD_LABELS[key] || key, before: clone(antes), after: clone(value ?? null) });
            record[key] = clone(value);
        });
        return applied;
    }

    /* Achata objetos (cliente, produtos) em pares "caminho: valor" para a auditoria
       mostrar exatamente qual pedaço mudou, e não o objeto inteiro. */
    function diffOf(correction) {
        const achatar = (valor, prefixo = '') => {
            if (valor == null) return prefixo ? [[prefixo, '—']] : [];
            if (Array.isArray(valor)) return valor.flatMap((item, indice) => achatar(item, `${prefixo}[${indice + 1}]`));
            if (typeof valor === 'object') return Object.entries(valor).flatMap(([chave, item]) => achatar(item, prefixo ? `${prefixo}.${chave}` : chave));
            return [[prefixo, String(valor)]];
        };
        const antes = new Map(achatar(correction.before));
        const depois = new Map(achatar(correction.after));
        if (!antes.size && !depois.size) return [{ path: '', before: String(correction.before ?? '—'), after: String(correction.after ?? '—') }];
        return [...new Set([...antes.keys(), ...depois.keys()])]
            .filter(chave => antes.get(chave) !== depois.get(chave))
            .map(chave => ({ path: chave, before: antes.get(chave) ?? '—', after: depois.get(chave) ?? '—' }));
    }

    // O Lab ajusta os dados enquanto a solicitação está na fila dele, sem sair do estado de validação.
    function labCorrect(record, corrections, actorId, options = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, options.expectedVersion); ensureEditable(next, ['pending_lab_review']);
        requireValue(actorId, `Responsável do ${LAB_AREA} não identificado.`);
        const applied = applyLabCorrections(next, corrections);
        if (!applied.length) throw new Error('Nenhum dado foi alterado.');
        validateForSubmit(next);
        next.labCorrections = [...normalizeArray(next.labCorrections), { fields: applied, note: options.note || '', actorId, timestamp }];
        return append(next, 'lab_corrected', actorId, `${LAB_AREA} corrigiu ${applied.length} campo(s) da solicitação.`, { corrections: applied, correctionNote: options.note || '' }, timestamp);
    }

    function labReview(record, decision, actorId, options = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, options.expectedVersion); ensureEditable(next, ['pending_lab_review']);
        if (!['validate', 'reject'].includes(decision)) throw new Error('Decisão inválida.');
        requireValue(actorId, `Responsável do ${LAB_AREA} não identificado.`);
        if (decision === 'reject') {
            requireValue(options.note, 'Informe o motivo da reprovação.');
            next.requestStatus = 'rejected'; next.review = { decision: 'rejected', stage: 'lab', note: options.note, actorId, timestamp };
            normalizeArray(next.assignments).filter(task => ['pending', 'processing'].includes(task.status)).forEach(task => { task.status = 'completed'; task.completedAt = timestamp; });
            return append(next, 'rejected', actorId, `${LAB_AREA} reprovou a solicitação.`, { note: options.note, stage: 'lab' }, timestamp);
        }
        const corrections = applyLabCorrections(next, options.corrections);
        if (corrections.length) requireValue(options.correctionNote, 'Descreva o que foi corrigido antes de validar.');
        validateForSubmit(next);
        const calculated = scoreFromCriteria(options.criteria, options.pointsPerCriterion == null ? 4 : options.pointsPerCriterion);
        next.labReview = { actorId, timestamp, criteria: clone(options.criteria || []), calculated, corrections, correctionNote: options.correctionNote || '', note: options.note || '' };
        next.scoring = { ...next.scoring, calculated, final: calculated, rule: options.rule || 'Critérios de peças Catraca', criteria: clone(options.criteria || []), reviewedBy: actorId, reviewedAt: timestamp };
        next.requestStatus = 'pending_manager_check';
        handoff(next, 'Gestão', timestamp, 'Check da validação e da pontuação do Toletus Lab.');
        return append(next, 'lab_validated', actorId, corrections.length
            ? `${LAB_AREA} corrigiu ${corrections.length} campo(s), validou e pontuou a solicitação.`
            : `${LAB_AREA} validou e pontuou a solicitação.`, { points: calculated, corrections, correctionNote: options.correctionNote || '' }, timestamp);
    }

    function evaluate(record, decision, actorId, options = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, options.expectedVersion); ensureEditable(next, ['pending_manager_check']);
        if (decision === 'confirm') decision = 'approve';
        if (decision === 'correction') throw new Error(`A solicitação não volta para o analista: devolva ao ${LAB_AREA} ou reprove.`);
        if (!['approve', 'return', 'reject'].includes(decision)) throw new Error('Decisão inválida.');
        requireValue(actorId, 'Gestor responsável não identificado.');
        if (decision !== 'approve') requireValue(options.note, decision === 'return' ? 'Informe o que o Lab precisa revisar.' : 'Informe o motivo da reprovação.');
        if (decision === 'return') {
            next.requestStatus = 'pending_lab_review'; next.managerReturn = { note: options.note, actorId, timestamp };
            handoff(next, LAB_AREA, timestamp, 'Gestão devolveu a validação para revisão.');
            return append(next, 'returned_to_lab', actorId, `Gestão devolveu a solicitação para o ${LAB_AREA} revisar.`, { note: options.note }, timestamp);
        }
        if (decision === 'reject') {
            next.requestStatus = 'rejected'; next.review = { decision: 'rejected', stage: 'manager', note: options.note, actorId, timestamp };
            normalizeArray(next.assignments).filter(task => ['pending', 'processing'].includes(task.status)).forEach(task => { task.status = 'completed'; task.completedAt = timestamp; });
            return append(next, 'rejected', actorId, 'Gestão reprovou a solicitação.', { note: options.note }, timestamp);
        }
        // A pontuação vem do Lab; a gestão só confere e, se alterar, justifica.
        const calculated = Number(next.scoring?.calculated || 0);
        const final = options.finalPoints == null || options.finalPoints === '' ? calculated : Number(options.finalPoints);
        if (final !== calculated) requireValue(options.scoreReason, `Justifique a alteração da pontuação validada pelo ${LAB_AREA}.`);
        next.requestStatus = 'approved'; next.approvedAt = timestamp; next.approvedPriority = options.priority || next.requestedPriority || 'Normal';
        next.scoring = { ...next.scoring, calculated, final, rule: next.scoring?.rule || 'Critérios de peças Catraca', adjustmentReason: options.scoreReason || '', approvedBy: actorId, approvedAt: timestamp };
        const nfRequired = options.invoiceRequired !== false;
        next.fiscal = { ...next.fiscal, required: nfRequired, status: nfRequired ? 'awaiting_invoice' : 'not_required' };
        next.movements = next.movement === 'Troca' ? [createMovement('Envio', timestamp), createMovement('Coleta', timestamp)] : [createMovement(next.movement, timestamp)];
        next.movements.forEach(movement => { movement.status = nfRequired ? 'awaiting_invoice' : 'awaiting_tracking'; });
        next.review = { decision: 'approved', stage: 'manager', note: options.note || '', actorId, timestamp };
        next.assignments = [{ id: id('task'), area: 'Logística/Faturamento', status: 'pending', assigneeId: null, createdAt: timestamp }];
        return append(next, 'approved_handoff', actorId, 'Gestão confirmou a validação e encaminhou automaticamente para Logística/Faturamento.', { priority: next.approvedPriority, points: final, invoiceRequired: nfRequired }, timestamp);
    }

    function updateDraft(record, patch, actorId, expectedVersion, timestamp = now()) {
        const next = clone(record); assertVersion(next, expectedVersion); ensureEditable(next, ['draft', 'correction_requested']);
        const protectedFields = new Set(['id', 'version', 'events', 'createdAt', 'createdBy', 'scoring', 'approvedAt']);
        Object.entries(patch || {}).forEach(([key, value]) => { if (!protectedFields.has(key)) next[key] = clone(value); });
        if (next.requestStatus === 'correction_requested') next.requestStatus = 'draft';
        return append(next, 'updated', actorId, 'Solicitação atualizada.', {}, timestamp);
    }

    function claim(record, actorId, area, expectedVersion, timestamp = now()) {
        const next = clone(record); assertVersion(next, expectedVersion); ensureEditable(next, ['approved']);
        const current = normalizeArray(next.assignments).find(task => task.status === 'processing');
        if (current && current.assigneeId !== actorId) throw new Error(`Esta pendência já está em processamento por ${current.assigneeName || 'outra pessoa'}.`);
        if (!current) next.assignments.push({ id: id('task'), area: area || nextAction(next).area, status: 'processing', assigneeId: actorId, startedAt: timestamp });
        return append(next, 'processing_started', actorId, `${area || 'Operação'} iniciou o processamento.`, { area }, timestamp);
    }

    function updateFiscal(record, action, actorId, data = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, data.expectedVersion); ensureEditable(next, ['approved']);
        const map = { start: 'processing', issue: 'issued', not_required: 'not_required', reject: 'rejected', block: 'blocked' };
        if (!map[action]) throw new Error('Ação fiscal inválida.');
        if (action === 'issue') { requireValue(data.number, 'Informe o número da nota fiscal.'); requireValue(data.issuedAt || timestamp, 'Informe a data de emissão.'); }
        if (['reject', 'block'].includes(action)) requireValue(data.note, 'Informe o motivo da pendência fiscal.');
        next.fiscal = { ...next.fiscal, ...clone(data), status: map[action], updatedBy: actorId, updatedAt: timestamp };
        if (['issued', 'not_required'].includes(next.fiscal.status)) next.movements.forEach(movement => { if (movement.status === 'awaiting_invoice') movement.status = 'awaiting_tracking'; });
        return append(next, `fiscal_${map[action]}`, actorId, ({ start: 'Emissão da nota fiscal iniciada.', issue: 'Nota fiscal emitida. A etiqueta e o rastreio ainda precisam ser registrados.', not_required: 'Operação registrada como sem exigência de nota fiscal. A etiqueta e o rastreio ainda precisam ser registrados.', reject: 'Nota fiscal rejeitada; pendência devolvida para resolução.', block: 'Faturamento bloqueado por falta de dados.' })[action], { number: data.number || '', note: data.note || '' }, timestamp);
    }

    function registerTracking(record, movementId, actorId, data = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, data.expectedVersion); ensureEditable(next, ['approved']);
        if (!['issued', 'not_required'].includes(next.fiscal?.status)) throw new Error('Conclua a etapa fiscal antes de gerar a etiqueta e o rastreio.');
        const movement = next.movements.find(item => item.id === movementId); if (!movement) throw new Error('Movimentação não encontrada.');
        requireValue(data.carrier, 'Informe a transportadora.'); requireValue(data.modality, 'Informe a modalidade.');
        if (!normalizeArray(data.tracking).length) throw new Error('Adicione ao menos um código de rastreio.');
        Object.assign(movement, clone(data), { status: 'awaiting_packing', trackingIssuedAt: timestamp, updatedBy: actorId, updatedAt: timestamp });
        handoff(next, 'Envio/Coleta', timestamp, 'NF e rastreio disponíveis; preparar embalagem e despacho.');
        return append(next, 'tracking_issued_handoff', actorId, 'Etiqueta e rastreio registrados. Solicitação encaminhada para Envio/Coleta preparar a peça.', { movementId, tracking: data.tracking }, timestamp);
    }

    function returnForInformation(record, actorId, data = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, data.expectedVersion); ensureEditable(next, ['approved']);
        if (!['Gestão', 'Envio/Coleta'].includes(data.targetArea)) throw new Error('Selecione Gestão ou Envio/Coleta como responsável pela informação.');
        requireValue(data.note, 'Explique qual informação está faltando.');
        next.informationRequest = { id: id('info'), status: 'pending', targetArea: data.targetArea, note: data.note, requestedBy: actorId, requestedAt: timestamp };
        handoff(next, data.targetArea, timestamp, data.note);
        return append(next, 'information_requested', actorId, `Logística solicitou informações para ${data.targetArea}.`, { targetArea: data.targetArea, note: data.note }, timestamp);
    }

    function resolveInformation(record, actorId, note, expectedVersion, timestamp = now()) {
        const next = clone(record); assertVersion(next, expectedVersion); ensureEditable(next, ['approved']);
        if (!next.informationRequest || next.informationRequest.status !== 'pending') throw new Error('Não existe solicitação de informação pendente.');
        requireValue(note, 'Informe a resposta enviada para Logística/Faturamento.');
        next.informationRequest = { ...next.informationRequest, status: 'answered', answer: note, answeredBy: actorId, answeredAt: timestamp };
        handoff(next, 'Logística/Faturamento', timestamp, 'Informação respondida; retomar processamento.');
        return append(next, 'information_answered', actorId, 'Informação complementar enviada para Logística/Faturamento.', { note }, timestamp);
    }

    function updateMovement(record, movementId, action, actorId, data = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, data.expectedVersion); ensureEditable(next, ['approved']);
        const movement = next.movements.find(item => item.id === movementId); if (!movement) throw new Error('Movimentação não encontrada.');
        const map = { pack: 'packing', ready: 'awaiting_dispatch', await_carrier: 'awaiting_carrier', schedule: 'scheduled', collect: 'collected', return: 'returning', receive: 'received', await_inspection: 'awaiting_inspection', inspect: 'inspected', out_for_delivery: 'out_for_delivery', deliver: 'delivered', followup: 'client_followup', await_confirmation: 'awaiting_confirmation', complete: 'completed' };
        if (action === 'freight') {
            requireValue(data.carrier, 'Informe a transportadora.'); requireValue(data.modality, 'Informe a modalidade.');
            Object.assign(movement, clone(data), { updatedBy: actorId, updatedAt: timestamp });
            return append(next, 'movement_freight', actorId, 'Dados de frete registrados.', { movementId, carrier: data.carrier, modality: data.modality }, timestamp);
        }
        if (action === 'post') {
            if (!normalizeArray(movement.tracking).length) throw new Error('O código de rastreio deve ser gerado por Logística/Faturamento antes da postagem.');
            movement.status = 'in_transit'; movement.postedAt = data.postedAt || timestamp;
        } else if (map[action]) movement.status = map[action]; else throw new Error('Ação logística inválida.');
        Object.assign(movement, clone(data), { updatedBy: actorId, updatedAt: timestamp });
        if (action === 'complete') {
            requireValue(data.outcome, 'Descreva o desfecho da demanda antes de concluir o chamado.');
            movement.deliveredAt = data.deliveredAt || timestamp; movement.outcome = data.outcome;
            const pendentes = next.movements.filter(item => item.status !== 'completed');
            if (!pendentes.length) next.conclusion = { outcome: data.outcome, closedBy: actorId, closedAt: timestamp };
        }
        return append(next, `movement_${action}`, actorId, ({ pack: 'Envio/Coleta iniciou a embalagem da peça.', ready: 'Embalagem concluída; peça pronta para postagem.', await_carrier: 'Peça pronta, aguardando a transportadora.', post: 'Postagem confirmada e acompanhamento iniciado.', schedule: 'Coleta agendada.', collect: 'Coleta confirmada.', return: 'Peça coletada em trânsito para a empresa.', receive: 'Produto recebido pela empresa.', await_inspection: 'Produto encaminhado para inspeção.', inspect: 'Inspeção concluída.', out_for_delivery: 'Peça saiu para entrega.', deliver: 'Entrega ao cliente confirmada.', followup: 'Cliente instruído; acompanhamento em andamento até o fechamento.', await_confirmation: 'Aguardando confirmação do solicitante.', complete: 'Entrega acompanhada e chamado concluído.' })[action], { movementId, kind: movement.kind }, timestamp);
    }

    function resolveOccurrence(record, occurrenceId, actorId, data = {}, timestamp = now()) {
        const next = clone(record); assertVersion(next, data.expectedVersion);
        const occurrence = normalizeArray(next.occurrences).find(item => item.id === occurrenceId);
        if (!occurrence) throw new Error('Ocorrência não encontrada.');
        if (occurrence.status !== 'active') throw new Error('Esta ocorrência já foi encerrada.');
        requireValue(data.resolution, 'Descreva como a ocorrência foi resolvida.');
        Object.assign(occurrence, { status: 'resolved', resolution: data.resolution, resolvedBy: actorId, resolvedAt: timestamp });
        return append(next, 'occurrence_resolved', actorId, `Ocorrência encerrada: ${occurrence.type}.`, { occurrenceId, type: occurrence.type }, timestamp);
    }

    function addOccurrence(record, actorId, data, timestamp = now()) {
        const next = clone(record); assertVersion(next, data.expectedVersion); requireValue(data.type, 'Selecione o tipo da ocorrência.'); requireValue(data.description, 'Descreva a ocorrência.');
        next.occurrences.push({ id: id('occ'), type: data.type, description: data.description, responsibleId: data.responsibleId || actorId, nextAction: data.nextAction || '', dueAt: data.dueAt || null, status: 'active', createdBy: actorId, createdAt: timestamp });
        return append(next, 'occurrence_created', actorId, `Ocorrência registrada: ${data.type}.`, { type: data.type }, timestamp);
    }

    function nextAction(record) {
        if (record.requestStatus === 'draft') return { label: 'Enviar para validação', area: 'Analista' };
        if (record.requestStatus === 'pending_lab_review') return { label: 'Validar e pontuar', area: LAB_AREA };
        if (record.requestStatus === 'pending_manager_check') return { label: 'Conferir validação e pontuação', area: 'Gestão', assigneeId: record.targetManagerId || null };
        if (record.requestStatus === 'pending_review') return { label: 'Avaliar solicitação', area: 'Gestão', assigneeId: record.targetManagerId || null };
        if (record.requestStatus === 'correction_requested') return { label: 'Corrigir solicitação', area: 'Analista' };
        if (record.requestStatus === 'rejected') return { label: 'Nenhuma ação', area: '' };
        if (record.informationRequest?.status === 'pending') return { label: 'Responder informação pendente', area: record.informationRequest.targetArea };
        if (['awaiting_invoice', 'processing', 'rejected', 'blocked'].includes(record.fiscal?.status)) return { label: record.fiscal.status === 'processing' ? 'Concluir emissão da NF' : 'Emitir nota fiscal', area: 'Logística/Faturamento' };
        const movement = normalizeArray(record.movements).find(item => item.status !== 'completed');
        if (!movement) return { label: 'Operação concluída', area: '' };
        if (movement.status === 'awaiting_tracking') return { label: 'Gerar etiqueta e rastreio', area: 'Logística/Faturamento' };
        if (movement.kind === 'Coleta') return { label: movement.status === 'awaiting_packing' ? 'Preparar coleta' : movement.status === 'awaiting_schedule' ? 'Agendar coleta' : movement.status === 'scheduled' ? 'Confirmar coleta' : movement.status === 'received' ? 'Concluir chamado' : 'Acompanhar coleta', area: 'Envio/Coleta' };
        if (movement.status === 'awaiting_packing') return { label: 'Embalar peça', area: 'Envio/Coleta' };
        if (movement.status === 'packing') return { label: 'Concluir embalagem', area: 'Envio/Coleta' };
        if (movement.status === 'awaiting_dispatch') return { label: 'Confirmar postagem', area: 'Envio/Coleta' };
        // Postada a peça, o acompanhamento até o fechamento volta para o Lab.
        if (['in_transit', 'out_for_delivery'].includes(movement.status)) return { label: 'Acompanhar entrega', area: LAB_AREA };
        if (movement.status === 'delivered') return { label: 'Instruir o cliente e acompanhar', area: LAB_AREA };
        if (movement.status === 'client_followup') return { label: 'Concluir chamado', area: LAB_AREA };
        if (movement.status === 'awaiting_confirmation') return { label: 'Confirmar com o solicitante', area: LAB_AREA };
        return { label: 'Atualizar movimentação', area: 'Envio/Coleta' };
    }

    /* Onde a solicitação está no caminho completo, do envio do analista à conclusão
       com o cliente. operationalStatus() responde "qual o status"; isto responde
       "de quem é a bola agora e quanto falta" — que é o que a tela precisa mostrar. */
    const PIPELINE = [
        { key: 'lab_review', order: 1, label: 'Aguardando validação', area: LAB_AREA, hint: 'Enviada pela equipe técnica; o Lab precisa corrigir, validar e pontuar.' },
        { key: 'manager_check', order: 2, label: 'No check da gestão', area: 'Gestão', hint: 'Validada e pontuada pelo Lab; aguarda a conferência da gestão.' },
        { key: 'invoicing', order: 3, label: 'Faturamento e rastreio', area: 'Logística/Faturamento', hint: 'Aprovada pela gestão; aguarda nota fiscal, etiqueta e código de rastreio.' },
        { key: 'shipping', order: 4, label: 'Expedição', area: 'Envio/Coleta', hint: 'Documentos prontos; aguarda embalagem e postagem.' },
        { key: 'lab_followup', order: 5, label: 'Acompanhamento do Lab', area: LAB_AREA, hint: 'Peça a caminho; o Lab acompanha a entrega e instrui o cliente até fechar.' },
        { key: 'done', order: 6, label: 'Concluído', area: '', hint: 'Chamado encerrado com desfecho registrado.' },
        { key: 'rejected', order: 0, label: 'Reprovada', area: '', hint: 'Encerrada sem seguir para a operação.' },
        { key: 'draft', order: 0, label: 'Rascunho', area: 'Analista', hint: 'Ainda não enviada pelo analista.' }
    ];
    const PIPELINE_BY_KEY = PIPELINE.reduce((acc, item) => ({ ...acc, [item.key]: item }), {});

    function pipelineStage(record) {
        if (!record) return PIPELINE_BY_KEY.draft;
        if (record.requestStatus === 'rejected') return PIPELINE_BY_KEY.rejected;
        if (record.requestStatus === 'draft') return PIPELINE_BY_KEY.draft;
        if (['pending_lab_review', 'correction_requested'].includes(record.requestStatus)) return PIPELINE_BY_KEY.lab_review;
        if (['pending_manager_check', 'pending_review'].includes(record.requestStatus)) return PIPELINE_BY_KEY.manager_check;
        if (operationalStatus(record) === 'Concluído') return PIPELINE_BY_KEY.done;
        const area = nextAction(record).area;
        if (area === LAB_AREA) return PIPELINE_BY_KEY.lab_followup;
        if (area === 'Envio/Coleta') return PIPELINE_BY_KEY.shipping;
        return PIPELINE_BY_KEY.invoicing;
    }

    // Contagem por etapa, na ordem do caminho, para a tela desenhar o funil.
    function pipelineSummary(records) {
        const rows = normalizeArray(records);
        return PIPELINE.filter(stage => stage.order > 0).map(stage => ({
            ...stage,
            count: rows.filter(row => pipelineStage(row).key === stage.key).length
        }));
    }

    function operationalStatus(record) {
        if (record.requestStatus !== 'approved') return REQUEST_STATUSES[record.requestStatus] || record.requestStatus;
        if (normalizeArray(record.occurrences).some(item => item.status === 'active')) return 'Com ocorrência';
        const movement = normalizeArray(record.movements).find(item => item.status !== 'completed');
        if (!movement) return 'Concluído';
        if (['awaiting_invoice', 'processing', 'rejected', 'blocked'].includes(record.fiscal?.status)) return FISCAL_STATUSES[record.fiscal.status];
        return SHIPPING_STATUSES[movement.status] || movement.status;
    }

    function priorityOf(record) { return record.approvedPriority || record.requestedPriority || 'Normal'; }

    function slaStageStart(record) {
        if (['draft', 'correction_requested'].includes(record.requestStatus)) return Number(record.updatedAt || record.createdAt);
        if (record.requestStatus === 'pending_review') return Number(record.submittedAt || record.createdAt);
        const task = normalizeArray(record.assignments).find(item => ['pending', 'processing'].includes(item.status));
        return Number(task?.createdAt || record.approvedAt || record.submittedAt || record.createdAt);
    }

    function sla(record, reference = now()) {
        const action = nextAction(record);
        const priority = priorityOf(record);
        const target = SLA_TARGETS[priority] || null;
        const startedAt = slaStageStart(record);
        const elapsedMs = Math.max(0, reference - startedAt);
        const base = { area: action.area, action: action.label, priority, startedAt, elapsedMs, dueAt: null, remainingMs: null, basis: null };
        if (!action.area || record.requestStatus === 'rejected') return { ...base, state: 'completed', label: SLA_STATES.completed };
        const promisedAt = Number(record.promisedAt) || null;
        const stageDueAt = target ? startedAt + target : null;
        const candidates = [stageDueAt, promisedAt].filter(value => Number.isFinite(value) && value > 0);
        if (!candidates.length) return { ...base, state: 'no_target', label: SLA_STATES.no_target };
        const dueAt = Math.min(...candidates);
        const remainingMs = dueAt - reference;
        const window = target || (dueAt - startedAt) || HOUR;
        const state = remainingMs < 0 ? 'late' : remainingMs <= window * SLA_DUE_SOON_RATIO ? 'due_soon' : 'on_track';
        return { ...base, dueAt, remainingMs, state, label: SLA_STATES[state], basis: dueAt === promisedAt ? 'promised' : 'priority' };
    }

    function isLate(record, reference = now()) { return sla(record, reference).state === 'late'; }

    function durationBetween(record, fromEvents, toEvents) {
        const events = normalizeArray(record.events);
        const at = types => events.find(item => types.includes(item.type))?.timestamp || null;
        const from = at(fromEvents); const to = at(toEvents);
        return from && to && to >= from ? to - from : null;
    }

    function average(values) { const list = values.filter(value => Number.isFinite(value)); return list.length ? list.reduce((sum, value) => sum + value, 0) / list.length : null; }

    function operationMetrics(records, reference = now()) {
        const rows = normalizeArray(records);
        const open = rows.filter(row => sla(row, reference).area);
        const late = open.filter(row => sla(row, reference).state === 'late');
        const closed = rows.filter(row => operationalStatus(row) === 'Concluído');
        return {
            open: open.length, late: late.length, dueSoon: open.filter(row => sla(row, reference).state === 'due_soon').length,
            onTimeRate: open.length ? (open.length - late.length) / open.length : null,
            submitToApproval: average(rows.map(row => durationBetween(row, ['submitted'], ['approved_handoff']))),
            approvalToInvoice: average(rows.map(row => durationBetween(row, ['approved_handoff'], ['fiscal_issued', 'fiscal_not_required']))),
            invoiceToDispatch: average(rows.map(row => durationBetween(row, ['fiscal_issued', 'fiscal_not_required'], ['movement_post']))),
            dispatchToDelivery: average(rows.map(row => durationBetween(row, ['movement_post'], ['movement_deliver', 'movement_complete']))),
            blocked: rows.filter(row => ['rejected', 'blocked'].includes(row.fiscal?.status)).length,
            withOccurrence: rows.filter(row => normalizeArray(row.occurrences).some(item => item.status === 'active')).length,
            failedCollections: rows.filter(row => normalizeArray(row.occurrences).some(item => item.type === 'Coleta não realizada')).length,
            completed: closed.length
        };
    }

    // Qualidade do que o analista envia: o Lab não devolve, corrige — então o sinal é o campo que ele precisou corrigir.
    function correctionEvents(row) {
        return normalizeArray(row.events).filter(item => item.type === 'correction_requested' || item.type === 'lab_corrected' || (item.type === 'lab_validated' && normalizeArray(item.metadata?.corrections).length > 0));
    }
    function neededCorrection(row) { return correctionEvents(row).length > 0; }

    function qualityMetrics(records) {
        const rows = normalizeArray(records);
        const reviewed = rows.filter(row => normalizeArray(row.events).some(item => ['approved_handoff', 'lab_validated', 'correction_requested', 'rejected'].includes(item.type)));
        const returned = rows.filter(neededCorrection);
        const rejected = rows.filter(row => row.requestStatus === 'rejected');
        const firstTry = reviewed.filter(row => !neededCorrection(row));
        const returnedToLab = rows.filter(row => normalizeArray(row.events).some(item => item.type === 'returned_to_lab'));
        const byAnalyst = {};
        rows.forEach(row => {
            const key = row.analystId || 'sem-analista';
            const entry = byAnalyst[key] || (byAnalyst[key] = { total: 0, approved: 0, returned: 0, points: 0 });
            entry.total += 1;
            if (row.requestStatus === 'approved') { entry.approved += 1; entry.points += Number(row.scoring?.final || 0); }
            if (neededCorrection(row)) entry.returned += 1;
        });
        const returnReasons = {};
        rows.forEach(row => correctionEvents(row).forEach(item => {
            const reason = String(item.metadata?.note || item.metadata?.correctionNote || 'Não informado').trim().slice(0, 80) || 'Não informado';
            returnReasons[reason] = (returnReasons[reason] || 0) + 1;
        }));
        return {
            reviewed: reviewed.length, returned: returned.length, rejected: rejected.length, returnedToLab: returnedToLab.length,
            returnRate: reviewed.length ? returned.length / reviewed.length : null,
            firstTryRate: reviewed.length ? firstTry.length / reviewed.length : null,
            correctionTime: average(rows.map(row => durationBetween(row, ['lab_validated', 'correction_requested'], ['submitted']))),
            validatedPoints: rows.reduce((sum, row) => sum + Number(row.scoring?.final || 0), 0),
            byAnalyst, returnReasons
        };
    }

    function freightMetrics(records) {
        const rows = normalizeArray(records);
        const movements = rows.flatMap(row => normalizeArray(row.movements).map(movement => ({ row, movement })));
        const paid = movements.filter(item => Number(item.movement.actualCost || 0) > 0);
        const group = getter => movements.reduce((acc, item) => {
            const key = getter(item) || 'Não informado';
            const entry = acc[key] || (acc[key] = { count: 0, total: 0 });
            entry.count += 1; entry.total += Number(item.movement.actualCost || 0);
            return acc;
        }, {});
        const quoted = movements.filter(item => Number(item.movement.quotedCost || 0) > 0);
        return {
            total: movements.reduce((sum, item) => sum + Number(item.movement.actualCost || 0), 0),
            average: paid.length ? paid.reduce((sum, item) => sum + Number(item.movement.actualCost || 0), 0) / paid.length : null,
            quotedTotal: quoted.reduce((sum, item) => sum + Number(item.movement.quotedCost || 0), 0),
            quotedVsActual: quoted.length ? quoted.reduce((sum, item) => sum + (Number(item.movement.actualCost || 0) - Number(item.movement.quotedCost || 0)), 0) : null,
            byCarrier: group(item => item.movement.carrier), byModality: group(item => item.movement.modality),
            byPayer: group(item => item.movement.paidBy), byBrand: group(item => item.row.client?.brand),
            byState: group(item => item.row.client?.state), byCategory: group(item => item.row.products?.[0]?.category)
        };
    }

    function warrantyMetrics(records, baseline = {}) {
        const rows = normalizeArray(records).filter(row => row.reason === 'Garantia');
        const byProduct = {};
        rows.forEach(row => normalizeArray(row.products).forEach(product => {
            const key = product.code || product.name || 'Não informado';
            const entry = byProduct[key] || (byProduct[key] = { code: product.code || '', name: product.name || key, quantity: 0, recurrences: 0, defects: {}, rate: null });
            entry.quantity += Number(product.quantity || 0);
            if (String(row.conditional?.recurrence || '').toLowerCase() === 'sim') entry.recurrences += 1;
            const defect = row.conditional?.defect || 'Não informado';
            entry.defects[defect] = (entry.defects[defect] || 0) + 1;
        }));
        Object.entries(byProduct).forEach(([key, entry]) => {
            const denominator = Number(baseline[key] ?? baseline[entry.code] ?? 0);
            entry.rate = denominator > 0 ? entry.quantity / denominator : null;
            entry.baseline = denominator || null;
        });
        return { totalItems: rows.reduce((sum, row) => sum + normalizeArray(row.products).reduce((n, item) => n + Number(item.quantity || 0), 0), 0), requests: rows.length, byProduct, hasBaseline: Object.keys(baseline || {}).length > 0 };
    }

    function filter(records, filters = {}) {
        const query = String(filters.query || '').trim().toLowerCase();
        return normalizeArray(records).filter(record => {
            if (filters.requestStatus && filters.requestStatus !== 'all' && record.requestStatus !== filters.requestStatus) return false;
            if (filters.movement && filters.movement !== 'all' && record.movement !== filters.movement) return false;
            if (filters.reason && filters.reason !== 'all' && record.reason !== filters.reason) return false;
            if (filters.priority && filters.priority !== 'all' && (record.approvedPriority || record.requestedPriority) !== filters.priority) return false;
            if (filters.brand && filters.brand !== 'all' && record.client?.brand !== filters.brand) return false;
            if (filters.analystId && filters.analystId !== 'all' && record.analystId !== filters.analystId) return false;
            if (filters.stage && filters.stage !== 'all' && nextAction(record).area !== filters.stage) return false;
            if (filters.occurrence === 'yes' && !normalizeArray(record.occurrences).some(item => item.status === 'active')) return false;
            if (filters.occurrence === 'no' && normalizeArray(record.occurrences).some(item => item.status === 'active')) return false;
            if (filters.department && filters.department !== 'all' && record.department !== filters.department) return false;
            if (filters.targetManagerId && filters.targetManagerId !== 'all' && record.targetManagerId !== filters.targetManagerId) return false;
            if (filters.state && filters.state !== 'all' && String(record.client?.state || '').toUpperCase() !== String(filters.state).toUpperCase()) return false;
            if (filters.category && filters.category !== 'all' && !normalizeArray(record.products).some(item => item.category === filters.category)) return false;
            if (filters.carrier && filters.carrier !== 'all' && !normalizeArray(record.movements).some(item => item.carrier === filters.carrier)) return false;
            if (filters.modality && filters.modality !== 'all' && !normalizeArray(record.movements).some(item => item.modality === filters.modality)) return false;
            if (filters.invoice === 'yes' && !['issued'].includes(record.fiscal?.status)) return false;
            if (filters.invoice === 'no' && ['issued'].includes(record.fiscal?.status)) return false;
            if (filters.tracking === 'yes' && !normalizeArray(record.movements).some(item => normalizeArray(item.tracking).length)) return false;
            if (filters.tracking === 'no' && normalizeArray(record.movements).some(item => normalizeArray(item.tracking).length)) return false;
            if (filters.sla && filters.sla !== 'all' && sla(record).state !== filters.sla) return false;
            if (filters.from && Number(record.createdAt || 0) < Number(filters.from)) return false;
            if (filters.to && Number(record.createdAt || 0) > Number(filters.to)) return false;
            if (query && ![record.protocol, record.sourceTicket, record.client?.id, record.client?.name, record.fiscal?.number, ...normalizeArray(record.movements).flatMap(item => normalizeArray(item.tracking).map(track => track.code))].filter(Boolean).some(value => String(value).toLowerCase().includes(query))) return false;
            return true;
        });
    }

    function sortQueue(records, reference = now()) {
        const due = record => { const value = sla(record, reference).dueAt; return Number.isFinite(value) ? value : Infinity; };
        return normalizeArray(records).slice().sort((a, b) =>
            (PRIORITY_WEIGHT[priorityOf(a)] ?? 9) - (PRIORITY_WEIGHT[priorityOf(b)] ?? 9)
            || due(a) - due(b)
            || slaStageStart(a) - slaStageStart(b)
            || Number(a.approvedAt || a.createdAt) - Number(b.approvedAt || b.createdAt));
    }

    /* Exclusão auditada. Apagar a solicitação sem tirar os pontos mantém exatamente o erro
       que a exclusão existe para desfazer: um chamado de teste que pontuou o analista. E
       apagar sem rastro impede conferir depois quem tirou o quê. Por isso a exclusão devolve
       um registro completo — snapshot, autor, motivo e pontos estornados — que vira a aba
       de auditoria da gestão e mantém o estrago reversível. */
    function pointLogsOf(logs, recordId) {
        return normalizeArray(logs).filter(log => log && log.type === 'PECA' && log.relatedPieceRequestId === recordId);
    }

    function deletionEntry(record, actorId, reason, removedLogs, timestamp = now()) {
        requireValue(actorId, 'Usuário responsável não identificado.');
        requireValue(reason, 'Informe o motivo da exclusão.');
        const logs = normalizeArray(removedLogs);
        return {
            id: record.id,
            protocol: record.protocol || record.sourceTicket || '',
            analystId: record.analystId || null,
            department: record.department || '',
            requestStatus: record.requestStatus || '',
            deletedBy: actorId,
            deletedAt: timestamp,
            reason: String(reason).trim(),
            removedPoints: logs.reduce((sum, log) => sum + Number(log.value || 0), 0),
            removedLogIds: logs.map(log => log.id),
            record: clone(record)
        };
    }

    function summarize(records) {
        const rows = normalizeArray(records); const count = predicate => rows.filter(predicate).length;
        return {
            total: rows.length, awaitingLabReview: count(row => row.requestStatus === 'pending_lab_review'), awaitingApproval: count(row => row.requestStatus === 'pending_manager_check'),
            awaitingLabFollowup: count(row => row.requestStatus === 'approved' && nextAction(row).area === LAB_AREA),
            corrections: count(row => row.requestStatus === 'correction_requested'),
            approved: count(row => row.requestStatus === 'approved'), awaitingInvoice: count(row => ['awaiting_invoice', 'processing', 'rejected', 'blocked'].includes(row.fiscal?.status)),
            awaitingTracking: count(row => row.requestStatus === 'approved' && nextAction(row).area === 'Logística/Faturamento' && row.movements?.some(item => item.status === 'awaiting_tracking')),
            awaitingLogistics: count(row => row.requestStatus === 'approved' && nextAction(row).area === 'Envio/Coleta'), inTransit: count(row => row.movements?.some(item => ['in_transit', 'returning'].includes(item.status))),
            occurrences: count(row => row.occurrences?.some(item => item.status === 'active')), completed: count(row => operationalStatus(row) === 'Concluído'),
            late: count(row => sla(row).state === 'late'), dueSoon: count(row => sla(row).state === 'due_soon'),
            readyToShip: count(row => row.movements?.some(item => ['awaiting_packing', 'packing', 'awaiting_dispatch', 'awaiting_carrier'].includes(item.status))),
            pendingCollections: count(row => row.movements?.some(item => item.kind === 'Coleta' && ['awaiting_schedule', 'scheduled'].includes(item.status))),
            points: rows.reduce((sum, row) => sum + Number(row.scoring?.final || 0), 0), freight: rows.reduce((sum, row) => sum + normalizeArray(row.movements).reduce((subtotal, movement) => subtotal + Number(movement.actualCost || 0), 0), 0)
        };
    }

    function guaranteeRate(records, productCode, installedOrSold) {
        const guarantees = normalizeArray(records).filter(row => row.reason === 'Garantia').reduce((sum, row) => sum + normalizeArray(row.products).filter(item => item.code === productCode).reduce((n, item) => n + Number(item.quantity || 0), 0), 0);
        return installedOrSold > 0 ? guarantees / installedOrSold : null;
    }

    return {
        MOVEMENTS, REASONS, PRIORITIES, BRANDS, REQUEST_STATUSES, FISCAL_STATUSES, SHIPPING_STATUSES, OCCURRENCE_TYPES, CARRIERS, MODALITIES, SLA_TARGETS, SLA_STATES, LAB_AREA, LAB_EDITABLE_FIELDS, LAB_FIELD_LABELS, PERSON_TYPES, diffOf,
        personTypeOf, documentOf, documentTypeOf, documentLabelOf, nameLabelOf,
        bootstrap, legacyToOperation, createDraft, updateDraft, validateForSubmit, pendingRequirements, submit, labCorrect, labReview, evaluate, claim, updateFiscal, registerTracking, returnForInformation, resolveInformation,
        updateMovement, addOccurrence, resolveOccurrence, comment, nextAction, operationalStatus, pipelineStage, pipelineSummary, PIPELINE, sla, isLate, filter, sortQueue, summarize,
        pointLogsOf, deletionEntry,
        operationMetrics, qualityMetrics, freightMetrics, warrantyMetrics, guaranteeRate, scoreFromCriteria
    };
});
