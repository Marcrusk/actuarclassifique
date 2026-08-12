(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    root.PerformanceDomain = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';

    const REQUEST_STATUS = Object.freeze({
        DRAFT: 'draft',
        PENDING: 'pending_review',
        IN_REVIEW: 'in_review',
        CORRECTION: 'correction_requested',
        RESUBMITTED: 'resubmitted',
        APPROVED: 'approved',
        NOT_APPROVED: 'not_approved',
        CANCELLED: 'cancelled',
        UNDER_REVISION: 'under_revision',
        ADMIN_ADJUSTED: 'admin_adjusted'
    });

    const ROLE = Object.freeze({
        ANALYST: 'analyst',
        MANAGER: 'manager',
        ADMIN: 'administrator',
        GUEST: 'guest'
    });

    const CYCLE_STATUS = Object.freeze({ OPEN: 'open', REVIEW: 'review', CLOSED: 'closed' });

    const transitions = Object.freeze({
        [REQUEST_STATUS.DRAFT]: [REQUEST_STATUS.PENDING, REQUEST_STATUS.CANCELLED],
        [REQUEST_STATUS.PENDING]: [REQUEST_STATUS.IN_REVIEW, REQUEST_STATUS.CANCELLED],
        [REQUEST_STATUS.IN_REVIEW]: [REQUEST_STATUS.APPROVED, REQUEST_STATUS.NOT_APPROVED, REQUEST_STATUS.CORRECTION],
        [REQUEST_STATUS.CORRECTION]: [REQUEST_STATUS.RESUBMITTED, REQUEST_STATUS.CANCELLED],
        [REQUEST_STATUS.RESUBMITTED]: [REQUEST_STATUS.IN_REVIEW],
        [REQUEST_STATUS.APPROVED]: [REQUEST_STATUS.CANCELLED, REQUEST_STATUS.UNDER_REVISION, REQUEST_STATUS.ADMIN_ADJUSTED],
        [REQUEST_STATUS.UNDER_REVISION]: [REQUEST_STATUS.APPROVED, REQUEST_STATUS.ADMIN_ADJUSTED],
        [REQUEST_STATUS.NOT_APPROVED]: [REQUEST_STATUS.UNDER_REVISION],
        [REQUEST_STATUS.CANCELLED]: [REQUEST_STATUS.ADMIN_ADJUSTED],
        [REQUEST_STATUS.ADMIN_ADJUSTED]: []
    });

    const statusLabels = Object.freeze({
        [REQUEST_STATUS.DRAFT]: 'Rascunho',
        [REQUEST_STATUS.PENDING]: 'Aguardando análise',
        [REQUEST_STATUS.IN_REVIEW]: 'Em análise',
        [REQUEST_STATUS.CORRECTION]: 'Correção solicitada',
        [REQUEST_STATUS.RESUBMITTED]: 'Reenviada',
        [REQUEST_STATUS.APPROVED]: 'Aprovada',
        [REQUEST_STATUS.NOT_APPROVED]: 'Não aprovada',
        [REQUEST_STATUS.CANCELLED]: 'Cancelada',
        [REQUEST_STATUS.UNDER_REVISION]: 'Em revisão',
        [REQUEST_STATUS.ADMIN_ADJUSTED]: 'Ajustada administrativamente'
    });

    function canTransition(from, to) {
        return Boolean(transitions[from] && transitions[from].includes(to));
    }

    function assertTransition(from, to) {
        if (!canTransition(from, to)) throw new Error(`Transição inválida: ${from} -> ${to}`);
        return true;
    }

    function canAccessRequest(actor, request) {
        if (!actor || !request) return false;
        if (actor.status !== 'active') return false;
        if (actor.role === ROLE.ADMIN) return true;
        if (actor.role === ROLE.ANALYST) return request.analyst_id === actor.id;
        if (actor.role === ROLE.MANAGER) {
            return request.analyst_id === actor.id || (actor.managedTeamIds || []).includes(request.team_id);
        }
        return false;
    }

    function canReviewRequest(actor, request) {
        if (!actor || !request || actor.status !== 'active') return false;
        if (![ROLE.MANAGER, ROLE.ADMIN].includes(actor.role)) return false;
        if (request.analyst_id === actor.id) return false;
        return actor.role === ROLE.ADMIN || (actor.managedTeamIds || []).includes(request.team_id);
    }

    function canCreateRequest(actor, cycle) {
        return Boolean(actor && actor.status === 'active' && actor.role !== ROLE.GUEST && cycle && cycle.status === CYCLE_STATUS.OPEN);
    }

    function canMutateCycle(actor, cycle, exceptional = false) {
        if (!actor || actor.role !== ROLE.ADMIN || actor.status !== 'active') return false;
        return cycle.status !== CYCLE_STATUS.CLOSED || exceptional;
    }

    function pointsBelongToCycle(request) {
        return request && request.score_cycle_id;
    }

    function sanitizeViewerFromQuery(query, sessionUserId) {
        return { sessionUserId, analystFilter: query && query.analyst ? String(query.analyst) : null };
    }

    function summarizeLedger(entries) {
        return (entries || []).reduce((sum, entry) => sum + Number(entry.quantity || 0), 0);
    }

    function hasDuplicateCredit(entries, requestId) {
        return (entries || []).some(entry => entry.request_id === requestId && entry.movement_type === 'credit');
    }

    return {
        REQUEST_STATUS,
        ROLE,
        CYCLE_STATUS,
        transitions,
        statusLabels,
        canTransition,
        assertTransition,
        canAccessRequest,
        canReviewRequest,
        canCreateRequest,
        canMutateCycle,
        pointsBelongToCycle,
        sanitizeViewerFromQuery,
        summarizeLedger,
        hasDuplicateCredit
    };
});
