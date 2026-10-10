import { cx, useBreakpoint, useIsCoarsePointer } from '@healthy360/design-system';
import type { PriceLine } from '@healthy360/api-client/contracts';
import type { Money } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { formatMoney } from '../marketplace/format.ts';

/**
 * The frame the basket, the checkout and the guest checkout share — HealthZone's `cart`,
 * `checkout` and `guest` screens are one composition drawn three times: a display title, a
 * main column of bordered cards, and an order-summary rail beside it.
 *
 * Feature-local on purpose. These pieces are the shape of *buying*, and nothing outside the three
 * screens has asked for them; the radio chips and the option cards are the candidates for the
 * design system if a second surface ever does.
 */

/* ── the page measure ───────────────────────────────────────────────────────────────────────── */

export interface CheckoutPageProps {
    /**
     * `default` is the basket's and the checkout's measure, `wide` the guest checkout's. The design
     * draws them as 1000px and 1040px containers with 28px of padding either side, so the content
     * column is 944px and 984px; the shell already owns the gutter, so only the column is set here.
     */
    readonly measure?: 'default' | 'wide' | undefined;
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}

export function CheckoutPage({ measure = 'default', children, testID }: CheckoutPageProps) {
    return (
        <View
            testID={testID}
            className={cx(
                'w-full flex-col gap-6 self-center',
                measure === 'wide' ? 'max-w-[984px]' : 'max-w-[944px]',
            )}
        >
            {children}
        </View>
    );
}

/* ── the title ──────────────────────────────────────────────────────────────────────────────── */

export interface CheckoutTitleProps {
    readonly children: string;
    /** `lg` is the basket/checkout's 38px title (snapped to 36); `md` the guest checkout's 30px. */
    readonly size?: 'lg' | 'md' | undefined;
    readonly testID?: string | undefined;
}

export function CheckoutTitle({ children, size = 'lg', testID }: CheckoutTitleProps) {
    return (
        <RNText
            testID={testID}
            accessibilityRole="header"
            aria-level={1}
            className={cx(
                'font-display font-bold leading-tight tracking-display text-content-primary text-start',
                size === 'lg' ? 'text-4xl' : 'text-3xl',
            )}
        >
            {children}
        </RNText>
    );
}

/* ── the two columns ────────────────────────────────────────────────────────────────────────── */

export interface CheckoutColumnsProps {
    readonly main: ReactNode;
    readonly aside: ReactNode;
    /** The rail's width from `lg`: 340px beside the basket and the guest form, 320px at checkout. */
    readonly asideWidth?: 'md' | 'lg' | undefined;
    /** `default` is the basket's and checkout's 24px gutter; `tight` the guest checkout's 18px. */
    readonly gap?: 'default' | 'tight' | undefined;
    readonly testID?: string | undefined;
}

/**
 * Main column beside a summary rail from `lg`; one column below it, the rail last.
 *
 * A *structural* branch, so it is `useBreakpoint` rather than responsive utilities: below `lg` the
 * rail is not narrower, it is somewhere else — after the form, where a phone reaches it once the
 * questions are answered. The rail is sticky on the web against the shell's scroll port
 * (`web:top-0` pins it under the top bar; the design's `top:130px` is a document offset this app
 * does not have). `z-auto` keeps a popover inside the main column from being painted under it.
 */
export function CheckoutColumns({
    main,
    aside,
    asideWidth = 'lg',
    gap = 'default',
    testID,
}: CheckoutColumnsProps) {
    const { atLeast } = useBreakpoint();
    const gapClass = gap === 'tight' ? 'gap-5' : 'gap-6';

    if (!atLeast('lg')) {
        return (
            <View testID={testID} className={cx('w-full flex-col', gapClass)}>
                <View testID={testID === undefined ? undefined : `${testID}-main`}>{main}</View>
                <View testID={testID === undefined ? undefined : `${testID}-aside`}>{aside}</View>
            </View>
        );
    }

    return (
        <View testID={testID} className={cx('w-full flex-row items-start', gapClass)}>
            <View
                testID={testID === undefined ? undefined : `${testID}-main`}
                className="min-w-0 flex-1"
            >
                {main}
            </View>
            <View
                testID={testID === undefined ? undefined : `${testID}-aside`}
                className={cx(
                    'z-auto shrink-0 self-start web:sticky web:top-0',
                    asideWidth === 'lg' ? 'w-[340px]' : 'w-[320px]',
                )}
            >
                {aside}
            </View>
        </View>
    );
}

/* ── the card ───────────────────────────────────────────────────────────────────────────────── */

export interface CheckoutCardProps {
    readonly children: ReactNode;
    /**
     * `none` for the basket's lines card, whose rows carry their own inset; `md` the 18–22px of the
     * rails and the guest blocks; `lg` the checkout step card's 26px.
     */
    readonly padding?: 'none' | 'md' | 'lg' | undefined;
    /** `lg` is the design's 16px card corner; `md` the guest checkout's 13px one. */
    readonly radius?: 'md' | 'lg' | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * The design's card: the raised surface inside one hairline, no cast. Not the design system's
 * `Card`, whose raised tone carries the admin's card shadow — HealthZone's customer cards are flat.
 */
export function CheckoutCard({
    children,
    padding = 'md',
    radius = 'lg',
    className,
    testID,
}: CheckoutCardProps) {
    return (
        <View
            testID={testID}
            className={cx(
                'border border-stroke bg-surface-raised',
                radius === 'lg' ? 'rounded-xl' : 'rounded-lg',
                padding === 'none'
                    ? 'overflow-hidden'
                    : padding === 'lg'
                      ? 'p-5 sm:p-6'
                      : 'px-4 py-4 sm:px-5',
                className,
            )}
        >
            {children}
        </View>
    );
}

/* ── the summary figures ────────────────────────────────────────────────────────────────────── */

export interface SummaryRowProps {
    readonly label: string;
    /** Already formatted — a figure, or a word ("At checkout") where there is no figure yet. */
    readonly value: string;
    /** `${testID}` on the row, `${testID}-amount` on the value. */
    readonly testID: string;
    /** `credit` is the design's accent-coloured discount figure. */
    readonly tone?: 'default' | 'credit' | undefined;
}

/** One label-and-figure line: muted label at the start, the figure at the end. */
export function SummaryRow({ label, value, testID, tone = 'default' }: SummaryRowProps) {
    return (
        <View testID={testID} className="flex-row items-baseline justify-between gap-3">
            <RNText className="shrink text-sm text-content-secondary text-start">{label}</RNText>
            <RNText
                testID={`${testID}-amount`}
                className={cx(
                    'text-sm tabular-nums text-end',
                    tone === 'credit' ? 'text-content-on-brand-subtle' : 'text-content-primary',
                )}
            >
                {value}
            </RNText>
        </View>
    );
}

export interface SummaryTotalProps {
    readonly label: string;
    readonly total: Money;
    /** `${testID}` on the row, `${testID}-amount` on the figure. */
    readonly testID: string;
    /** `rule` draws the design's divider above the total — the basket and checkout rails. */
    readonly rule?: boolean | undefined;
    /** `display` sets the label in the display face too — the guest rail's "Total". */
    readonly labelFace?: 'body' | 'display' | undefined;
}

/**
 * The total: a label at the start and the figure in the display face at the end, on one baseline.
 * The figure is the repository's and goes through `formatMoney` — nothing is added up here, because
 * a client-side sum of `Money` is a confident wrong number the day a basket quotes two currencies.
 */
export function SummaryTotal({
    label,
    total,
    testID,
    rule = false,
    labelFace = 'body',
}: SummaryTotalProps) {
    const formatter = useFormatter();

    return (
        <View
            testID={testID}
            className={cx(
                'flex-row items-baseline justify-between gap-3',
                rule ? 'border-t border-stroke pt-4' : null,
            )}
        >
            <RNText
                className={cx(
                    'text-base text-content-primary text-start',
                    labelFace === 'display' ? 'font-display font-bold' : 'font-semibold',
                )}
            >
                {label}
            </RNText>
            <RNText
                testID={`${testID}-amount`}
                className="font-display text-2xl font-bold tabular-nums tracking-display text-content-primary text-end"
            >
                {formatMoney(formatter, total)}
            </RNText>
        </View>
    );
}

/**
 * Catalogue copy for the price-line codes the repositories emit (`subtotal`, `delivery`,
 * `delivery_fee`). An unknown code keeps the server's own label rather than disappearing.
 */
export function priceLineLabel(t: TFunction, line: PriceLine): string {
    switch (line.code) {
        case 'subtotal':
            return t('commerce:cart.subtotal');
        case 'delivery':
        case 'delivery_fee':
            return t('commerce:cart.delivery');
        default:
            return line.label;
    }
}

/* ── the item lines in a rail ───────────────────────────────────────────────────────────────── */

export interface SummaryItem {
    readonly key: string;
    readonly name: string;
    readonly quantity: number;
    readonly lineTotal: Money;
}

/** `2 × Grilled halloumi bowl ……… AED 84.00` — the rail's list of what is being bought. */
export function SummaryItems({
    items,
    testID,
    emphasis = 'plain',
}: {
    readonly items: readonly SummaryItem[];
    readonly testID: string;
    /** `strong` sets the figures semibold — the guest rail draws them heavier than the names. */
    readonly emphasis?: 'plain' | 'strong' | undefined;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View testID={testID} className="flex-col gap-2.5">
            {items.map((item) => (
                <View
                    key={item.key}
                    testID={`${testID}-${item.key}`}
                    className="flex-row items-baseline justify-between gap-3"
                >
                    <RNText className="min-w-0 shrink text-sm text-content-primary text-start">
                        {t('commerce:cart.lineSummary', {
                            quantity: formatter.formatNumber(item.quantity),
                            meal: item.name,
                        })}
                    </RNText>
                    <RNText
                        className={cx(
                            'text-sm tabular-nums text-content-primary text-end',
                            emphasis === 'strong' ? 'font-semibold' : null,
                        )}
                    >
                        {formatMoney(formatter, item.lineTotal)}
                    </RNText>
                </View>
            ))}
        </View>
    );
}

/* ── one-of-n chips ─────────────────────────────────────────────────────────────────────────── */

export interface ChoiceChipOption {
    readonly value: string;
    readonly label: string;
    readonly testID?: string | undefined;
}

export interface ChoiceChipsProps {
    /** The group's accessible name. */
    readonly label: string;
    readonly options: readonly ChoiceChipOption[];
    readonly value: string | null;
    /** Omitted for a group of one, already chosen — the guest checkout's single payment method. */
    readonly onChange?: ((value: string) => void) | undefined;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

/**
 * A single choice drawn as the design's `chip()` row — delivery windows, contact channels, the
 * payment method.
 *
 * A radio group, not a row of toggles: exactly one is chosen, and `FilterChip`'s `aria-pressed`
 * would announce each as independently on or off. The chosen chip takes the brand-subtle fill and
 * the brand ring, as the design draws it; the choice is announced as `checked`. The 44px floor
 * follows the pointer exactly as `FilterChip`'s does — a finger gets it, a mouse gets the design's
 * 30px pill.
 */
export function ChoiceChips({
    label,
    options,
    value,
    onChange,
    disabled = false,
    testID,
}: ChoiceChipsProps) {
    const coarse = useIsCoarsePointer();

    return (
        <View
            testID={testID}
            role="radiogroup"
            accessibilityRole="radiogroup"
            aria-label={label}
            accessibilityLabel={label}
            className="flex-row flex-wrap gap-2"
        >
            {options.map((option) => {
                const chosen = option.value === value;
                return (
                    <Pressable
                        key={option.value}
                        testID={option.testID}
                        role="radio"
                        accessibilityRole="radio"
                        aria-checked={chosen}
                        accessibilityState={{ checked: chosen, disabled }}
                        aria-disabled={disabled}
                        disabled={disabled}
                        accessibilityLabel={option.label}
                        {...(onChange === undefined
                            ? {}
                            : {
                                  onPress: () => {
                                      onChange(option.value);
                                  },
                              })}
                        className={cx(
                            'flex-row items-center justify-center rounded-full border px-3 py-1.5',
                            coarse ? 'min-h-touch' : null,
                            chosen
                                ? 'border-surface-brand bg-surface-brand-subtle'
                                : 'border-stroke-strong bg-surface-raised hover:bg-surface-sunken',
                            disabled ? 'opacity-50' : null,
                        )}
                    >
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'text-xs font-medium',
                                chosen ? 'text-content-on-brand-subtle' : 'text-content-primary',
                            )}
                        >
                            {option.label}
                        </RNText>
                    </Pressable>
                );
            })}
        </View>
    );
}

/* ── option cards and radio rows ────────────────────────────────────────────────────────────── */

export interface OptionCardProps {
    readonly label: string;
    readonly sub: string;
    readonly chosen: boolean;
    /** Omitted for the chosen card of a one-real-option group: pressing it changes nothing. */
    readonly onPress?: (() => void) | undefined;
    readonly disabled?: boolean | undefined;
    /** Read after the label — for a card whose capability is not built yet. */
    readonly accessibilityHint?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * The checkout's Delivery / Pickup card: a bold label over a muted line, inside a ring that is the
 * brand colour when chosen and the strong hairline when not. A `radio` in its group.
 */
export function OptionCard({
    label,
    sub,
    chosen,
    onPress,
    disabled = false,
    accessibilityHint,
    testID,
}: OptionCardProps) {
    return (
        <Pressable
            testID={testID}
            role="radio"
            accessibilityRole="radio"
            aria-checked={chosen}
            accessibilityState={{ checked: chosen, disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            accessibilityLabel={`${label}, ${sub}`}
            {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
            {...(onPress === undefined ? {} : { onPress })}
            className={cx(
                'min-h-touch min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg border-2 bg-surface-raised px-4 py-3',
                chosen ? 'border-surface-brand' : 'border-stroke-strong hover:bg-surface-sunken',
                disabled ? 'opacity-60' : null,
            )}
        >
            <RNText className="text-base font-semibold text-content-primary text-start">
                {label}
            </RNText>
            <RNText className="text-sm text-content-secondary text-start">{sub}</RNText>
        </Pressable>
    );
}

export interface RadioRowProps {
    readonly label: string;
    readonly meta: string;
    readonly chosen: boolean;
    /** Omitted for the only method there is: choosing it again changes nothing. */
    readonly onPress?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

/** The checkout's payment row: a drawn radio, the method, and a muted note at the end. */
export function RadioRow({ label, meta, chosen, onPress, testID }: RadioRowProps) {
    return (
        <Pressable
            testID={testID}
            role="radio"
            accessibilityRole="radio"
            aria-checked={chosen}
            accessibilityState={{ checked: chosen }}
            accessibilityLabel={`${label}, ${meta}`}
            {...(onPress === undefined ? {} : { onPress })}
            className={cx(
                'min-h-touch flex-row items-center gap-3 rounded-lg border-2 bg-surface-raised px-4 py-3',
                chosen ? 'border-surface-brand' : 'border-stroke-strong',
            )}
        >
            <View
                aria-hidden
                className={cx(
                    'h-4 w-4 items-center justify-center rounded-full border-2',
                    chosen ? 'border-surface-brand' : 'border-stroke-strong',
                )}
            >
                {chosen ? <View className="h-2 w-2 rounded-full bg-surface-brand" /> : null}
            </View>
            <RNText className="min-w-0 flex-1 text-base font-medium text-content-primary text-start">
                {label}
            </RNText>
            <RNText className="text-sm text-content-secondary text-end">{meta}</RNText>
        </Pressable>
    );
}

/* ── text links ─────────────────────────────────────────────────────────────────────────────── */

export interface TextLinkProps {
    readonly label: string;
    readonly onPress: () => void;
    /** `accent` is the design's underlined green "Edit options"; `muted` its grey "Remove". */
    readonly tone?: 'accent' | 'muted' | undefined;
    readonly disabled?: boolean | undefined;
    readonly accessibilityHint?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * The design's bare text buttons on a basket line. A button by role — each one does something on
 * this screen — drawn as words; the 44px floor follows the pointer, as it does on the chips.
 */
export function TextLink({
    label,
    onPress,
    tone = 'accent',
    disabled = false,
    accessibilityHint,
    testID,
}: TextLinkProps) {
    const coarse = useIsCoarsePointer();

    return (
        <Pressable
            testID={testID}
            role="button"
            accessibilityRole="button"
            accessibilityLabel={label}
            accessibilityState={{ disabled }}
            aria-disabled={disabled}
            disabled={disabled}
            {...(accessibilityHint === undefined ? {} : { accessibilityHint })}
            onPress={onPress}
            className={cx(
                'justify-center',
                coarse ? 'min-h-touch' : null,
                disabled ? 'opacity-50' : null,
            )}
        >
            <RNText
                className={cx(
                    'text-sm font-medium',
                    tone === 'accent'
                        ? 'text-content-on-brand-subtle underline'
                        : 'text-content-secondary',
                )}
            >
                {label}
            </RNText>
        </Pressable>
    );
}

/* ── field rows ─────────────────────────────────────────────────────────────────────────────── */

/**
 * One row of the design's two-column field grid. Two children sit side by side from `sm`, each
 * taking half; one child spans the row (`grid-column: span 2`). Below `sm` every field is full
 * width — a 375px phone has no room for two inputs abreast.
 */
export function FieldRow({ children }: { readonly children: ReactNode }) {
    return <View className="flex-col gap-3 sm:flex-row sm:items-start">{children}</View>;
}

/** A half-width cell in a {@link FieldRow}. */
export function FieldCell({ children }: { readonly children: ReactNode }) {
    return <View className="min-w-0 sm:flex-1">{children}</View>;
}

/* ── the step bar ───────────────────────────────────────────────────────────────────────────── */

export interface CheckoutStepItem {
    readonly key: string;
    readonly label: string;
}

export interface CheckoutStepsProps {
    /** The sequence's accessible name. */
    readonly label: string;
    readonly steps: readonly CheckoutStepItem[];
    /** One-based. */
    readonly current: number;
    readonly testID: string;
}

export type SectionState = 'current' | 'done' | 'upcoming';

/**
 * The checkout's progress as the design draws it: one bordered bar, a segment per step, the
 * current segment on the sunken surface, each with a numbered dot — brand for a step behind you,
 * ink for the one you are on, the sunken well for the ones ahead. Read-only: going back is the
 * payment step's own "Back", because the delivery step is the only one a person can return to
 * without undoing a placement.
 *
 * Below `sm` only the current step keeps its label; the numbered dots still say how long the
 * flow is, and three labels do not fit a phone without truncating all of them.
 */
export function CheckoutSteps({ label, steps, current, testID }: CheckoutStepsProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const total = steps.length;

    return (
        <View
            testID={testID}
            role="list"
            aria-label={label}
            accessibilityLabel={label}
            className="w-full flex-row overflow-hidden rounded-lg border border-stroke bg-surface-raised"
        >
            {steps.map((step, index) => {
                const number = index + 1;
                const state: SectionState =
                    number < current ? 'done' : number === current ? 'current' : 'upcoming';
                return (
                    <View
                        key={step.key}
                        testID={`${testID}-${step.key}`}
                        role="listitem"
                        aria-current={state === 'current' ? 'step' : undefined}
                        accessibilityLabel={t(
                            state === 'current'
                                ? 'commerce:checkout.stepCurrent'
                                : state === 'done'
                                  ? 'commerce:checkout.stepDone'
                                  : 'commerce:checkout.stepUpcoming',
                            { step: number, total, label: step.label },
                        )}
                        className={cx(
                            'flex-row items-center gap-2.5 px-4 py-4',
                            state === 'current'
                                ? 'min-w-0 flex-1 bg-surface-sunken'
                                : 'sm:min-w-0 sm:flex-1',
                            index > 0 ? 'border-s border-stroke-subtle' : null,
                        )}
                    >
                        <View
                            aria-hidden
                            accessibilityElementsHidden
                            importantForAccessibility="no-hide-descendants"
                            className={cx(
                                'h-6 w-6 shrink-0 items-center justify-center rounded-full',
                                state === 'done'
                                    ? 'bg-surface-brand'
                                    : state === 'current'
                                      ? 'bg-surface-inverse'
                                      : 'bg-surface-sunken',
                            )}
                        >
                            <RNText
                                className={cx(
                                    'text-xs font-semibold tabular-nums',
                                    state === 'done'
                                        ? 'text-content-on-brand'
                                        : state === 'current'
                                          ? 'text-content-inverse'
                                          : 'text-content-primary',
                                )}
                            >
                                {formatter.formatNumber(number)}
                            </RNText>
                        </View>
                        <RNText
                            numberOfLines={1}
                            className={cx(
                                'shrink text-sm font-semibold',
                                state === 'upcoming'
                                    ? 'text-content-secondary'
                                    : 'text-content-primary',
                                state === 'current' ? null : 'hidden sm:flex',
                            )}
                        >
                            {step.label}
                        </RNText>
                    </View>
                );
            })}
        </View>
    );
}

/* ── a numbered section ─────────────────────────────────────────────────────────────────────── */

/** The guest checkout's numbered dot: the call-to-action fill carrying its number. */
export function NumberDot({ number }: { readonly number: number }) {
    const formatter = useFormatter();

    return (
        <View
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            className="h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-brand"
        >
            <RNText className="text-xs font-semibold tabular-nums text-content-on-brand">
                {formatter.formatNumber(number)}
            </RNText>
        </View>
    );
}
