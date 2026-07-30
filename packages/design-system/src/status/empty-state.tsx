import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Badge } from '../content/badge.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export const EMPTY_STATE_VARIANTS = ['empty', 'prototype'] as const;
export type EmptyStateVariant = (typeof EMPTY_STATE_VARIANTS)[number];

export interface EmptyStateProps {
    readonly title: string;
    readonly body?: string | undefined;
    readonly variant?: EmptyStateVariant | undefined;
    readonly icon?: IconName | undefined;
    /**
     * Actions are only permitted on the `empty` variant. The `prototype` variant renders none by
     * design — a button that cannot do anything is worse than no button.
     */
    readonly actions?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Empty state.
 *
 * Two variants with genuinely different contracts:
 *
 * * `empty` — there is nothing here *yet*; the user may be able to change that, so actions are
 *   allowed.
 * * `prototype` — this area is not built. It carries the translated "Prototype — planned for a
 *   later phase" badge and **never** renders actions, even if some are passed. Every unbuilt area
 *   in the application renders exactly this, from one shared screen (plan §16: do not generate
 *   dozens of empty pages, and no dead buttons anywhere).
 */
export function EmptyState({
    title,
    body,
    variant = 'empty',
    icon,
    actions,
    className,
    testID,
}: EmptyStateProps) {
    const { t } = useTranslation();
    const isPrototype = variant === 'prototype';
    const resolvedIcon: IconName = icon ?? (isPrototype ? 'prototype' : 'info');

    return (
        <View
            testID={testID}
            role="region"
            accessibilityLabel={title}
            className={cx(
                'flex-col items-center gap-3 rounded-xl border border-dashed border-stroke bg-surface-base p-8',
                className,
            )}
        >
            <Icon name={resolvedIcon} size="lg" className="text-content-secondary" />

            {isPrototype ? (
                <Badge
                    testID={testID === undefined ? undefined : `${testID}-prototype-badge`}
                    tone="warning"
                    label={t('designSystem:emptyState.prototypeBadge')}
                />
            ) : null}

            <RNText
                testID={testID === undefined ? undefined : `${testID}-title`}
                accessibilityRole="header"
                aria-level={2}
                className="text-xl font-semibold text-content-primary text-center"
            >
                {title}
            </RNText>

            {body === undefined ? null : (
                <RNText className="max-w-[52ch] text-sm text-content-secondary text-center">
                    {body}
                </RNText>
            )}

            {isPrototype ? (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-prototype-body`}
                    className="max-w-[52ch] text-sm text-content-secondary text-center"
                >
                    {t('designSystem:emptyState.prototypeBody')}
                </RNText>
            ) : (
                actions
            )}
        </View>
    );
}
