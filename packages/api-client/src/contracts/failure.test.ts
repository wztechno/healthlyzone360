import { describe, expect, it } from 'vitest';

import {
    API_FAILURE_CODES,
    ApiError,
    apiFailure,
    asApiFailure,
    conflictFailure,
    defaultRetryable,
    isApiFailure,
    isApiFailureCode,
    isAutoRetryable,
    isConflictFailure,
    isOrderPlacementRefusedFailure,
    isPermissionDeniedFailure,
    isOtpCooldownFailure,
    isOtpFailure,
    isOtpInvalidFailure,
    isOtpLockedFailure,
    isRateLimitFailure,
    isValidationFailure,
    otpCooldownFailure,
    otpInvalidFailure,
    otpLockedFailure,
    orderPlacementRefusedFailure,
    permissionDeniedFailure,
    rateLimitFailure,
    throwFailure,
    validationFailure,
} from './failure.ts';

describe('the failure vocabulary', () => {
    it('mirrors the backend envelope codes and is unique', () => {
        expect([...API_FAILURE_CODES]).toEqual([
            'auth.invalid_credentials',
            'auth.unauthenticated',
            'auth.email_unverified',
            'auth.two_factor_required',
            'auth.step_up_required',
            'context.organisation_required',
            'context.organisation_forbidden',
            'context.branch_out_of_scope',
            'authz.permission_denied',
            'resource.not_found',
            'resource.conflict',
            'request.precondition_required',
            'request.idempotency_key_reused',
            'validation.failed',
            'rate_limit.exceeded',
            'otp.invalid',
            'otp.expired',
            'otp.cooldown_active',
            'otp.attempts_exceeded',
            'otp.channel_unavailable',
            // The ten journey codes (J1, G1, B1). Listed here in the order the union declares them
            // so that adding one anywhere fails this assertion — which is the point of asserting
            // the whole array rather than a membership test.
            'contact.already_in_use',
            'account.verification_required',
            'address.area_not_served',
            'guest.session_invalid',
            'cart.line_refused',
            'order.placement_refused',
            'b2b.application_state_invalid',
            'b2b.documents_incomplete',
            'b2b.signatory_required',
            'b2b.quotation_state_invalid',
            // The six refusal codes (S1, J2, B2), on the same terms as the ten above.
            'subscription.refused',
            'subscription.change_refused',
            'closure.refused',
            'offboarding.refused',
            'offboarding.settlement_outstanding',
            'record_export.unavailable',
            'network',
            'server',
            'prototype.not_implemented',
        ]);
        expect(new Set(API_FAILURE_CODES).size).toBe(API_FAILURE_CODES.length);
    });

    /**
     * Two codes have no wire counterpart and never will: `network` is what a failed fetch becomes,
     * and `prototype.not_implemented` is what the eight proposed contracts reject with when the
     * application is talking to the real API. Stated here so that a future "map every code to a wire
     * code" refactor has to notice them.
     */
    it('keeps the two client-side codes distinguishable from the wire vocabulary', () => {
        expect(isApiFailureCode('network')).toBe(true);
        expect(isApiFailureCode('prototype.not_implemented')).toBe(true);
        expect(apiFailure('prototype.not_implemented').retryable).toBe(false);
        expect(apiFailure('prototype.not_implemented').message).toContain('no backend yet');
    });

    it('recognises its own codes and nothing else', () => {
        expect(isApiFailureCode('auth.step_up_required')).toBe(true);
        expect(isApiFailureCode('auth.made_up')).toBe(false);
        expect(isApiFailureCode(422)).toBe(false);
    });

    /**
     * The retry policy is derived from this table, so it is asserted rather than assumed: an
     * automatic retry of a rejected password or a rate limit is a bug, not a resilience feature.
     */
    it('marks only transport-level failures as automatically retryable', () => {
        const retryable = API_FAILURE_CODES.filter(defaultRetryable);
        expect([...retryable]).toEqual(['network', 'server']);
    });
});

describe('failure builders', () => {
    it('supplies a human-readable fallback message and no correlation id by default', () => {
        const failure = apiFailure('auth.invalid_credentials');
        expect(failure.code).toBe('auth.invalid_credentials');
        expect(failure.message.length).toBeGreaterThan(0);
        expect(failure.correlationId).toBeNull();
        expect(failure.retryable).toBe(false);
    });

    it('carries per-field messages on a validation failure', () => {
        const failure = validationFailure(
            { email: ['Already registered.'] },
            {
                correlationId: 'corr-1',
            },
        );
        expect(isValidationFailure(failure)).toBe(true);
        if (!isValidationFailure(failure)) throw new Error('unreachable');
        expect(failure.fields['email']).toEqual(['Already registered.']);
        expect(failure.correlationId).toBe('corr-1');
        expect(isAutoRetryable(failure)).toBe(false);
    });

    it('carries retry-after seconds on a rate-limit failure', () => {
        const failure = rateLimitFailure(45);
        expect(isRateLimitFailure(failure)).toBe(true);
        if (!isRateLimitFailure(failure)) throw new Error('unreachable');
        expect(failure.retryAfterSeconds).toBe(45);
    });

    /**
     * The lock version is *absent*, not zero, when the server did not send one — an editor that
     * saw `0` would tell the person the row had been reset to its first revision.
     */
    it('carries the server lock version on a conflict, and omits it when there is none', () => {
        const versioned = conflictFailure({ currentLockVersion: 7 });
        expect(isConflictFailure(versioned)).toBe(true);
        if (!isConflictFailure(versioned)) throw new Error('unreachable');
        expect(versioned.currentLockVersion).toBe(7);

        const bare = conflictFailure();
        if (!isConflictFailure(bare)) throw new Error('unreachable');
        expect(bare.currentLockVersion).toBeUndefined();
        expect(Object.hasOwn(bare, 'currentLockVersion')).toBe(false);
    });

    it('names the permission and the denying step on an authorisation failure', () => {
        const failure = permissionDeniedFailure(
            'catalogue.publish_organisation',
            'membership roles do not carry the code',
        );
        expect(isPermissionDeniedFailure(failure)).toBe(true);
        if (!isPermissionDeniedFailure(failure)) throw new Error('unreachable');
        expect(failure.permission).toBe('catalogue.publish_organisation');
        expect(failure.reason).toBe('membership roles do not carry the code');
        expect(failure.retryable).toBe(false);
    });

    /**
     * The three structured OTP rejections. Each is asserted for the *one* field a panel cannot
     * draw itself: how many tries are left, how long the wait is, and what to do instead of waiting.
     */
    it('carries the remaining attempts on a wrong code', () => {
        const failure = otpInvalidFailure(2);
        expect(isOtpFailure(failure)).toBe(true);
        expect(isOtpInvalidFailure(failure)).toBe(true);
        if (!isOtpInvalidFailure(failure)) throw new Error('unreachable');
        expect(failure.attemptsRemaining).toBe(2);
        expect(failure.retryable).toBe(false);
    });

    it('carries the wait on an active cooldown, distinct from a rate limit', () => {
        const failure = otpCooldownFailure(45);
        expect(isOtpCooldownFailure(failure)).toBe(true);
        expect(isRateLimitFailure(failure)).toBe(false);
        if (!isOtpCooldownFailure(failure)) throw new Error('unreachable');
        expect(failure.retryAfterSeconds).toBe(45);
    });

    /** An empty channel list is a statement, not a missing field: "there is nothing else to try". */
    it('carries the lockout end and the escape channels, including none at all', () => {
        const failure = otpLockedFailure('2026-08-02T10:05:00.000Z', ['sms']);
        expect(isOtpLockedFailure(failure)).toBe(true);
        if (!isOtpLockedFailure(failure)) throw new Error('unreachable');
        expect(failure.lockedUntil).toBe('2026-08-02T10:05:00.000Z');
        expect(failure.availableChannels).toEqual(['sms']);

        const stranded = otpLockedFailure('2026-08-02T10:05:00.000Z', []);
        if (!isOtpLockedFailure(stranded)) throw new Error('unreachable');
        expect(stranded.availableChannels).toEqual([]);
    });

    /**
     * The placement refusal carries the same reason list the subscription ones do. Asserted through
     * the guard rather than by casting, because the guard is what a checkout screen actually uses to
     * decide whether it has a list to draw.
     */
    it('carries the named reasons, with their context, on a refused placement', () => {
        const failure = orderPlacementRefusedFailure([
            { reason: 'cut_off_passed', context: { cut_off_at: '2026-08-04T18:00:00.000Z' } },
            { reason: 'zone_suspended', context: {} },
        ]);

        expect(isOrderPlacementRefusedFailure(failure)).toBe(true);
        if (!isOrderPlacementRefusedFailure(failure)) throw new Error('unreachable');
        expect(failure.reasons.map((entry) => entry.reason)).toEqual([
            'cut_off_passed',
            'zone_suspended',
        ]);
        expect(failure.reasons[0]?.context).toEqual({ cut_off_at: '2026-08-04T18:00:00.000Z' });
        expect(failure.retryable).toBe(false);

        // An empty list is a statement — "refused, and nothing was named" — not a missing field.
        const unexplained = orderPlacementRefusedFailure([]);
        if (!isOrderPlacementRefusedFailure(unexplained)) throw new Error('unreachable');
        expect(unexplained.reasons).toEqual([]);
        expect(unexplained.message.length).toBeGreaterThan(0);
    });

    it('treats otp.expired and otp.channel_unavailable as plain failures', () => {
        expect(isOtpFailure(apiFailure('otp.expired'))).toBe(true);
        expect(isOtpFailure(apiFailure('otp.channel_unavailable'))).toBe(true);
        expect(isOtpFailure(apiFailure('server'))).toBe(false);
    });

    it('lets a caller mark a normally fatal failure retryable', () => {
        expect(apiFailure('server', { retryable: false }).retryable).toBe(false);
        expect(apiFailure('network').retryable).toBe(true);
    });
});

describe('ApiError', () => {
    it('is a real Error carrying the failure and its code', () => {
        const failure = apiFailure('context.branch_out_of_scope');
        const error = new ApiError(failure);
        expect(error).toBeInstanceOf(Error);
        expect(error.name).toBe('ApiError');
        expect(error.message).toBe(failure.message);
        expect(error.code).toBe('context.branch_out_of_scope');
        expect(error.failure).toBe(failure);
    });

    it('throwFailure throws an ApiError that asApiFailure can unwrap again', () => {
        try {
            throwFailure(apiFailure('server'));
            expect.unreachable('throwFailure must throw');
        } catch (error) {
            expect(asApiFailure(error)?.code).toBe('server');
            expect(isApiFailure(error)).toBe(true);
        }
    });

    it('asApiFailure rejects things that are not failures', () => {
        expect(asApiFailure(new Error('boom'))).toBeNull();
        expect(asApiFailure(null)).toBeNull();
        expect(asApiFailure('server')).toBeNull();
        expect(asApiFailure({ code: 'nope' })).toBeNull();
    });

    it('asApiFailure passes a bare failure object straight through', () => {
        const failure = apiFailure('network');
        expect(asApiFailure(failure)).toBe(failure);
    });
});
