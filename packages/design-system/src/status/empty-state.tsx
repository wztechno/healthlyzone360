import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { Badge } from '../content/badge.tsx';
import { useDensity } from '../hooks/use-density.tsx';
import type { Density } from '../hooks/use-density.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { InfoTip } from '../overlays/info-tip.tsx';

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
    /**
     * The admin's shapes (compact density only; the customer surfaces ignore them):
     * `panel` stands alone on the page, `table` sits under a table's header, `row` is the one-line
     * form for a small table among several.
     */
    readonly shape?: 'panel' | 'table' | 'row' | undefined;
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
 * On the admin (compact density) it is option C of the canvas's `Empty states` page: a soft icon
 * tile, a title and, where there is a next step, a button. No dashed box and no sentence on the page:
 * a `body` goes behind an (i) beside the title.
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
    shape = 'panel',
    className,
    testID,
}: EmptyStateProps) {
    const { t } = useTranslation();
    const density = useDensity();
    const isPrototype = variant === 'prototype';
    const resolvedIcon: IconName = icon ?? (isPrototype ? 'prototype' : 'info');

    if (density === 'compact' && !isPrototype) {
        const row = shape === 'row';
        return (
            <View
                testID={testID}
                role="region"
                accessibilityLabel={title}
                className={cx(
                    row
                        ? 'flex-row flex-wrap items-center gap-3 px-3.5 py-3'
                        : 'flex-col items-center gap-3 px-4 py-11',
                    shape === 'panel'
                        ? 'rounded-panel border border-stroke-subtle bg-surface-raised'
                        : null,
                    className,
                )}
            >
                <View
                    className={cx(
                        'items-center justify-center bg-surface-brand-subtle',
                        row ? 'h-9 w-9 rounded-[11px]' : 'h-12 w-12 rounded-[14px]',
                    )}
                >
                    <Icon
                        name={resolvedIcon}
                        size={row ? 'md' : 'lg'}
                        className="text-content-on-brand-subtle"
                    />
                </View>
                <View className="flex-row items-center gap-1.5">
                    <RNText
                        testID={testID === undefined ? undefined : `${testID}-title`}
                        accessibilityRole="header"
                        aria-level={2}
                        className={cx(
                            row ? 'text-[13px] font-semibold' : 'text-[15px] font-bold',
                            'font-sans text-content-primary',
                        )}
                    >
                        {title}
                    </RNText>
                    {body === undefined ? null : (
                        <InfoTip
                            label={title}
                            text={body}
                            {...(testID === undefined ? {} : { testID: `${testID}-info` })}
                        />
                    )}
                </View>
                {actions === undefined || actions === null ? null : row ? (
                    <View className="ms-auto">{actions}</View>
                ) : (
                    <View className="items-center">{actions}</View>
                )}
            </View>
        );
    }

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
