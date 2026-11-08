import { Icon, Skeleton, Text } from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

/**
 * The New order page's own parts (the Order desk redesign, 2026-11-07): the step marker by the
 * title, the menu's sections as a side rail with counts, the stepper a tile grows once its dish is
 * on the ticket, and the label a field takes on the ticket's green ground.
 *
 * Drawn on `/showcase-order-desk` as well as the sale page.
 */

/* ------------------------------------------------------------------------------------------------
 * The step marker
 * ---------------------------------------------------------------------------------------------- */

export interface SaleStep {
    readonly key: string;
    /** Translated. */
    readonly label: string;
}

/**
 * `(1 Customer) (2 Meals) (3 Checkout)` — where the agent is in the sale. The step in hand is a
 * pill in the sidebar green; the ones behind it are ticked off in the soft brand ground.
 */
export function SaleSteps({
    steps,
    current,
    label,
    testID,
}: {
    readonly steps: readonly SaleStep[];
    /** The index of the step in hand. */
    readonly current: number;
    /** Translated: the marker's accessible name. */
    readonly label: string;
    readonly testID: string;
}) {
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            role="list"
            aria-label={label}
            className="flex-row items-center gap-1.5 rounded-full border border-brand-100 bg-surface-raised p-1"
        >
            {steps.map((step, index) => {
                const on = index === current;
                const done = index < current;
                return (
                    <View
                        key={step.key}
                        testID={`${testID}-${step.key}`}
                        role="listitem"
                        aria-current={on ? 'step' : undefined}
                        className={`h-desk-step flex-row items-center gap-[7px] rounded-full pe-3 ps-1 ${
                            on ? 'bg-surface-canopy' : ''
                        }`}
                    >
                        <View
                            className={`h-desk-step-mark w-desk-step-mark items-center justify-center rounded-full ${
                                on
                                    ? 'bg-brand-300'
                                    : done
                                      ? 'bg-surface-brand-subtle'
                                      : 'bg-surface-sunken'
                            }`}
                        >
                            {done ? (
                                <Icon
                                    name="check"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                            ) : (
                                <Text
                                    variant="caption"
                                    tone="secondary"
                                    className={
                                        on
                                            ? '!text-[11px] font-bold !text-surface-canopy'
                                            : '!text-[11px] font-bold'
                                    }
                                >
                                    {formatter.formatNumber(index + 1)}
                                </Text>
                            )}
                        </View>
                        <Text
                            variant="label"
                            tone={done ? 'primary' : 'secondary'}
                            className={
                                on ? 'font-semibold !text-content-on-canopy' : 'font-semibold'
                            }
                        >
                            {step.label}
                        </Text>
                    </View>
                );
            })}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The section rail
 * ---------------------------------------------------------------------------------------------- */

export type SectionTint = 'brand' | 'neutral' | 'warning' | 'info' | 'danger';

const TINT_CLASS: Readonly<Record<SectionTint, string>> = {
    brand: 'bg-surface-brand-subtle',
    neutral: 'bg-surface-sunken',
    warning: 'bg-warning-subtle',
    info: 'bg-info-subtle',
    danger: 'bg-danger-subtle',
};

const TINT_INK: Readonly<Record<SectionTint, string>> = {
    brand: 'text-content-on-brand-subtle',
    neutral: 'text-content-secondary',
    warning: 'text-warning-on-subtle',
    info: 'text-info-on-subtle',
    danger: 'text-danger-on-subtle',
};

export interface RailSection<T extends string> {
    readonly value: T;
    /** Translated. */
    readonly label: string;
    readonly icon: IconName;
    readonly tint: SectionTint;
    /** How many the section holds; `null` while it is being counted. */
    readonly count: number | null;
}

/**
 * The menu's sections down the side of the grid — glyph, name, count — the one in hand raised onto
 * the card ground with a brand bar on its leading edge.
 */
export function SectionRail<T extends string>({
    sections,
    value,
    onChange,
    label,
    testID,
}: {
    readonly sections: readonly RailSection<T>[];
    readonly value: T;
    readonly onChange: (value: T) => void;
    /** Translated: the rail's accessible name. */
    readonly label: string;
    readonly testID: string;
}) {
    const formatter = useFormatter();

    return (
        <View testID={testID} role="radiogroup" aria-label={label} className="flex-col gap-1">
            {sections.map((section) => {
                const on = section.value === value;
                return (
                    <Pressable
                        key={section.value}
                        testID={`${testID}-status-${section.value}`}
                        role="radio"
                        accessibilityRole="radio"
                        aria-checked={on}
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={
                            section.count === null
                                ? section.label
                                : `${section.label} ${formatter.formatNumber(section.count)}`
                        }
                        onPress={() => {
                            onChange(section.value);
                        }}
                        className={`relative h-11 flex-row items-center gap-2.5 overflow-hidden rounded-lg pe-2.5 ps-1.5 ${
                            on
                                ? 'bg-surface-raised shadow-elevation-card'
                                : 'web:hover:bg-surface-raised'
                        }`}
                    >
                        {on ? (
                            <View
                                aria-hidden
                                className="absolute bottom-0 start-0 top-0 w-1 bg-surface-brand"
                            />
                        ) : null}
                        <View
                            className={`h-8 w-8 items-center justify-center rounded-lg ${TINT_CLASS[section.tint]}`}
                        >
                            <Icon
                                name={section.icon}
                                size="sm"
                                className={TINT_INK[section.tint]}
                            />
                        </View>
                        {/* eslint-disable-next-line no-restricted-syntax -- the name is the row's filler. */}
                        <View className="min-w-0 flex-1">
                            <Text variant="label" className="font-semibold" numberOfLines={1}>
                                {section.label}
                            </Text>
                        </View>
                        {section.count === null ? (
                            <Skeleton heightClassName="h-3" widthClassName="w-4" />
                        ) : (
                            <Text
                                variant="caption"
                                tone="secondary"
                                className="tabular-nums"
                                testID={`${testID}-count-${section.value}`}
                            >
                                {formatter.formatNumber(section.count)}
                            </Text>
                        )}
                    </Pressable>
                );
            })}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The tile's stepper
 * ---------------------------------------------------------------------------------------------- */

/**
 * `(− 2 +)` — what a menu tile grows at its top corner once its dish is on the ticket. It floats over
 * the photograph, so it is drawn as the tile's sibling, never inside the tile's own button.
 */
export function TileStepper({
    count,
    onDecrease,
    onIncrease,
    decreaseLabel,
    increaseLabel,
    increaseDisabled = false,
    testID,
}: {
    readonly count: number;
    readonly onDecrease: () => void;
    readonly onIncrease: () => void;
    /** Translated. */
    readonly decreaseLabel: string;
    /** Translated. */
    readonly increaseLabel: string;
    readonly increaseDisabled?: boolean | undefined;
    readonly testID: string;
}) {
    const formatter = useFormatter();
    const step = (
        icon: IconName,
        accessibilityLabel: string,
        onPress: () => void,
        disabled: boolean,
        id: string,
    ) => (
        <Pressable
            testID={`${testID}-${id}`}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            aria-disabled={disabled}
            disabled={disabled}
            onPress={onPress}
            className={`h-6 w-6 items-center justify-center rounded-full bg-surface-sunken ${
                disabled ? 'opacity-40' : 'web:hover:bg-surface-brand-subtle'
            }`}
        >
            <Icon name={icon} size="sm" className="text-content-primary" />
        </Pressable>
    );

    return (
        <View
            testID={testID}
            className="flex-row items-center gap-0.5 rounded-full bg-surface-raised p-0.5 shadow-elevation-card"
        >
            {step('minus', decreaseLabel, onDecrease, false, 'decrement')}
            <View className="min-w-5 items-center">
                <Text
                    variant="caption"
                    className="font-bold tabular-nums"
                    aria-live="polite"
                    testID={`${testID}-count`}
                >
                    {formatter.formatNumber(count)}
                </Text>
            </View>
            {step('plus', increaseLabel, onIncrease, increaseDisabled, 'increment')}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * How the order leaves
 * ---------------------------------------------------------------------------------------------- */

export interface KindTile<T extends string> {
    readonly value: T;
    /** Translated. */
    readonly title: string;
    /** Translated: a few words under the title. */
    readonly body: string;
    readonly icon: IconName;
}

/**
 * Counter, collection, delivery — three tiles on one row, each a glyph over its name and a few
 * words. The chosen one takes the soft brand ground and a brand ring; its glyph turns solid.
 */
export function KindTiles<T extends string>({
    tiles,
    value,
    onChange,
    label,
    testID,
}: {
    readonly tiles: readonly KindTile<T>[];
    /** `null`: nothing chosen yet. */
    readonly value: T | null;
    readonly onChange: (value: T) => void;
    /** Translated: the group's accessible name. */
    readonly label: string;
    readonly testID: string;
}) {
    return (
        <View testID={testID} role="radiogroup" aria-label={label} className="flex-row gap-2">
            {tiles.map((tile) => {
                const on = tile.value === value;
                return (
                    <Pressable
                        key={tile.value}
                        testID={`${testID}-${tile.value}`}
                        role="radio"
                        accessibilityRole="radio"
                        aria-checked={on}
                        accessibilityState={{ checked: on }}
                        aria-label={tile.title}
                        onPress={() => {
                            onChange(tile.value);
                        }}
                        // eslint-disable-next-line no-restricted-syntax -- three equal tiles share the row.
                        className={`min-w-0 flex-1 flex-row items-center gap-2.5 rounded-xl border-2 px-2 py-2 ${
                            on
                                ? 'border-surface-brand bg-surface-brand-subtle'
                                : 'border-brand-100 bg-surface-raised web:hover:border-brand-300'
                        }`}
                    >
                        <View
                            className={`h-10 w-10 items-center justify-center rounded-lg ${
                                on ? 'bg-surface-brand' : 'bg-surface-sunken'
                            }`}
                        >
                            <Icon
                                name={tile.icon}
                                size="md"
                                className={
                                    on ? 'text-content-on-brand' : 'text-content-on-brand-subtle'
                                }
                            />
                        </View>
                        {/* eslint-disable-next-line no-restricted-syntax -- the words take the rest. */}
                        <View className="min-w-0 flex-1 flex-col">
                            <Text variant="strong" numberOfLines={1}>
                                {tile.title}
                            </Text>
                            <Text variant="caption" tone="secondary" numberOfLines={1}>
                                {tile.body}
                            </Text>
                        </View>
                    </Pressable>
                );
            })}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * A label on the ticket
 * ---------------------------------------------------------------------------------------------- */

/** An uppercase label on the ticket's green ground, over a field drawn with its own label hidden. */
export function TicketLabel({
    children,
    aside,
}: {
    readonly children: string;
    /** The field's hint, as an (i) beside the label. */
    readonly aside?: ReactNode | undefined;
}) {
    return (
        <View className="flex-row items-center gap-1.5">
            <Text
                variant="micro"
                tone="sidebarMuted"
                className="font-semibold uppercase tracking-wider"
            >
                {children}
            </Text>
            {aside}
        </View>
    );
}
