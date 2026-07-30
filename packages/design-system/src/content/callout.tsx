import type { ReactNode } from 'react';
import { Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const CALLOUT_TONES = ['info', 'warning', 'danger', 'success'] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

const TONE_CLASS: Readonly<Record<CalloutTone, string>> = {
    info: 'bg-info-subtle border-info-border',
    warning: 'bg-warning-subtle border-warning-border',
    danger: 'bg-danger-subtle border-danger-border',
    success: 'bg-success-subtle border-success-border',
};

const TONE_TEXT_CLASS: Readonly<Record<CalloutTone, string>> = {
    info: 'text-info-on-subtle',
    warning: 'text-warning-on-subtle',
    danger: 'text-danger-on-subtle',
    success: 'text-success-on-subtle',
};

const TONE_ICON: Readonly<Record<CalloutTone, IconName>> = {
    info: 'info',
    warning: 'warning',
    danger: 'error',
    success: 'success',
};

export const CALLOUT_ROLES = ['note', 'status', 'alert'] as const;
export type CalloutRole = (typeof CALLOUT_ROLES)[number];

export interface CalloutProps {
    readonly title: string;
    readonly tone?: CalloutTone | undefined;
    /** Plain supporting copy. Use `children` instead when the body needs structure. */
    readonly body?: string | undefined;
    readonly children?: ReactNode | undefined;
    /** Overrides the tone's icon. `null` removes it — only when the title is unambiguous. */
    readonly icon?: IconName | null | undefined;
    /** Buttons or links. Rendered under the body in a wrapping row. */
    readonly actions?: ReactNode | undefined;
    /**
     * `note` for standing guidance (a medical disclaimer), `status` for a polite live update,
     * `alert` for something that must interrupt. Defaults to `note`.
     */
    readonly role?: CalloutRole | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Callout — the base of every standing notice in the application.
 *
 * It exists as one component so the application-level notices that matter (the medical disclaimer,
 * the prototype notice) cannot each invent their own markup and each get the semantics slightly
 * wrong. Those live in the app, not here: the design system stays domain-free, and a disclaimer's
 * *wording* is a product and legal decision, not a styling one.
 *
 * `role` is a deliberate prop rather than a fixed value. A disclaimer that is always present is a
 * `note`; a result that has just changed is a `status`; only something that must interrupt is an
 * `alert`. Making every callout an alert is how a screen reader user learns to ignore them.
 *
 * Tone never carries the meaning alone — each tone also brings its own icon.
 */
export function Callout({
    title,
    tone = 'info',
    body,
    children,
    icon,
    actions,
    role = 'note',
    className,
    testID,
}: CalloutProps) {
    const resolvedIcon = icon === undefined ? TONE_ICON[tone] : icon;

    return (
        <View
            testID={testID}
            role={role}
            {...(role === 'alert' ? { accessibilityRole: 'alert' as const } : {})}
            {...(role === 'status' ? { 'aria-live': 'polite' as const } : {})}
            className={cx(
                'flex-row items-start gap-3 rounded-lg border p-4',
                TONE_CLASS[tone],
                className,
            )}
        >
            {resolvedIcon === null ? null : (
                <Icon
                    testID={testID === undefined ? undefined : `${testID}-icon`}
                    name={resolvedIcon}
                    className={TONE_TEXT_CLASS[tone]}
                />
            )}

            <View className="flex-1 flex-col gap-1">
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-title`}
                    className={cx('text-sm font-semibold text-start', TONE_TEXT_CLASS[tone])}
                >
                    {title}
                </RNText>

                {body === undefined ? null : (
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-body`}
                        className={cx('text-sm text-start', TONE_TEXT_CLASS[tone])}
                    >
                        {body}
                    </RNText>
                )}

                {children}

                {actions === undefined ? null : (
                    <View
                        testID={testID === undefined ? undefined : `${testID}-actions`}
                        className="flex-row flex-wrap items-center gap-2 pt-1"
                    >
                        {actions}
                    </View>
                )}
            </View>
        </View>
    );
}
