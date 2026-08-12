(function () {
    'use strict';

    const D = window.PerformanceDomain;
    const authenticationEnabled = window.ACTUAR_AUTHENTICATION_ENABLED === true;
    const secureRoutes = new Set(['overview', 'newRequest', 'requests', 'ledger', 'approvals', 'team', 'usersTeams', 'rules', 'cycles', 'audit', 'notifications', 'profile']);
    const routeRoles = {
        approvals: ['manager', 'administrator'],
        team: ['manager', 'administrator'],
        usersTeams: ['administrator'],
        cycles: ['administrator'],
        audit: ['administrator']
    };
    const state = { client: null, session: null, profile: null, managedTeamIds: [], managedTeamCodes: [], guest: false, initialized: false, renderToken: 0 };

    const escape = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
    const fmtDate = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';
    const fmtPoints = value => `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(Number(value || 0))} pts`;
    const roleCode = () => state.profile?.role?.code || 'guest';
    const isAuthenticated = () => Boolean(state.session && state.profile);
    const currentRoute = () => window.getActuarCurrentRoute?.() || { name: 'dashboard' };
    const platformView = () => document.getElementById('viewPlatform');

    function feedback(kind, title, message) {
        const icon = kind === 'error' ? 'triangle-warning' : kind === 'success' ? 'check-circle' : 'info';
        return `<div class="actuar-feedback actuar-feedback-${kind}"><i class="fi fi-rr-${icon}" aria-hidden="true"></i><div><strong>${escape(title)}</strong><p>${escape(message)}</p></div></div>`;
    }

    function loading(message = 'Carregando dados…') {
        return `<div class="actuar-state"><span class="actuar-spinner" aria-hidden="true"></span><p>${escape(message)}</p></div>`;
    }

    function empty(title, message, action = '') {
        return `<div class="actuar-empty-state"><div><i class="fi fi-rr-inbox" aria-hidden="true"></i><strong>${escape(title)}</strong><p>${escape(message)}</p>${action}</div></div>`;
    }

    function statusBadge(status) {
        const label = D.statusLabels[status] || status || '—';
        const tone = status === 'approved' ? 'success' : status === 'not_approved' || status === 'cancelled' ? 'danger' : status === 'correction_requested' ? 'warning' : 'primary';
        return `<span class="actuar-badge actuar-badge-${tone}">${escape(label)}</span>`;
    }

    function setPlatformHtml(html) {
        const view = platformView();
        if (view) view.innerHTML = html;
        window.normalizeActuarIcons?.(view || document);
        window.enhanceReusableComponents?.(view || document);
    }

    function showAuth(message = '') {
        state.guest = false;
        const auth = document.getElementById('authScreen');
        auth?.classList.remove('hidden');
        document.getElementById('globalHeader')?.classList.add('auth-hidden');
        document.querySelector('.actuar-toolbar')?.classList.add('auth-hidden');
        document.querySelector('.actuar-app-layout')?.classList.add('auth-hidden');
        const error = document.getElementById('authError');
        if (error) { error.textContent = message; error.classList.toggle('hidden', !message); }
        requestAnimationFrame(() => document.getElementById('authEmail')?.focus());
    }

    function hideAuth() {
        document.getElementById('authScreen')?.classList.add('hidden');
        document.getElementById('globalHeader')?.classList.remove('auth-hidden');
        document.querySelector('.actuar-toolbar')?.classList.remove('auth-hidden');
        document.querySelector('.actuar-app-layout')?.classList.remove('auth-hidden');
    }

    async function loadProfile() {
        const { data, error } = await state.client
            .from('users')
            .select('id,auth_user_id,legacy_user_key,first_name,last_name,display_name,avatar_url,corporate_email,phone,job_title,status,primary_team_id,responsible_manager_id,created_at,last_access_at,role:roles(code,name),team:teams!users_primary_team_id_fkey(id,code,name),manager:users!users_responsible_manager_id_fkey(id,display_name,corporate_email)')
            .eq('auth_user_id', state.session.user.id)
            .single();
        if (error) throw error;
        if (data.status !== 'active') throw new Error(data.status === 'blocked' ? 'Seu acesso está bloqueado. Procure a gestão.' : 'Seu convite ainda não foi ativado pela gestão.');
        state.profile = data;
        if (roleCode() === 'manager' || roleCode() === 'administrator') {
            const { data: managed, error: managedError } = await state.client.from('manager_teams').select('team_id,team:teams(code)').eq('manager_id', data.id).is('valid_to', null);
            if (managedError) throw managedError;
            state.managedTeamIds = (managed || []).map(item => item.team_id);
            state.managedTeamCodes = (managed || []).map(item => item.team?.code).filter(Boolean);
        } else { state.managedTeamIds = []; state.managedTeamCodes = []; }
        await state.client.rpc('record_login');
    }

    async function init(client) {
        state.client = client;
        if (!authenticationEnabled) {
            state.initialized = true;
            hideAuth();
            return;
        }
        if (!client) { showAuth('Configuração do Supabase indisponível.'); return; }
        const { data } = await client.auth.getSession();
        state.session = data.session;
        client.auth.onAuthStateChange((event, session) => {
            state.session = session;
            if (event === 'SIGNED_OUT') {
                state.profile = null;
                state.managedTeamIds = [];
                showAuth();
            } else if (session && event !== 'TOKEN_REFRESHED') {
                setTimeout(() => hydrateAuthenticatedSession(), 0);
            }
        });
        if (state.session) await hydrateAuthenticatedSession();
        else showAuth();
        state.initialized = true;
    }

    async function hydrateAuthenticatedSession() {
        try {
            await loadProfile();
            state.guest = false;
            hideAuth();
            alignLegacyViewer();
            await loadConfirmedRanking();
            renderNavigation();
            overrideLegacyProfileActions();
            await renderDashboardSummary();
            const route = currentRoute();
            if (isSecureRoute(route.name)) window.applyRoute(route, { fromHistory: true });
            else window.render();
        } catch (error) {
            console.error('Falha ao carregar perfil autenticado:', error);
            await state.client.auth.signOut();
            showAuth(error.message.includes('relation') || error.code === '42P01'
                ? 'A migration da plataforma ainda não foi aplicada no Supabase.'
                : error.message);
        }
    }

    function alignLegacyViewer() {
        if (!state.profile) return;
        const legacyKey = state.profile.legacy_user_key;
        window.syncAuthenticatedLegacyViewer?.(legacyKey);
        const analystSelect = document.getElementById('userSelect');
        if (analystSelect) {
            analystSelect.disabled = roleCode() === 'analyst';
            analystSelect.title = roleCode() === 'analyst' ? 'Sua identidade vem da sessão autenticada' : 'Filtro autorizado de visualização';
        }
        ['btnAdminAccess', 'btnPecaAccess', 'btnAdminLogout', 'btnPecaLogout'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.querySelectorAll('form[onsubmit*="submitPriorityRequest"], form[onsubmit*="submitTransferRequest"]').forEach(form => form.closest('.bg-surface')?.classList.add('hidden'));
    }

    async function loadConfirmedRanking() {
        window.performanceConfirmedPoints = {};
        const cycles = await query('score_cycles', 'id', q => q.in('status', ['open', 'review']).order('starts_on', { ascending: false }).limit(1));
        if (!cycles[0]) return;
        const { data: totals, error } = await state.client.rpc('get_confirmed_ranking', { p_cycle_id: cycles[0].id });
        if (error) throw error;
        (totals || []).forEach(total => { if (total.legacy_user_key) window.performanceConfirmedPoints[total.legacy_user_key] = Number(total.confirmed_points || 0); });
    }

    function overrideLegacyProfileActions() {
        window.openProfileScreen = () => window.navigateTo('profile');
        window.signOutProfile = () => signOut();
        const p = state.profile;
        if (!p) return;
        const avatar = p.avatar_url ? `<img src="${escape(p.avatar_url)}" alt="">` : escape((p.first_name?.[0] || '') + (p.last_name?.[0] || ''));
        ['headerProfileAvatar', 'menuProfileAvatar'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = avatar || '<i class="fi fi-rr-user"></i>'; });
        document.getElementById('menuProfileName').textContent = p.display_name;
        document.getElementById('menuProfileIdentifier').textContent = p.corporate_email || 'E-mail pendente';
        document.getElementById('menuProfileRole').textContent = p.job_title || p.role.name;
    }

    async function login(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const submit = form.querySelector('[type="submit"]');
        const errorEl = document.getElementById('authError');
        submit.disabled = true;
        errorEl.classList.add('hidden');
        const { error } = await state.client.auth.signInWithPassword({ email: form.email.value.trim(), password: form.password.value });
        submit.disabled = false;
        if (error) {
            errorEl.textContent = error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message;
            errorEl.classList.remove('hidden');
        }
        return false;
    }

    async function requestPasswordReset() {
        const email = document.getElementById('authEmail')?.value.trim();
        if (!email) { showAuth('Informe seu e-mail corporativo para recuperar o acesso.'); return; }
        const { error } = await state.client.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}${location.pathname}#/profile` });
        if (error) showAuth(error.message);
        else showAuth('Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.');
    }

    function continueAsGuest() {
        state.guest = true;
        hideAuth();
        document.querySelectorAll('form[onsubmit*="submitPriorityRequest"], form[onsubmit*="submitTransferRequest"]').forEach(form => form.closest('.bg-surface')?.classList.add('hidden'));
        renderNavigation();
        window.navigateTo('ranking', { replace: true, root: true });
        window.showToast?.('Acesso de convidado: ranking e regras disponíveis.', 'info');
    }

    async function signOut() {
        if (state.session) await state.client.auth.signOut();
        state.session = null; state.profile = null; state.guest = false;
        showAuth();
    }

    function navItem(route, label, icon) {
        const active = currentRoute().name === route;
        return `<button class="actuar-sidebar-item${active ? ' is-active' : ''}" type="button" onclick="navigateTo('${route}')"><i class="fi fi-rr-${icon}" aria-hidden="true"></i><span>${escape(label)}</span></button>`;
    }

    function renderNavigation() {
        const sidebar = document.getElementById('appSidebar');
        const tabs = document.getElementById('publicTabsContainer');
        if (!isAuthenticated()) {
            sidebar?.classList.add('hidden');
            document.querySelector('.actuar-app-layout')?.classList.remove('has-sidebar');
            if (tabs && state.guest) {
                tabs.innerHTML = `<button onclick="switchPublicTab('ranking')" id="btnTabRanking" class="actuar-btn actuar-btn-secondary"><i class="fi fi-rr-ranking-podium"></i>Ranking</button><button onclick="switchPublicTab('faq')" id="btnTabFaq" class="actuar-btn actuar-btn-secondary"><i class="fi fi-rr-book-alt"></i>Regras e Pontuação</button><button onclick="PerformancePlatform.showLogin()" class="actuar-btn actuar-btn-primary"><i class="fi fi-rr-sign-in-alt"></i>Entrar</button>`;
                tabs.classList.remove('hidden');
            }
            return;
        }
        const role = roleCode();
        const analyst = [navItem('overview', 'Visão Geral', 'home'), navItem('dashboard', 'Minha Performance', 'chart-histogram'), navItem('newRequest', 'Nova Solicitação', 'plus'), navItem('requests', 'Minhas Solicitações', 'document'), navItem('ledger', 'Extrato de Pontos', 'receipt'), navItem('ranking', 'Ranking', 'ranking-podium'), navItem('faq', 'Regras e Pontuação', 'book-alt'), navItem('profile', 'Meu Perfil', 'user')];
        const manager = [navItem('approvals', 'Aprovações', 'clipboard-check'), navItem('team', 'Minha Equipe', 'users')];
        const admin = [navItem('usersTeams', 'Usuários e Equipes', 'users-gear'), navItem('rules', 'Regras de Pontuação', 'settings-sliders'), navItem('cycles', 'Ciclos', 'calendar-check'), navItem('audit', 'Auditoria', 'shield-check')];
        sidebar.innerHTML = `<div class="actuar-sidebar-section"><span>Performance</span>${analyst.join('')}</div>${['manager', 'administrator'].includes(role) ? `<div class="actuar-sidebar-section"><span>Gestão</span>${manager.join('')}</div>` : ''}${role === 'administrator' ? `<div class="actuar-sidebar-section"><span>Administração</span>${admin.join('')}</div>` : ''}<div class="actuar-sidebar-section actuar-sidebar-footer">${navItem('notifications', 'Notificações', 'bell')}</div>`;
        sidebar.classList.remove('hidden');
        document.querySelector('.actuar-app-layout')?.classList.add('has-sidebar');
        tabs?.classList.add('hidden');
    }

    function isSecureRoute(name) { return secureRoutes.has(name); }

    function canSelectLegacyAnalyst(legacyId, teamCode) {
        if (!authenticationEnabled) return true;
        if (state.guest || !isAuthenticated()) return false;
        if (roleCode() === 'administrator') return true;
        if (roleCode() === 'manager') return state.managedTeamCodes.includes(teamCode) || legacyId === state.profile.legacy_user_key;
        return legacyId === state.profile.legacy_user_key;
    }

    function guardRoute(route) {
        if (!isAuthenticated()) { showAuth('Entre para acessar esta área.'); return false; }
        const allowed = routeRoles[route.name];
        if (allowed && !allowed.includes(roleCode())) {
            window.showToast?.('Você não possui permissão para acessar esta área.', 'error');
            window.navigateTo('overview', { replace: true });
            return false;
        }
        return true;
    }

    async function query(table, select = '*', configure = value => value) {
        const result = await configure(state.client.from(table).select(select));
        if (result.error) throw result.error;
        return result.data || [];
    }

    async function renderDashboardSummary() {
        const target = document.getElementById('authenticatedDashboardSummary');
        if (!target || !isAuthenticated()) { target?.classList.add('hidden'); return; }
        target.classList.remove('hidden');
        target.innerHTML = loading('Carregando seu resumo…');
        try {
            const cycles = await query('score_cycles', '*', q => q.in('status', ['open', 'review']).order('starts_on', { ascending: false }).limit(1));
            const cycle = cycles[0];
            if (!cycle) { target.innerHTML = feedback('info', 'Sem ciclo ativo', 'A gestão ainda não abriu um ciclo de pontuação.'); return; }
            const [ledger, requests, rankingResult] = await Promise.all([
                query('point_ledger', 'quantity,movement_type', q => q.eq('analyst_id', state.profile.id).eq('score_cycle_id', cycle.id).eq('valid', true)),
                query('requests', 'id,status,expected_points,granted_points,request_type,protocol,updated_at', q => q.eq('analyst_id', state.profile.id).eq('score_cycle_id', cycle.id).order('updated_at', { ascending: false })),
                state.client.rpc('get_confirmed_ranking', { p_cycle_id: cycle.id })
            ]);
            if (rankingResult.error) throw rankingResult.error;
            const teamUsers = rankingResult.data || [];
            const confirmed = D.summarizeLedger(ledger);
            const pending = requests.filter(r => ['pending_review', 'in_review', 'correction_requested', 'resubmitted'].includes(r.status)).reduce((sum, r) => sum + Number(r.expected_points || 0), 0);
            const sorted = teamUsers.sort((a, b) => Number(b.confirmed_points) - Number(a.confirmed_points));
            const rank = sorted.findIndex(item => item.analyst_id === state.profile.id) + 1;
            const approved = requests.filter(r => r.status === 'approved').length;
            const notApproved = requests.filter(r => r.status === 'not_approved').length;
            const corrections = requests.filter(r => r.status === 'correction_requested').length;
            const prize = rank === 1 ? 1000 : rank === 2 ? 500 : rank === 3 ? 300 : 0;
            target.innerHTML = `<div class="actuar-context-strip"><div><span>Equipe atual</span><strong>${escape(state.profile.team?.name || 'Não definida')}</strong></div><div><span>Gestor responsável</span><strong>${escape(state.profile.manager?.display_name || 'Não definido')}</strong></div><div><span>Ciclo</span><strong>${escape(cycle.name)} · ${cycle.status === 'open' ? 'Parcial' : 'Em conferência'}</strong></div></div><div class="actuar-kpi-grid">${kpi('Pontuação confirmada', fmtPoints(confirmed), 'check-circle', 'success')}${kpi('Previsão pendente', fmtPoints(pending), 'clock', 'warning')}${kpi('Aprovadas', approved, 'clipboard-check', 'success')}${kpi('Não aprovadas', notApproved, 'cross-circle', 'danger')}${kpi('Correções pendentes', corrections, 'file-edit', 'warning')}${kpi('Posição na equipe', rank ? `${rank}º` : '—', 'ranking-podium', 'primary')}${kpi('Premiação estimada', `R$ ${prize.toLocaleString('pt-BR')}`, 'trophy', 'primary')}</div>`;
        } catch (error) { target.innerHTML = feedback('error', 'Não foi possível carregar o resumo', error.message); }
    }

    function kpi(label, value, icon, tone) {
        return `<article class="actuar-kpi actuar-kpi-${tone}"><span><i class="fi fi-rr-${icon}" aria-hidden="true"></i></span><div><p>${escape(label)}</p><strong class="num-mono">${escape(value)}</strong></div></article>`;
    }

    async function renderCurrentRoute(route) {
        if (!guardRoute(route)) return;
        renderNavigation();
        const token = ++state.renderToken;
        setPlatformHtml(loading());
        try {
            const renderers = {
                overview: renderOverview, newRequest: renderNewRequest, requests: renderRequests, ledger: renderLedger,
                approvals: renderApprovals, team: renderTeam, usersTeams: renderUsersTeams, rules: renderRules,
                cycles: renderCycles, audit: renderAudit, notifications: renderNotifications, profile: renderProfile
            };
            const html = await renderers[route.name](route.section);
            if (token === state.renderToken) setPlatformHtml(html);
        } catch (error) {
            console.error(error);
            if (token === state.renderToken) setPlatformHtml(feedback('error', 'Não foi possível carregar esta área', error.message));
        }
    }

    async function renderOverview() {
        const cycles = await query('score_cycles', '*', q => q.order('starts_on', { ascending: false }).limit(1));
        const cycle = cycles[0];
        const requests = cycle ? await query('requests', 'id,status,request_type,protocol,client_name,expected_points,updated_at', q => q.eq('analyst_id', state.profile.id).eq('score_cycle_id', cycle.id).order('updated_at', { ascending: false }).limit(5)) : [];
        return `<div class="actuar-context-strip"><div><span>Equipe</span><strong>${escape(state.profile.team?.name || 'Não definida')}</strong></div><div><span>Gestor</span><strong>${escape(state.profile.manager?.display_name || 'Não definido')}</strong></div><div><span>Ciclo consultado</span><strong>${escape(cycle?.name || 'Sem ciclo')}</strong></div></div><div class="actuar-two-column"><section class="actuar-card"><div class="actuar-card-header"><h2 class="actuar-card-title">Atalhos</h2><p class="actuar-card-description">Ações mais frequentes da sua rotina.</p></div><div class="actuar-action-grid"><button onclick="navigateTo('newRequest')"><i class="fi fi-rr-star"></i>Registrar prioridade</button><button onclick="navigateTo({name:'newRequest',section:'transfer'})"><i class="fi fi-rr-exchange"></i>Registrar transferência</button><button onclick="navigateTo('requests')"><i class="fi fi-rr-document"></i>Acompanhar solicitações</button><button onclick="navigateTo('ledger')"><i class="fi fi-rr-receipt"></i>Ver extrato</button></div></section><section class="actuar-card"><div class="actuar-card-header"><h2 class="actuar-card-title">Últimas movimentações</h2></div>${requests.length ? `<div class="actuar-list">${requests.map(r => `<button onclick="navigateTo({name:'requests',section:'${r.id}'})"><span><strong>${escape(r.protocol)}</strong><small>${escape(r.client_name)} · ${fmtDate(r.updated_at)}</small></span>${statusBadge(r.status)}</button>`).join('')}</div>` : empty('Nenhuma solicitação', 'Você ainda não registrou solicitações neste ciclo.')}</section></div>`;
    }

    async function ruleFor(type) {
        const now = new Date().toISOString();
        const rules = await query('point_rules', '*,team:teams(name)', q => q.eq('request_type', type).eq('team_id', state.profile.primary_team_id).eq('active', true).lte('effective_from', now).order('version', { ascending: false }).limit(1));
        return rules[0];
    }

    async function renderNewRequest(section) {
        const type = section === 'transfer' ? 'transfer' : 'priority';
        const rule = await ruleFor(type);
        if (!rule) return feedback('error', 'Regra indisponível', 'Não existe regra vigente para este tipo e equipe. A solicitação não pode ser enviada sem uma regra versionada.');
        const specific = type === 'priority' ? `<div class="actuar-field"><label for="reqCategory">Categoria</label><input id="reqCategory" required></div><div class="actuar-field"><label for="reqReason">Motivo da prioridade</label><input id="reqReason" required></div><div class="actuar-field actuar-field-full"><label for="reqCriteria">Evidência dos critérios</label><textarea id="reqCriteria" required></textarea></div>` : `<div class="actuar-field"><label for="reqSource">Área de origem</label><input id="reqSource" required></div><div class="actuar-field"><label for="reqDestination">Área de destino</label><input id="reqDestination" required></div><div class="actuar-field actuar-field-full"><label for="reqReason">Motivo da transferência</label><textarea id="reqReason" required></textarea></div>`;
        return `<div class="actuar-segmented"><button class="${type === 'priority' ? 'is-active' : ''}" onclick="navigateTo('newRequest',{replace:true})">Prioridade</button><button class="${type === 'transfer' ? 'is-active' : ''}" onclick="navigateTo({name:'newRequest',section:'transfer'},{replace:true})">Transferência</button></div><form class="actuar-card actuar-request-form" onsubmit="return PerformancePlatform.createRequest(event,'${type}')"><div class="actuar-rule-preview"><i class="fi fi-rr-info"></i><div><strong>Regra v${rule.version} · ${escape(rule.team.name)}</strong><p>${escape(rule.criteria)}</p><span>Se aprovada, esta solicitação concederá <b>${fmtPoints(rule.points)}</b> no ciclo da data da ocorrência.</span></div></div><div class="actuar-form-grid"><div class="actuar-field"><label for="reqProtocol">Protocolo</label><input id="reqProtocol" required></div><div class="actuar-field"><label for="reqClient">Cliente</label><input id="reqClient" required></div><div class="actuar-field"><label for="reqOccurred">Data e hora da ocorrência</label><input id="reqOccurred" type="datetime-local" required></div><div class="actuar-field"><label for="reqEvidence">Evidências</label><input id="reqEvidence" type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain"><p class="actuar-field-help">Até 10 MB por arquivo.</p></div><div class="actuar-field actuar-field-full"><label for="reqDescription">Descrição do cenário</label><textarea id="reqDescription" required></textarea></div>${specific}<div class="actuar-field actuar-field-full"><label for="reqNote">Observação complementar</label><textarea id="reqNote"></textarea></div></div><div class="actuar-form-actions"><button type="button" class="actuar-btn actuar-btn-secondary" onclick="navigateBack()">Cancelar</button><button type="submit" class="actuar-btn actuar-btn-primary actuar-btn-lg"><i class="fi fi-rr-paper-plane"></i>Enviar para análise</button></div></form>`;
    }

    async function createRequest(event, type) {
        event.preventDefault();
        const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); submit.disabled = true;
        const occurred = document.getElementById('reqOccurred').value;
        const args = { p_type: type, p_protocol: document.getElementById('reqProtocol').value.trim(), p_client_name: document.getElementById('reqClient').value.trim(), p_occurred_at: new Date(occurred).toISOString(), p_description: document.getElementById('reqDescription').value.trim(), p_complementary_note: document.getElementById('reqNote').value.trim() || null, p_category: type === 'priority' ? document.getElementById('reqCategory').value.trim() : null, p_priority_reason: type === 'priority' ? document.getElementById('reqReason').value.trim() : null, p_criteria_evidence: type === 'priority' ? document.getElementById('reqCriteria').value.trim() : null, p_source_area: type === 'transfer' ? document.getElementById('reqSource').value.trim() : null, p_destination_area: type === 'transfer' ? document.getElementById('reqDestination').value.trim() : null, p_transfer_reason: type === 'transfer' ? document.getElementById('reqReason').value.trim() : null, p_submit: false };
        const { data: request, error } = await state.client.rpc('create_request', args);
        if (error) { submit.disabled = false; window.showToast?.(error.message, 'error'); return false; }
        const files = [...(document.getElementById('reqEvidence').files || [])];
        let uploadFailed = false;
        for (const file of files) {
            if (file.size > 10485760) { window.showToast?.(`${file.name} excede 10 MB. O rascunho foi preservado.`, 'error'); uploadFailed = true; break; }
            const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
            const path = `${state.profile.id}/${request.id}/${crypto.randomUUID()}-${safeName}`;
            const uploaded = await state.client.storage.from('request-evidences').upload(path, file, { contentType: file.type, upsert: false });
            if (uploaded.error) { window.showToast?.(`Falha ao enviar ${file.name}. O rascunho foi preservado.`, 'error'); uploadFailed = true; break; }
            const evidence = await state.client.from('request_evidences').insert({ request_id: request.id, storage_path: path, original_name: file.name, mime_type: file.type, size_bytes: file.size, uploaded_by: state.profile.id });
            if (evidence.error) { window.showToast?.(`Falha ao registrar ${file.name}. O rascunho foi preservado.`, 'error'); uploadFailed = true; break; }
        }
        if (uploadFailed) { submit.disabled = false; return false; }
        const submitted = await state.client.rpc('submit_request', { p_request_id: request.id });
        if (submitted.error) { submit.disabled = false; window.showToast?.(submitted.error.message, 'error'); return false; }
        window.showToast?.(request.duplicate_suspected ? 'Solicitação enviada com alerta de possível duplicidade.' : 'Solicitação enviada para análise.');
        window.navigateTo({ name: 'requests', section: request.id }, { replace: true });
        return false;
    }

    async function renderRequests(section) {
        if (section) return renderRequestDetail(section, false);
        const rows = await query('requests', 'id,created_at,request_type,protocol,client_name,status,expected_points,granted_points,decided_at,manager:users!requests_manager_id_fkey(display_name)', q => q.eq('analyst_id', state.profile.id).order('created_at', { ascending: false }));
        if (!rows.length) return empty('Nenhuma solicitação', 'Registre uma prioridade ou transferência para começar.', '<button class="actuar-btn actuar-btn-primary" onclick="navigateTo(\'newRequest\')">Nova solicitação</button>');
        const counts = ['pending_review','in_review','correction_requested','approved','not_approved'].map(status => ({ status, count: rows.filter(r => r.status === status).length }));
        return `<div class="actuar-counter-row">${counts.map(c => `<div><span>${statusBadge(c.status)}</span><strong>${c.count}</strong></div>`).join('')}</div>${requestFilters()}<div class="actuar-table-wrap"><table><thead><tr><th>Data</th><th>Tipo</th><th>Protocolo</th><th>Cliente</th><th>Status</th><th>Pontos</th><th>Analisado por</th><th>Decisão</th></tr></thead><tbody>${rows.map(r => `<tr tabindex="0" role="button" onclick="navigateTo({name:'requests',section:'${r.id}'})"><td>${fmtDate(r.created_at)}</td><td>${r.request_type === 'priority' ? 'Prioridade' : 'Transferência'}</td><td><strong>${escape(r.protocol)}</strong></td><td>${escape(r.client_name)}</td><td>${statusBadge(r.status)}</td><td class="num-mono">${fmtPoints(r.granted_points ?? r.expected_points)}</td><td>${escape(r.manager?.display_name || '—')}</td><td>${fmtDate(r.decided_at)}</td></tr>`).join('')}</tbody></table></div>`;
    }

    function requestFilters() {
        return `<div class="actuar-filter-panel"><div class="actuar-field"><label>Tipo</label><select><option>Todos</option><option>Prioridade</option><option>Transferência</option></select></div><div class="actuar-field"><label>Status</label><select><option>Todos</option>${Object.entries(D.statusLabels).map(([v,l]) => `<option value="${v}">${l}</option>`).join('')}</select></div><div class="actuar-field"><label>Protocolo ou cliente</label><input type="search" placeholder="Buscar na listagem"></div></div>`;
    }

    async function renderRequestDetail(id, approvalMode) {
        const rows = await query('requests', '*,analyst:users!requests_analyst_id_fkey(display_name,corporate_email,avatar_url),team:teams(name),manager:users!requests_manager_id_fkey(display_name),rule:point_rules(criteria,required_evidences),cycle:score_cycles(name,status)', q => q.eq('id', id).limit(1));
        const request = rows[0]; if (!request) return empty('Solicitação não encontrada', 'O registro não existe ou você não possui acesso.');
        const [events, decisions, evidences] = await Promise.all([
            query('request_events', '*', q => q.eq('request_id', id).order('created_at')),
            query('manager_decisions', '*,manager:users!manager_decisions_manager_id_fkey(display_name)', q => q.eq('request_id', id).order('created_at')),
            query('request_evidences', '*', q => q.eq('request_id', id).order('created_at'))
        ]);
        const details = `<dl class="actuar-detail-grid"><div><dt>Analista</dt><dd>${escape(request.analyst.display_name)}</dd></div><div><dt>Equipe</dt><dd>${escape(request.team.name)}</dd></div><div><dt>Tipo</dt><dd>${request.request_type === 'priority' ? 'Prioridade' : 'Transferência'}</dd></div><div><dt>Protocolo</dt><dd>${escape(request.protocol)}</dd></div><div><dt>Cliente</dt><dd>${escape(request.client_name)}</dd></div><div><dt>Ocorrência</dt><dd>${fmtDate(request.occurred_at)}</dd></div><div><dt>Ciclo</dt><dd>${escape(request.cycle.name)}</dd></div><div><dt>Regra aplicada</dt><dd>v${request.point_rule_version} · ${fmtPoints(request.expected_points)}</dd></div><div class="full"><dt>Descrição</dt><dd>${escape(request.description)}</dd></div>${request.duplicate_suspected ? `<div class="full">${feedback('warning','Possível duplicidade','Confira o protocolo e o histórico antes de decidir.')}</div>` : ''}</dl>`;
        const files = evidences.length ? `<div class="actuar-evidence-list">${evidences.map(e => `<button onclick="PerformancePlatform.openEvidence('${escape(e.storage_path)}')"><i class="fi fi-rr-clip"></i>${escape(e.original_name)}<small>${Math.ceil(e.size_bytes/1024)} KB</small></button>`).join('')}</div>` : '<p class="actuar-muted">Nenhuma evidência anexada.</p>';
        const timeline = events.map(e => `<li><span></span><div><strong>${escape(e.event_type.replaceAll('_',' '))}</strong><time>${fmtDate(e.created_at)}</time>${e.public_note ? `<p>${escape(e.public_note)}</p>` : ''}</div></li>`).join('');
        const decision = decisions.at(-1); const decisionBox = decision ? `<section class="actuar-card"><h2 class="actuar-card-title">Última decisão</h2><p><strong>${escape(decision.manager?.display_name || 'Gestão')}</strong> · ${fmtDate(decision.created_at)}</p><p>${escape(decision.standardized_reason || decision.explanation || 'Aprovada')}</p>${decision.analyst_guidance ? `<p>${escape(decision.analyst_guidance)}</p>` : ''}</section>` : '';
        const actions = approvalMode ? approvalActions(request) : correctionActions(request);
        return `${actions}<div class="actuar-two-column"><section class="actuar-card"><div class="actuar-card-header"><div class="actuar-title-row"><h2 class="actuar-card-title">Solicitação #${request.public_number}</h2>${statusBadge(request.status)}</div></div>${details}<h3>Evidências</h3>${files}</section><section class="actuar-card"><h2 class="actuar-card-title">Timeline completa</h2><ol class="actuar-timeline">${timeline}</ol></section></div>${decisionBox}`;
    }

    function correctionActions(request) {
        if (request.status !== 'correction_requested') return '';
        return `<section class="actuar-callout actuar-callout-warning"><div><strong>Esta solicitação precisa de correção</strong><p>Campos liberados: ${escape(request.editable_fields.join(', '))}</p></div><button class="actuar-btn actuar-btn-primary" onclick="PerformancePlatform.correctRequest('${request.id}',${JSON.stringify(request.editable_fields).replaceAll('"','&quot;')})">Corrigir e reenviar</button></section>`;
    }

    function approvalActions(request) {
        if (request.status === 'approved' && roleCode() === 'administrator') return `<div class="actuar-page-actionbar"><button class="actuar-btn actuar-btn-danger" onclick="PerformancePlatform.cancelApproved('${request.id}')">Cancelar com estorno</button></div>`;
        if (['pending_review','resubmitted'].includes(request.status)) return `<div class="actuar-page-actionbar"><button class="actuar-btn actuar-btn-primary" onclick="PerformancePlatform.beginReview('${request.id}')">Iniciar análise</button></div>`;
        if (request.status !== 'in_review') return '';
        return `<section class="actuar-card actuar-decision-panel"><h2 class="actuar-card-title">Decisão da gestão</h2><div class="actuar-field"><label for="decisionComment">Comentário ou explicação</label><textarea id="decisionComment"></textarea></div><div class="actuar-field"><label for="decisionReason">Motivo para não aprovação</label><select id="decisionReason"><option value="">Selecione</option><option>Protocolo não localizado</option><option>Critério de pontuação não atendido</option><option>Evidência insuficiente</option><option>Solicitação duplicada</option><option>Informações inconsistentes</option><option>Ocorrência fora do prazo</option><option>Analista ou equipe incorretos</option><option>Atendimento não elegível</option><option>Outro motivo</option></select></div><div class="actuar-decision-actions"><button class="actuar-btn actuar-btn-secondary" onclick="PerformancePlatform.requestCorrection('${request.id}')">Solicitar correção</button><button class="actuar-btn actuar-btn-danger" onclick="PerformancePlatform.notApprove('${request.id}')">Não aprovar</button><button class="actuar-btn actuar-btn-primary" onclick="PerformancePlatform.approve('${request.id}')">Aprovar ${fmtPoints(request.expected_points)}</button></div></section>`;
    }

    async function renderLedger() {
        const rows = await query('point_ledger', '*,cycle:score_cycles(name),rule:point_rules(request_type),manager:users!point_ledger_manager_id_fkey(display_name),request:requests(protocol)', q => q.eq('analyst_id', state.profile.id).order('created_at', { ascending: false }));
        const total = D.summarizeLedger(rows.filter(r => r.valid));
        return `${kpi('Saldo confirmado',fmtPoints(total),'receipt','success')}<div class="actuar-table-wrap"><table><thead><tr><th>Data</th><th>Movimento</th><th>Origem</th><th>Ciclo</th><th>Regra</th><th>Responsável</th><th>Quantidade</th></tr></thead><tbody>${rows.map(r => `<tr><td>${fmtDate(r.created_at)}</td><td>${escape(r.movement_type.replaceAll('_',' '))}</td><td>${escape(r.request?.protocol || r.reason || 'Ajuste administrativo')}</td><td>${escape(r.cycle.name)}</td><td>${escape(r.rule?.request_type || `v${r.point_rule_version || '—'}`)}</td><td>${escape(r.manager?.display_name || 'Sistema')}</td><td class="num-mono ${r.quantity < 0 ? 'text-red-400' : 'text-emerald-400'}">${r.quantity > 0 ? '+' : ''}${fmtPoints(r.quantity)}</td></tr>`).join('') || `<tr><td colspan="7">Nenhuma movimentação confirmada.</td></tr>`}</tbody></table></div>`;
    }

    async function renderApprovals(section) {
        if (section) return renderRequestDetail(section, true);
        const rows = await query('requests', 'id,submitted_at,request_type,protocol,client_name,status,expected_points,duplicate_suspected,analyst:users!requests_analyst_id_fkey(display_name),team:teams(name),cycle:score_cycles(name)', q => q.in('team_id', state.managedTeamIds.length ? state.managedTeamIds : ['00000000-0000-0000-0000-000000000000']).order('submitted_at', { ascending: true }));
        const waiting = rows.filter(r => ['pending_review','resubmitted'].includes(r.status)).length;
        const review = rows.filter(r => r.status === 'in_review').length;
        const approved = rows.filter(r => r.status === 'approved').length;
        const denied = rows.filter(r => r.status === 'not_approved').length;
        return `<div class="actuar-kpi-grid">${kpi('Aguardando análise',waiting,'clock','warning')}${kpi('Em análise',review,'search','primary')}${kpi('Aprovadas no período',approved,'check-circle','success')}${kpi('Não aprovadas',denied,'cross-circle','danger')}</div>${requestFilters()}<div class="actuar-table-wrap"><table><thead><tr><th>Envio</th><th>Analista</th><th>Equipe</th><th>Tipo</th><th>Protocolo</th><th>Cliente</th><th>Status</th><th>Pontos</th><th>Duplicidade</th></tr></thead><tbody>${rows.map(r => `<tr tabindex="0" role="button" onclick="navigateTo({name:'approvals',section:'${r.id}'})"><td>${fmtDate(r.submitted_at)}</td><td><strong>${escape(r.analyst.display_name)}</strong></td><td>${escape(r.team.name)}</td><td>${r.request_type === 'priority' ? 'Prioridade' : 'Transferência'}</td><td>${escape(r.protocol)}</td><td>${escape(r.client_name)}</td><td>${statusBadge(r.status)}</td><td>${fmtPoints(r.expected_points)}</td><td>${r.duplicate_suspected ? '<span class="actuar-badge actuar-badge-warning">Verificar</span>' : '—'}</td></tr>`).join('') || `<tr><td colspan="9">Nenhuma solicitação dentro do seu escopo.</td></tr>`}</tbody></table></div>`;
    }

    async function beginReview(id) { const { error } = await state.client.rpc('begin_request_review',{p_request_id:id}); if(error) window.showToast?.(error.message,'error'); else { window.showToast?.('Análise iniciada.'); renderCurrentRoute(currentRoute()); } }
    async function approve(id) { if(!confirm('Confirmar a aprovação e o crédito de pontos?')) return; const comment=document.getElementById('decisionComment')?.value.trim()||null; const {error}=await state.client.rpc('approve_request',{p_request_id:id,p_comment:comment}); if(error) window.showToast?.(error.message,'error'); else {window.showToast?.('Solicitação aprovada e pontos creditados.');renderCurrentRoute(currentRoute());} }
    async function requestCorrection(id) { const text=document.getElementById('decisionComment')?.value.trim(); if(!text){window.showToast?.('Descreva claramente o que deve ser corrigido.','error');return;} const fields=prompt('Campos liberados, separados por vírgula:','description,complementary_note,criteria_evidence'); if(!fields)return; const {error}=await state.client.rpc('request_correction',{p_request_id:id,p_explanation:text,p_allowed_fields:fields.split(',').map(v=>v.trim()).filter(Boolean)}); if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Correção solicitada.');renderCurrentRoute(currentRoute());} }
    async function notApprove(id) { const reason=document.getElementById('decisionReason')?.value; const explanation=document.getElementById('decisionComment')?.value.trim(); if(!reason||!explanation){window.showToast?.('Selecione o motivo e informe a explicação.','error');return;} if(!confirm('Confirmar que esta solicitação não será aprovada?'))return; const {error}=await state.client.rpc('not_approve_request',{p_request_id:id,p_reason:reason,p_explanation:explanation,p_guidance:explanation});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Decisão registrada sem concessão de pontos.');renderCurrentRoute(currentRoute());} }
    async function correctRequest(id, fields) { const patch={}; for(const field of fields){const value=prompt(`Novo valor para ${field}:`);if(value!==null)patch[field]=value;} if(!Object.keys(patch).length)return; const {error}=await state.client.rpc('resubmit_request',{p_request_id:id,p_patch:patch,p_note:'Correções realizadas pelo analista'});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Solicitação corrigida e reenviada.');renderCurrentRoute(currentRoute());} }
    async function cancelApproved(id){const reason=prompt('Justificativa obrigatória para o cancelamento e estorno:');if(!reason)return;if(!confirm('O crédito original será preservado e um estorno será lançado. Continuar?'))return;const{error}=await state.client.rpc('cancel_approved_request',{p_request_id:id,p_reason:reason});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Solicitação cancelada e estorno registrado.');renderCurrentRoute(currentRoute());}}

    async function openEvidence(path) { const {data,error}=await state.client.storage.from('request-evidences').createSignedUrl(path,60);if(error)window.showToast?.(error.message,'error');else window.open(data.signedUrl,'_blank','noopener'); }

    async function renderTeam() {
        const teamIds = roleCode() === 'administrator' ? undefined : state.managedTeamIds;
        let q = state.client.from('users').select('id,display_name,corporate_email,job_title,status,last_access_at,team:teams!users_primary_team_id_fkey(name),manager:users!users_responsible_manager_id_fkey(display_name)').order('display_name');
        if (teamIds) q = q.in('primary_team_id', teamIds.length ? teamIds : ['00000000-0000-0000-0000-000000000000']);
        const {data,error}=await q;if(error)throw error;
        return `<div class="actuar-table-wrap"><table><thead><tr><th>Analista</th><th>E-mail</th><th>Cargo</th><th>Equipe</th><th>Gestor</th><th>Status</th><th>Último acesso</th></tr></thead><tbody>${data.map(u=>`<tr><td><strong>${escape(u.display_name)}</strong></td><td>${escape(u.corporate_email||'E-mail pendente')}</td><td>${escape(u.job_title||'—')}</td><td>${escape(u.team?.name||'—')}</td><td>${escape(u.manager?.display_name||'—')}</td><td><span class="actuar-badge actuar-badge-${u.status==='active'?'success':'warning'}">${escape(u.status)}</span></td><td>${fmtDate(u.last_access_at)}</td></tr>`).join('')}</tbody></table></div>`;
    }

    async function renderUsersTeams() {
        const [users,teams,roles]=await Promise.all([query('users','id,auth_user_id,display_name,corporate_email,status,legacy_user_key,team:teams!users_primary_team_id_fkey(name),role:roles(name,code)',q=>q.order('display_name')),query('teams','*',q=>q.order('name')),query('roles','*',q=>q.order('name'))]);
        return `<div class="actuar-page-actionbar"><button class="actuar-btn actuar-btn-primary" onclick="PerformancePlatform.inviteUser()"><i class="fi fi-rr-user-add"></i>Convidar novo usuário</button></div><div class="actuar-two-column"><section class="actuar-card"><h2 class="actuar-card-title">Usuários</h2><div class="actuar-list">${users.map(u=>`<div><span><strong>${escape(u.display_name)}</strong><small>${escape(u.corporate_email||'E-mail pendente')} · ${escape(u.team?.name||'Sem equipe')}</small></span><span class="actuar-inline-actions"><span class="actuar-badge actuar-badge-${u.status==='active'?'success':'warning'}">${escape(u.role.name)} · ${escape(u.status)}</span>${!u.auth_user_id&&u.legacy_user_key?`<button class="actuar-btn actuar-btn-primary actuar-btn-sm" onclick="PerformancePlatform.inviteUser('${escape(u.legacy_user_key)}')">Ativar acesso</button>`:''}<button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="PerformancePlatform.adjustPoints('${u.id}')">Ajustar pontos</button><button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="PerformancePlatform.editUser('${u.id}')">Editar</button></span></div>`).join('')}</div></section><section class="actuar-card"><h2 class="actuar-card-title">Equipes</h2><div class="actuar-list">${teams.map(t=>`<div><span><strong>${escape(t.name)}</strong><small>${escape(t.code)}</small></span><span class="actuar-badge actuar-badge-${t.active?'success':'danger'}">${t.active?'Ativa':'Inativa'}</span></div>`).join('')}</div><p class="actuar-field-help">As fichas do ranking legado são importadas com nome, foto, função e equipe. Ao ativar o acesso, o login é vinculado à mesma ficha e ao histórico existente.</p></section></div>`;
    }

    async function inviteUser(legacyUserKey = '') {
        let legacyProfile = null;
        if (legacyUserKey) {
            const profiles = await query('users','first_name,last_name,display_name',q=>q.eq('legacy_user_key',legacyUserKey).limit(1));
            legacyProfile = profiles[0] || null;
            if (!legacyProfile) { window.showToast?.('Ficha legada não encontrada.','error'); return; }
        }
        const email=prompt('E-mail corporativo do novo usuário:');if(!email)return;
        const firstName=legacyProfile?.first_name||prompt('Nome:');if(!firstName)return;
        const lastName=legacyProfile?.last_name||(!legacyUserKey?prompt('Sobrenome (opcional):',''):null);
        const {data,error}=await state.client.functions.invoke('invite-performance-user',{body:{email,first_name:firstName,last_name:lastName||undefined,legacy_user_key:legacyUserKey||undefined}});
        if(error)window.showToast?.(error.message,'error');else{window.showToast?.(legacyUserKey?'Convite enviado e vinculado à ficha histórica.':'Convite enviado e perfil criado.');renderCurrentRoute(currentRoute());}
    }

    async function editUser(id) {
        const users=await query('users','id,status,job_title,primary_team_id,responsible_manager_id,role:roles(code)',q=>q.eq('id',id).limit(1));
        const user=users[0];if(!user)return;
        const status=prompt('Status: invited, active, blocked ou inactive',user.status);if(!status)return;
        const role=prompt('Perfil: analyst, manager ou administrator',user.role.code);if(!role)return;
        const teamCode=prompt('Equipe: Sistema, Catraca ou vazio para nenhuma','');
        let teamId=user.primary_team_id;
        if(teamCode!==null){if(!teamCode.trim())teamId=null;else{const teams=await query('teams','id',q=>q.eq('code',teamCode.trim()).limit(1));if(!teams[0]){window.showToast?.('Equipe não encontrada.','error');return;}teamId=teams[0].id;}}
        const {error}=await state.client.rpc('admin_update_user',{p_user_id:id,p_status:status,p_role_code:role,p_team_id:teamId,p_manager_id:user.responsible_manager_id,p_job_title:user.job_title});
        if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Usuário atualizado com histórico preservado.');renderCurrentRoute(currentRoute());}
    }

    async function adjustPoints(analystId){const cycles=await query('score_cycles','id,name',q=>q.order('starts_on',{ascending:false}).limit(1));if(!cycles[0]){window.showToast?.('Nenhum ciclo disponível.','error');return;}const quantity=Number(prompt(`Quantidade do ajuste em ${cycles[0].name} (use negativo para débito):`));if(!quantity)return;const reason=prompt('Justificativa obrigatória:');if(!reason)return;const{error}=await state.client.rpc('admin_adjust_points',{p_analyst_id:analystId,p_cycle_id:cycles[0].id,p_quantity:quantity,p_reason:reason});if(error)window.showToast?.(error.message,'error');else window.showToast?.('Ajuste registrado no extrato e na auditoria.');}

    async function renderRules() {
        const rules=await query('point_rules','*,team:teams(name),cycle:score_cycles(name),creator:users!point_rules_created_by_fkey(display_name)',q=>q.order('effective_from',{ascending:false}));
        return `${roleCode()==='administrator'?'<div class="actuar-page-actionbar"><button class="actuar-btn actuar-btn-primary" onclick="PerformancePlatform.createRule()">Nova versão de regra</button></div>':''}<div class="actuar-table-wrap"><table><thead><tr><th>Tipo</th><th>Equipe</th><th>Versão</th><th>Pontos</th><th>Critérios</th><th>Vigência</th><th>Status</th></tr></thead><tbody>${rules.map(r=>`<tr><td>${r.request_type==='priority'?'Prioridade':'Transferência'}</td><td>${escape(r.team.name)}</td><td>v${r.version}</td><td class="num-mono">${fmtPoints(r.points)}</td><td>${escape(r.criteria)}</td><td>${fmtDate(r.effective_from)}</td><td><span class="actuar-badge actuar-badge-${r.active?'success':'danger'}">${r.active?'Ativa':'Inativa'}</span></td></tr>`).join('')}</tbody></table></div>`;
    }
    async function createRule(){const type=prompt('Tipo: priority ou transfer','priority');if(!['priority','transfer'].includes(type))return;const teamCode=prompt('Equipe: Sistema ou Catraca','Sistema');if(!teamCode)return;const teams=await query('teams','id',q=>q.eq('code',teamCode).limit(1));if(!teams[0]){window.showToast?.('Equipe inválida.','error');return;}const points=Number(prompt('Quantidade de pontos:'));if(points<0||Number.isNaN(points))return;const criteria=prompt('Critérios completos da nova versão:');if(!criteria)return;const{error}=await state.client.rpc('admin_create_point_rule',{p_type:type,p_team_id:teams[0].id,p_points:points,p_criteria:criteria,p_effective_from:new Date().toISOString(),p_required_evidences:[],p_review_sla_hours:48});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Nova versão de regra criada sem alterar o histórico.');renderCurrentRoute(currentRoute());}}

    async function renderCycles() {
        const cycles=await query('score_cycles','*,closer:users!score_cycles_closed_by_fkey(display_name)',q=>q.order('starts_on',{ascending:false}));
        return `<div class="actuar-page-actionbar"><button class="actuar-btn actuar-btn-primary" onclick="PerformancePlatform.createCycle()">Novo ciclo</button></div><div class="actuar-table-wrap"><table><thead><tr><th>Ciclo</th><th>Início</th><th>Fim</th><th>Prazo de análise</th><th>Status</th><th>Fechado por</th><th>Ações</th></tr></thead><tbody>${cycles.map(c=>`<tr><td><strong>${escape(c.name)}</strong></td><td>${fmtDate(c.starts_on)}</td><td>${fmtDate(c.ends_on)}</td><td>${fmtDate(c.review_deadline)}</td><td><span class="actuar-badge actuar-badge-${c.status==='closed'?'success':c.status==='review'?'warning':'primary'}">${c.status}</span></td><td>${escape(c.closer?.display_name||'—')}</td><td><span class="actuar-inline-actions">${c.status==='open'?`<button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="PerformancePlatform.reviewCycle('${c.id}')">Iniciar conferência</button>`:''}${c.status!=='closed'?`<button class="actuar-btn actuar-btn-secondary actuar-btn-sm" onclick="PerformancePlatform.closeCycle('${c.id}')">Fechar ciclo</button>`:'Ranking oficial salvo'}</span></td></tr>`).join('')}</tbody></table></div>`;
    }
    async function createCycle(){const code=prompt('Código do ciclo (AAAA-MM):');if(!code)return;const name=prompt('Nome do ciclo:');if(!name)return;const start=prompt('Data inicial (AAAA-MM-DD):');const end=prompt('Data final (AAAA-MM-DD):');if(!start||!end)return;const{error}=await state.client.rpc('admin_create_cycle',{p_code:code,p_name:name,p_starts_on:start,p_ends_on:end,p_submission_deadline:`${end}T23:59:59-03:00`,p_review_deadline:`${end}T23:59:59-03:00`});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Ciclo criado.');renderCurrentRoute(currentRoute());}}
    async function reviewCycle(id){if(!confirm('Bloquear novas solicitações e iniciar a conferência?'))return;const{error}=await state.client.rpc('admin_set_cycle_review',{p_cycle_id:id});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Ciclo em conferência.');renderCurrentRoute(currentRoute());}}
    async function closeCycle(id){if(!confirm('Fechar o ciclo congela a pontuação e salva o ranking oficial. Continuar?'))return;const{error}=await state.client.rpc('close_score_cycle',{p_cycle_id:id});if(error)window.showToast?.(error.message,'error');else{window.showToast?.('Ciclo fechado com classificação oficial.');renderCurrentRoute(currentRoute());}}

    async function renderAudit() {
        const logs=await query('audit_logs','*,actor:users!audit_logs_actor_id_fkey(display_name)',q=>q.order('created_at',{ascending:false}).limit(200));
        return `<div class="actuar-table-wrap"><table><thead><tr><th>Data</th><th>Responsável</th><th>Perfil</th><th>Ação</th><th>Entidade</th><th>Contexto</th></tr></thead><tbody>${logs.map(l=>`<tr><td>${fmtDate(l.created_at)}</td><td>${escape(l.actor?.display_name||'Sistema')}</td><td>${escape(l.actor_role||'—')}</td><td><strong>${escape(l.action)}</strong></td><td>${escape(l.entity_type)}<small>${escape(l.entity_id||'')}</small></td><td><code>${escape(JSON.stringify(l.context||{}))}</code></td></tr>`).join('')}</tbody></table></div>`;
    }

    async function renderNotifications() {
        const notes=await query('notifications','*',q=>q.eq('user_id',state.profile.id).order('created_at',{ascending:false}));
        return notes.length?`<div class="actuar-notifications">${notes.map(n=>`<button class="${n.read_at?'is-read':''}" onclick="PerformancePlatform.openNotification('${n.id}','${escape(n.link||'')}')"><span><i class="fi fi-rr-bell"></i></span><div><strong>${escape(n.title)}</strong><p>${escape(n.message)}</p><time>${fmtDate(n.created_at)}</time></div>${n.read_at?'':'<b>Nova</b>'}</button>`).join('')}</div>`:empty('Tudo em dia','Você não possui notificações.');
    }
    async function openNotification(id,link){await state.client.from('notifications').update({read_at:new Date().toISOString()}).eq('id',id);if(link&&link.startsWith('#/'))location.hash=link;else renderCurrentRoute(currentRoute());}

    async function renderProfile() {
        const p=state.profile;
        return `<form class="actuar-card actuar-profile-secure" onsubmit="return PerformancePlatform.saveProfile(event)"><div class="actuar-profile-identification"><span class="actuar-avatar">${p.avatar_url?`<img src="${escape(p.avatar_url)}" alt="">`:escape((p.first_name?.[0]||'')+(p.last_name?.[0]||''))}</span><div><h3>${escape(p.display_name)}</h3><p>${escape(p.job_title||p.role.name)} · ${escape(p.team?.name||'Sem equipe')}</p></div></div><div class="actuar-form-grid"><div class="actuar-field"><label>Nome</label><input value="${escape(p.first_name)}" disabled></div><div class="actuar-field"><label>Sobrenome</label><input value="${escape(p.last_name||'')}" disabled></div><div class="actuar-field"><label>E-mail</label><input value="${escape(p.corporate_email||'E-mail pendente')}" disabled></div><div class="actuar-field"><label>Função</label><input value="${escape(p.job_title||p.role.name)}" disabled></div><div class="actuar-field"><label>Perfil de acesso</label><input value="${escape(p.role.name)}" disabled></div><div class="actuar-field"><label for="securePhone">Telefone</label><input id="securePhone" value="${escape(p.phone||'')}"></div><div class="actuar-field"><label for="secureAvatar">URL da foto</label><input id="secureAvatar" type="url" value="${escape(p.avatar_url||'')}"></div></div><div class="actuar-form-actions"><button type="button" class="actuar-btn actuar-btn-secondary" onclick="PerformancePlatform.sendPasswordChange()">Alterar senha</button><button class="actuar-btn actuar-btn-primary" type="submit">Salvar alterações</button></div></form>`;
    }
    async function saveProfile(event){event.preventDefault();const updates={phone:document.getElementById('securePhone').value.trim()||null,avatar_url:document.getElementById('secureAvatar').value.trim()||null,updated_at:new Date().toISOString()};const{error}=await state.client.from('users').update(updates).eq('id',state.profile.id);if(error)window.showToast?.(error.message,'error');else{Object.assign(state.profile,updates);overrideLegacyProfileActions();window.showToast?.('Perfil atualizado.');}return false;}
    async function sendPasswordChange(){const password=prompt('Informe a nova senha (mínimo de 8 caracteres):');if(!password)return;if(password.length<8){window.showToast?.('Use ao menos 8 caracteres.','error');return;}const{error}=await state.client.auth.updateUser({password});window.showToast?.(error?error.message:'Senha alterada com sucesso.',error?'error':'success');}

    window.PerformancePlatform = { init, login, requestPasswordReset, continueAsGuest, signOut, showLogin: showAuth, authenticationEnabled: () => authenticationEnabled, isSecureRoute, guardRoute, canSelectLegacyAnalyst, renderCurrentRoute, createRequest, openEvidence, beginReview, approve, requestCorrection, notApprove, correctRequest, cancelApproved, inviteUser, editUser, adjustPoints, createRule, createCycle, reviewCycle, closeCycle, openNotification, saveProfile, sendPasswordChange, renderDashboardSummary, isAuthenticated, refreshNavigation: renderNavigation };
})();
