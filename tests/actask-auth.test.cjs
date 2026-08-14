const test = require('node:test');
const assert = require('node:assert/strict');
const ActaskAuth = require('../js/actask-auth.js');

function createStorage() {
    const values = new Map();
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
        removeItem(key) { values.delete(key); },
        dump() { return Object.fromEntries(values); }
    };
}

function response(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() { return payload; }
    };
}

function configure() {
    global.sessionStorage = createStorage();
    global.ACTASK_AUTH_CONFIG = {
        enabled: true,
        environment: 'stage',
        issuer: 'https://actaskapistage.bluefronte.com',
        clientId: 'actuar-classifique-stage-login',
        redirectUri: 'https://actuarclassifique-stage.example.com/',
        audience: 'actask-public-api',
        scopes: ['openid', 'profile']
    };
}

test.afterEach(() => {
    delete global.sessionStorage;
    delete global.ACTASK_AUTH_CONFIG;
    delete global.fetch;
});

test('userinfo normaliza equipes, mantém roles funcionais e ignora categorias', () => {
    const user = ActaskAuth.normalizeUser({
        sub: 'user-1',
        name: 'Ana Actask',
        email: 'ana@example.com',
        teams: [
            {
                id: 'team-1',
                name: 'Catraca',
                team_type: 'analyst',
                is_primary: true,
                functional_roles: [
                    { id: 'analista', name: 'Analista' },
                    { id: 'analista_catraca', name: 'Analista de catraca' },
                    { id: 'envio_coleta', name: 'Envio/Coleta' }
                ]
            }
        ]
    });

    assert.deepEqual(user.roles, ['Analista de catraca', 'Envio/Coleta']);
    assert.equal(user.team, 'Catraca');
    assert.equal(user.mode, 'operations');
    assert.equal(user.isRankable, false);
    assert.equal(user.isPiecesOperator, true);
});

test('diretório público normaliza equipes, tipo e usuários sem credenciais', async () => {
    configure();
    const requests = [];
    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return response({
            teams: [{
                id: 'team-1',
                name: 'Suporte Catraca',
                code: 'SCTC',
                color: '#6366f1',
                team_type: 'analyst',
                login_target: 'external',
                users: [{
                    id: 'user-1',
                    name: 'Ana Actask',
                    initials: 'AA',
                    role: 'member',
                    has_password: true,
                    functional_roles: [{ id: 'analista_catraca', name: 'Analista de catraca' }]
                }]
            }]
        });
    };

    const teams = await ActaskAuth.loadLoginOptions();
    assert.equal(requests[0].url, 'https://actaskapistage.bluefronte.com/auth/login-options');
    assert.equal(requests[0].options.method, undefined);
    assert.deepEqual(teams[0], {
        id: 'team-1',
        name: 'Suporte Catraca',
        code: 'SCTC',
        color: '#6366f1',
        teamType: 'analyst',
        loginTarget: 'external',
        functionalRoles: [],
        users: [{
            id: 'user-1',
            name: 'Ana Actask',
            initials: 'AA',
            membershipRole: 'member',
            functionalRoles: ['Analista de catraca'],
            hasPassword: true
        }]
    });
});

test('login por equipe e usuário usa a validação externa do Actask', async () => {
    configure();
    const requests = [];
    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return response({ authenticated: true });
    };

    const user = await ActaskAuth.loginSelected(
        {
            id: 'team-1',
            name: 'Suporte Catraca',
            teamType: 'analyst',
            loginTarget: 'external',
            functionalRoles: []
        },
        {
            id: 'user-1',
            name: 'Ana Actask',
            membershipRole: 'member',
            functionalRoles: []
        },
        'senha-secreta'
    );

    assert.equal(requests[0].url, 'https://actaskapistage.bluefronte.com/auth/login-selected-external');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
        user_id: 'user-1',
        team_id: 'team-1',
        password: 'senha-secreta'
    });
    assert.equal(user.id, 'user-1');
    assert.equal(user.team, 'Suporte Catraca');
    assert.equal(user.mode, 'analyst');
    assert.equal(user.selectedTeamId, 'team-1');
    assert.equal(JSON.stringify(global.sessionStorage.dump()).includes('senha-secreta'), false);
});

test('login selecionado aproveita identidade e roles quando o Actask as devolve', async () => {
    configure();
    global.fetch = async () => response({
        session_token: 'actask-session',
        user: {
            id: 'user-1',
            name: 'Ana Actask',
            email: 'ana@example.com',
            teams: [{
                id: 'team-1',
                name: 'Operação',
                team_type: 'operational',
                role: 'member',
                is_primary: true,
                functional_roles: [{ id: 'expedicao', name: 'Expedição' }]
            }]
        }
    });

    const user = await ActaskAuth.loginSelected(
        { id: 'team-1', name: 'Operação', teamType: 'operational', loginTarget: 'actask', functionalRoles: [] },
        { id: 'user-1', name: 'Ana Actask', membershipRole: 'member', functionalRoles: [] },
        'senha-secreta'
    );

    assert.deepEqual(user.roles, ['Expedição']);
    assert.equal(user.mode, 'operations');
    assert.equal(user.loginTarget, 'actask');
});

test('login envia o contrato público do Actask e não persiste a senha', async () => {
    configure();
    const requests = [];
    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        if (url.endsWith('/oauth/login')) {
            return response({
                access_token: 'access-1',
                refresh_token: 'refresh-1',
                expires_in: 900,
                refresh_expires_in: 2592000,
                token_type: 'Bearer',
                scope: 'openid profile'
            });
        }
        return response({
            sub: 'user-1',
            name: 'Ana Actask',
            email: 'ana@example.com',
            teams: [{ name: 'Sistema', functional_roles: [{ name: 'Analista de sistema' }] }]
        });
    };

    const user = await ActaskAuth.login(' ana@example.com ', 'senha-secreta');
    const body = JSON.parse(requests[0].options.body);
    assert.equal(requests[0].url, 'https://actaskapistage.bluefronte.com/oauth/login');
    assert.deepEqual(body, {
        client_id: 'actuar-classifique-stage-login',
        redirect_uri: 'https://actuarclassifique-stage.example.com/',
        email: 'ana@example.com',
        password: 'senha-secreta',
        scope: 'openid profile',
        audience: 'actask-public-api'
    });
    assert.equal(user.id, 'user-1');
    assert.equal(requests[1].options.headers.Authorization, 'Bearer access-1');
    assert.equal(JSON.stringify(global.sessionStorage.dump()).includes('senha-secreta'), false);
    assert.equal(ActaskAuth.getSession().refreshToken, 'refresh-1');
});

test('credencial inválida retorna mensagem genérica', async () => {
    configure();
    global.fetch = async () => response({ error: 'invalid_grant', error_description: 'Usuário não encontrado' }, 400);

    await assert.rejects(
        () => ActaskAuth.login('inexistente@example.com', 'errada'),
        error => error.code === 'invalid_grant' && error.message === 'E-mail ou senha inválidos.'
    );
});

test('refresh usa o novo refresh token e substitui a sessão anterior', async () => {
    configure();
    let calls = 0;
    global.fetch = async (url, options = {}) => {
        calls += 1;
        if (url.endsWith('/oauth/token')) {
            const body = String(options.body);
            assert.match(body, /grant_type=refresh_token/);
            assert.match(body, /refresh_token=refresh-1/);
            return response({ access_token: 'access-2', refresh_token: 'refresh-2', expires_in: 900, refresh_expires_in: 2592000 });
        }
        return response({
            sub: 'user-1',
            name: 'Ana Actask',
            email: 'ana@example.com',
            teams: [{ name: 'Sistema', functional_roles: [{ name: 'Gestor Adm' }] }]
        });
    };
    global.sessionStorage.setItem('actuar-classifique-actask-session-v1', JSON.stringify({
        accessToken: 'access-1',
        refreshToken: 'refresh-1',
        accessExpiresAt: Date.now() - 1,
        user: null
    }));

    const user = await ActaskAuth.restore();
    assert.equal(calls, 2);
    assert.equal(user.mode, 'manager');
    assert.equal(ActaskAuth.getSession().accessToken, 'access-2');
    assert.equal(ActaskAuth.getSession().refreshToken, 'refresh-2');
});

test('logout revoga refresh token e limpa a sessão local', async () => {
    configure();
    const requests = [];
    global.fetch = async (url, options = {}) => {
        requests.push({ url, options });
        return response({});
    };
    global.sessionStorage.setItem('actuar-classifique-actask-session-v1', JSON.stringify({ refreshToken: 'refresh-1', accessToken: 'access-1' }));

    await ActaskAuth.logout();
    assert.equal(requests[0].url, 'https://actaskapistage.bluefronte.com/oauth/revoke');
    assert.match(String(requests[0].options.body), /token=refresh-1/);
    assert.equal(ActaskAuth.getSession(), null);
});

test('identidade pode ser associada à chave histórica por e-mail', () => {
    const user = ActaskAuth.normalizeUser({
        sub: 'user-1',
        name: 'Ana Actask',
        email: 'ana@example.com',
        teams: [{ name: 'Sistema', functional_roles: [{ name: 'Analista de sistema' }] }]
    });
    const users = { ana_historica: { name: 'Ana antiga', email: 'ana@example.com', team: 'Sistema' } };
    const key = ActaskAuth.attachToLegacyUsers(user, users);
    assert.equal(key, 'ana_historica');
    assert.equal(users.ana_historica.actaskId, 'user-1');
    assert.deepEqual(users.ana_historica.roles, ['Analista de sistema']);
});
