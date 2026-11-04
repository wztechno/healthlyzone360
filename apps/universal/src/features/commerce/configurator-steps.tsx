import { Callout, Icon, cx } from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    PlanVariant,
    SubscriptionPlan,
    SubscriptionPreview,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { listDayPrice } from '../catalogue/plan-balance.ts';
import { durationLabel } from '../catalogue/plan-duration-label.ts';
import { TINT_FILL, TINT_INK } from '../catalogue/shelf-tints.ts';
import { formatMoney, weekdayKey } from '../marketplace/format.ts';
import {
    combinationKey,
    configuredDeliveryDates,
    durationOption,
    mealCombinations,
    missingPicks,
    perDeliveryPrice,
    sittingsOf,
    variantById,
} from './configurator.ts';
import type { ConfiguratorState, ConfiguratorStep } from './configurator.ts';
import { addDays, isoWeekday } from './dates.ts';
import type { DeliveryAreaStatus, DeliverySlotOption } from './delivery.ts';
import { PlanAllergyNotice } from './my-allergens.tsx';
import { DayTile, OptionTile, SegChoice, SetupLabel, SetupPane } from './plan-setup-frame.tsx';
import { PriceSummary } from './price-summary.tsx';
import type { PriceRow } from './price-summary.tsx';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from './warnings.ts';

/**
 * The plan, delivery and review steps of the plan setup, as the accepted board draws them: each one
 * pane under a title, its questions under small uppercase labels, answered with the board's
 * segmented rows, day tiles and option tiles. A question with one possible answer is not asked —
 * the band's chips already state it. The screen owns navigation, validation, the request and the
 * summary; these own layout and nothing else.
 */

export interface StepPatch {
    (patch: Partial<ConfiguratorState>): void;
}

/* ── ① plan: band, meals, length ─────────────────────────────────────────────────────────────── */

export interface PlanStepProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    /** A combination was chosen; the screen moves to the nearest variant that offers it. */
    readonly onCombination: (key: string) => void;
    /** "Change plan" — back to the plans to choose another. */
    readonly onChangePlan: () => void;
}

export function PlanStep({
    plan,
    variant,
    state,
    patch,
    onCombination,
    onChangePlan,
}: PlanStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const combinations = mealCombinations(plan);

    return (
        <SetupPane testID="configurator-step-plan" title={t('commerce:configurator.plan.title')}>
            <View
                testID="configurator-chosen-plan"
                className={cx(
                    'mt-4 flex-row flex-wrap items-center gap-3.5 rounded-[20px] px-[18px] py-4',
                    TINT_FILL.green,
                )}
            >
                <View className="h-12 w-12 items-center justify-center rounded-[14px] bg-surface-raised">
                    <Icon name="calendar" size="lg" className={TINT_INK.green} />
                </View>
                <View className="min-w-0 flex-1 flex-col gap-1.5">
                    <RNText
                        className={cx(
                            'font-display text-2xl font-bold tracking-display text-start',
                            TINT_INK.green,
                        )}
                    >
                        {plan.name}
                    </RNText>
                    {variant === null ? null : (
                        <View className="flex-row flex-wrap gap-1.5">
                            <PlanChip
                                label={t('commerce:configurator.aDay', {
                                    value: bandLabel(variant, formatter.formatNumber, t),
                                })}
                            />
                            <PlanChip label={mealsLine(variant, formatter.formatNumber, t)} />
                        </View>
                    )}
                </View>
                <View className="items-end gap-1.5">
                    {variant === null ? null : (
                        <View className="flex-row items-baseline gap-1">
                            <RNText
                                testID="configurator-chosen-price"
                                className={cx(
                                    'font-display text-3xl font-bold tabular-nums tracking-display',
                                    TINT_INK.green,
                                )}
                            >
                                {formatMoney(formatter, listDayPrice(variant))}
                            </RNText>
                            <RNText className={cx('text-xs', TINT_INK.green)}>
                                {t('catalogue:plans.aDay')}
                            </RNText>
                        </View>
                    )}
                    <Pressable
                        testID="configurator-change-plan"
                        role="link"
                        accessibilityRole="link"
                        onPress={onChangePlan}
                        className="h-9 justify-center rounded-[10px] bg-surface-raised px-3"
                    >
                        <RNText className="text-sm font-semibold text-content-primary hover:text-content-on-brand-subtle">
                            {t('commerce:configurator.plan.changePlan')}
                        </RNText>
                    </Pressable>
                </View>
            </View>

            {plan.variants.length > 1 ? (
                <>
                    <SetupLabel>{t('commerce:configurator.plan.variantLabel')}</SetupLabel>
                    <SegChoice
                        testID="configurator-variant"
                        label={t('commerce:configurator.plan.variantLabel')}
                        value={state.variantId === null ? null : String(state.variantId)}
                        onChange={(next) => {
                            const chosen = plan.variants.find(
                                (option) => String(option.id) === next,
                            );
                            if (chosen !== undefined) patch({ variantId: chosen.id });
                        }}
                        options={plan.variants.map((option) => ({
                            value: String(option.id),
                            title: variantName(option, formatter.formatNumber, t),
                            sub: t('catalogue:plan.pricePerDay', {
                                price: formatMoney(formatter, listDayPrice(option)),
                            }),
                            testID: `configurator-variant-${String(option.id)}`,
                        }))}
                    />
                </>
            ) : null}

            {combinations.length > 1 ? (
                <>
                    <SetupLabel>{t('commerce:configurator.combination.label')}</SetupLabel>
                    <SegChoice
                        testID="configurator-combination"
                        label={t('commerce:configurator.combination.label')}
                        value={variant === null ? null : combinationKey(variant)}
                        onChange={onCombination}
                        options={combinations.map((combination) => ({
                            value: combinationKey(combination),
                            title: combinationLabel(combination, formatter.formatNumber, t),
                            testID: `configurator-combination-${combinationKey(combination)}`,
                        }))}
                    />
                </>
            ) : null}

            <SetupLabel>{t('commerce:configurator.duration.howLong')}</SetupLabel>
            {/* A plan with no length on sale says so; a row of nothing would leave the step with
                a question it cannot answer and a Continue it cannot pass. */}
            {plan.durations.length === 0 ? (
                <RNText
                    testID="configurator-duration-none"
                    className="self-start text-base text-content-secondary text-start"
                >
                    {t('catalogue:plan.noDurations')}
                </RNText>
            ) : (
                <SegChoice
                    testID="configurator-duration"
                    label={t('commerce:configurator.duration.howLong')}
                    value={state.duration}
                    onChange={(next) => {
                        const option = plan.durations.find((each) => each.duration === next);
                        if (option !== undefined) patch({ duration: option.duration });
                    }}
                    options={plan.durations.map((option) => {
                        // "28 days" over "4 weeks · −5%"; a length that is not whole weeks has no
                        // second name, so only its discount, if any, goes under it.
                        const title = t('catalogue:plans.finderDaysValue', { count: option.days });
                        const length = durationLabel(option.days, t, formatter.formatNumber);
                        const percent = formatter.formatNumber(option.discountPercent);
                        const named = length === title ? null : length;
                        const sub =
                            option.discountPercent > 0
                                ? named === null
                                    ? t('catalogue:plan.durationDiscount', { discount: percent })
                                    : t('commerce:configurator.duration.withDiscount', {
                                          duration: named,
                                          percent,
                                      })
                                : (named ?? undefined);
                        return {
                            value: option.duration,
                            title,
                            sub,
                            testID: `configurator-duration-${option.duration}`,
                        };
                    })}
                />
            )}
        </SetupPane>
    );
}

/** A white chip on the chosen-plan card. */
function PlanChip({ label }: { readonly label: string }) {
    return (
        <View className="h-6 justify-center rounded-full bg-surface-raised px-2.5">
            <RNText className="text-xs font-semibold tabular-nums text-content-primary">
                {label}
            </RNText>
        </View>
    );
}

/** "3 meals · 1 snack" — plural on each count, no snack clause when there are none. */
export function combinationLabel(
    combination: { readonly mealsPerDay: number; readonly snacksPerDay: number },
    formatNumber: (value: number) => string,
    t: TFunction,
): string {
    const meals = t('commerce:configurator.combination.meals', {
        count: combination.mealsPerDay,
        meals: formatNumber(combination.mealsPerDay),
    });
    if (combination.snacksPerDay === 0) return meals;
    return t('commerce:configurator.combination.withSnacks', {
        meals,
        snacks: t('commerce:configurator.combination.snacks', {
            count: combination.snacksPerDay,
            snacks: formatNumber(combination.snacksPerDay),
        }),
    });
}

/** "2 meals + 1 snack a day" — the board's meals line. */
export function mealsLine(
    combination: { readonly mealsPerDay: number; readonly snacksPerDay: number },
    formatNumber: (value: number) => string,
    t: TFunction,
): string {
    return t('commerce:configurator.aDay', {
        value: combinationLabel(combination, formatNumber, t),
    });
}

/** "1,200–1,500 kcal". */
export function bandLabel(
    variant: Pick<PlanVariant, 'energyRange'>,
    formatNumber: (value: number) => string,
    t: TFunction,
): string {
    return t('commerce:configurator.plan.bandName', {
        min: formatNumber(variant.energyRange.min),
        max: formatNumber(variant.energyRange.max),
    });
}

/**
 * What a calorie band is called. A plan configuration need not carry a name of its own — the
 * server falls back to its energy band's — and when neither does, the kcal range stands in, so
 * a band choice is never an empty pill.
 */
export function variantName(
    variant: Pick<PlanVariant, 'name' | 'energyRange'>,
    formatNumber: (value: number) => string,
    t: TFunction,
): string {
    if (variant.name.trim() !== '') return variant.name;
    return bandLabel(variant, formatNumber, t);
}

/** The chosen weekdays as a run of names — or "Every day" when it is all seven. */
export function weekdayRun(weekdays: readonly number[], t: TFunction): string {
    if (weekdays.length === 7) return t('commerce:configurator.summary.everyDay');
    return [...weekdays]
        .sort((a, b) => a - b)
        .map((weekday) => t(weekdayKey(weekday)))
        .join(t('commerce:common.listSeparator'));
}

/** A slot's name: the kitchen's own label, else the house name for its code. */
export function slotName(slot: DeliverySlotOption | undefined, code: string, t: TFunction): string {
    return slot?.label ?? t(`commerce:slots.${code}`, { defaultValue: code });
}

/* ── ② delivery: days, start, window, address, allergies ───────────────────────────────────── */

/** How many start dates the board offers, from the earliest. */
export const START_TILES = 10;

export interface DeliveryStepProps {
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly allowedWeekdays: readonly number[] | null;
    /** The first day a start may fall on: tomorrow, or later when the cut-off reaches past it. */
    readonly earliestStartDate: string;
    /**
     * Where the start tiles begin: the cut-off's floor before the chosen days are applied, so a day
     * the days rule out is drawn greyed rather than missing — the board's row of ten.
     */
    readonly firstStartTile: string;
    /** The plan's change cut-off, so the step can say why the earliest start is what it is. */
    readonly cutoffHours: number;
    /** The kitchen's delivery windows. */
    readonly slots: readonly DeliverySlotOption[];
    readonly areaStatus: DeliveryAreaStatus;
    readonly servedAreas: readonly string[];
    /** The dishes picked so far — none yet on a first pass — checked against the allergy list. */
    readonly chosenMeals: readonly MarketplaceMeal[];
    /** False until the kitchen's menu has loaded, so an empty list is not read as safe. */
    readonly chosenMealsLoaded: boolean;
    /** This step's own URL — where the allergy editor comes back to. */
    readonly returnTo: string;
    readonly showIssues: boolean;
    readonly savedAddresses: readonly CustomerAddress[];
    readonly addressId: string | null;
    readonly onAddressIdChange: (id: string | null) => void;
    /**
     * Opens the address editor, which saves the address and comes back to this step with it chosen.
     * The screen persists the set-up before it leaves, so nothing on the way here is lost.
     */
    readonly onAddAddress: () => void;
}

/**
 * ② Delivery — the board's "Start on", "Delivery window" and "Deliver to", with the plan's own
 * delivery days above them (a plan delivers on chosen weekdays) and the allergy list below.
 *
 * - **Days.** Every weekday the plan delivers on starts ticked; a day it does not deliver on is
 *   greyed. The start is the first delivery, so a start date on an unticked day is greyed too.
 * - **Start on.** Ten days from the earliest start the kitchen can make — past its change cut-off,
 *   on a chosen day (plans-17) — and the step says why it is that date.
 * - **The address is chosen, never typed.** A subscription is placed against a saved address
 *   (D-084): the saved addresses are tiles, and "Add an address" opens the editor and comes back
 *   with the new one chosen (plans-02).
 * - **Allergies are read, not collected.** The step shows the person's list and which picked
 *   dishes cross it, with the way to change it (plans-16).
 */
export function DeliveryStep({
    state,
    patch,
    allowedWeekdays,
    earliestStartDate,
    firstStartTile,
    cutoffHours,
    slots,
    areaStatus,
    servedAreas,
    chosenMeals,
    chosenMealsLoaded,
    returnTo,
    showIssues,
    savedAddresses,
    addressId,
    onAddressIdChange,
    onAddAddress,
}: DeliveryStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const separator = t('commerce:common.listSeparator');

    const allowed = allowedWeekdays ?? [];
    // The start is the first delivery, so it is judged against the days actually chosen.
    const startDays =
        state.deliveryWeekdays.length > 0
            ? state.deliveryWeekdays
            : allowedWeekdays === null
              ? [1, 2, 3, 4, 5, 6, 7]
              : allowed;
    const tilesFrom = firstStartTile < earliestStartDate ? firstStartTile : earliestStartDate;
    const starts = Array.from({ length: START_TILES }, (_, index) =>
        addDays(tilesFrom, index),
    ).filter((date): date is string => date !== null);

    const area = savedAddresses.find((entry) => entry.id === addressId)?.areaName ?? '';
    const toggle = (list: readonly number[], value: number, on: boolean): number[] =>
        on ? [...list, value] : list.filter((each) => each !== value);
    const noon = (date: string) => `${date}T12:00:00Z`;

    return (
        <SetupPane
            testID="configurator-step-delivery"
            title={t('commerce:configurator.delivery.title')}
        >
            <SetupLabel>{t('commerce:configurator.delivery.weekdaysTitle')}</SetupLabel>
            <View
                testID="configurator-weekdays"
                role="group"
                aria-label={t('commerce:configurator.delivery.weekdaysTitle')}
                className="flex-row flex-wrap gap-2"
            >
                {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                    const on = state.deliveryWeekdays.includes(weekday);
                    const off = allowedWeekdays !== null && !allowed.includes(weekday);
                    return (
                        <Pressable
                            key={weekday}
                            testID={`configurator-weekday-${String(weekday)}`}
                            role="checkbox"
                            aria-checked={on}
                            accessibilityState={{ checked: on, selected: on, disabled: off }}
                            disabled={off}
                            onPress={() => {
                                patch({
                                    deliveryWeekdays: toggle(state.deliveryWeekdays, weekday, !on),
                                });
                            }}
                            className={cx(
                                'h-11 min-w-[64px] flex-1 flex-row items-center justify-center gap-1.5 rounded-xl border-2 transition duration-normal ease-standard',
                                on
                                    ? 'border-surface-brand bg-surface-brand-subtle'
                                    : 'border-stroke-subtle bg-surface-raised hover:border-stroke',
                                off ? 'opacity-40' : '',
                            )}
                        >
                            {on ? (
                                <Icon
                                    name="check"
                                    size="sm"
                                    className="text-content-on-brand-subtle"
                                />
                            ) : null}
                            <RNText
                                className={cx(
                                    'text-sm font-semibold',
                                    on ? 'text-content-on-brand-subtle' : 'text-content-secondary',
                                    off ? 'line-through' : '',
                                )}
                            >
                                {t(weekdayKey(weekday))}
                            </RNText>
                        </Pressable>
                    );
                })}
            </View>
            {allowedWeekdays === null || allowed.length === 7 ? null : (
                <RNText
                    testID="configurator-weekdays-limited"
                    className="mt-2 self-start text-sm text-content-secondary text-start"
                >
                    {t('commerce:configurator.delivery.weekdaysLimited', {
                        days: allowed.map((weekday) => t(weekdayKey(weekday))).join(separator),
                    })}
                </RNText>
            )}

            <SetupLabel>{t('commerce:configurator.delivery.startOn')}</SetupLabel>
            <View
                testID="configurator-start-date"
                role="radiogroup"
                aria-label={t('commerce:configurator.delivery.startOn')}
                className="flex-row flex-wrap gap-2"
            >
                {starts.map((date) => {
                    const weekday = isoWeekday(date);
                    const off =
                        weekday === null ||
                        !startDays.includes(weekday) ||
                        date < earliestStartDate;
                    return (
                        <DayTile
                            key={date}
                            testID={`configurator-start-${date}`}
                            top={formatter.formatDate(noon(date), { weekday: 'short' })}
                            big={formatter.formatDate(noon(date), { day: 'numeric' })}
                            bottom={formatter.formatDate(noon(date), { month: 'short' })}
                            accessibilityLabel={formatter.formatDate(noon(date), {
                                dateStyle: 'full',
                            })}
                            on={state.startDate === date}
                            disabled={off}
                            onPress={() => {
                                patch({ startDate: date });
                            }}
                        />
                    );
                })}
            </View>
            {cutoffHours <= 0 ? null : (
                <RNText
                    testID="configurator-start-date-cutoff"
                    className="mt-2 self-start text-sm text-content-secondary text-start"
                >
                    {t('commerce:configurator.delivery.cutoffNote', {
                        count: cutoffHours,
                        date: formatter.formatDate(earliestStartDate, { dateStyle: 'medium' }),
                    })}
                </RNText>
            )}

            <SetupLabel>{t('commerce:configurator.delivery.slotTitle')}</SetupLabel>
            <SegChoice
                testID="configurator-slot"
                label={t('commerce:configurator.delivery.slotTitle')}
                value={state.slotCode}
                onChange={(next) => {
                    patch({ slotCode: next });
                }}
                options={slots.map((slot) => ({
                    value: slot.code,
                    title: slotName(slot, slot.code, t),
                    sub: `${slot.startsAt} – ${slot.endsAt}`,
                    testID: `configurator-slot-${slot.code}`,
                }))}
            />

            <SetupLabel>{t('commerce:configurator.delivery.deliverTo')}</SetupLabel>
            <View
                testID="configurator-address"
                role="radiogroup"
                aria-label={t('commerce:configurator.delivery.deliverTo')}
                className="flex-row flex-wrap gap-2.5"
            >
                {savedAddresses.map((entry) => (
                    <OptionTile
                        key={entry.id}
                        testID={`configurator-address-${entry.id}`}
                        chosen={entry.id === addressId}
                        onPress={() => {
                            onAddressIdChange(entry.id);
                        }}
                    >
                        <RNText className="text-base font-bold text-content-primary text-start">
                            {entry.label.trim() === '' ? entry.areaName : entry.label}
                        </RNText>
                        <RNText className="text-sm text-content-secondary text-start">
                            {entry.areaName}
                        </RNText>
                        <RNText
                            numberOfLines={1}
                            className="text-xs text-content-secondary text-start"
                        >
                            {entry.line1}
                        </RNText>
                    </OptionTile>
                ))}
                <Pressable
                    testID="configurator-add-address"
                    role="button"
                    accessibilityRole="button"
                    onPress={onAddAddress}
                    className={cx(
                        'min-h-[92px] min-w-[200px] flex-1 flex-row items-center justify-center gap-2 rounded-[20px] border-2 border-dashed px-4 hover:border-surface-brand',
                        showIssues && addressId === null ? 'border-danger-border' : 'border-stroke',
                    )}
                >
                    <Icon name="plus" size="sm" className="text-content-on-brand-subtle" />
                    <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                        {t('commerce:configurator.delivery.addAddress')}
                    </RNText>
                </Pressable>
            </View>
            {addressId === null ? null : (
                <View className="mt-2.5">
                    <AreaStatus status={areaStatus} area={area} servedAreas={servedAreas} />
                </View>
            )}

            <SetupLabel>{t('commerce:configurator.delivery.allergensTitle')}</SetupLabel>
            <View testID="configurator-allergens">
                <PlanAllergyNotice
                    testID="configurator-allergy-notice"
                    meals={chosenMeals}
                    checked={chosenMealsLoaded}
                    returnTo={returnTo}
                />
            </View>
        </SetupPane>
    );
}

/** One line under the address: whether this kitchen delivers there. Status, never prose. */
function AreaStatus({
    status,
    area,
    servedAreas,
}: {
    readonly status: DeliveryAreaStatus;
    readonly area: string;
    readonly servedAreas: readonly string[];
}) {
    const { t } = useTranslation();

    if (status === 'served') {
        return (
            <View
                testID="configurator-area-served"
                role="status"
                className="flex-row items-center gap-2"
            >
                <Icon name="check" size="sm" className="text-success-on-subtle" />
                <RNText className="text-sm font-medium text-success-on-subtle text-start">
                    {t('commerce:configurator.checks.areaServed', { area })}
                </RNText>
            </View>
        );
    }

    if (status === 'unserved') {
        return (
            <View
                testID="configurator-area-unserved"
                role="alert"
                className="flex-row items-center gap-2"
            >
                <Icon name="warning" size="sm" className="text-danger-on-subtle" />
                <RNText className="shrink text-sm font-medium text-danger-on-subtle text-start">
                    {t('commerce:configurator.checks.areaUnserved', {
                        area,
                        areas: servedAreas
                            .filter((name) => name.trim() !== '')
                            .join(t('commerce:common.listSeparator')),
                    })}
                </RNText>
            </View>
        );
    }

    return area.trim() === '' ? null : (
        <View
            testID="configurator-area-unknown"
            role="status"
            className="flex-row items-center gap-2"
        >
            <Icon name="info" size="sm" className="text-content-secondary" />
            <RNText className="shrink text-sm text-content-secondary text-start">
                {t('commerce:configurator.checks.areaUnknown')}
            </RNText>
        </View>
    );
}

/* ── ④ review: the choices, the price, how to pay, the terms ────────────────────────────────── */

/** The board's two ways to pay. Shown only: the plan purchase takes no payment yet. */
export const PAY_METHODS = ['cash', 'whish'] as const;
export type PayMethod = (typeof PAY_METHODS)[number];

export interface ReviewStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly preview: SubscriptionPreview | undefined;
    /** The saved address chosen on the delivery step, when one was. */
    readonly savedAddress: CustomerAddress | undefined;
    readonly slots: readonly DeliverySlotOption[];
    readonly cutoffHours: number;
    /** The dishes picked for the run, checked against the person's allergy list once more here. */
    readonly chosenMeals: readonly MarketplaceMeal[];
    readonly chosenMealsLoaded: boolean;
    /** This step's own URL — where the allergy editor comes back to. */
    readonly returnTo: string;
    readonly pay: PayMethod;
    readonly onPay: (method: PayMethod) => void;
    readonly showIssues: boolean;
    readonly onEdit: (step: ConfiguratorStep) => void;
}

export function ReviewStep({
    plan,
    state,
    patch,
    preview,
    savedAddress,
    slots,
    cutoffHours,
    chosenMeals,
    chosenMealsLoaded,
    returnTo,
    pay,
    onPay,
    showIssues,
    onEdit,
}: ReviewStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const variant = variantById(plan, state.variantId);
    const option = durationOption(plan, state.duration);
    const dates = configuredDeliveryDates(state, plan);
    const total = dates.length * sittingsOf(plan, state).length;
    const picked = total - missingPicks(state, plan);

    const rows: readonly PriceRow[] =
        preview === undefined
            ? []
            : buildPriceRows(preview, {
                  perDayList: t('commerce:configurator.summary.perDayList'),
                  balance: t('commerce:configurator.summary.balance', {
                      count: preview.deliveryCount,
                  }),
                  gross: t('commerce:configurator.summary.gross'),
                  discount: t('commerce:configurator.summary.discount', {
                      percent: formatter.formatNumber(preview.discountPercent),
                  }),
                  total: t('commerce:configurator.summary.total'),
                  perDelivery: t('commerce:configurator.summary.perDelivery'),
              });

    const address =
        savedAddress === undefined
            ? '—'
            : [savedAddress.label, savedAddress.areaName]
                  .filter((part) => part.trim() !== '')
                  .join(t('commerce:common.listSeparator'));
    const start =
        state.startDate === null
            ? '—'
            : formatter.formatDate(`${state.startDate}T12:00:00Z`, {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
              });
    const slot = slots.find((each) => each.code === state.slotCode);

    return (
        <SetupPane
            testID="configurator-step-review"
            title={t('commerce:configurator.review.title')}
        >
            <ReviewRow
                testID="configurator-review-plan"
                icon="calendar"
                title={plan.name}
                sub={[
                    option === undefined
                        ? null
                        : t('catalogue:plans.finderDaysValue', { count: option.days }),
                    variant === null ? null : mealsLine(variant, formatter.formatNumber, t),
                ]
                    .filter((part): part is string => part !== null)
                    .join(' · ')}
                onEdit={() => {
                    onEdit('plan');
                }}
            />
            <ReviewRow
                testID="configurator-review-delivery"
                icon="home"
                title={t('commerce:configurator.review.deliveryLine', { address, date: start })}
                sub={t('commerce:configurator.review.deliverySub', {
                    window:
                        slot === undefined
                            ? slotName(undefined, state.slotCode, t)
                            : `${slotName(slot, slot.code, t)} ${slot.startsAt} – ${slot.endsAt}`,
                    days: weekdayRun(state.deliveryWeekdays, t),
                })}
                onEdit={() => {
                    onEdit('delivery');
                }}
            />
            <ReviewRow
                testID="configurator-review-meals"
                icon="plate"
                title={t('commerce:configurator.review.mealsLine', {
                    done: formatter.formatNumber(picked),
                    total: formatter.formatNumber(total),
                })}
                sub={t('commerce:configurator.review.mealsSub', { count: cutoffHours })}
                onEdit={() => {
                    onEdit('meals');
                }}
            />

            {preview === undefined ? null : (
                <>
                    <SetupLabel>{t('commerce:configurator.review.priceTitle')}</SetupLabel>
                    <View testID="configurator-summary-price">
                        <PriceSummary rows={rows} testID="configurator-price" />
                    </View>
                </>
            )}

            <SetupLabel>{t('commerce:configurator.summary.allergens')}</SetupLabel>
            <View testID="configurator-review-allergens">
                <PlanAllergyNotice
                    testID="configurator-review-allergy-notice"
                    meals={chosenMeals}
                    checked={chosenMealsLoaded}
                    returnTo={returnTo}
                />
            </View>

            {displayableWarnings(preview?.warnings ?? []).map((code) => (
                <View key={code} className="mt-3">
                    <Callout
                        testID={`configurator-warning-${code.replace(/\./g, '-')}`}
                        role={isCriticalWarning(code) ? 'alert' : 'note'}
                        tone={isCriticalWarning(code) ? 'danger' : 'warning'}
                        icon="warning"
                        title={t(warningMessageKey(code), { code })}
                    />
                </View>
            ))}

            <SetupLabel>{t('commerce:configurator.review.payWith')}</SetupLabel>
            <View
                testID="configurator-pay"
                role="radiogroup"
                aria-label={t('commerce:configurator.review.payWith')}
                className="flex-row flex-wrap gap-2.5"
            >
                {PAY_METHODS.map((method) => (
                    <OptionTile
                        key={method}
                        testID={`configurator-pay-${method}`}
                        chosen={pay === method}
                        onPress={() => {
                            onPay(method);
                        }}
                    >
                        <RNText className="text-base font-bold text-content-primary text-start">
                            {t(`commerce:configurator.pay.${method}`)}
                        </RNText>
                        <RNText className="text-sm text-content-secondary text-start">
                            {t(`commerce:configurator.pay.${method}Sub`)}
                        </RNText>
                    </OptionTile>
                ))}
            </View>

            <TermsAcknowledgement state={state} patch={patch} showIssues={showIssues} />

            <View className="mt-4">
                <MedicalDisclaimer context={t('commerce:configurator.disclaimerContext')} />
            </View>
        </SetupPane>
    );
}

/** One line of the review: an icon, what was chosen, and "Change" back to its step. */
function ReviewRow({
    testID,
    icon,
    title,
    sub,
    onEdit,
}: {
    readonly testID: string;
    readonly icon: 'calendar' | 'home' | 'plate';
    readonly title: string;
    readonly sub: string;
    readonly onEdit: () => void;
}) {
    const { t } = useTranslation();
    return (
        <View
            testID={testID}
            className="flex-row items-center gap-3.5 border-b border-stroke-subtle py-3.5"
        >
            <View className="h-11 w-11 items-center justify-center rounded-[14px] bg-surface-brand-subtle">
                <Icon name={icon} size="md" className="text-content-on-brand-subtle" />
            </View>
            <View className="min-w-0 flex-1">
                <RNText
                    testID={`${testID}-title`}
                    className="text-base font-bold text-content-primary text-start"
                >
                    {title}
                </RNText>
                <RNText
                    testID={`${testID}-sub`}
                    className="text-sm text-content-secondary text-start"
                >
                    {sub}
                </RNText>
            </View>
            <Pressable
                testID={`${testID}-edit`}
                role="button"
                accessibilityRole="button"
                accessibilityLabel={`${t('commerce:configurator.review.change')} ${title}`}
                onPress={onEdit}
                className="h-11 justify-center px-1"
            >
                <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                    {t('commerce:configurator.review.change')}
                </RNText>
            </Pressable>
        </View>
    );
}

/**
 * "I agree to the plan terms" — the board's tick box at the foot of the review. Subscribe waits for
 * it, and once the person has tried without it the box is ringed.
 */
export function TermsAcknowledgement({
    state,
    patch,
    showIssues = false,
}: {
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly showIssues?: boolean | undefined;
}) {
    const { t } = useTranslation();
    const on = state.termsAcknowledged;
    return (
        <Pressable
            testID="configurator-confirm-acknowledge"
            role="checkbox"
            aria-checked={on}
            accessibilityState={{ checked: on }}
            onPress={() => {
                patch({ termsAcknowledged: !on });
            }}
            className={cx(
                'mt-[18px] flex-row items-start gap-3 rounded-2xl bg-surface-base p-3.5',
                showIssues && !on ? 'border-2 border-danger-border' : '',
            )}
        >
            <View
                className={cx(
                    'h-6 w-6 items-center justify-center rounded-[7px] border-2',
                    on
                        ? 'border-surface-brand bg-surface-brand'
                        : 'border-stroke bg-surface-raised',
                )}
            >
                {on ? <Icon name="check" size="sm" className="text-content-on-brand" /> : null}
            </View>
            <RNText className="min-w-0 flex-1 text-sm leading-5 text-content-primary text-start">
                {t('commerce:configurator.confirm.agree')}
            </RNText>
        </Pressable>
    );
}

export interface PriceLabels {
    readonly perDayList: string;
    /** "28 delivery days" — the note under the gross row, saying what it multiplies. */
    readonly balance: string;
    readonly gross: string;
    readonly discount: string;
    readonly total: string;
    readonly perDelivery: string;
}

/**
 * Price rows from the preview's **typed** fields, never from its `lines`.
 *
 * `PriceLine.label` arrives as a server-composed English sentence ("Duration discount (10 %)").
 * Rendering it would put English in front of an Arabic reader, so the labels are the client's and
 * the figures are the server's. Recorded as a contract gap: a priced line should carry a stable
 * code and its parameters, not a rendered string.
 *
 * One arithmetic, readable top to bottom: a delivery day lists at X; the run buys N of them, so
 * before the discount it is X × N; the discount takes the gap to the total; the total is what the
 * server quoted; and a day after the discount is the figure a delivery costs. The gross
 * and the saving are derived in one currency, and the authority for what is owed remains
 * `preview.total`, rendered as it arrived (plans-19).
 */
export function buildPriceRows(
    preview: SubscriptionPreview,
    labels: PriceLabels,
): readonly PriceRow[] {
    const currency = preview.total.currency;
    const gross = { amount: preview.perDayListPrice.amount * preview.deliveryCount, currency };
    const saving = gross.amount - preview.total.amount;
    const perDelivery = perDeliveryPrice(preview.total, preview.deliveryCount);

    return [
        { key: 'per-day-list', label: labels.perDayList, amount: preview.perDayListPrice },
        { key: 'gross', label: labels.gross, amount: gross, note: labels.balance },
        ...(preview.discountPercent > 0 && saving > 0
            ? [
                  {
                      key: 'discount',
                      label: labels.discount,
                      amount: { amount: -saving, currency },
                  },
              ]
            : []),
        { key: 'total', label: labels.total, amount: preview.total, emphasis: true },
        ...(perDelivery === null
            ? []
            : [{ key: 'per-delivery', label: labels.perDelivery, amount: perDelivery }]),
    ];
}
