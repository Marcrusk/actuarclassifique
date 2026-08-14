(function (root, factory) {
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ActaskAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
    'use strict';

    const STAGE_ISSUER = 'https://actaskapistage.bluefronte.com';
    const MAIN_ISSUER = 'https://actaskapi.bluefronte.com';
    const PUBLIC_AUDIENCE = 'actask-public-api';
    const SESSION_KEY = 'actuar-classifique-actask-session-v1';
    const DIRECTORY_SESSION_KEY = 'actuar-classifique-actask-directory-session-v1';
    const DEFAULT_SCOPES = ['openid', 'profile'];
    const PIECES_ROLES = new Set(['Envio/Coleta', 'Faturamento', 'Expedição', 'Logística/Faturamento', 'Toletus Lab']);
    const ROLE_PRIORITY = [
        'Gestor Adm',
        'Logística/Faturamento',
        'Faturamento',
        'Expedição',
        'Envio/Coleta',
        'Toletus Lab',
        'Analista de sistema',
        'Analista de catraca'
    ];
    const ROLE_ALIASES = new Map([
        ['analista_de_sistema', 'Analista de sistema'],
        ['analista_sistema', 'Analista de sistema'],
        ['analista_de_catraca', 'Analista de catraca'],
        ['analista_catraca', 'Analista de catraca'],
        ['toletus_lab', 'Toletus Lab'],
        ['envio_coleta', 'Envio/Coleta'],
        ['faturamento', 'Faturamento'],
        ['expedicao', 'Expedição'],
        ['logistica_faturamento', 'Logística/Faturamento'],
        ['gestor_adm', 'Gestor Adm'],
        ['gestao_adm', 'Gestor Adm']
    ]);
    const CATEGORY_ROLE_IDS = new Set(['analista', 'gestao', 'operacional']);

    class ActaskAuthError extends Error {
        constructor(message, code = 'actask_auth_error', status = 0) {
            super(message);
            this.name = 'ActaskAuthError';
            this.code = code;
            this.status = status;
        }
    }

    function getStorage() {
        try { return root.sessionStorage || null; } catch (_) { return null; }
    }

    function readStoredSession() {
        const storage = getStorage();
        if (!storage) return null;
        try {
            const value = storage.getItem(SESSION_KEY);
            return value ? JSON.parse(value) : null;
        } catch (_) {
            return null;
        }
    }

    function writeStoredSession(session) {
        const storage = getStorage();
        if (!storage) return;
        try { storage.setItem(SESSION_KEY, JSON.stringify(session)); } catch (_) { /* sessão local indisponível */ }
    }

    function clearStoredSession() {
        const storage = getStorage();
        if (!storage) return;
        try { storage.removeItem(SESSION_KEY); } catch (_) { /* nada a limpar */ }
    }

    function readStoredDirectorySession() {
        const storage = getStorage();
        if (!storage) return null;
        try {
            const value = storage.getItem(DIRECTORY_SESSION_KEY);
            return value ? JSON.parse(value) : null;
        } catch (_) {
            return null;
        }
    }

    function writeStoredDirectorySession(session) {
        const storage = getStorage();
        if (!storage) return;
        try { storage.setItem(DIRECTORY_SESSION_KEY, JSON.stringify(session)); } catch (_) { /* sessão local indisponível */ }
    }

    function clearStoredDirectorySession() {
        const storage = getStorage();
        if (!storage) return;
        try { storage.removeItem(DIRECTORY_SESSION_KEY); } catch (_) { /* nada a limpar */ }
    }

    function normalizeIssuer(value) {
        return String(value || '').trim().replace(/\/$/, '');
    }

    function currentRedirectUri() {
        if (root.ACTASK_AUTH_REDIRECT_URI) return String(root.ACTASK_AUTH_REDIRECT_URI);
        if (!root.location) return '';
        return `${root.location.origin}${root.location.pathname}`;
    }

    function getConfig() {
        const supplied = root.ACTASK_AUTH_CONFIG && typeof root.ACTASK_AUTH_CONFIG === 'object'
            ? root.ACTASK_AUTH_CONFIG
            : {};
        const environment = supplied.environment || root.ACTASK_AUTH_ENV || 'stage';
        const issuer = normalizeIssuer(supplied.issuer || root.ACTASK_AUTH_ISSUER || (environment === 'main' ? MAIN_ISSUER : STAGE_ISSUER));
        const clientId = String(supplied.clientId || root.ACTASK_AUTH_CLIENT_ID || (environment === 'main' ? 'actuar-classifique-main-login' : '')).trim();
        const scopes = Array.isArray(supplied.scopes)
            ? supplied.scopes.filter(Boolean)
            : String(supplied.scopes || root.ACTASK_AUTH_SCOPES || DEFAULT_SCOPES.join(' ')).split(/\s+/).filter(Boolean);
        const audience = String(supplied.audience || root.ACTASK_AUTH_AUDIENCE || PUBLIC_AUDIENCE).trim();
        const redirectUri = String(supplied.redirectUri || currentRedirectUri()).trim();
        return {
            enabled: supplied.enabled !== false && root.ACTASK_AUTH_ENABLED !== false,
            environment,
            issuer,
            clientId,
            audience,
            scopes: [...new Set(scopes)],
            redirectUri,
            loginOptionsEndpoint: supplied.loginOptionsEndpoint || `${issuer}/auth/login-options`,
            selectedLoginEndpoint: supplied.selectedLoginEndpoint || `${issuer}/auth/login-selected`,
            selectedExternalLoginEndpoint: supplied.selectedExternalLoginEndpoint || `${issuer}/auth/login-selected-external`,
            meEndpoint: supplied.meEndpoint || `${issuer}/auth/me`,
            logoutEndpoint: supplied.logoutEndpoint || `${issuer}/auth/logout`,
            loginEndpoint: supplied.loginEndpoint || `${issuer}/oauth/login`,
            tokenEndpoint: supplied.tokenEndpoint || `${issuer}/oauth/token`,
            userinfoEndpoint: supplied.userinfoEndpoint || `${issuer}/oauth/userinfo`,
            revokeEndpoint: supplied.revokeEndpoint || `${issuer}/oauth/revoke`
        };
    }

    function isConfigured() {
        const config = getConfig();
        return Boolean(config.enabled && config.issuer && config.clientId && config.redirectUri);
    }

    function isDirectoryConfigured() {
        const config = getConfig();
        return Boolean(config.enabled && config.issuer && config.loginOptionsEndpoint);
    }

    function configurationError() {
        return new ActaskAuthError(
            'O login do Actask ainda não foi configurado para este ambiente.',
            'actask_not_configured'
        );
    }

    function responseError(payload, response) {
        const code = payload?.error || payload?.code || 'actask_request_failed';
        const status = response?.status || 0;
        const genericCredentialError = code === 'invalid_grant' || status === 400 || status === 401;
        const message = genericCredentialError
            ? 'E-mail ou senha inválidos.'
            : (payload?.error_description || payload?.detail || 'Não foi possível concluir o login no Actask.');
        return new ActaskAuthError(message, code, status);
    }

    async function parseResponse(response) {
        let payload = null;
        try { payload = await response.json(); } catch (_) { payload = {}; }
        if (!response.ok) throw responseError(payload, response);
        return payload;
    }

    function requireFetch() {
        if (typeof root.fetch !== 'function') throw new ActaskAuthError('A integração do Actask não encontrou o recurso de rede do navegador.', 'fetch_unavailable');
        return root.fetch.bind(root);
    }

    function normalizeText(value) {
        return String(value || '')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .trim()
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_|_$/g, '');
    }

    function normalizeRole(value) {
        const raw = typeof value === 'object' && value !== null
            ? (value.name || value.code || value.key || value.id)
            : value;
        const normalized = normalizeText(raw);
        if (!normalized || CATEGORY_ROLE_IDS.has(normalized)) return null;
        return ROLE_ALIASES.get(normalized) || null;
    }

    function unique(values) {
        return [...new Set((values || []).filter(Boolean))];
    }

    function rawTeamRoles(team) {
        const values = team?.functional_roles || team?.functionalRoles || team?.roles || [];
        if (Array.isArray(values)) return values;
        return values ? [values] : [];
    }

    function normalizeLoginOptionUser(user) {
        if (!user || typeof user !== 'object') return null;
        const functionalRoles = unique(
            (user.functional_roles || user.functionalRoles || user.roles || [])
                .map(normalizeRole)
        );
        const id = String(user.id || user.user_id || '').trim();
        const name = String(user.name || '').trim();
        if (!id || !name) return null;
        return {
            id,
            name,
            initials: String(user.initials || '').trim(),
            membershipRole: user.role || user.membership_role || 'member',
            functionalRoles,
            hasPassword: user.has_password !== false && user.hasPassword !== false
        };
    }

    function normalizeLoginOptions(payload) {
        const source = Array.isArray(payload) ? payload : payload?.teams;
        if (!Array.isArray(source)) return [];
        return source.map((team, index) => {
            if (!team || typeof team !== 'object') return null;
            const users = (Array.isArray(team.users) ? team.users : [])
                .map(normalizeLoginOptionUser)
                .filter(Boolean);
            const id = team.id === null || team.id === undefined ? null : String(team.id);
            const name = String(team.name || team.code || team.id || `Equipe ${index + 1}`).trim();
            return {
                id,
                name,
                code: String(team.code || '').trim(),
                color: team.color || '',
                teamType: team.team_type || team.teamType || 'none',
                loginTarget: team.login_target || team.loginTarget || 'external',
                functionalRoles: unique(rawTeamRoles(team).map(normalizeRole)),
                users
            };
        }).filter(team => team && team.users.length);
    }

    function normalizeTeam(team, index) {
        if (!team || typeof team !== 'object') return null;
        const functionalRoles = unique(rawTeamRoles(team).map(normalizeRole));
        const name = String(team.name || team.code || team.id || '').trim();
        if (!name && !functionalRoles.length) return null;
        return {
            id: team.id || null,
            name,
            code: String(team.code || '').trim(),
            color: team.color || '',
            teamType: team.team_type || team.teamType || 'none',
            membershipRole: team.role || team.membership_role || 'member',
            isPrimary: team.is_primary === true || team.isPrimary === true || index === 0,
            functionalRoles
        };
    }

    function preferredRole(roles) {
        return ROLE_PRIORITY.find(role => roles.includes(role)) || roles[0] || '';
    }

    function sameTeamId(left, right) {
        if (left === null || left === undefined) return right === null || right === undefined;
        if (right === null || right === undefined) return false;
        return String(left) === String(right);
    }

    function modeForUser(user) {
        if (!user) return null;
        if (user.roles?.includes('Gestor Adm') || user.role === 'Gestor Adm') return 'manager';
        if (user.roles?.some(role => PIECES_ROLES.has(role)) || PIECES_ROLES.has(user.role)) return 'operations';
        const teamType = user.teamType || user.teams?.find(team => team.isPrimary)?.teamType;
        if (teamType === 'management') return 'manager';
        if (teamType === 'operational') return 'operations';
        if (teamType === 'analyst') return 'analyst';
        if (user.roles?.length || user.role) return 'analyst';
        return null;
    }

    function normalizeUser(claims) {
        const rawTeams = Array.isArray(claims?.teams) ? claims.teams : [];
        const teams = rawTeams.map(normalizeTeam).filter(Boolean);
        const roles = unique(teams.flatMap(team => team.functionalRoles));
        const primaryTeam = teams.find(team => team.isPrimary) || teams[0] || null;
        const managerTeams = teams
            .filter(team => team.membershipRole === 'manager' || team.functionalRoles.includes('Gestor Adm'))
            .map(team => team.name)
            .filter(Boolean);
        const name = String(claims?.name || claims?.preferred_username || claims?.email || '').trim();
        const initial = name.split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase();
        const user = {
            id: String(claims?.sub || '').trim(),
            actaskId: String(claims?.sub || '').trim(),
            name,
            email: String(claims?.email || '').trim(),
            photo: claims?.picture || claims?.avatar_url || '',
            initial,
            active: claims?.active !== false,
            teams,
            roles,
            functionalRoles: roles,
            team: primaryTeam?.name || '',
            teamType: primaryTeam?.teamType || 'none',
            role: preferredRole(roles),
            membershipRole: primaryTeam?.membershipRole || 'member',
            managedTeams: unique(managerTeams.length ? managerTeams : teams.map(team => team.name)),
            allTeamsAccess: false,
            hasPassword: true,
            legacyKey: null
        };
        user.mode = modeForUser(user);
        user.isManager = user.mode === 'manager';
        user.isPiecesOperator = user.mode === 'operations';
        user.isRankable = user.mode === 'analyst';
        return user;
    }

    function scopeIdentityToTeam(identity, selectedTeamId) {
        if (!identity?.id || !Array.isArray(identity.teams)) return null;
        const selectedTeam = identity.teams.find(team => sameTeamId(team.id, selectedTeamId));
        if (!selectedTeam) return null;
        const scoped = normalizeUser({
            ...identity,
            sub: identity.id,
            teams: [selectedTeam]
        });
        if (!scoped.id) return null;
        scoped.selectedTeamId = selectedTeamId;
        return scoped;
    }

    function identityFromSelection(team, selectedUser, responsePayload = {}) {
        const returnedUser = responsePayload?.user || responsePayload?.identity || responsePayload;
        if ((returnedUser?.sub || returnedUser?.id) && Array.isArray(returnedUser?.teams)) {
            const returnedTeams = returnedUser.teams;
            const selectedReturnedTeam = returnedTeams.find(returnedTeam => sameTeamId(returnedTeam?.id, team.id));
            const identity = normalizeUser({
                ...returnedUser,
                sub: returnedUser.sub || returnedUser.id,
                teams: [selectedReturnedTeam || {
                    id: team.id,
                    name: team.name,
                    code: team.code,
                    color: team.color,
                    team_type: team.teamType,
                    role: selectedUser.membershipRole,
                    is_primary: true,
                    functional_roles: selectedUser.functionalRoles.length
                        ? selectedUser.functionalRoles
                        : team.functionalRoles
                }]
            });
            if (identity.id) return identity;
        }
        return normalizeUser({
            sub: selectedUser.id,
            name: selectedUser.name,
            teams: [{
                id: team.id,
                name: team.name,
                code: team.code,
                color: team.color,
                team_type: team.teamType,
                role: selectedUser.membershipRole,
                is_primary: true,
                functional_roles: selectedUser.functionalRoles.length
                    ? selectedUser.functionalRoles
                    : team.functionalRoles
            }]
        });
    }

    function attachToLegacyUsers(identity, users) {
        const collection = users || {};
        const candidates = Object.entries(collection);
        const byActaskId = candidates.find(([, user]) => user?.actaskId === identity.id);
        const byEmail = identity.email
            ? candidates.find(([, user]) => user?.email && String(user.email).toLowerCase() === identity.email.toLowerCase())
            : null;
        const sameName = identity.name
            ? candidates.filter(([, user]) => user?.name && String(user.name).toLowerCase() === identity.name.toLowerCase())
            : [];
        const legacyKey = byActaskId?.[0] || byEmail?.[0] || (sameName.length === 1 ? sameName[0][0] : `actask:${identity.id}`);
        const previous = collection[legacyKey] || {};
        collection[legacyKey] = {
            ...previous,
            name: identity.name || previous.name || identity.email || legacyKey,
            email: identity.email || previous.email || '',
            photo: identity.photo || previous.photo || '',
            initial: identity.initial || previous.initial || '?',
            active: identity.active,
            actaskId: identity.id,
            team: identity.team || previous.team || 'Sistema',
            teamType: identity.teamType,
            role: identity.role,
            roles: identity.roles,
            functionalRoles: identity.functionalRoles,
            teams: identity.teams,
            membershipRole: identity.membershipRole,
            managedTeams: identity.managedTeams,
            allTeamsAccess: identity.allTeamsAccess,
            hasPassword: true,
            identitySource: 'actask'
        };
        identity.legacyKey = legacyKey;
        return legacyKey;
    }

    async function login(email, password) {
        if (!isConfigured()) throw configurationError();
        const normalizedEmail = String(email || '').trim();
        if (!normalizedEmail || !String(password || '')) throw new ActaskAuthError('Informe e-mail e senha.', 'invalid_request');
        const config = getConfig();
        const fetcher = requireFetch();
        const response = await fetcher(config.loginEndpoint, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                client_id: config.clientId,
                redirect_uri: config.redirectUri,
                email: normalizedEmail,
                password,
                scope: config.scopes.join(' '),
                audience: config.audience
            })
        });
        const tokens = await parseResponse(response);
        if (!tokens.access_token) throw new ActaskAuthError('O Actask não retornou uma sessão válida.', 'invalid_token_response');
        const identity = await fetchUserinfo(tokens.access_token);
        const session = createSession(tokens, identity);
        writeStoredSession(session);
        return identity;
    }

    async function loadLoginOptions() {
        if (!isDirectoryConfigured()) throw configurationError();
        const config = getConfig();
        const fetcher = requireFetch();
        const response = await fetcher(config.loginOptionsEndpoint, {
            headers: { Accept: 'application/json' }
        });
        const payload = await parseResponse(response);
        return normalizeLoginOptions(payload);
    }

    async function loginSelected(team, selectedUser, password) {
        if (!isDirectoryConfigured()) throw configurationError();
        if (!team?.id && team?.id !== null) throw new ActaskAuthError('Selecione uma equipe.', 'invalid_selection');
        if (!selectedUser?.id) throw new ActaskAuthError('Selecione um usuário.', 'invalid_selection');
        if (!String(password || '')) throw new ActaskAuthError('Informe a senha.', 'invalid_request');
        const config = getConfig();
        const endpoint = team.loginTarget === 'actask'
            ? config.selectedLoginEndpoint
            : config.selectedExternalLoginEndpoint;
        const fetcher = requireFetch();
        const response = await fetcher(endpoint, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                user_id: selectedUser.id,
                team_id: team.id,
                password
            })
        });
        const payload = await parseResponse(response);
        if (payload?.authenticated === false) throw new ActaskAuthError('Usuário ou senha inválidos.', 'invalid_grant', 401);
        const identity = identityFromSelection(team, selectedUser, payload);
        if (!identity.id) throw new ActaskAuthError('O Actask não retornou o usuário selecionado.', 'invalid_userinfo');
        identity.selectedTeamId = team.id;
        identity.loginTarget = team.loginTarget;
        if (team.loginTarget === 'actask' && payload?.session_token) {
            writeStoredDirectorySession({
                sessionToken: String(payload.session_token),
                selectedTeamId: team.id,
                loginTarget: team.loginTarget,
                user: identity
            });
        }
        return identity;
    }

    function createSession(tokens, identity) {
        const now = Date.now();
        return {
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token || null,
            tokenType: tokens.token_type || 'Bearer',
            accessExpiresAt: now + (Number(tokens.expires_in || 900) * 1000),
            refreshExpiresAt: tokens.refresh_expires_in ? now + (Number(tokens.refresh_expires_in) * 1000) : null,
            scope: tokens.scope || '',
            user: identity
        };
    }

    async function fetchUserinfo(accessToken) {
        if (!accessToken) throw new ActaskAuthError('Sessão do Actask ausente.', 'missing_access_token');
        const config = getConfig();
        const fetcher = requireFetch();
        const response = await fetcher(config.userinfoEndpoint, {
            headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` }
        });
        const claims = await parseResponse(response);
        const identity = normalizeUser(claims);
        if (!identity.id) throw new ActaskAuthError('O Actask não retornou o identificador do usuário.', 'invalid_userinfo');
        return identity;
    }

    async function fetchSelectedUser(sessionToken) {
        if (!sessionToken) throw new ActaskAuthError('Sessão do Actask ausente.', 'missing_session_token');
        const config = getConfig();
        const fetcher = requireFetch();
        const response = await fetcher(config.meEndpoint, {
            headers: { Accept: 'application/json', 'X-Session-Token': sessionToken }
        });
        const claims = await parseResponse(response);
        const identity = normalizeUser({ ...claims, sub: claims?.sub || claims?.id });
        if (!identity.id) throw new ActaskAuthError('O Actask não retornou o identificador do usuário.', 'invalid_userinfo');
        return identity;
    }

    async function refresh() {
        if (!isConfigured()) throw configurationError();
        const stored = readStoredSession();
        if (!stored?.refreshToken) throw new ActaskAuthError('A sessão do Actask expirou.', 'refresh_unavailable');
        const config = getConfig();
        const fetcher = requireFetch();
        const response = await fetcher(config.tokenEndpoint, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                client_id: config.clientId,
                refresh_token: stored.refreshToken
            })
        });
        const tokens = await parseResponse(response);
        if (!tokens.access_token) throw new ActaskAuthError('O Actask não retornou uma sessão renovada.', 'invalid_refresh_response');
        const identity = await fetchUserinfo(tokens.access_token);
        writeStoredSession(createSession(tokens, identity));
        return identity;
    }

    async function restore() {
        const stored = readStoredSession();
        if (stored?.accessToken) {
            try {
                const identity = Number(stored.accessExpiresAt || 0) - Date.now() < 30_000
                    ? await refresh()
                    : await fetchUserinfo(stored.accessToken);
                const current = readStoredSession();
                if (current) {
                    current.user = identity;
                    writeStoredSession(current);
                }
                return identity;
            } catch (error) {
                if (error?.status === 401 || error?.code === 'invalid_grant' || error?.code === 'refresh_unavailable') clearStoredSession();
                return null;
            }
        }

        const directorySession = readStoredDirectorySession();
        if (!directorySession?.sessionToken) return null;
        try {
            const identity = await fetchSelectedUser(directorySession.sessionToken);
            const scoped = scopeIdentityToTeam(identity, directorySession.selectedTeamId);
            if (!scoped) throw new ActaskAuthError('A equipe selecionada não está mais disponível.', 'invalid_selection');
            scoped.loginTarget = directorySession.loginTarget || 'actask';
            writeStoredDirectorySession({ ...directorySession, user: scoped });
            return scoped;
        } catch (_) {
            clearStoredDirectorySession();
            return null;
        }
    }

    async function revokeToken(token, tokenTypeHint) {
        if (!token || !isConfigured()) return;
        const config = getConfig();
        try {
            const fetcher = requireFetch();
            await fetcher(config.revokeEndpoint, {
                method: 'POST',
                headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: config.clientId, token, token_type_hint: tokenTypeHint })
            });
        } catch (_) { /* logout local continua mesmo se a rede estiver indisponível */ }
    }

    async function revokeDirectorySession(token) {
        if (!token || !isDirectoryConfigured()) return;
        const config = getConfig();
        try {
            const fetcher = requireFetch();
            await fetcher(config.logoutEndpoint, {
                method: 'POST',
                headers: { Accept: 'application/json', 'X-Session-Token': token }
            });
        } catch (_) { /* logout local continua mesmo se a rede estiver indisponível */ }
    }

    async function logout() {
        const stored = readStoredSession();
        const directorySession = readStoredDirectorySession();
        clearStoredSession();
        clearStoredDirectorySession();
        if (stored?.refreshToken) await revokeToken(stored.refreshToken, 'refresh_token');
        if (directorySession?.sessionToken) await revokeDirectorySession(directorySession.sessionToken);
    }

    function getSession() {
        return readStoredSession() || readStoredDirectorySession();
    }

    function getUser() {
        return getSession()?.user || null;
    }

    return {
        ActaskAuthError,
        CATEGORY_ROLE_IDS,
        DEFAULT_SCOPES,
        MAIN_ISSUER,
        PIECES_ROLES,
        PUBLIC_AUDIENCE,
        ROLE_ALIASES,
        STAGE_ISSUER,
        attachToLegacyUsers,
        clearStoredSession,
        getConfig,
        getSession,
        getUser,
        isConfigured,
        isDirectoryConfigured,
        loadLoginOptions,
        loginSelected,
        login,
        logout,
        modeForUser,
        normalizeLoginOptions,
        normalizeRole,
        normalizeTeam,
        normalizeUser,
        refresh,
        restore
    };
});
