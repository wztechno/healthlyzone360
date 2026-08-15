import type { ApiFailure } from '@healthy360/api-client';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Button } from '../actions/button.tsx';
import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

/**
 * Translation key per failure code. Screens never render `failure.message` when a key exists: the
 * server's text is a developer-facing fallback, not product copy.
 */
export const FAILURE_MESSAGE_KEYS: Readonly<Record<ApiFailure['code'], string>> = {
    'auth.invalid_credentials': 'errors:failure.auth_invalid_credentials',
    'auth.unauthenticated': 'errors:failure.auth_unauthenticated',
    'auth.email_unverified': 'errors:failure.auth_email_unverified',
    'auth.two_factor_required': 'errors:failure.auth_two_factor_required',
    'auth.step_up_required': 'errors:failure.auth_step_up_required',
    'context.organisation_required': 'errors:failure.context_organisation_required',
    'context.organisation_forbidden': 'errors:failure.context_organisation_forbidden',
    'context.branch_out_of_scope': 'errors:failure.context_branch_out_of_scope',
    // The four management codes (K1). `resource.conflict` and `request.precondition_required` are
    // deliberately worded for the person rather than the developer: one says somebody else saved
    // first, the other says the app sent a stale change — neither blames them for a typing mistake.
    'authz.permission_denied': 'errors:failure.authz_permission_denied',
    'resource.not_found': 'errors:failure.resource_not_found',
    'resource.conflict': 'errors:failure.resource_conflict',
    'request.precondition_required': 'errors:failure.request_precondition_required',
    'validation.failed': 'errors:failure.validation_failed',
    'rate_limit.exceeded': 'errors:failure.rate_limit_exceeded',
    // The five OTP codes (J1). A one-time-code panel renders its own copy from
    // `features/verification/otp-errors.ts`, because it can say *how many tries are left* and
    // *what to do instead*. These entries are the last resort for anywhere else an OTP rejection
    // surfaces — a generic error boundary — and they are worded without the counts they lack.
    'otp.invalid': 'errors:failure.otp_invalid',
    'otp.expired': 'errors:failure.otp_expired',
    'otp.cooldown_active': 'errors:failure.otp_cooldown_active',
    'otp.attempts_exceeded': 'errors:failure.otp_attempts_exceeded',
    'otp.channel_unavailable': 'errors:failure.otp_channel_unavailable',
    // The ten journey codes (J1, G1, B1). Each one has a screen that handles it properly — the
    // contact form offers sign-in, the checkout restarts a dead guest session, the wizard refetches
    // an application a reviewer has moved. These entries are what a *generic* error boundary shows
    // when the rejection surfaces somewhere that has no such handling, so each is worded as the
    // plainest true sentence rather than as the remedy the owning screen would offer.
    'request.idempotency_key_reused': 'errors:failure.request_idempotency_key_reused',
    'contact.already_in_use': 'errors:failure.contact_already_in_use',
    'account.verification_required': 'errors:failure.account_verification_required',
    'address.area_not_served': 'errors:failure.address_area_not_served',
    'guest.session_invalid': 'errors:failure.guest_session_invalid',
    'cart.line_refused': 'errors:failure.cart_line_refused',
    'order.placement_refused': 'errors:failure.order_placement_refused',
    'b2b.application_state_invalid': 'errors:failure.b2b_application_state_invalid',
    'b2b.documents_incomplete': 'errors:failure.b2b_documents_incomplete',
    'b2b.signatory_required': 'errors:failure.b2b_signatory_required',
    'b2b.quotation_state_invalid': 'errors:failure.b2b_quotation_state_invalid',
    // The six refusal codes (S1, J2, B2). Five of them carry structured detail — the reasons a
    // configurator lists, the checks a wind-down must settle, the transitions still open — and the
    // owning surface renders that detail itself. These entries are what a *generic* error boundary
    // shows when one surfaces somewhere with no such handling, so each states the refusal without
    // the specifics it would otherwise be quoting from a list it did not read.
    'subscription.refused': 'errors:failure.subscription_refused',
    'subscription.change_refused': 'errors:failure.subscription_change_refused',
    'closure.refused': 'errors:failure.closure_refused',
    'offboarding.refused': 'errors:failure.offboarding_refused',
    'offboarding.settlement_outstanding': 'errors:failure.offboarding_settlement_outstanding',
    'record_export.unavailable': 'errors:failure.record_export_unavailable',
    // Raised by every prototype API repository. The record is exhaustive over `ApiFailure['code']`,
    // so a new failure code cannot be added upstream without this table being updated — which is
    // exactly the point of typing it that way.
    'prototype.not_implemented': 'errors:failure.prototype_not_implemented',
    network: 'errors:failure.network',
    server: 'errors:failure.server',
};

export interface ErrorStateProps {
    readonly failure: ApiFailure;
    /** Overrides the code-derived title. */
    readonly title?: string | undefined;
    /** Wired to the retry button. The button only appears when the failure is retryable. */
    readonly onRetry?: (() => void) | undefined;
    readonly retrying?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Error state.
 *
 * Two rules the component enforces rather than trusts callers with:
 *
 * 1. **Retry is offered only when retrying could work.** A rejected password or a validation
 *    failure will produce the identical answer, so no button is drawn — an action that is certain
 *    to fail is a dead button.
 * 2. **The correlation id is always shown when there is one.** It is the only thing that connects
 *    what the user saw to what the server logged.
 */
export function ErrorState({
    failure,
    title,
    onRetry,
    retrying = false,
    className,
    testID,
}: ErrorStateProps) {
    const { t } = useTranslation();
    const retryable = failure.retryable && onRetry !== undefined;

    const body = t(FAILURE_MESSAGE_KEYS[failure.code], {
        defaultValue: failure.message,
        ...(failure.code === 'rate_limit.exceeded' ? { seconds: failure.retryAfterSeconds } : {}),
    });

    return (
        <View
            testID={testID}
            role="alert"
            accessibilityRole="alert"
            aria-live="assertive"
            className={cx(
                'flex-col items-start gap-3 rounded-xl border border-danger-border bg-danger-subtle p-6',
                className,
            )}
        >
            <View className="flex-row items-center gap-2">
                <Icon name="error" size="lg" className="text-danger-on-subtle" />
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-title`}
                    accessibilityRole="header"
                    aria-level={2}
                    className="flex-1 text-lg font-semibold text-danger-on-subtle text-start"
                >
                    {title ?? t('errors:generic.title')}
                </RNText>
            </View>

            <RNText
                testID={testID === undefined ? undefined : `${testID}-body`}
                className="text-sm text-danger-on-subtle text-start"
            >
                {body}
            </RNText>

            {failure.correlationId === null ? null : (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-correlation`}
                    className="text-xs text-content-secondary text-start"
                    selectable
                >
                    {t('errors:generic.reference', { id: failure.correlationId })}
                </RNText>
            )}

            {retryable ? (
                <Button
                    testID={testID === undefined ? undefined : `${testID}-retry`}
                    variant="secondary"
                    size="sm"
                    label={t('errors:generic.retry')}
                    loading={retrying}
                    onPress={onRetry}
                />
            ) : null}
        </View>
    );
}
