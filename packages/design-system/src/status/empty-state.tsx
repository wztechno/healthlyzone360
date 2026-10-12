import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Badge } from '../content/badge.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
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
 * The two ladders. Comfortable is the customer surfaces' block, unchanged; compact is the admin's —
 * the same parts on the `role-*` steps and the panel radius, so an empty table on a desk page is
 * the size of the toolbar above it rather than a hero.
 */
const FRAME_CLASS: Readonly<Record<Density, string>> = {
    comfortable:
        'flex-col items-center gap-3 rounded-xl border border-dashed border-stroke bg-surface-base p-8',
    compact:
        'flex-col items-center gap-tight rounded-panel border border-dashed border-stroke bg-surface-base p-base',
};
const TITLE_CLASS: Readonly<Record<Density, string>> = {
    comfortable: 'text-xl font-semibold text-content-primary text-center',
    compact: 'text-role-title text-content-primary text-center',
};
const BODY_CLASS: Readonly<Record<Density, string>> = {
    comfortable: 'max-w-[52ch] text-sm text-content-secondary text-center',
    compact: 'max-w-[52ch] text-role-body text-content-secondary text-center',
};

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
    const density = useDensity();
    const isPrototype = variant === 'prototype';
    const resolvedIcon: IconName = icon ?? (isPrototype ? 'prototype' : 'info');

    return (
        <View
            testID={testID}
            role="region"
            accessibilityLabel={title}
            className={cx(FRAME_CLASS[density], className)}
        >
            <Icon
                name={resolvedIcon}
                size={density === 'compact' ? 'md' : 'lg'}
                className="text-content-secondary"
            />

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
                className={TITLE_CLASS[density]}
            >
                {title}
            </RNText>

            {body === undefined ? null : <RNText className={BODY_CLASS[density]}>{body}</RNText>}

            {isPrototype ? (
                <RNText
                    testID={testID === undefined ? undefined : `${testID}-prototype-body`}
                    className={BODY_CLASS[density]}
                >
                    {t('designSystem:emptyState.prototypeBody')}
                </RNText>
            ) : (
                actions
            )}
        </View>
    );
}
