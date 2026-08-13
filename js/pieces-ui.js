(function () {
    'use strict';

    const EMPTY_FILTERS = {
        query: '', movement: 'all', reason: 'all', requestStatus: 'all', priority: 'all', stage: 'all', occurrence: 'all', analystId: 'all',
        brand: 'all', carrier: 'all', modality: 'all', category: 'all', state: 'all', sla: 'all', invoice: 'all', tracking: 'all', from: '', to: ''
    };
    const ADVANCED_KEYS = ['reason', 'brand', 'stage', 'carrier', 'modality', 'category', 'state', 'sla', 'invoice', 'tracking', 'occurrence', 'from', 'to'];
    const state = {
        tab: '', filters: { ...EMPTY_FILTERS }, filtersOpen: false,
        pipeline: 'all', selectedId: null, wizardStep: 0, wizardDraft: null, wizardProducts: [], wizardVisited: [0], wizardChecked: false, action: null, actionContext: null, detailSuspended: false
    };
    const STEPS = ['Origem e tipo', 'Cliente', 'Produtos', 'Motivo e evidências', 'Revisão'];
    const STEP_KEYS = ['origin', 'client', 'products', 'details', 'review'];
    const LAB_ROLE = 'Toletus Lab';
    function normalizeCriteria(list) { return Array.isArray(list) ? list : []; }
    const CRITERIA = ['Chamado corretamente vinculado', 'Cliente corretamente identificado', 'Endereço confirmado', 'Produto correto', 'Quantidade correta', 'Motivo coerente', 'Evidências suficientes', 'Diagnóstico suficiente', 'Solicitação dentro do SLA', 'Dados obrigatórios completos'];

    function domain() { return window.PiecesOperations; }
    function store() { return typeof getStore === 'function' ? getStore() : null; }
    function users() { return store()?.users || window.defaultUsers || {}; }
    function currentContext() {
        if (typeof isAdminLoggedIn !== 'undefined' && isAdminLoggedIn) return { mode: 'manager', actorId: currentAdminId, user: getCurrentManager?.(), teams: getManagerAuthorizedTeams?.() || ['Sistema', 'Catraca'] };
        if (typeof isPecaLoggedIn !== 'undefined' && isPecaLoggedIn) {
            // O papel vem do cadastro do usuário logado e de mais lugar nenhum: sem
            // atalho de visualização, a tela sempre corresponde a quem entrou.
            const user = users()[currentPecaUserId];
            return { mode: user?.role === LAB_ROLE ? 'lab' : 'logistics', actorId: currentPecaUserId, user, teams: ['Sistema', 'Catraca'] };
        }
        return { mode: 'analyst', actorId: currentActiveUser, user: users()[currentActiveUser], teams: [users()[currentActiveUser]?.team].filter(Boolean) };
    }
    function e(value) { return typeof escapeHtml === 'function' ? escapeHtml(String(value ?? '')) : String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
    function fmtDate(timestamp, withTime = false) { if (!timestamp) return '—'; return new Date(timestamp).toLocaleString('pt-BR', withTime ? { dateStyle: 'short', timeStyle: 'short' } : { dateStyle: 'short' }); }
    function money(value) { return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }); }
    function initials(user) { return (user?.initial || user?.name || '?').split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase(); }
    function avatar(user, size = '') { return `<span class="pieces-avatar ${size}">${user?.photo ? `<img src="${e(user.photo)}" alt="">` : e(initials(user))}</span>`; }
    function options(list, selected, allLabel) { return `${allLabel ? `<option value="all">${e(allLabel)}</option>` : ''}${list.map(item => `<option value="${e(item)}" ${item === selected ? 'selected' : ''}>${e(item)}</option>`).join('')}`; }
    function records() { return Array.isArray(store()?.pieceOperations) ? store().pieceOperations : []; }
    function allowedRecords() {
        const context = currentContext(); let rows = records();
        if (context.mode === 'analyst') rows = rows.filter(row => row.analystId === context.actorId);
        if (context.mode === 'manager' && context.teams.length) rows = rows.filter(row => context.teams.includes(row.department) || row.targetManagerId === context.actorId);
        if (context.mode === 'logistics') rows = rows.filter(row => row.requestStatus === 'approved');
        // O Lab valida antes da gestão e acompanha depois da logística: enxerga tudo que não é rascunho.
        if (context.mode === 'lab') rows = rows.filter(row => row.requestStatus !== 'draft');
        return rows;
    }
    function selected() { return records().find(row => row.id === state.selectedId) || null; }
    // Solicitações aguardando validação/aprovação da gestão, no escopo de equipes do gestor logado.
    function pendingReviewCount() {
        if (!store() || !domain()) return 0;
        if (currentContext().mode !== 'manager') return 0;
        return allowedRecords().filter(row => row.requestStatus === 'pending_manager_check').length;
    }
    function updatePendingBadge() {
        const badge = document.getElementById('admPiecesPendingBadge');
        if (!badge) return 0;
        const count = pendingReviewCount();
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.classList.toggle('hidden', count === 0);
        badge.setAttribute('aria-label', count === 1 ? '1 solicitação de peça aguardando avaliação' : `${count} solicitações de peça aguardando avaliação`);
        return count;
    }
    function statusClass(label) {
        const text = String(label || '').toLowerCase();
        if (/conclu|entreg|emitida|aprovada/.test(text)) return 'success';
        if (/reprov|rejeit|atras|ocorr|bloque/.test(text)) return 'danger';
        if (/aguard|process|trânsito|ajuste/.test(text)) return 'warning';
        return 'neutral';
    }
    function stageBadge(record) {
        const etapa = domain().pipelineStage(record);
        return `<span class="pieces-stage-badge is-${e(etapa.key)}" title="${e(etapa.hint)}">${e(etapa.label)}${etapa.area ? ` · ${e(etapa.area)}` : ''}</span>`;
    }
    function badge(label) { return `<span class="pieces-status ${statusClass(label)}">${e(label)}</span>`; }
    function root() { return document.getElementById(currentContext().mode === 'manager' ? 'admPiecesModule' : 'piecesModuleStandalone'); }

    function initStore() {
        if (!store() || !domain()) return;
        store().pieceOperations = domain().bootstrap(store(), users());
    }

    function tabsFor(mode) {
        if (mode === 'logistics') return [['operation', 'Minha operação'], ...(operatorCan('Faturamento') ? [['invoices', 'Notas fiscais']] : []), ...(operatorCan('Expedição') ? [['shipping', 'Expedição'], ['collections', 'Coletas']] : []), ['transit', 'Em trânsito'], ['occurrences', 'Ocorrências'], ['completed', 'Concluídos']];
        /* Antônio e Jeremias são o Lab E quem embala e posta: validam na entrada,
           preparam, despacham, acompanham e concluem com o cliente. Por isso a tela
           deles é a da gestão inteira, mais a própria fila de validação — recortar
           abas obrigaria a trocar de perfil no meio do próprio trabalho.
           A aba de trabalho continua sendo a primeira ao entrar. */
        if (mode === 'lab') return [['validation', 'Validar e pontuar'], ['overview', 'Visão geral'], ['requests', 'Solicitações'], ['evaluations', 'Avaliações'], ['shipping', 'A embalar'], ['collections', 'Coletas'], ['followup', 'Acompanhamento'], ['transit', 'Em trânsito'], ['occurrences', 'Ocorrências'], ['completed', 'Concluídos'], ['movements', 'Movimentações'], ['indicators', 'Indicadores']];
        if (mode === 'analyst') return [['overview', 'Visão geral'], ['requests', 'Minhas solicitações'], ['movements', 'Movimentações']];
        return [['overview', 'Visão geral'], ['requests', 'Solicitações'], ['evaluations', 'Avaliações'], ['shipping', 'A embalar'], ['transit', 'Em trânsito'], ['occurrences', 'Ocorrências'], ['completed', 'Concluídos'], ['movements', 'Movimentações'], ['indicators', 'Indicadores']];
    }
    function defaultTab(mode) { return mode === 'logistics' ? 'operation' : mode === 'lab' ? 'validation' : 'overview'; }
    function operatorCan(area) {
        const role = currentContext().user?.role;
        // O Lab embala e posta, mas não emite nota: "cada área mexe só no que é dela"
        // continua valendo para a parte fiscal, que é da Logística.
        if (role === LAB_ROLE) return area !== 'Faturamento';
        if (role === 'Envio/Coleta') return area === 'Expedição';
        if (!['Faturamento', 'Expedição', 'Logística/Faturamento'].includes(role)) return true;
        // A Logística emite a nota e lança o rastreio; quem embala e posta é o Lab.
        // Sem este recorte a Sarah continuava com o chamado na fila e via "Embalar peça".
        if (role === 'Logística/Faturamento') return area === 'Faturamento';
        return area === role;
    }
    function canRequestPieces() {
        const context = currentContext();
        if (context.mode === 'logistics' || context.mode === 'lab') return false;
        if (context.mode === 'manager') return !context.teams.length || context.teams.includes('Catraca');
        return context.user?.team === 'Catraca';
    }
    function setTab(tab) { state.tab = tab; renderPiecesModule(); }
    /* Devolver o foco resolve o cursor, mas redesenhar a lista inteira a cada tecla
       ainda engasga a digitação. Campo de texto agenda o redesenho; o resto (selects,
       datas) continua respondendo na hora. */
    const TYPED_FILTERS = ['query'];
    let filterTimer = null;
    function updateFilter(key, value) {
        state.filters[key] = value;
        clearTimeout(filterTimer);
        if (!TYPED_FILTERS.includes(key)) { renderPiecesModule(); return; }
        filterTimer = setTimeout(() => { filterTimer = null; renderPiecesModule(); }, 250);
    }
    function clearFilters() { state.filters = { ...EMPTY_FILTERS }; renderPiecesModule(); }
    function toggleFilters() { state.filtersOpen = !state.filtersOpen; renderPiecesModule(); }
    function activeFilters() { return Object.entries(state.filters).filter(([key, value]) => value && value !== 'all' && value !== EMPTY_FILTERS[key] && key !== 'query'); }
    function appliedFilters() {
        const filters = { ...state.filters };
        filters.from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : '';
        filters.to = filters.to ? new Date(`${filters.to}T23:59:59`).getTime() : '';
        return filters;
    }

    /* Abas como "Validar e pontuar" já filtram por status. Marcar a etapa "No check da
       gestão" dentro delas devolvia lista vazia — o número dizia que havia 1, e a tela
       dizia que não havia nada. Ao escolher uma etapa, vamos para uma aba que lista
       tudo, e o filtro passa a ser a própria etapa. */
    const PIPELINE_LIST_TAB = { manager: 'requests', lab: 'requests', logistics: 'operation', analyst: 'requests' };

    function setPipeline(stage) {
        const desmarcando = state.pipeline === stage;
        state.pipeline = desmarcando ? 'all' : stage;
        if (!desmarcando) {
            const destino = PIPELINE_LIST_TAB[currentContext().mode] || 'requests';
            if (tabsFor(currentContext().mode).some(([id]) => id === destino)) state.tab = destino;
        }
        renderPiecesModule();
    }

    /* Funil do processo, do envio do analista à conclusão com o cliente. Cada etapa
       diz de quem é a bola agora — era isso que faltava para saber o que é o quê. */
    function renderPipeline(rows) {
        const etapas = domain().pipelineSummary(rows);
        const total = rows.length;
        return `<nav class="pieces-pipeline" aria-label="Etapas do processo">${etapas.map((etapa, indice) => `
            <button type="button" class="pieces-pipeline-step ${state.pipeline === etapa.key ? 'is-active' : ''} ${etapa.count ? '' : 'is-empty'}"
                onclick="setPiecesPipeline('${etapa.key}')" title="${e(etapa.hint)}" aria-pressed="${state.pipeline === etapa.key}">
                <span class="pieces-pipeline-order">${indice + 1}</span>
                <span class="pieces-pipeline-text"><strong>${e(etapa.label)}</strong><small>${e(etapa.area || 'Encerrado')}</small></span>
                <b class="num-mono">${etapa.count}</b>
            </button>`).join('')}
            ${state.pipeline === 'all' ? '' : `<button type="button" class="pieces-pipeline-clear" onclick="setPiecesPipeline('${state.pipeline}')"><i class="fi fi-rr-filter-slash"></i>Ver todas (${total})</button>`}
        </nav>`;
    }

    function activeRows() {
        let rows = domain().filter(allowedRecords(), appliedFilters());
        if (state.tab === 'evaluations') rows = rows.filter(row => ['pending_manager_check', 'pending_review', 'correction_requested', 'approved', 'rejected'].includes(row.requestStatus));
        if (state.pipeline !== 'all') rows = rows.filter(row => domain().pipelineStage(row).key === state.pipeline);
        if (state.tab === 'validation') rows = domain().sortQueue(rows.filter(row => row.requestStatus === 'pending_lab_review'));
        if (state.tab === 'followup') rows = domain().sortQueue(rows.filter(row => row.requestStatus === 'approved' && domain().nextAction(row).area === LAB_ROLE));
        if (state.tab === 'operation') rows = domain().sortQueue(rows.filter(row => row.requestStatus === 'approved' && domain().operationalStatus(row) !== 'Concluído' && (currentContext().mode !== 'logistics' || (operatorCan('Faturamento') && domain().nextAction(row).area === 'Logística/Faturamento') || (operatorCan('Expedição') && domain().nextAction(row).area === 'Envio/Coleta'))));
        if (state.tab === 'invoices') rows = rows.filter(row => row.requestStatus === 'approved' && row.fiscal?.required !== false);
        if (state.tab === 'shipping') rows = rows.filter(row => row.requestStatus === 'approved' && row.movements?.some(item => item.kind !== 'Coleta' && item.status !== 'completed'));
        if (state.tab === 'collections') rows = rows.filter(row => row.requestStatus === 'approved' && row.movements?.some(item => item.kind === 'Coleta' && item.status !== 'completed'));
        if (state.tab === 'transit') rows = rows.filter(row => row.movements?.some(item => ['in_transit', 'returning', 'out_for_delivery'].includes(item.status)));
        if (state.tab === 'occurrences') rows = rows.filter(row => row.occurrences?.some(item => item.status === 'active'));
        if (state.tab === 'completed') rows = rows.filter(row => domain().operationalStatus(row) === 'Concluído');
        return rows;
    }

    function skeleton() {
        const block = (count, className) => Array.from({ length: count }, () => `<div class="actuar-skeleton ${className}"></div>`).join('');
        return `<section class="pieces-heading"><div style="width:100%"><div class="actuar-skeleton actuar-skeleton-title"></div><div class="actuar-skeleton actuar-skeleton-text" style="width:60%"></div></div></section>
            <div class="actuar-skeleton actuar-skeleton-row"></div>
            <div class="pieces-kpi-grid">${block(6, 'actuar-skeleton-block')}</div>
            <div class="pieces-operation-list">${block(4, 'actuar-skeleton-row')}</div>`;
    }

    function renderPiecesModule() {
        const mount = root(); if (!mount || !domain()) return;
        clearTimeout(filterTimer); filterTimer = null;
        if (!store()) { mount.innerHTML = skeleton(); return; }
        initStore();
        updatePendingBadge();
        const context = currentContext(); const tabs = tabsFor(context.mode); if (!tabs.some(([id]) => id === state.tab)) state.tab = defaultTab(context.mode);
        const summary = domain().summarize(allowedRecords());
        const isShippingOperator = context.mode === 'logistics' && context.user?.role === 'Envio/Coleta';
        // "Envio e coleta" era o nome da tela do Lab E o nome de outro papel: dava para
        // olhar o cabeçalho e não saber em qual dos dois perfis se estava.
        const title = context.mode === 'logistics' ? (isShippingOperator ? 'Preparação e acompanhamento' : 'Operação de peças') : context.mode === 'lab' ? 'Validação técnica e acompanhamento' : 'Envio e coleta';
        const description = context.mode === 'logistics' ? (isShippingOperator ? 'Receba peças liberadas, prepare a embalagem, acompanhe a entrega e conclua o chamado.' : 'Emita a nota fiscal, gere a etiqueta e o rastreio e encaminhe a peça para Envio/Coleta.') : context.mode === 'lab' ? 'Valide e pontue o que chega dos analistas, acompanhe a entrega e conclua com o cliente.' : 'Acompanhe solicitações de peças, avaliações e movimentações logísticas da equipe.';
        // Redesenhar o módulo troca os elementos: o campo em foco é destruído e o
        // cursor se perde. Por isso a posição é guardada antes e devolvida depois —
        // era o que fazia a busca parar a cada letra digitada.
        const focado = document.activeElement;
        const focoId = focado && mount.contains(focado) ? focado.id : null;
        const selecao = focoId && typeof focado.selectionStart === 'number' ? [focado.selectionStart, focado.selectionEnd] : null;

        mount.innerHTML = `
            <section class="pieces-heading"><div><span class="rotation-eyebrow">Performance do Atendimento</span><h2>${title}</h2><p>${description}</p>${context.user ? `<span class="pieces-identity" title="A tela que você vê depende deste papel. Para mudar: Modo Gestão → Pessoas e Acessos → Editar.">${avatar(context.user, 'is-small')}<b>${e(context.user.name)}</b><i>${e(context.user.role || 'Sem papel definido')}</i></span>` : ''}</div><div class="pieces-heading-actions">${canRequestPieces() ? `<button class="actuar-btn actuar-btn-primary" onclick="openPiecesRequestModal()"><i class="fi fi-rr-add-document"></i>Nova solicitação</button>` : `<button class="actuar-btn actuar-btn-secondary" onclick="renderPiecesModule()"><i class="fi fi-rr-refresh"></i>Atualizar</button>`}</div></section>
            <nav class="pieces-tabs" aria-label="Seções de Envio e Coleta">${tabs.map(([id, label]) => `<button class="${state.tab === id ? 'is-active' : ''}" onclick="setPiecesTab('${id}')" aria-current="${state.tab === id ? 'page' : 'false'}">${label}${tabCount(id, summary)}</button>`).join('')}</nav>
            ${['lab', 'manager'].includes(context.mode) ? renderPipeline(allowedRecords()) : ''}
            ${renderFilters(context)}
            <div class="pieces-content">${renderTab(context, summary)}</div>`;

        if (focoId) {
            const devolvido = document.getElementById(focoId);
            if (devolvido) {
                devolvido.focus({ preventScroll: true });
                if (selecao) { try { devolvido.setSelectionRange(selecao[0], selecao[1]); } catch (_) { /* campos sem seleção */ } }
            }
        }
    }

    function tabCount(tab, summary) {
        const value = ({ evaluations: summary.awaitingApproval, operation: summary.awaitingInvoice + summary.awaitingLogistics, invoices: summary.awaitingInvoice, occurrences: summary.occurrences, shipping: summary.readyToShip, transit: summary.inTransit })[tab];
        return value ? `<span>${value}</span>` : '';
    }
    function renderFilters(context) {
        const analysts = Object.entries(users()).filter(([, user]) => user.active !== false && user.role !== 'Gestor Adm' && !['Envio/Coleta', 'Faturamento', 'Expedição', 'Logística/Faturamento', LAB_ROLE].includes(user.role) && (!context.teams.length || context.teams.includes(user.team)));
        const filtersVisible = !['overview', 'indicators'].includes(state.tab);
        if (!filtersVisible) return '';
        const statusOptions = `<option value="all">Todos</option>${Object.entries(domain().REQUEST_STATUSES).map(([key, label]) => `<option value="${e(key)}" ${state.filters.requestStatus === key ? 'selected' : ''}>${e(label)}</option>`).join('')}`;
        const rows = allowedRecords();
        const unique = getter => [...new Set(rows.flatMap(getter).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'));
        const carriers = unique(row => (row.movements || []).map(item => item.carrier));
        const modalities = unique(row => (row.movements || []).map(item => item.modality));
        const categories = unique(row => (row.products || []).map(item => item.category));
        const states = unique(row => [row.client?.state]);
        const stages = ['Analista', 'Gestão', 'Logística/Faturamento', 'Envio/Coleta'];
        const slaOptions = `<option value="all">Todos</option>${Object.entries(domain().SLA_STATES).filter(([key]) => key !== 'no_target').map(([key, label]) => `<option value="${e(key)}" ${state.filters.sla === key ? 'selected' : ''}>${e(label)}</option>`).join('')}`;
        const select = (key, label, list, allLabel) => `<div class="actuar-field"><label for="pf_${key}">${e(label)}</label><select id="pf_${key}" onchange="updatePiecesFilter('${key}',this.value)">${options(list, state.filters[key], allLabel)}</select></div>`;
        const ternary = (key, label, yes, no) => `<div class="actuar-field"><label for="pf_${key}">${e(label)}</label><select id="pf_${key}" onchange="updatePiecesFilter('${key}',this.value)"><option value="all">Todos</option><option value="yes" ${state.filters[key] === 'yes' ? 'selected' : ''}>${e(yes)}</option><option value="no" ${state.filters[key] === 'no' ? 'selected' : ''}>${e(no)}</option></select></div>`;
        const applied = activeFilters();
        const labels = { movement: 'Movimento', reason: 'Motivo', requestStatus: 'Status', priority: 'Prioridade', stage: 'Etapa', occurrence: 'Ocorrência', analystId: 'Analista', brand: 'Marca', carrier: 'Transportadora', modality: 'Modalidade', category: 'Categoria', state: 'UF', sla: 'SLA', invoice: 'NF emitida', tracking: 'Rastreio', from: 'De', to: 'Até' };
        const chipValue = (key, value) => key === 'analystId' ? (users()[value]?.name || value) : key === 'requestStatus' ? (domain().REQUEST_STATUSES[value] || value) : key === 'sla' ? (domain().SLA_STATES[value] || value) : ['occurrence', 'invoice', 'tracking'].includes(key) ? (value === 'yes' ? 'Sim' : 'Não') : value;
        const advancedCount = applied.filter(([key]) => ADVANCED_KEYS.includes(key)).length;
        return `<section class="pieces-filters">
            <div class="pieces-filter-grid">
                <div class="actuar-field pieces-search"><label for="piecesSearch">Buscar</label><div class="pieces-search-control"><i class="fi fi-rr-search"></i><input id="piecesSearch" value="${e(state.filters.query)}" oninput="updatePiecesFilter('query',this.value)" placeholder="Protocolo, chamado, cliente, NF ou rastreio"></div></div>
                ${select('movement', 'Movimento', domain().MOVEMENTS, 'Todos')}
                <div class="actuar-field"><label for="pf_requestStatus">Status</label><select id="pf_requestStatus" onchange="updatePiecesFilter('requestStatus',this.value)">${statusOptions}</select></div>
                ${select('priority', 'Prioridade', domain().PRIORITIES, 'Todas')}
                ${context.mode !== 'analyst' ? `<div class="actuar-field"><label for="pf_analystId">Analista</label><select id="pf_analystId" onchange="updatePiecesFilter('analystId',this.value)"><option value="all">Todos</option>${analysts.map(([id, user]) => `<option value="${e(id)}" ${state.filters.analystId === id ? 'selected' : ''}>${e(user.name)}</option>`).join('')}</select></div>` : ''}
                <button type="button" class="actuar-btn actuar-btn-secondary actuar-btn-sm pieces-filter-toggle" aria-expanded="${state.filtersOpen}" aria-controls="piecesAdvancedFilters" onclick="togglePiecesFilters()"><i class="fi fi-rr-filter"></i>Mais filtros${advancedCount ? `<span class="pieces-filter-count">${advancedCount}</span>` : ''}</button>
            </div>
            <div id="piecesAdvancedFilters" class="pieces-filter-advanced ${state.filtersOpen ? '' : 'hidden'}">
                ${select('reason', 'Motivo', domain().REASONS, 'Todos')}
                ${select('brand', 'Marca', domain().BRANDS, 'Todas')}
                ${select('stage', 'Etapa atual', stages, 'Todas')}
                <div class="actuar-field"><label for="pf_sla">SLA</label><select id="pf_sla" onchange="updatePiecesFilter('sla',this.value)">${slaOptions}</select></div>
                ${carriers.length ? select('carrier', 'Transportadora', carriers, 'Todas') : ''}
                ${modalities.length ? select('modality', 'Modalidade', modalities, 'Todas') : ''}
                ${categories.length ? select('category', 'Categoria do produto', categories, 'Todas') : ''}
                ${states.length ? select('state', 'UF', states, 'Todas') : ''}
                ${ternary('invoice', 'Nota fiscal', 'Emitida', 'Sem NF emitida')}
                ${ternary('tracking', 'Rastreio', 'Com rastreio', 'Sem rastreio')}
                ${ternary('occurrence', 'Ocorrência', 'Com ocorrência ativa', 'Sem ocorrência')}
                <div class="actuar-field"><label for="pf_from">Criadas de</label><input id="pf_from" type="date" value="${e(state.filters.from)}" onchange="updatePiecesFilter('from',this.value)"></div>
                <div class="actuar-field"><label for="pf_to">Criadas até</label><input id="pf_to" type="date" value="${e(state.filters.to)}" onchange="updatePiecesFilter('to',this.value)"></div>
            </div>
            ${applied.length ? `<div class="pieces-applied-filters"><span>Filtros aplicados</span>${applied.map(([key, value]) => `<button type="button" onclick="updatePiecesFilter('${key}','${e(EMPTY_FILTERS[key])}')"><b>${e(labels[key] || key)}:</b> ${e(chipValue(key, value))}<i class="fi fi-rr-cross-small" aria-hidden="true"></i><span class="sr-only">Remover filtro</span></button>`).join('')}<button type="button" class="actuar-btn actuar-btn-ghost actuar-btn-sm" onclick="clearPiecesFilters()"><i class="fi fi-rr-filter-slash"></i>Limpar tudo</button></div>` : ''}
        </section>`;
    }

    function slaChip(record) {
        const info = domain().sla(record);
        if (!info || ['completed', 'no_target'].includes(info.state)) return '';
        const tone = info.state === 'late' ? 'danger' : info.state === 'due_soon' ? 'warning' : 'success';
        return `<span class="pieces-sla ${tone}" title="${e(info.basis === 'promised' ? 'Prazo prometido ao cliente' : 'Prazo pela prioridade aprovada')}"><i class="fi fi-rr-clock" aria-hidden="true"></i>${e(info.state === 'late' ? `Atrasado há ${duration(-info.remainingMs)}` : `Vence em ${duration(info.remainingMs)}`)}</span>`;
    }
    function duration(ms) {
        const value = Math.max(0, Number(ms) || 0);
        const minutes = Math.floor(value / 60000); if (minutes < 60) return `${minutes} min`;
        const hours = Math.floor(minutes / 60); if (hours < 48) return `${hours} h`;
        return `${Math.floor(hours / 24)} d`;
    }
    function durationLabel(ms) { return Number.isFinite(ms) && ms != null ? duration(ms) : '—'; }
    function percent(value) { return value == null ? '—' : `${Math.round(value * 100)}%`; }

    function renderTab(context, summary) {
        if (state.tab === 'overview') return renderOverview(context, summary);
        if (state.tab === 'indicators') return renderIndicators(summary);
        if (state.tab === 'operation') return renderOperation(activeRows(), summary);
        return renderRecords(activeRows(), context);
    }
    function metric(label, value, detail, filterTab) { return `<button class="pieces-kpi" ${filterTab ? `onclick="setPiecesTab('${filterTab}')"` : ''}><span>${e(label)}</span><strong>${e(value)}</strong><small>${e(detail || '')}</small></button>`; }
    function renderOverview(context, summary) {
        const pending = domain().sortQueue(allowedRecords().filter(row => context.mode === 'manager' ? row.requestStatus === 'pending_manager_check' : row.requestStatus === 'pending_lab_review')).slice(0, 5);
        const recent = allowedRecords().slice().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 6);
        return `<div class="pieces-kpi-grid">${metric('Aguardando aprovação', summary.awaitingApproval, 'Solicitações para revisar', 'evaluations')}${metric('Precisam de ajuste', summary.corrections, 'Aguardam correção', 'requests')}${metric('Aprovadas para processamento', summary.approved, 'Encaminhadas automaticamente', 'movements')}${metric('Aguardando NF', summary.awaitingInvoice, 'Pendências fiscais', context.mode === 'logistics' ? 'invoices' : 'movements')}${metric('Em trânsito', summary.inTransit, 'Movimentações ativas', 'movements')}${metric('Com ocorrência', summary.occurrences, 'Exigem ação', 'movements')}</div><div class="pieces-overview-grid"><section class="actuar-card"><div class="actuar-card-header"><div><h3 class="actuar-card-title">Pendências prioritárias</h3><p class="actuar-card-description">Registros que exigem ação do seu perfil.</p></div></div>${pending.length ? pending.map(renderCompactRecord).join('') : emptyState('Sua operação está em dia', 'Não existem solicitações aguardando sua ação neste momento.')}</section><section class="actuar-card"><div class="actuar-card-header"><div><h3 class="actuar-card-title">Operação em andamento</h3><p class="actuar-card-description">Distribuição das solicitações por etapa.</p></div></div><div class="pieces-stage-list"><div><span>Validação</span><strong>${summary.awaitingApproval}</strong></div><div><span>Faturamento</span><strong>${summary.awaitingInvoice}</strong></div><div><span>Expedição ou coleta</span><strong>${summary.awaitingLogistics}</strong></div><div><span>Em trânsito</span><strong>${summary.inTransit}</strong></div><div><span>Conclusão</span><strong>${summary.completed}</strong></div></div></section></div><section class="actuar-card"><div class="actuar-card-header"><div><h3 class="actuar-card-title">Atividade recente</h3><p class="actuar-card-description">Handoffs e atualizações operacionais mais recentes.</p></div></div>${recent.length ? `<div class="pieces-activity">${recent.flatMap(row => (row.events || []).slice(-1).map(item => `<button onclick="openPiecesDetail('${row.id}')"><i class="fi fi-rr-time-check"></i><span><strong>${e(item.text)}</strong><small>${e(row.protocol || row.sourceTicket)} · ${fmtDate(item.timestamp, true)}</small></span></button>`)).join('')}</div>` : emptyState('Nenhuma atividade no período', 'As movimentações aparecerão aqui conforme a equipe avançar o processo.')}</section>`;
    }
    function renderCompactRecord(row) { const user = users()[row.analystId]; return `<button class="pieces-compact-row" onclick="openPiecesDetail('${row.id}')">${avatar(user)}<span><strong>${e(row.protocol || row.sourceTicket)}</strong><small>${e(row.client?.id)} · ${e(row.client?.name)}</small></span>${badge(domain().operationalStatus(row))}<i class="fi fi-rr-angle-small-right"></i></button>`; }

    function renderOperation(rows, summary) {
        const board = `<div class="pieces-kpi-grid">${metric('Aguardando NF', summary.awaitingInvoice, 'Pendências fiscais', 'invoices')}${metric('Prontos para expedição', summary.readyToShip, 'Separação e postagem', 'shipping')}${metric('Coletas pendentes', summary.pendingCollections, 'Agendar ou confirmar', 'collections')}${metric('Em trânsito', summary.inTransit, 'Acompanhamento ativo', 'transit')}${metric('Atrasados', summary.late, 'Fora do prazo acordado')}${metric('Com ocorrência', summary.occurrences, 'Exigem tratativa', 'occurrences')}</div>`;
        if (!rows.length) return `${board}${emptyState('Sua operação está em dia', 'Não existem solicitações aguardando sua ação neste momento.')}`;
        const cards = rows.map(row => {
            const user = users()[row.analystId]; const action = domain().nextAction(row); const info = domain().sla(row);
            const owner = row.assignments?.find(task => task.status === 'processing');
            return `<article class="pieces-operation-card priority-${e((row.approvedPriority || 'Normal').toLowerCase())} ${info.state === 'late' ? 'is-late' : ''}">
                <div class="pieces-operation-top"><span class="pieces-priority">${e(row.approvedPriority || row.requestedPriority)}</span>${slaChip(row)}<span>Aguardando há ${duration(info.elapsedMs)}</span></div>
                <div class="pieces-operation-main">
                    <div><h3>${e(row.movement)} em ${e(row.reason.toLowerCase())} — ${e(row.products?.[0]?.name || 'Produto')}</h3>
                    <p>${e(row.client?.brand || '')} · ${e(row.client?.id)} · ${e(row.client?.name)} · ${e([row.client?.city, row.client?.state].filter(Boolean).join('/'))}</p>
                    <div class="pieces-operation-meta"><span>${avatar(user, 'sm')} ${e(user?.name || 'Analista')}</span><span>${row.products?.reduce((sum, item) => sum + Number(item.quantity || 0), 0) || 0} un.</span><span>${e(domain().FISCAL_STATUSES[row.fiscal?.status] || 'NF a definir')}</span><span>${badge(domain().operationalStatus(row))}</span></div>
                    ${owner ? `<p class="pieces-operation-owner"><i class="fi fi-rr-user" aria-hidden="true"></i>Em processamento por ${e(users()[owner.assigneeId]?.name || 'operador')} desde ${fmtDate(owner.startedAt, true)}</p>` : ''}</div>
                    <div class="pieces-next-action"><small>Próxima ação</small><strong>${e(action.label)}</strong><button class="actuar-btn actuar-btn-primary actuar-btn-sm" onclick="openPiecesDetail('${row.id}')">Processar</button></div>
                </div></article>`;
        }).join('');
        return `${board}<section class="pieces-operation-list"><div class="pieces-section-heading"><div><h3>Para processar</h3><p>Ordenado por prioridade, prazo de SLA e tempo de espera.</p></div></div>${cards}</section>`;
    }

    function renderRecords(rows, context) {
        if (!rows.length) return emptyState('Nenhuma movimentação encontrada', 'Remova alguns filtros ou consulte outro período.', true);
        return `<section class="actuar-card pieces-records-card"><div class="pieces-table-wrap"><table class="pieces-table"><thead><tr><th>Protocolo</th><th>Movimento</th><th>Marca e cliente</th><th>Produto principal</th><th>Analista</th><th>NF</th><th>Status</th><th>Prazo</th><th>Próxima ação</th><th></th></tr></thead><tbody>${rows.map(row => { const user = users()[row.analystId]; return `<tr><td><strong>${e(row.protocol || row.sourceTicket)}</strong><small>${fmtDate(row.createdAt)}</small></td><td>${e(row.movement)}<small>${e(row.reason)}</small></td><td>${e(row.client?.brand || '—')}<small>${e(row.client?.id)} · ${e(row.client?.name)}</small></td><td>${e(row.products?.[0]?.name || '—')}<small>${row.products?.length || 0} item(ns)</small></td><td><span class="pieces-person">${avatar(user, 'sm')} ${e(user?.name || '—')}</span></td><td>${e(domain().FISCAL_STATUSES[row.fiscal?.status] || '—')}</td><td>${badge(domain().operationalStatus(row))}</td><td>${slaChip(row) || '<span class="pieces-muted">—</span>'}</td><td>${e(domain().nextAction(row).label)}</td><td><button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="openPiecesDetail('${row.id}')">Ver ficha</button></td></tr>`; }).join('')}</tbody></table></div><div class="pieces-mobile-list">${rows.map(row => `<article onclick="openPiecesDetail('${row.id}')"><header><strong>${e(row.protocol || row.sourceTicket)}</strong>${badge(domain().operationalStatus(row))}</header><h3>${e(row.movement)} · ${e(row.reason)}</h3><p>${e(row.client?.id)} · ${e(row.client?.name)}</p><footer><span>${e(row.products?.[0]?.name || 'Produto')}</span>${slaChip(row)}<i class="fi fi-rr-angle-small-right"></i></footer></article>`).join('')}</div></section>`;
    }

    function renderIndicators(summary) {
        const rows = allowedRecords();
        const operation = domain().operationMetrics(rows);
        const quality = domain().qualityMetrics(rows);
        const freight = domain().freightMetrics(rows);
        const warranty = domain().warrantyMetrics(rows, warrantyBaseline());
        const rank = (source, valueOf = entry => entry[1]) => Object.entries(source).map(entry => [entry[0], valueOf(entry)]).filter(item => item[1]).sort((a, b) => b[1] - a[1]).slice(0, 6);
        const count = getter => rows.reduce((acc, row) => { const value = getter(row) || 'Não informado'; acc[value] = (acc[value] || 0) + 1; return acc; }, {});
        const chart = (title, data, format = value => value) => `<section class="actuar-card pieces-breakdown"><h3>${e(title)}</h3>${data.length ? data.map(([label, value]) => `<div><span>${e(label)}</span><strong>${e(format(value))}</strong><i style="--piece-bar:${Math.max(8, value / Math.max(...data.map(item => item[1])) * 100)}%"></i></div>`).join('') : `<p>Sem dados suficientes no período e nos filtros atuais.</p>`}</section>`;
        const units = rows.reduce((sum, row) => sum + (row.products || []).reduce((n, item) => n + Number(item.quantity || 0), 0), 0);

        const warrantyRows = Object.values(warranty.byProduct).sort((a, b) => b.quantity - a.quantity).slice(0, 8);
        const warrantyBlock = warrantyRows.length
            ? `<div class="pieces-table-wrap"><table class="pieces-table"><thead><tr><th>Produto</th><th>Itens em garantia</th><th>Base vendida/instalada</th><th>Taxa de garantia</th><th>Reincidências</th><th>Defeito mais citado</th></tr></thead><tbody>${warrantyRows.map(item => `<tr><td><strong>${e(item.name)}</strong><small>${e(item.code || 'Sem código')}</small></td><td>${item.quantity}</td><td>${item.baseline || '<span class="pieces-muted">Base não cadastrada</span>'}</td><td>${item.rate == null ? '<span class="pieces-muted">Indisponível</span>' : `<strong>${percent(item.rate)}</strong>`}</td><td>${item.recurrences}</td><td>${e(rank(item.defects)[0]?.[0] || '—')}</td></tr>`).join('')}</tbody></table></div>`
            : emptyState('Nenhuma garantia no recorte atual', 'Ajuste os filtros ou selecione outro período para analisar garantias.');

        const analystRows = Object.entries(quality.byAnalyst).sort((a, b) => b[1].total - a[1].total).slice(0, 8);

        return `<div class="pieces-kpi-grid">${metric('Solicitações', summary.total, 'Volume total')}${metric('Produtos movimentados', units, 'Unidades')}${metric('Pontos validados', summary.points, 'Após aprovação')}${metric('Gasto com frete', money(freight.total), 'Valor real registrado')}${metric('Dentro do SLA', percent(operation.onTimeRate), `${operation.late} atrasada(s)`)}${metric('Concluídas', summary.completed, 'Operações finalizadas')}</div>
            <div class="pieces-indicator-grid is-triple">
                ${chart('Movimentos', rank(count(row => row.movement)))}
                ${chart('Motivos', rank(count(row => row.reason)))}
                ${chart('Categorias movimentadas', rank(count(row => row.products?.[0]?.category)))}
            </div>
            <section class="actuar-card"><div class="actuar-card-header"><div><h3 class="actuar-card-title">Garantia por produto</h3><p class="actuar-card-description">A taxa só é calculada quando existe base real de itens vendidos ou instalados. Volume absoluto não é taxa de defeito.</p></div></div>${warrantyBlock}</section>
            <div class="pieces-indicator-grid is-triple">
                ${chart('Custo de frete por transportadora', rank(freight.byCarrier, entry => entry[1].total), money)}
                ${chart('Custo de frete por modalidade', rank(freight.byModality, entry => entry[1].total), money)}
                ${chart('Custo de frete por UF', rank(freight.byState, entry => entry[1].total), money)}
            </div>
            <div class="pieces-indicator-grid is-triple">
                <section class="actuar-card pieces-metric-list"><h3>Tempo médio por etapa</h3>
                    <div><span>Abertura → aprovação</span><strong>${e(durationLabel(operation.submitToApproval))}</strong></div>
                    <div><span>Aprovação → NF</span><strong>${e(durationLabel(operation.approvalToInvoice))}</strong></div>
                    <div><span>NF → postagem</span><strong>${e(durationLabel(operation.invoiceToDispatch))}</strong></div>
                    <div><span>Postagem → entrega</span><strong>${e(durationLabel(operation.dispatchToDelivery))}</strong></div>
                </section>
                <section class="actuar-card pieces-metric-list"><h3>Saúde da operação</h3>
                    <div><span>Em aberto</span><strong>${operation.open}</strong></div>
                    <div><span>Vencendo em breve</span><strong>${operation.dueSoon}</strong></div>
                    <div><span>Atrasadas</span><strong>${operation.late}</strong></div>
                    <div><span>Bloqueios fiscais</span><strong>${operation.blocked}</strong></div>
                    <div><span>Coletas sem sucesso</span><strong>${operation.failedCollections}</strong></div>
                </section>
                <section class="actuar-card pieces-metric-list"><h3>Qualidade do registro</h3>
                    <div><span>Completas na primeira tentativa</span><strong>${e(percent(quality.firstTryRate))}</strong></div>
                    <div><span>Devolvidas para ajuste</span><strong>${quality.returned} (${e(percent(quality.returnRate))})</strong></div>
                    <div><span>Reprovadas</span><strong>${quality.rejected}</strong></div>
                    <div><span>Tempo médio de correção</span><strong>${e(durationLabel(quality.correctionTime))}</strong></div>
                    <div><span>Pontos validados</span><strong>${quality.validatedPoints}</strong></div>
                </section>
            </div>
            <section class="actuar-card"><div class="actuar-card-header"><div><h3 class="actuar-card-title">Desempenho por analista</h3><p class="actuar-card-description">Aprovação, devoluções e pontos validados no recorte atual.</p></div></div>${analystRows.length ? `<div class="pieces-table-wrap"><table class="pieces-table"><thead><tr><th>Analista</th><th>Solicitações</th><th>Aprovadas</th><th>Devolvidas</th><th>Aproveitamento</th><th>Pontos</th></tr></thead><tbody>${analystRows.map(([key, entry]) => `<tr><td><span class="pieces-person">${avatar(users()[key], 'sm')} ${e(users()[key]?.name || 'Não identificado')}</span></td><td>${entry.total}</td><td>${entry.approved}</td><td>${entry.returned}</td><td>${e(percent(entry.total ? entry.approved / entry.total : null))}</td><td>${entry.points}</td></tr>`).join('')}</tbody></table></div>` : emptyState('Sem dados de analistas', 'Nenhuma solicitação corresponde aos filtros atuais.', true)}</section>
            ${quality.returned ? `<section class="actuar-card pieces-metric-list"><h3>Principais motivos de devolução</h3>${rank(quality.returnReasons).map(([label, value]) => `<div><span>${e(label)}</span><strong>${value}</strong></div>`).join('')}</section>` : ''}
            ${warranty.hasBaseline ? '' : `<section class="actuar-card pieces-insight-note"><i class="fi fi-rr-info"></i><p>Cadastre a base de itens vendidos ou instalados por produto para que a taxa de garantia seja calculada. Sem essa base, apenas o volume absoluto é exibido.</p></section>`}`;
    }
    function warrantyBaseline() { const base = store()?.warrantyBaseline; return base && typeof base === 'object' ? base : {}; }
    function emptyState(title, text, clear) { return `<div class="pieces-empty"><i class="fi fi-rr-box-open"></i><h3>${e(title)}</h3><p>${e(text)}</p>${clear ? `<button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="clearPiecesFilters()">Limpar filtros</button>` : ''}</div>`; }

    // A ficha e os overlays secundários nunca ficam empilhados: a ficha recua e volta ao fechar o overlay.
    function suspendDetail() {
        const layer = document.getElementById('piecesDetailDrawer');
        if (!layer || layer.classList.contains('hidden')) return false;
        layer.classList.add('hidden');
        return true;
    }
    function resumeDetail() {
        if (!state.detailSuspended) return;
        state.detailSuspended = false;
        if (!state.selectedId || !records().some(item => item.id === state.selectedId)) return;
        document.getElementById('piecesDetailDrawer')?.classList.remove('hidden');
        renderDetail();
        requestAnimationFrame(() => document.querySelector('#piecesDetailDrawer .pieces-detail-drawer')?.focus());
    }

    function openRequest(recordId) {
        const context = currentContext(); const record = recordId ? records().find(item => item.id === recordId) : null;
        if (!record && !canRequestPieces()) return showToast('Solicitações de peça são uma rotina da equipe de Catraca.', 'error');
        state.detailSuspended = suspendDetail();
        state.wizardStep = 0; state.wizardVisited = [0]; state.wizardChecked = false; state.wizardProducts = record?.products ? JSON.parse(JSON.stringify(record.products)) : [];
        state.wizardDraft = record ? JSON.parse(JSON.stringify(record)) : domain().createDraft({ analystId: context.mode === 'analyst' ? context.actorId : '', department: context.mode === 'analyst' ? context.user?.team : 'Catraca', movement: 'Envio', reason: 'Garantia', requestedPriority: 'Normal', client: { brand: 'Actuar' } }, context.actorId || 'manager');
        document.getElementById('piecesRequestModal')?.classList.remove('hidden'); renderWizard(); window.syncPriorityRotationOverlayScroll?.(); requestAnimationFrame(() => document.querySelector('#piecesRequestModal input, #piecesRequestModal select')?.focus());
    }
    function closeRequest() { document.getElementById('piecesRequestModal')?.classList.add('hidden'); state.wizardDraft = null; resumeDetail(); window.syncPriorityRotationOverlayScroll?.(); }
    function wizardField(id, label, value = '', type = 'text', attrs = '') { return `<div class="actuar-field"><label for="${id}">${e(label)}</label><input id="${id}" type="${type}" value="${e(value)}" ${attrs}></div>`; }
    function selectField(id, label, list, selected, attrs = '') { return `<div class="actuar-field"><label for="${id}">${e(label)}</label><select id="${id}" ${attrs}>${options(list, selected)}</select></div>`; }
    // Cada regra do domínio aponta para o campo que a viola, para o erro nascer colado no input.
    const FIELD_INPUTS = {
        'sourceTicket': 'pwTicket', 'targetManagerId': 'pwManager', 'movement': 'pwMovement', 'reason': 'pwReason',
        'priorityReason': 'pwPriorityReason', 'client.id': 'pwClientId', 'client.name': 'pwClientName',
        'client.brand': 'pwBrand', 'client.personType': 'pwPersonType', 'client.document': 'pwDocument',
        'client.state': 'pwState', 'client.phone': 'pwPhone', 'client.email': 'pwEmail',
        'description': 'pwDescription', 'conditional.defect': 'pwDefect', 'conditional.diagnosis': 'pwWarrantyDiagnosis',
        'conditional.saleOrder': 'pwSaleOrder', 'conditional.serviceOrder': 'pwServiceOrder'
    };
    function paintPendingErrors(pending) {
        const body = document.getElementById('piecesWizardBody'); if (!body || !window.ActuarFields) return null;
        body.querySelectorAll('[aria-invalid]').forEach(input => window.ActuarFields.clearError(input));
        let first = null;
        pending.forEach(item => {
            const input = FIELD_INPUTS[item.field] && document.getElementById(FIELD_INPUTS[item.field]);
            if (!input || !body.contains(input)) return;
            window.ActuarFields.showError(input, item.message);
            if (!first) first = input;
        });
        return first;
    }
    function wizardPending() {
        if (!state.wizardDraft) return [];
        return domain().pendingRequirements({ ...state.wizardDraft, products: state.wizardProducts });
    }
    function pendingOfStep(pending, index) { return index === STEPS.length - 1 ? pending : pending.filter(item => STEP_KEYS.indexOf(item.step) === index); }
    function stepChip(label, index, pending) {
        const missing = pendingOfStep(pending, index).length;
        const seen = state.wizardChecked || state.wizardVisited.includes(index);
        const classes = ['pieces-wizard-step', index === state.wizardStep ? 'is-active' : '', seen && missing ? 'is-pending' : '', seen && !missing ? 'is-complete' : ''].filter(Boolean).join(' ');
        const hint = missing ? `${missing} campo(s) obrigatório(s) pendente(s)` : 'Etapa completa';
        return `<button type="button" class="${classes}" onclick="goToPiecesWizardStep(${index})" ${index === state.wizardStep ? 'aria-current="step"' : ''} title="${e(`${label} · ${hint}`)}"><b>${index + 1}</b>${e(label)}${seen && missing ? '<i class="fi fi-rr-triangle-warning" aria-hidden="true"></i>' : ''}</button>`;
    }
    // O Lab abre o mesmo wizard para corrigir dados de uma solicitação que já está na
    // fila dele. Chamar isso de "enviar para avaliação" descreve o fluxo do analista,
    // não o dele: ele não está enviando nada, está acertando o que vai avaliar.
    function wizardIsLabCorrection() {
        if (currentContext().mode !== 'lab' || !state.wizardDraft?.id) return false;
        return records().some(item => item.id === state.wizardDraft.id && item.requestStatus === 'pending_lab_review');
    }
    function wizardCopy() {
        return wizardIsLabCorrection()
            ? { title: 'Corrigir dados da solicitação', submit: 'Salvar correções', verbo: 'salvar', pronta: 'pronta para salvar', review: 'Confira o que foi corrigido. Salvar não valida nem pontua — isso é feito em "Validar e pontuar".' }
            : { title: 'Nova solicitação', submit: 'Enviar para validação', verbo: 'enviar', pronta: 'pronta para envio', review: 'Confira os dados antes de enviar. A criação não concede pontos.' };
    }

    function renderWizard() {
        const draft = state.wizardDraft; if (!draft) return;
        const copy = wizardCopy();
        const titulo = document.getElementById('piecesRequestTitle');
        if (titulo) titulo.textContent = copy.title;
        const enviar = document.getElementById('piecesWizardSubmit');
        if (enviar) enviar.textContent = copy.submit;
        const pending = wizardPending();
        const subtitle = document.getElementById('piecesRequestSubtitle');
        if (subtitle) subtitle.textContent = `Etapa ${state.wizardStep + 1} de ${STEPS.length} · ${STEPS[state.wizardStep]}${pending.length ? ` · ${pending.length} pendência(s) para ${copy.verbo}` : ` · ${copy.pronta}`}`;
        document.getElementById('piecesWizardSteps').innerHTML = STEPS.map((label, index) => stepChip(label, index, pending)).join('');
        const body = document.getElementById('piecesWizardBody');
        if (state.wizardStep === 0) {
            const managerOptions = Object.entries(users()).filter(([, user]) => user.role === 'Gestor Adm' && user.active !== false).map(([id, user]) => `<option value="${e(id)}" ${draft.targetManagerId === id ? 'selected' : ''}>${e(user.name)}${user.team ? ` · ${e(user.team)}` : ''}</option>`).join('');
            const analystOptions = Object.entries(users()).filter(([, user]) => user.role !== 'Gestor Adm' && !['Envio/Coleta', 'Faturamento', 'Expedição', 'Logística/Faturamento', LAB_ROLE].includes(user.role) && user.active !== false).map(([id, user]) => `<option value="${e(id)}" ${draft.analystId === id ? 'selected' : ''}>${e(user.name)} · ${e(user.team)}</option>`).join('');
            body.innerHTML = `<section class="pieces-wizard-section"><h3>Origem e tipo</h3><p>Movimento informa o que acontecerá fisicamente; motivo explica por que acontecerá.</p><div class="actuar-form-grid">${wizardField('pwTicket', 'Chamado ou protocolo de origem', draft.sourceTicket, 'text', 'required')}${wizardField('pwProtocol', 'Protocolo da solicitação', draft.protocol || draft.sourceTicket, 'text', 'placeholder="Ex: 45353"')}<div class="actuar-field"><label for="pwAnalyst">Analista responsável</label><select id="pwAnalyst" ${currentContext().mode === 'analyst' ? 'disabled' : ''}>${analystOptions}</select></div><div class="actuar-field"><label for="pwManager">Gestor que vai avaliar</label><select id="pwManager" required><option value="">Selecione o gestor</option>${managerOptions}</select><small class="actuar-field-help">A solicitação vai direto para a fila de avaliação desse gestor.</small></div>${selectField('pwMovement', 'Movimento logístico', domain().MOVEMENTS, draft.movement)}${selectField('pwReason', 'Motivo da movimentação', domain().REASONS, draft.reason)}${selectField('pwPriority', 'Urgência solicitada', domain().PRIORITIES, draft.requestedPriority)}${wizardField('pwPromised', 'Prazo prometido ao cliente', draft.promisedAt ? new Date(draft.promisedAt).toISOString().slice(0, 16) : '', 'datetime-local')}${wizardField('pwPriorityReason', 'Motivo da urgência', draft.priorityReason, 'text', 'placeholder="Obrigatório para prioridade alta ou crítica"')}</div></section>`;
        } else if (state.wizardStep === 1) {
            body.innerHTML = `<section class="pieces-wizard-section"><h3>Cliente</h3><p>Informe a marca responsável e confirme os dados do destino.</p><div class="actuar-form-grid">${selectField('pwBrand', 'Marca', domain().BRANDS, draft.client?.brand || 'Actuar')}${wizardField('pwClientId', 'ID do cliente', draft.client?.id, 'text', 'required data-field="clientId"')}${selectField('pwPersonType', 'Tipo de cliente', domain().PERSON_TYPES.map(item => item === 'Física' ? 'Pessoa física' : 'Pessoa jurídica'), domain().personTypeOf(draft.client) === 'Física' ? 'Pessoa física' : 'Pessoa jurídica', 'onchange="refreshPiecesPersonType()"')}${wizardField('pwClientName', domain().nameLabelOf(draft.client), draft.client?.name, 'text', 'required')}${wizardField('pwDocument', domain().documentLabelOf(draft.client), domain().documentOf(draft.client), 'text', `data-field="${domain().documentTypeOf(draft.client)}"`)}${wizardField('pwUnit', 'Unidade', draft.client?.unit)}${wizardField('pwCity', 'Cidade', draft.client?.city)}${wizardField('pwState', 'UF', draft.client?.state, 'text', 'data-field="uf"')}${wizardField('pwAddress', 'Endereço', draft.client?.address)}${wizardField('pwContact', 'Contato responsável', draft.client?.contact)}${wizardField('pwPhone', 'Telefone', draft.client?.phone, 'tel', 'data-field="phone"')}${wizardField('pwEmail', 'E-mail', draft.client?.email, 'email', 'data-field="email"')}</div></section>`;
        } else if (state.wizardStep === 2) {
            body.innerHTML = `<section class="pieces-wizard-section"><div class="pieces-section-heading"><div><h3>Produtos</h3><p>Adicione um ou mais itens à mesma solicitação.</p></div><button type="button" class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="addPiecesWizardProduct()"><i class="fi fi-rr-plus"></i>Adicionar produto</button></div><div id="piecesWizardProducts" class="pieces-products-editor">${renderProductEditors()}</div></section>`;
        } else if (state.wizardStep === 3) {
            const conditional = draft.conditional || {};
            body.innerHTML = `<section class="pieces-wizard-section"><h3>Motivo e evidências</h3><p>Registre o contexto técnico necessário para a avaliação.</p><div class="actuar-form-grid"><div class="actuar-field span-2"><label for="pwDescription">Descrição da necessidade</label><textarea id="pwDescription" rows="3" required>${e(draft.description)}</textarea></div><div class="actuar-field span-2"><label for="pwJustification">Justificativa</label><textarea id="pwJustification" rows="3">${e(draft.justification)}</textarea></div><div class="actuar-field span-2"><label for="pwDiagnosis">Diagnóstico técnico</label><textarea id="pwDiagnosis" rows="3">${e(draft.diagnosis)}</textarea></div><div class="actuar-field span-2"><label for="pwEvidence">Evidências e links</label><textarea id="pwEvidence" rows="3" placeholder="Um link ou referência por linha">${e((draft.evidence || []).join('\n'))}</textarea></div>${conditionalFields(draft.reason, conditional)}<div class="actuar-field span-2"><label for="pwManagerNotes">Observações para o gestor</label><textarea id="pwManagerNotes" rows="2">${e(draft.managerNotes)}</textarea></div><div class="actuar-field span-2"><label for="pwLogisticsNotes">Observações para Faturamento/Logística</label><textarea id="pwLogisticsNotes" rows="2">${e(draft.logisticsNotes)}</textarea></div></div></section>`;
        } else {
            body.innerHTML = `<section class="pieces-wizard-section"><h3>Revisão</h3><p>${e(copy.review)}</p><div class="pieces-review-grid"><div><span>Chamado</span><strong>${e(draft.sourceTicket)}</strong></div><div><span>Movimento</span><strong>${e(draft.movement)}</strong></div><div><span>Motivo</span><strong>${e(draft.reason)}</strong></div><div><span>Cliente</span><strong>${e(draft.client?.id)} · ${e(draft.client?.name)}</strong></div><div><span>Marca</span><strong>${e(draft.client?.brand)}</strong></div><div><span>Produtos</span><strong>${state.wizardProducts.length} item(ns)</strong></div><div><span>Urgência solicitada</span><strong>${e(draft.requestedPriority)}</strong></div><div><span>Gestor avaliador</span><strong>${e(users()[draft.targetManagerId]?.name || 'Não selecionado')}</strong></div><div><span>Pontuação</span><strong>Calculada somente na avaliação</strong></div></div><div class="pieces-review-products">${state.wizardProducts.map(item => `<span>${e(item.quantity)}× ${e(item.name)} <small>${e(item.code)}</small></span>`).join('')}</div>${reviewChecklist(pending)}</section>`;
        }
        bindFields(body);
        bindFields(body);
        if (state.wizardChecked || state.wizardVisited.includes(state.wizardStep)) paintPendingErrors(pendingOfStep(pending, state.wizardStep));
        document.getElementById('piecesWizardBack').classList.toggle('hidden', state.wizardStep === 0);
        document.getElementById('piecesWizardNext').classList.toggle('hidden', state.wizardStep === STEPS.length - 1);
        document.getElementById('piecesWizardSubmit').classList.toggle('hidden', state.wizardStep !== STEPS.length - 1);
    }
    function bindFields(scope) { window.ActuarFields?.bind(scope || document); }
    function checkFields(scope) { return window.ActuarFields?.validateScope(scope) || { valid: true, errors: [] }; }

    function reviewChecklist(pending) {
        if (!pending.length) return `<div class="pieces-review-status is-ready"><i class="fi fi-rr-user-check" aria-hidden="true"></i><div><strong>Dados obrigatórios completos</strong><p>Você pode enviar a solicitação para avaliação.</p></div></div>`;
        return `<div class="pieces-review-status is-blocked"><i class="fi fi-rr-triangle-warning" aria-hidden="true"></i><div><strong>${pending.length} pendência(s) antes de enviar</strong><ul>${pending.map(item => `<li><button type="button" onclick="goToPiecesWizardStep(${STEP_KEYS.indexOf(item.step)})">${e(item.message)}<small>${e(STEPS[STEP_KEYS.indexOf(item.step)] || '')}</small></button></li>`).join('')}</ul></div></div>`;
    }
    function renderProductEditors() { if (!state.wizardProducts.length) return `<div class="pieces-product-empty"><p>Nenhum produto adicionado.</p><button type="button" class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="addPiecesWizardProduct()">Adicionar primeiro produto</button></div>`; return state.wizardProducts.map((item, index) => `<div class="pieces-product-editor"><div class="actuar-field"><label>Código/SKU</label><input value="${e(item.code)}" oninput="updatePiecesWizardProduct(${index},'code',this.value)"></div><div class="actuar-field product-name"><label>Nome do produto</label><input required value="${e(item.name)}" oninput="updatePiecesWizardProduct(${index},'name',this.value)"></div><div class="actuar-field"><label>Categoria</label><select onchange="updatePiecesWizardProduct(${index},'category',this.value)">${options(['Catraca','Placa facial','Leitor facial','Biometria','Módulo','Fonte','Placa eletrônica','Display','Cabeamento','Peça mecânica','Acessório','Outro'], item.category || 'Outro')}</select></div><div class="actuar-field"><label>Quantidade</label><input type="number" min="1" value="${e(item.quantity || 1)}" oninput="updatePiecesWizardProduct(${index},'quantity',Number(this.value))"></div><div class="actuar-field"><label>Nº de série</label><input value="${e(item.serial || '')}" oninput="updatePiecesWizardProduct(${index},'serial',this.value)"></div><div class="actuar-field"><label>Condição</label><select onchange="updatePiecesWizardProduct(${index},'condition',this.value)">${options(['Novo','Usado','Recondicionado','Avariado'], item.condition || 'Novo')}</select></div><button type="button" class="actuar-icon-button" onclick="removePiecesWizardProduct(${index})" aria-label="Remover produto"><i class="fi fi-rr-trash"></i></button></div>`).join(''); }
    function conditionalFields(reason, data) {
        if (reason === 'Garantia') return `${wizardField('pwDefect', 'Defeito relatado', data.defect, 'text', 'required')}${wizardField('pwWarrantyDiagnosis', 'Diagnóstico da garantia', data.diagnosis, 'text', 'required')}${wizardField('pwInstallDate', 'Data de instalação', data.installDate, 'date')}${selectField('pwUnderWarranty', 'Dentro da garantia?', ['Sim','Não','A confirmar'], data.underWarranty || 'A confirmar')}${wizardField('pwSerial', 'Número de série', data.serial)}${selectField('pwRecurrence', 'É reincidência?', ['Não','Sim'], data.recurrence || 'Não')}`;
        if (reason === 'Venda de peça') return `${wizardField('pwSaleOrder', 'Número do pedido ou venda', data.saleOrder, 'text', 'required')}${wizardField('pwSaleValue', 'Valor da venda', data.saleValue, 'number', 'min="0" step="0.01"')}${selectField('pwInvoiceRequired', 'NF obrigatória?', ['Sim','Não'], data.invoiceRequired || 'Sim')}${selectField('pwFreightIncluded', 'Frete incluso?', ['Sim','Não'], data.freightIncluded || 'Não')}${wizardField('pwFreightPayer', 'Quem custeará o frete?', data.freightPayer)}`;
        if (reason === 'Manutenção paga') return `${wizardField('pwServiceOrder', 'Ordem de serviço', data.serviceOrder, 'text', 'required')}${wizardField('pwServiceValue', 'Valor da manutenção', data.serviceValue, 'number', 'min="0" step="0.01"')}${wizardField('pwServicePart', 'Peça substituída', data.servicePart)}${selectField('pwChargeApproved', 'Cobrança aprovada?', ['Sim','Não','A confirmar'], data.chargeApproved || 'A confirmar')}`;
        return '';
    }
    function captureWizard() {
        const d = state.wizardDraft; const val = id => document.getElementById(id)?.value;
        if (state.wizardStep === 0) { d.sourceTicket = val('pwTicket') || d.sourceTicket; d.protocol = val('pwProtocol') || d.sourceTicket; d.analystId = val('pwAnalyst') || d.analystId; d.department = users()[d.analystId]?.team || d.department; d.targetManagerId = val('pwManager') || d.targetManagerId || null; d.movement = val('pwMovement'); d.reason = val('pwReason'); d.requestedPriority = val('pwPriority'); d.promisedAt = val('pwPromised') ? new Date(val('pwPromised')).getTime() : null; d.priorityReason = val('pwPriorityReason') || ''; }
        if (state.wizardStep === 1) {
            const norm = (type, value) => window.ActuarFields ? window.ActuarFields.format(type, value) : String(value || '');
            const personType = val('pwPersonType') === 'Pessoa física' ? 'Física' : 'Jurídica';
            d.client = { brand: val('pwBrand'), id: norm('clientId', val('pwClientId')), name: val('pwClientName'), personType, document: norm(personType === 'Física' ? 'cpf' : 'cnpj', val('pwDocument')), unit: val('pwUnit'), city: val('pwCity'), state: norm('uf', val('pwState')), address: val('pwAddress'), contact: val('pwContact'), phone: norm('phone', val('pwPhone')), email: norm('email', val('pwEmail')) };
        }
        if (state.wizardStep === 2) d.products = JSON.parse(JSON.stringify(state.wizardProducts));
        if (state.wizardStep === 3) { d.description = val('pwDescription') || ''; d.justification = val('pwJustification') || ''; d.diagnosis = val('pwDiagnosis') || ''; d.evidence = (val('pwEvidence') || '').split('\n').map(item => item.trim()).filter(Boolean); d.managerNotes = val('pwManagerNotes') || ''; d.logisticsNotes = val('pwLogisticsNotes') || ''; const c = {}; ['Defect','WarrantyDiagnosis','InstallDate','UnderWarranty','Serial','Recurrence','SaleOrder','SaleValue','InvoiceRequired','FreightIncluded','FreightPayer','ServiceOrder','ServiceValue','ServicePart','ChargeApproved'].forEach(key => { const value = val(`pw${key}`); if (value != null) c[key.charAt(0).toLowerCase() + key.slice(1)] = value; }); if (c.warrantyDiagnosis) c.diagnosis = c.warrantyDiagnosis; d.conditional = c; }
    }
    // Trocar PJ/PF redesenha a etapa. O documento só é descartado se não couber no novo tipo,
    // em vez de ser truncado silenciosamente (um CNPJ cortado viraria um CPF plausível e errado).
    function refreshPersonType() {
        const raw = document.getElementById('pwDocument')?.value || '';
        captureWizard();
        const client = state.wizardDraft?.client;
        if (client) {
            const limit = client.personType === 'Física' ? 11 : 14;
            const typed = window.ActuarFields ? window.ActuarFields.digits(raw) : raw.replace(/\D+/g, '');
            client.document = typed.length > limit ? '' : client.document;
        }
        renderWizard();
        requestAnimationFrame(() => document.getElementById('pwDocument')?.focus());
    }
    function goToStep(index) {
        if (!state.wizardDraft) return;
        const target = Math.max(0, Math.min(STEPS.length - 1, Number(index) || 0));
        if (target === state.wizardStep) return;
        captureWizard();
        state.wizardStep = target;
        if (!state.wizardVisited.includes(target)) state.wizardVisited.push(target);
        renderWizard();
        requestAnimationFrame(() => document.querySelector('#piecesWizardBody input, #piecesWizardBody select, #piecesWizardBody textarea')?.focus());
    }
    function moveWizard(direction) { goToStep(state.wizardStep + direction); }
    function addProduct() { state.wizardProducts.push({ id: `item_${Date.now()}`, code: '', name: '', category: 'Outro', quantity: 1, condition: 'Novo', unitValue: 0 }); renderWizard(); }
    function updateProduct(index, key, value) { state.wizardProducts[index][key] = value; }
    function removeProduct(index) { state.wizardProducts.splice(index, 1); renderWizard(); }
    async function submitWizard(event) {
        event.preventDefault();
        const fieldCheck = checkFields(document.getElementById('piecesWizardBody'));
        if (!fieldCheck.valid) return showToast(fieldCheck.errors[0].message, 'error');
        captureWizard(); state.wizardChecked = true;
        const pending = wizardPending();
        if (pending.length) {
            const step = STEP_KEYS.indexOf(pending[0].step);
            if (step >= 0 && step !== state.wizardStep) { state.wizardStep = step; if (!state.wizardVisited.includes(step)) state.wizardVisited.push(step); }
            renderWizard();
            const target = paintPendingErrors(pendingOfStep(pending, state.wizardStep));
            requestAnimationFrame(() => { target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); target?.focus?.(); });
            return showToast(pending.length === 1 ? pending[0].message : `${pending.length} campos precisam de correção. Comece por: ${pending[0].message}`, 'error');
        }
        try { let next = state.wizardDraft; next.products = JSON.parse(JSON.stringify(state.wizardProducts));
            const context = currentContext(); const original = records().find(item => item.id === next.id);
            if (context.mode === 'lab' && original?.requestStatus === 'pending_lab_review') {
                const corrections = {}; domain().LAB_EDITABLE_FIELDS.forEach(key => { corrections[key] = next[key]; });
                next = domain().labCorrect(original, corrections, context.actorId, { expectedVersion: original.version });
            } else next = domain().submit(next, context.actorId, next.version); await saveRecord(next); closeRequest();
            showToast(context.mode === 'lab' ? 'Dados corrigidos. Valide e pontue para enviar à gestão.' : 'Solicitação enviada para validação do Toletus Lab. Nenhum ponto foi concedido nesta etapa.'); } catch (error) { showToast(error.message, 'error'); } }

    function canView(record) { const context = currentContext(); if (context.mode === 'analyst') return record.analystId === context.actorId; if (context.mode === 'manager') return !context.teams.length || context.teams.includes(record.department) || record.targetManagerId === context.actorId; if (context.mode === 'lab') return record.requestStatus !== 'draft'; return record.requestStatus === 'approved'; }
    function openDetail(id) { const record = records().find(item => item.id === id); if (!record || !canView(record)) return showToast('Você não possui permissão para consultar esta solicitação.', 'error'); state.selectedId = id; state.detailSuspended = false; document.getElementById('piecesDetailDrawer')?.classList.remove('hidden'); renderDetail(); window.syncPriorityRotationOverlayScroll?.(); requestAnimationFrame(() => document.querySelector('#piecesDetailDrawer .pieces-detail-drawer')?.focus()); }
    function closeDetail() { document.getElementById('piecesDetailDrawer')?.classList.add('hidden'); state.selectedId = null; state.detailSuspended = false; window.syncPriorityRotationOverlayScroll?.(); }
    function block(title, content, className = '') { return `<section class="pieces-detail-block ${className}"><h3>${e(title)}</h3>${content}</section>`; }
    function kv(label, value) { return `<div><span>${e(label)}</span><strong>${e(value == null || value === '' ? '—' : value)}</strong></div>`; }
    function renderDetail() {
        const record = selected(); if (!record) return closeDetail(); const context = currentContext(); const user = users()[record.analystId]; const status = domain().operationalStatus(record); const action = domain().nextAction(record);
        document.getElementById('piecesDetailTitle').textContent = `Solicitação de peça — ${record.protocol || record.sourceTicket}`;
        document.getElementById('piecesDetailSubtitle').textContent = `${record.department} · ${fmtDate(record.createdAt, true)}`;
        const movements = (record.movements || []).map(movement => `<article class="pieces-movement"><header><strong>${e(movement.kind)}</strong>${badge(domain().SHIPPING_STATUSES[movement.status] || movement.status)}</header><div class="pieces-detail-grid">${kv('Transportadora', movement.carrier)}${kv('Modalidade', movement.modality)}${kv('Custeio', movement.paidBy)}${kv('Frete real', money(movement.actualCost))}${kv('Postagem', fmtDate(movement.postedAt, true))}${kv('Conclusão', fmtDate(movement.deliveredAt, true))}</div>${(movement.tracking || []).length ? `<div class="pieces-tracking">${movement.tracking.map(track => `<span><i class="fi fi-rr-route"></i>${e(track.code)} · ${e(track.carrier || movement.carrier)}</span>`).join('')}</div>` : ''}</article>`).join('');
        const events = (record.events || []).slice().reverse().map(item => `<div><i class="fi fi-rr-time-check"></i><span><strong>${e(item.text)}</strong><small>${e(users()[item.actorId]?.name || (item.actorId === 'system' ? 'Sistema' : 'Responsável'))} · ${fmtDate(item.timestamp, true)}</small></span></div>`).join('');
        const actions = detailActions(record, context);
        const info = domain().sla(record);
        document.getElementById('piecesDetailBody').innerHTML = `<section class="pieces-detail-summary"><div><span>Etapa do processo</span>${stageBadge(record)}</div><div><span>Status atual</span>${badge(status)}</div><div><span>Prioridade</span><strong>${e(record.approvedPriority || record.requestedPriority)}</strong></div><div><span>Próxima ação</span><strong>${e(action.label)}</strong></div><div><span>Responsável</span><strong>${e(record.assignments?.find(task => task.status === 'processing')?.assigneeId ? users()[record.assignments.find(task => task.status === 'processing').assigneeId]?.name : action.area || '—')}</strong></div><div><span>SLA</span><strong>${info.dueAt ? `${e(info.label)} · ${fmtDate(info.dueAt, true)}` : e(info.label)}</strong></div><div><span>Tempo na etapa</span><strong>${e(duration(info.elapsedMs))}</strong></div></section>${block('Origem', `<div class="pieces-person-hero">${avatar(user)}<div><strong>${e(user?.name || 'Analista')}</strong><span>${e(record.department)} · Chamado ${e(record.sourceTicket)}</span></div></div><p class="pieces-detail-copy">${e(record.description)}</p><div class="pieces-detail-grid">${kv('Movimento', record.movement)}${kv('Motivo', record.reason)}${kv('Gestor avaliador', users()[record.targetManagerId]?.name)}${kv('Justificativa', record.justification)}${kv('Diagnóstico', record.diagnosis)}</div>`)}${block('Cliente', `<div class="pieces-detail-grid">${kv('Marca', record.client?.brand)}${kv('ID', record.client?.id)}${kv('Nome', record.client?.name)}${kv(domain().documentLabelOf(record.client), domain().documentOf(record.client))}${kv('Unidade', record.client?.unit)}${kv('Cidade/UF', [record.client?.city, record.client?.state].filter(Boolean).join('/'))}${kv('Endereço', record.client?.address)}${kv('Contato', [record.client?.contact, record.client?.phone].filter(Boolean).join(' · '))}</div>`)}${block('Produtos', `<div class="pieces-product-list">${(record.products || []).map(item => `<div><strong>${e(item.quantity)}× ${e(item.name)}</strong><span>${e(item.code || 'Sem código')} · ${e(item.category || 'Outro')} · ${e(item.condition || '—')}${item.serial ? ` · Série ${e(item.serial)}` : ''}</span></div>`).join('')}</div>`)}${block('Avaliação da gestão', `<div class="pieces-detail-grid">${kv('Decisão', domain().REQUEST_STATUSES[record.requestStatus])}${kv('Pontuação calculada', `${record.scoring?.calculated || 0} pts`)}${kv('Pontuação final', `${record.scoring?.final || 0} pts`)}${kv('Gestor', users()[record.scoring?.approvedBy]?.name)}${kv('Data', fmtDate(record.scoring?.approvedAt, true))}${kv('Parecer', record.review?.note)}</div>`)}${block('Faturamento', `<div class="pieces-detail-grid">${kv('Necessidade de NF', record.fiscal?.required == null ? 'A definir' : record.fiscal.required ? 'Sim' : 'Não')}${kv('Situação', domain().FISCAL_STATUSES[record.fiscal?.status])}${kv('Número', record.fiscal?.number)}${kv('Série', record.fiscal?.series)}${kv('Chave', record.fiscal?.accessKey)}${kv('Valor', record.fiscal?.value ? money(record.fiscal.value) : '—')}</div>`)}${block('Logística', movements || '<p class="pieces-muted">As movimentações serão criadas automaticamente após a aprovação.</p>')}${record.occurrences?.length ? block('Ocorrências', record.occurrences.map(item => `<div class="pieces-occurrence ${item.status === 'resolved' ? 'is-resolved' : ''}"><header><strong>${e(item.type)}</strong>${badge(item.status === 'resolved' ? 'Resolvida' : 'Em tratativa')}</header><p>${e(item.description)}</p><small>${fmtDate(item.createdAt, true)} · ${e(item.nextAction || 'Acompanhar resolução')}${item.dueAt ? ` · Prazo ${fmtDate(item.dueAt, true)}` : ''}</small>${item.status === 'resolved' ? `<p class="pieces-occurrence-resolution"><i class="fi fi-rr-check-circle" aria-hidden="true"></i>${e(item.resolution)} — ${e(users()[item.resolvedBy]?.name || 'Responsável')} · ${fmtDate(item.resolvedAt, true)}</p>` : ['logistics', 'lab'].includes(context.mode) ? `<button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="openPiecesAction('resolveOccurrence','${e(item.id)}')">Encerrar ocorrência</button>` : ''}</div>`).join('')) : ''}${record.conclusion ? block('Conclusão da demanda', `<p class="pieces-detail-copy">${e(record.conclusion.outcome)}</p><div class="pieces-detail-grid">${kv('Encerrado por', users()[record.conclusion.closedBy]?.name)}${kv('Data', fmtDate(record.conclusion.closedAt, true))}</div>`) : ''}${(record.labCorrections || []).length ? block('O que o Toletus Lab corrigiu', (record.labCorrections || []).map(entrada => `<article class="pieces-correction"><header><strong>${e(users()[entrada.actorId]?.name || 'Toletus Lab')}</strong><small>${fmtDate(entrada.timestamp, true)}</small></header>${(entrada.fields || []).map(campo => (typeof campo === 'string' ? [{ path: '', before: '—', after: '—', legado: true }] : domain().diffOf(campo)).map(parte => `<div class="pieces-correction-line"><span>${e(typeof campo === 'string' ? campo : campo.label)}${parte.path ? ` · ${e(parte.path)}` : ''}</span><b class="is-before">${e(parte.before)}</b><i class="fi fi-rr-arrow-right" aria-hidden="true"></i><b class="is-after">${e(parte.after)}</b></div>`).join('')).join('')}${entrada.note ? `<p class="pieces-correction-note">${e(entrada.note)}</p>` : ''}</article>`).join('')) : ''}${block('Acompanhamento', `<div class="pieces-comments">${(record.comments || []).map(item => `<article class="pieces-comment"><header>${avatar(users()[item.actorId], 'is-small')}<span><strong>${e(users()[item.actorId]?.name || 'Equipe')}</strong><small>${fmtDate(item.createdAt, true)}</small></span></header><p>${e(item.text)}</p></article>`).join('') || '<p class="pieces-muted">Nenhum comentário ainda. Use este espaço para registrar combinados com o cliente e o que aconteceu no caminho.</p>'}</div>${context.mode === 'analyst' ? '' : `<form class="pieces-comment-form" onsubmit="return submitPiecesComment(event)"><div class="actuar-field"><label for="pieceCommentText">Novo comentário</label><textarea id="pieceCommentText" rows="3" placeholder="Ex.: cliente pediu para entregar depois das 14h" required></textarea></div><button type="submit" class="actuar-btn actuar-btn-secondary actuar-btn-sm"><i class="fi fi-rr-comment-alt"></i>Comentar</button></form>`}`)}<details class="pieces-audit"><summary>Histórico e auditoria</summary><div>${events || '<p>Nenhum evento registrado.</p>'}</div></details><div class="pieces-detail-actions">${actions}</div>`;
        const flow = `<section class="pieces-process-flow"><span class="${record.submittedAt ? 'is-done' : 'is-current'}"><b>1</b>Analista registrou</span><span class="${record.requestStatus === 'approved' ? 'is-done' : record.requestStatus === 'pending_review' ? 'is-current' : ''}"><b>2</b>Gestão avaliou</span><span class="${['issued','not_required'].includes(record.fiscal?.status) && record.movements?.every(item => item.tracking?.length) ? 'is-done' : record.requestStatus === 'approved' ? 'is-current' : ''}"><b>3</b>NF e rastreio</span><span class="${record.movements?.some(item => ['in_transit','delivered','completed'].includes(item.status)) ? 'is-done' : action.area === 'Envio/Coleta' ? 'is-current' : ''}"><b>4</b>Envio/Coleta</span><span class="${status === 'Concluído' ? 'is-done' : ''}"><b>5</b>Conclusão</span></section>`;
        const infoAlert = record.informationRequest?.status === 'pending' ? `<section class="pieces-information-alert"><i class="fi fi-rr-comment-alt"></i><div><strong>Informação solicitada para ${e(record.informationRequest.targetArea)}</strong><p>${e(record.informationRequest.note)}</p></div></section>` : '';
        document.querySelector('#piecesDetailBody .pieces-detail-summary')?.insertAdjacentHTML("afterend", flow + infoAlert);
    }
    function detailActions(record, context) {
        const buttons = [];
        if (context.mode === 'lab' && record.requestStatus === 'pending_lab_review') buttons.push(`<button class="actuar-btn actuar-btn-secondary" onclick="openPiecesRequestModal('${record.id}')">Corrigir dados</button><button class="actuar-btn actuar-btn-danger" onclick="openPiecesAction('labReject')">Reprovar</button><button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('labValidate')">Validar e pontuar</button>`);
        if (context.mode === 'manager' && record.requestStatus === 'pending_manager_check') buttons.push(`<button class="actuar-btn actuar-btn-secondary" onclick="openPiecesAction('returnToLab')">Devolver ao Lab</button><button class="actuar-btn actuar-btn-danger" onclick="openPiecesAction('reject')">Reprovar</button><button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('approve')">Confirmar e encaminhar</button>`);
        if (context.mode === 'manager' && record.informationRequest?.status === 'pending' && record.informationRequest.targetArea === 'Gestão') buttons.push(`<button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('answerInfo')">Responder à Logística</button>`);
        if (context.mode === 'lab' && record.requestStatus === 'approved') {
            const movement = record.movements?.find(item => item.status !== 'completed');
            // "Registrar ocorrência" já vem do bloco operacional abaixo, que agora
            // também é do Lab; repetir aqui colocaria dois botões iguais na ficha.
            if (movement && domain().nextAction(record).area === LAB_ROLE) buttons.push(`<button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('labFollowup')">${e(domain().nextAction(record).label)}</button>`);
        }
        if (['logistics', 'lab'].includes(context.mode) && record.requestStatus === 'approved') {
            if (!record.assignments?.some(task => task.status === 'processing')) buttons.push(`<button class="actuar-btn actuar-btn-secondary" onclick="openPiecesAction('claim')">Iniciar processamento</button>`);
            const currentMovement = record.movements?.find(item => item.status !== 'completed');
            if (operatorCan('Faturamento') && ['awaiting_invoice', 'processing', 'rejected', 'blocked'].includes(record.fiscal?.status)) buttons.push(`<button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('invoice')">${record.fiscal.status === 'processing' ? 'Registrar nota emitida' : 'Processar nota fiscal'}</button>`);
            if (operatorCan('Faturamento') && currentMovement?.status === 'awaiting_tracking') buttons.push(`<button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('tracking')">Registrar etiqueta e rastreio</button>`);
            if (operatorCan('Faturamento') && domain().nextAction(record).area === 'Logística/Faturamento') buttons.push(`<button class="actuar-btn actuar-btn-secondary" onclick="openPiecesAction('returnInfo')">Solicitar informação</button>`);
            if (operatorCan('Expedição') && record.informationRequest?.status === 'pending' && record.informationRequest.targetArea === 'Envio/Coleta') buttons.push(`<button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('answerInfo')">Responder à Logística</button>`);
            if (operatorCan('Expedição') && ['awaiting_packing', 'packing', 'awaiting_dispatch', 'awaiting_carrier', 'in_transit', 'out_for_delivery', 'delivered', 'awaiting_confirmation', 'scheduled', 'collected', 'returning', 'received', 'awaiting_inspection', 'inspected'].includes(currentMovement?.status)) buttons.push(`<button class="actuar-btn actuar-btn-primary" onclick="openPiecesAction('logistics')">${e(domain().nextAction(record).label)}</button>`);
            if (operatorCan('Expedição') && currentMovement && !['awaiting_invoice', 'awaiting_tracking'].includes(currentMovement.status)) buttons.push(`<button class="actuar-btn actuar-btn-secondary" onclick="openPiecesAction('freight')">Registrar frete e volumes</button>`);
            buttons.push(`<button class="actuar-btn actuar-btn-secondary" onclick="openPiecesAction('occurrence')">Registrar ocorrência</button>`);
        }
        return buttons.join('');
    }

    function openAction(action, contextId) {
        const record = selected(); if (!record) return; state.action = action; state.actionContext = contextId || null; state.detailSuspended = suspendDetail();
        const titles = { labValidate: 'Validar e pontuar', labReject: 'Reprovar solicitação', returnToLab: 'Devolver ao Toletus Lab', labFollowup: 'Atualizar acompanhamento', approve: 'Conferir validação e encaminhar', correction: 'Devolver para ajuste', reject: 'Reprovar solicitação', claim: 'Iniciar processamento', invoice: 'Processar nota fiscal', tracking: 'Registrar etiqueta e rastreio', logistics: 'Atualizar preparação e entrega', freight: 'Registrar frete e volumes', returnInfo: 'Solicitar informação', answerInfo: 'Responder informação pendente', occurrence: 'Registrar ocorrência', resolveOccurrence: 'Encerrar ocorrência' };
        const submits = { labValidate: 'Validar e enviar para a gestão', labReject: 'Confirmar reprovação', returnToLab: 'Devolver ao Lab', labFollowup: 'Confirmar etapa', approve: 'Confirmar e encaminhar', correction: 'Devolver para ajuste', reject: 'Confirmar reprovação', claim: 'Iniciar processamento', invoice: 'Salvar dados fiscais', tracking: 'Encaminhar para Envio/Coleta', logistics: 'Confirmar etapa', freight: 'Salvar dados de frete', returnInfo: 'Devolver para o responsável', answerInfo: 'Enviar resposta', occurrence: 'Registrar ocorrência', resolveOccurrence: 'Encerrar ocorrência' };
        document.getElementById('piecesActionTitle').textContent = titles[action]; document.getElementById('piecesActionSubtitle').textContent = `Protocolo ${record.protocol || record.sourceTicket}`; document.getElementById('piecesActionSubmit').textContent = submits[action]; document.getElementById('piecesActionBody').innerHTML = actionForm(action, record); bindFields(document.getElementById('piecesActionBody')); document.getElementById('piecesActionModal').classList.remove('hidden'); window.syncPriorityRotationOverlayScroll?.();
    }
    function closeAction() { document.getElementById('piecesActionModal')?.classList.add('hidden'); state.action = null; state.actionContext = null; resumeDetail(); window.syncPriorityRotationOverlayScroll?.(); }
    function actionForm(action, record) {
        if (action === 'labValidate') {
            const marked = record.labReview?.criteria || [];
            const isMet = label => !marked.length || marked.some(item => item.label === label && item.met === true);
            // A pontuação era consequência invisível dos check-boxes: quem validava só
            // descobria o total depois de salvar. Agora ela aparece e muda ao vivo.
            const marcados = CRITERIA.filter(isMet).length;
            return `<div class="pieces-score-preview"><div><small>Pontuação desta solicitação</small><strong class="num-mono" id="paScorePreview">${marcados * 4}</strong><em>pontos</em></div><span id="paScoreDetail">${marcados} de ${CRITERIA.length} critérios atendidos · 4 pontos cada</span></div><div class="pieces-criteria" onchange="updatePiecesScorePreview()"><p>Desmarque o que veio errado do analista. O que você já corrigiu em "Corrigir dados" continua valendo como não atendido.</p>${CRITERIA.map(label => `<label class="actuar-checkbox-field"><input type="checkbox" name="pieceCriterion" value="${e(label)}" ${isMet(label) ? 'checked' : ''}><span>${e(label)}</span></label>`).join('')}</div><div class="actuar-form-grid"><div class="actuar-field span-2"><label for="paCorrectionNote">O que o Lab corrigiu</label><textarea id="paCorrectionNote" rows="2" placeholder="Obrigatório se você alterou algum dado da solicitação">${e(record.labReview?.correctionNote || '')}</textarea></div><div class="actuar-field span-2"><label for="paNote">Parecer técnico do Lab</label><textarea id="paNote" rows="3">${e(record.labReview?.note || '')}</textarea></div></div>`;
        }
        if (action === 'approve') {
            const lab = record.labReview; const labUser = users()[lab?.actorId];
            const met = normalizeCriteria(lab?.criteria).filter(item => item.met === true).length;
            return `<div class="pieces-confirm"><i class="fi fi-rr-user-check"></i><p><strong>${e(labUser?.name || LAB_ROLE)}</strong> validou ${met} de ${normalizeCriteria(lab?.criteria).length || CRITERIA.length} critérios e fechou <strong>${e(record.scoring?.calculated || 0)} ponto(s)</strong>.${lab?.corrections?.length ? ` Corrigiu: ${e(lab.corrections.join(', '))}.` : ''}</p></div>${lab?.correctionNote ? `<div class="pieces-detail-copy">${e(lab.correctionNote)}</div>` : ''}<div class="actuar-form-grid">${selectField('paPriority', 'Urgência aprovada', domain().PRIORITIES, record.requestedPriority)}${selectField('paInvoice', 'Exige nota fiscal?', ['Sim','Não'], record.conditional?.invoiceRequired || 'Sim')}<div class="actuar-field span-2"><label for="paNote">Parecer da gestão</label><textarea id="paNote" rows="3"></textarea></div><div class="actuar-field"><label for="paFinalPoints">Pontuação final</label><input id="paFinalPoints" type="number" min="0" placeholder="Manter os ${e(record.scoring?.calculated || 0)} pontos do Lab"></div><div class="actuar-field"><label for="paScoreReason">Justificativa do ajuste</label><input id="paScoreReason" placeholder="Obrigatória se alterar os pontos"></div></div>`;
        }
        if (action === 'labFollowup') {
            const movement = record.movements?.find(item => item.status !== 'completed');
            const stage = movement?.status;
            const steps = stage === 'client_followup'
                ? [['complete', 'Concluir chamado']]
                : stage === 'delivered'
                    ? [['followup', 'Cliente instruído — em acompanhamento'], ['complete', 'Concluir chamado']]
                    : [['out_for_delivery', 'Saiu para entrega'], ['deliver', 'Entrega confirmada']];
            return `<div class="actuar-form-grid"><div class="actuar-field span-2"><label for="paStage">Etapa do acompanhamento</label><select id="paStage">${steps.map(([value, label]) => `<option value="${e(value)}">${e(label)}</option>`).join('')}</select></div><div class="actuar-field span-2"><label for="paOutcome">Desfecho da demanda</label><textarea id="paOutcome" rows="3" placeholder="Obrigatório para concluir: instrução dada ao cliente, troca ou manutenção confirmada">${e(record.conclusion?.outcome || '')}</textarea></div></div>`;
        }
        if (action === 'returnToLab') return `<div class="actuar-field"><label for="paNote">O que o Lab precisa revisar</label><textarea id="paNote" rows="5" required></textarea></div><p class="rotation-modal-description">A solicitação volta para a fila do ${e(LAB_ROLE)} e precisa passar de novo pelo seu check antes de seguir para a logística.</p>`;
        if (action === 'labReject' || action === 'correction' || action === 'reject') return `<div class="actuar-field"><label for="paNote">${action === 'correction' ? 'O que precisa ser corrigido' : 'Motivo da reprovação'}</label><textarea id="paNote" rows="5" required></textarea></div>${action === 'correction' ? `<div class="actuar-field"><label for="paFields">Campos autorizados para correção</label><input id="paFields" placeholder="Ex: endereço, produto, evidências"></div>` : ''}`;
        if (action === 'claim') return `<div class="pieces-confirm"><i class="fi fi-rr-user-check"></i><p>Esta pendência será atribuída a você e ficará visível para os demais operadores.</p></div>`;
        if (action === 'invoice') return `<div class="actuar-form-grid">${selectField('paFiscalAction', 'Resultado', ['Emitir NF','Não exige NF','NF rejeitada','Bloqueada por falta de dados'], 'Emitir NF')}${wizardField('paInvoiceNumber', 'Número da nota fiscal', record.fiscal?.number)}${wizardField('paInvoiceSeries', 'Série', record.fiscal?.series)}${wizardField('paInvoiceKey', 'Chave de acesso', record.fiscal?.accessKey)}${wizardField('paInvoiceDate', 'Data de emissão', '', 'datetime-local')}${wizardField('paInvoiceValue', 'Valor da NF', record.fiscal?.value, 'number', 'min="0" step="0.01"')}<div class="actuar-field span-2"><label for="paFiscalNote">Observação fiscal / motivo da pendência</label><textarea id="paFiscalNote" rows="3"></textarea></div></div>`;
        if (action === 'tracking') { const movement = record.movements?.find(item => item.status === 'awaiting_tracking') || record.movements?.[0]; return `<input id="paMovementId" type="hidden" value="${e(movement?.id)}"><div class="actuar-form-grid">${selectField('paCarrier', 'Transportadora', domain().CARRIERS, movement?.carrier || domain().CARRIERS[0])}${selectField('paModality', 'Modalidade', domain().MODALITIES, movement?.modality || domain().MODALITIES[0])}${wizardField('paTracking', 'Código(s) de rastreio', '', 'text', 'required placeholder="Separe múltiplos códigos por vírgula"')}${selectField('paPaidBy', 'Quem custeará o frete', ['Actuar', 'Cliente', 'Fornecedor', 'Transportadora'], movement?.paidBy || 'Actuar')}${wizardField('paQuoted', 'Valor cotado do frete', movement?.quotedCost, 'number', 'min="0" step="0.01"')}${wizardField('paFreight', 'Valor real do frete', movement?.actualCost, 'number', 'min="0" step="0.01"')}<div class="actuar-field span-2"><label for="paLogNote">Instruções para a expedição</label><textarea id="paLogNote" rows="3" placeholder="Orientações de embalagem, postagem ou coleta"></textarea></div></div><div class="actuar-access-note"><i class="fi fi-rr-info"></i><span>Ao confirmar, a pendência será encaminhada automaticamente para Envio/Coleta preparar a peça.</span></div>`; }
        if (action === 'freight') { const movement = record.movements?.find(item => item.status !== 'completed') || record.movements?.[0]; return `<input id="paMovementId" type="hidden" value="${e(movement?.id)}"><div class="actuar-form-grid">${selectField('paCarrier', 'Transportadora', domain().CARRIERS, movement?.carrier || domain().CARRIERS[0])}${selectField('paModality', 'Modalidade', domain().MODALITIES, movement?.modality || domain().MODALITIES[0])}${selectField('paPaidBy', 'Quem custeou', ['Actuar', 'Cliente', 'Fornecedor', 'Transportadora'], movement?.paidBy || 'Actuar')}${wizardField('paCostCompany', 'Empresa responsável', movement?.costCompany)}${wizardField('paCostCenter', 'Centro de custo', movement?.costCenter)}${wizardField('paQuoted', 'Valor cotado', movement?.quotedCost, 'number', 'min="0" step="0.01"')}${wizardField('paFreight', 'Valor real', movement?.actualCost, 'number', 'min="0" step="0.01"')}${wizardField('paInsured', 'Valor segurado', movement?.insuredValue, 'number', 'min="0" step="0.01"')}${wizardField('paDeclared', 'Valor declarado', movement?.declaredValue, 'number', 'min="0" step="0.01"')}${wizardField('paWeight', 'Peso', movement?.weight, 'text', 'placeholder="Ex: 2,5 kg"')}${wizardField('paDimensions', 'Dimensões', movement?.dimensions, 'text', 'placeholder="Ex: 30x20x15 cm"')}${wizardField('paVolumeCount', 'Volumes', (movement?.volumes || []).length || 1, 'number', 'min="1"')}${wizardField('paProof', 'Comprovante (link)', movement?.proof)}<div class="actuar-field span-2"><label for="paLogNote">Observação</label><textarea id="paLogNote" rows="2"></textarea></div></div><div class="actuar-access-note"><i class="fi fi-rr-info"></i><span>Registrar o frete não avança a etapa logística; use as ações de etapa para isso.</span></div>`; }
        if (action === 'resolveOccurrence') { const occurrence = record.occurrences?.find(item => item.id === state.actionContext); return `<div class="pieces-confirm"><i class="fi fi-rr-triangle-warning"></i><p><strong>${e(occurrence?.type || 'Ocorrência')}</strong><br>${e(occurrence?.description || '')}</p></div><div class="actuar-field"><label for="paOccurrenceResolution">Como a ocorrência foi resolvida</label><textarea id="paOccurrenceResolution" rows="4" required></textarea></div><div class="actuar-access-note"><i class="fi fi-rr-info"></i><span>A ocorrência permanece no histórico; o encerramento apenas libera o status operacional.</span></div>`; }
        if (action === 'returnInfo') return `<div class="actuar-form-grid">${selectField('paInfoTarget', 'Quem deve responder?', ['Gestão','Envio/Coleta'], 'Gestão')}<div class="actuar-field span-2"><label for="paInfoNote">Informação necessária</label><textarea id="paInfoNote" rows="4" required placeholder="Explique objetivamente o dado que está faltando"></textarea></div></div>`;
        if (action === 'answerInfo') return `<div class="pieces-confirm"><i class="fi fi-rr-comment-alt"></i><p>${e(record.informationRequest?.note || 'Logística solicitou informações complementares.')}</p></div><div class="actuar-field"><label for="paInfoAnswer">Resposta para Logística/Faturamento</label><textarea id="paInfoAnswer" rows="4" required></textarea></div>`;
        if (action === 'logistics') { const movement = record.movements?.find(item => item.status !== 'completed') || record.movements?.[0]; const steps = logisticsSteps(movement); return `<input id="paMovementId" type="hidden" value="${e(movement?.id)}"><div class="actuar-form-grid">${selectField('paLogAction', 'Etapa', steps, steps[0])}${wizardField('paPostedAt', 'Data e horário', '', 'datetime-local')}${steps.includes('Concluir chamado') ? `<div class="actuar-field span-2"><label for="paOutcome">Desfecho da demanda</label><textarea id="paOutcome" rows="3" placeholder="Ex: peça trocada no cliente e equipamento validado em funcionamento"></textarea><small class="actuar-field-help">Obrigatório para concluir o chamado.</small></div>` : ''}<div class="actuar-field span-2"><label for="paLogNote">Observação operacional</label><textarea id="paLogNote" rows="3"></textarea></div></div><div class="pieces-tracking">${(movement?.tracking || []).map(track => `<span><i class="fi fi-rr-route"></i>${e(track.code)} · ${e(track.carrier || movement.carrier)}</span>`).join('')}</div>`; }
        return `<div class="actuar-form-grid">${selectField('paOccurrenceType', 'Tipo', domain().OCCURRENCE_TYPES, domain().OCCURRENCE_TYPES[0])}<div class="actuar-field"><label for="paOccurrenceDescription">Descrição</label><textarea id="paOccurrenceDescription" rows="3" required></textarea></div>${wizardField('paOccurrenceNext', 'Próxima ação')}${wizardField('paOccurrenceDue', 'Prazo', '', 'datetime-local')}</div><div class="actuar-access-note"><i class="fi fi-rr-info"></i><span>A ocorrência não substitui o status principal: o acompanhamento da etapa continua em paralelo.</span></div>`;
    }
    const LOGISTICS_ACTIONS = {
        'Iniciar embalagem': 'pack', 'Concluir embalagem': 'ready', 'Aguardar transportadora': 'await_carrier', 'Confirmar postagem': 'post',
        'Registrar saída para entrega': 'out_for_delivery', 'Confirmar entrega': 'deliver', 'Aguardar confirmação do solicitante': 'await_confirmation',
        'Agendar coleta': 'schedule', 'Confirmar coleta': 'collect', 'Registrar trânsito para a empresa': 'return', 'Confirmar recebimento': 'receive',
        'Encaminhar para inspeção': 'await_inspection', 'Registrar inspeção concluída': 'inspect', 'Concluir chamado': 'complete'
    };
    function logisticsSteps(movement) {
        const status = movement?.status;
        if (movement?.kind === 'Coleta') {
            const map = { awaiting_packing: ['Agendar coleta'], awaiting_schedule: ['Agendar coleta'], scheduled: ['Confirmar coleta', 'Aguardar transportadora'], awaiting_carrier: ['Confirmar coleta'], collected: ['Registrar trânsito para a empresa', 'Confirmar recebimento'], returning: ['Confirmar recebimento'], received: ['Encaminhar para inspeção', 'Concluir chamado'], awaiting_inspection: ['Registrar inspeção concluída'], inspected: ['Concluir chamado'] };
            return map[status] || ['Concluir chamado'];
        }
        const map = {
            awaiting_packing: ['Iniciar embalagem'], packing: ['Concluir embalagem'], awaiting_dispatch: ['Confirmar postagem', 'Aguardar transportadora'],
            awaiting_carrier: ['Confirmar postagem'], in_transit: ['Registrar saída para entrega', 'Confirmar entrega'], out_for_delivery: ['Confirmar entrega'],
            delivered: ['Aguardar confirmação do solicitante', 'Concluir chamado'], awaiting_confirmation: ['Concluir chamado']
        };
        return map[status] || ['Concluir chamado'];
    }
    async function submitActionV2(event) {
        event.preventDefault();
        const record = selected(); const context = currentContext(); const requestedAction = state.action; const val = id => document.getElementById(id)?.value;
        const fieldCheck = checkFields(document.getElementById('piecesActionBody'));
        if (!fieldCheck.valid) return showToast(fieldCheck.errors[0].message, 'error');
        try {
            let next;
            if (requestedAction === 'labValidate') {
                const criteria = [...document.querySelectorAll('[name="pieceCriterion"]')].map(input => ({ label: input.value, met: input.checked }));
                next = domain().labReview(record, 'validate', context.actorId, { expectedVersion: record.version, criteria, correctionNote: val('paCorrectionNote'), note: val('paNote') });
            } else if (requestedAction === 'labReject') {
                next = domain().labReview(record, 'reject', context.actorId, { expectedVersion: record.version, note: val('paNote') });
            } else if (requestedAction === 'returnToLab') {
                next = domain().evaluate(record, 'return', context.actorId, { expectedVersion: record.version, note: val('paNote') });
            } else if (requestedAction === 'labFollowup') {
                const movement = record.movements?.find(item => item.status !== 'completed');
                next = domain().updateMovement(record, movement?.id, val('paStage'), context.actorId, { expectedVersion: record.version, outcome: val('paOutcome') });
            } else if (requestedAction === 'approve') {
                next = domain().evaluate(record, 'approve', context.actorId, { expectedVersion: record.version, priority: val('paPriority'), invoiceRequired: val('paInvoice') === 'Sim', note: val('paNote'), finalPoints: val('paFinalPoints'), scoreReason: val('paScoreReason') });
            } else if (requestedAction === 'correction' || requestedAction === 'reject') {
                next = domain().evaluate(record, requestedAction === 'correction' ? 'correction' : 'reject', context.actorId, { expectedVersion: record.version, note: val('paNote'), fields: (val('paFields') || '').split(',').map(item => item.trim()).filter(Boolean) });
            } else if (requestedAction === 'claim') {
                next = domain().claim(record, context.actorId, domain().nextAction(record).area, record.version);
            } else if (requestedAction === 'invoice') {
                const action = ({ 'Emitir NF': 'issue', 'Não exige NF': 'not_required', 'NF rejeitada': 'reject', 'Bloqueada por falta de dados': 'block' })[val('paFiscalAction')];
                next = domain().updateFiscal(record, action, context.actorId, { expectedVersion: record.version, number: val('paInvoiceNumber'), series: val('paInvoiceSeries'), accessKey: val('paInvoiceKey'), issuedAt: val('paInvoiceDate') ? new Date(val('paInvoiceDate')).getTime() : Date.now(), value: Number(val('paInvoiceValue') || 0), note: val('paFiscalNote') });
            } else if (requestedAction === 'tracking') {
                const carrier = val('paCarrier'); const tracking = (val('paTracking') || '').split(',').map(code => code.trim()).filter(Boolean).map(code => ({ code, carrier }));
                next = domain().registerTracking(record, val('paMovementId'), context.actorId, { expectedVersion: record.version, carrier, modality: val('paModality'), paidBy: val('paPaidBy'), quotedCost: Number(val('paQuoted') || 0), actualCost: Number(val('paFreight') || 0), tracking, notes: val('paLogNote') });
            } else if (requestedAction === 'freight') {
                const volumeCount = Math.max(1, Number(val('paVolumeCount') || 1));
                next = domain().updateMovement(record, val('paMovementId'), 'freight', context.actorId, {
                    expectedVersion: record.version, carrier: val('paCarrier'), modality: val('paModality'), paidBy: val('paPaidBy'),
                    costCompany: val('paCostCompany'), costCenter: val('paCostCenter'), quotedCost: Number(val('paQuoted') || 0), actualCost: Number(val('paFreight') || 0),
                    insuredValue: Number(val('paInsured') || 0), declaredValue: Number(val('paDeclared') || 0), weight: val('paWeight'), dimensions: val('paDimensions'),
                    volumes: Array.from({ length: volumeCount }, (item, index) => ({ index: index + 1 })), proof: val('paProof'), notes: val('paLogNote')
                });
            } else if (requestedAction === 'resolveOccurrence') {
                next = domain().resolveOccurrence(record, state.actionContext, context.actorId, { expectedVersion: record.version, resolution: val('paOccurrenceResolution') });
            } else if (requestedAction === 'returnInfo') {
                next = domain().returnForInformation(record, context.actorId, { expectedVersion: record.version, targetArea: val('paInfoTarget'), note: val('paInfoNote') });
            } else if (requestedAction === 'answerInfo') {
                next = domain().resolveInformation(record, context.actorId, val('paInfoAnswer'), record.version);
            } else if (requestedAction === 'logistics') {
                const action = LOGISTICS_ACTIONS[val('paLogAction')];
                if (!action) throw new Error('Selecione uma etapa operacional válida.');
                next = domain().updateMovement(record, val('paMovementId'), action, context.actorId, { expectedVersion: record.version, postedAt: val('paPostedAt') ? new Date(val('paPostedAt')).getTime() : Date.now(), deliveredAt: val('paPostedAt') ? new Date(val('paPostedAt')).getTime() : Date.now(), outcome: val('paOutcome'), notes: val('paLogNote') });
            } else {
                next = domain().addOccurrence(record, context.actorId, { expectedVersion: record.version, type: val('paOccurrenceType'), description: val('paOccurrenceDescription'), nextAction: val('paOccurrenceNext'), dueAt: val('paOccurrenceDue') ? new Date(val('paOccurrenceDue')).getTime() : null });
            }
            await saveRecord(next); closeAction(); state.selectedId = next.id; renderDetail();
            showToast(({ approve: 'Solicitação aprovada e encaminhada para Logística/Faturamento.', tracking: 'NF e rastreio concluídos. A solicitação foi encaminhada para Envio/Coleta preparar a peça.', freight: 'Dados de frete e volumes registrados.', resolveOccurrence: 'Ocorrência encerrada e registrada no histórico.' })[requestedAction] || 'Operação atualizada com sucesso.');
        } catch (error) { showToast(error.message, 'error'); }
    }

    /* Comentar não muda etapa nem responsável: é registro. Por isso não passa pela
       modal de ação — o campo vive na própria ficha, onde a conversa acontece. */
    async function submitComment(event) {
        event.preventDefault();
        const record = selected(); const context = currentContext();
        try {
            await saveRecord(domain().comment(record, context.actorId, document.getElementById('pieceCommentText')?.value));
            renderDetail();
            showToast('Comentário registrado no acompanhamento.');
        } catch (error) {
            showToast(error.message || 'Não foi possível registrar o comentário.', 'error');
        }
        return false;
    }

    async function saveRecord(next) {
        const index = store().pieceOperations.findIndex(item => item.id === next.id); if (index >= 0) store().pieceOperations[index] = next; else store().pieceOperations.push(next);
        if (next.requestStatus === 'approved' && Number(next.scoring?.final || 0) > 0 && !store().logs.some(log => log.relatedPieceRequestId === next.id && log.type === 'PECA')) store().logs.push({ id: typeof uid === 'function' ? uid() : `piece_score_${Date.now()}`, type: 'PECA', userId: next.analystId, clientId: next.client?.id || '', tipo: next.movement, value: Number(next.scoring.final), registradoPor: next.scoring.approvedBy, relatedPieceRequestId: next.id, timestamp: next.scoring.approvedAt || Date.now() });
        const ok = await persistStore(); if (!ok) throw new Error(lastPersistError || 'Não foi possível salvar a solicitação.'); renderPiecesModule();
    }

    window.renderPiecesModule = renderPiecesModule; window.updatePiecesPendingBadge = updatePendingBadge; window.canRequestPieces = canRequestPieces;
    window.updatePiecesScorePreview = () => {
        const total = document.querySelectorAll('[name="pieceCriterion"]').length;
        const marcados = document.querySelectorAll('[name="pieceCriterion"]:checked').length;
        const valor = document.getElementById('paScorePreview');
        const detalhe = document.getElementById('paScoreDetail');
        if (valor) valor.textContent = String(marcados * 4);
        if (detalhe) detalhe.textContent = `${marcados} de ${total} critérios atendidos · 4 pontos cada`;
    };
    window.submitPiecesComment = submitComment;
    window.setPiecesTab = setTab; window.setPiecesPipeline = setPipeline; window.updatePiecesFilter = updateFilter; window.clearPiecesFilters = clearFilters; window.togglePiecesFilters = toggleFilters;
    window.openPiecesRequestModal = openRequest; window.closePiecesRequestModal = closeRequest; window.movePiecesWizard = moveWizard; window.goToPiecesWizardStep = goToStep; window.refreshPiecesPersonType = refreshPersonType; window.submitPiecesWizard = submitWizard;
    window.addPiecesWizardProduct = addProduct; window.updatePiecesWizardProduct = updateProduct; window.removePiecesWizardProduct = removeProduct;
    window.openPiecesDetail = openDetail; window.closePiecesDetail = closeDetail; window.openPiecesAction = openAction; window.closePiecesActionModal = closeAction; window.submitPiecesAction = submitActionV2;
    document.addEventListener('click', event => {
        if (event.target?.id === 'piecesRequestModal') closeRequest();
        if (event.target?.id === 'piecesActionModal') closeAction();
        if (event.target?.id === 'piecesDetailDrawer') closeDetail();
    });
})();
