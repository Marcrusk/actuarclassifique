const test = require('node:test');
const assert = require('node:assert/strict');
const domain = require('../js/performance-domain.js');

const { REQUEST_STATUS: S, ROLE, CYCLE_STATUS } = domain;

test('máquina de estados permite correção e reenvio, mas bloqueia edição livre após aprovação', () => {
    assert.equal(domain.canTransition(S.DRAFT, S.PENDING), true);
    assert.equal(domain.canTransition(S.IN_REVIEW, S.CORRECTION), true);
    assert.equal(domain.canTransition(S.CORRECTION, S.RESUBMITTED), true);
    assert.equal(domain.canTransition(S.APPROVED, S.PENDING), false);
    assert.throws(() => domain.assertTransition(S.APPROVED, S.PENDING), /Transição inválida/);
});

test('analista só acessa sua própria solicitação', () => {
    const analyst = { id: 'a1', role: ROLE.ANALYST, status: 'active' };
    assert.equal(domain.canAccessRequest(analyst, { analyst_id: 'a1', team_id: 't1' }), true);
    assert.equal(domain.canAccessRequest(analyst, { analyst_id: 'a2', team_id: 't1' }), false);
});

test('gestor só analisa equipe autorizada e nunca aprova a própria solicitação', () => {
    const manager = { id: 'm1', role: ROLE.MANAGER, status: 'active', managedTeamIds: ['t1'] };
    assert.equal(domain.canReviewRequest(manager, { analyst_id: 'a1', team_id: 't1' }), true);
    assert.equal(domain.canReviewRequest(manager, { analyst_id: 'a2', team_id: 't2' }), false);
    assert.equal(domain.canReviewRequest(manager, { analyst_id: 'm1', team_id: 't1' }), false);
});

test('usuário bloqueado não acessa nem cria solicitações', () => {
    const blocked = { id: 'a1', role: ROLE.ANALYST, status: 'blocked' };
    assert.equal(domain.canAccessRequest(blocked, { analyst_id: 'a1', team_id: 't1' }), false);
    assert.equal(domain.canCreateRequest(blocked, { status: CYCLE_STATUS.OPEN }), false);
});

test('ciclo fechado bloqueia solicitações comuns', () => {
    const analyst = { id: 'a1', role: ROLE.ANALYST, status: 'active' };
    assert.equal(domain.canCreateRequest(analyst, { status: CYCLE_STATUS.OPEN }), true);
    assert.equal(domain.canCreateRequest(analyst, { status: CYCLE_STATUS.REVIEW }), false);
    assert.equal(domain.canCreateRequest(analyst, { status: CYCLE_STATUS.CLOSED }), false);
});

test('crédito é somado uma vez por solicitação e estorno preserva histórico', () => {
    const entries = [
        { request_id: 'r1', movement_type: 'credit', quantity: 50 },
        { request_id: 'r1', movement_type: 'reversal', quantity: -50 }
    ];
    assert.equal(domain.hasDuplicateCredit(entries, 'r1'), true);
    assert.equal(domain.summarizeLedger(entries), 0);
    assert.equal(entries.length, 2);
});

test('query string nunca altera a identidade autenticada', () => {
    const result = domain.sanitizeViewerFromQuery({ analyst: 'dyego' }, 'auth-user-uuid');
    assert.equal(result.sessionUserId, 'auth-user-uuid');
    assert.equal(result.analystFilter, 'dyego');
});
