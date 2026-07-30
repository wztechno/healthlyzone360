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
    'validation.failed': 'errors:failure.validation_failed',
    'rate_limit.exceeded': 'errors:failure.rate_limit_exceeded',
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
