import {
    Button,
    Callout,
    Checkbox,
    Chip,
    DateField,
    Icon,
    Select,
} from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    PlanVariant,
    SubscriptionPlan,
    SubscriptionPreview,
} from '@healthy360/api-client/contracts';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text as RNText, View } from 'react-native';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { PillChip } from '../../ui/pill-chip.tsx';
import { listDayPrice } from '../catalogue/plan-balance.ts';
import { durationLabel, durationWithBalance } from '../catalogue/plan-duration-label.ts';
import { formatMoney, weekdayKey } from '../marketplace/format.ts';
import { formatAddress, toDeliveryAddress } from './address.ts';
import { OptionCard } from './checkout-frame.tsx';
import {
    combinationKey,
    configuredDeliveryDates,
    durationOption,
    estimatedTotal,
    mealCombinations,
    perDeliveryPrice,
    variantById,
} from './configurator.ts';
import type { ConfiguratorState, ConfiguratorStep } from './configurator.ts';
import { isoWeekday, nextAllowedDate } from './dates.ts';
import { DELIVERY_SLOTS } from './delivery.ts';
import type { DeliveryAreaStatus } from './delivery.ts';
import { PlanAllergyNotice } from './my-allergens.tsx';
import { PriceSummary } from './price-summary.tsx';
import { CardPanel, SummaryCard } from './summary-card.tsx';
import type { PriceRow } from './price-summary.tsx';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from './warnings.ts';

/**
 * The three step bodies of the subscription configurator — plan, delivery, review.
 *
 * Each is a stack of section cards, one question to a card. A single choice is a row of option
 * cards — the answer in bold, what it means (kcal, price, discount) under it; a choice with **one**
 * option is the answer as plain text, because a lone pre-selected card is a control that asks a
 * question nobody can answer differently. Many-of choices (weekdays) stay pills. The screen owns
 * navigation, validation, the request and the summary; these own layout and nothing else.
 */

export interface StepPatch {
    (patch: Partial<ConfiguratorState>): void;
}

/* ── shared rows ─────────────────────────────────────────────────────────────────────────────── */

/** One question of a step, in its own card under a title. */
function Row({
    label,
    children,
    testID,
}: {
    readonly label: string;
    readonly children: ReactNode;
    readonly testID?: string | undefined;
}) {
    return (
        <CardPanel testID={testID} className="gap-3">
            <RNText
                accessibilityRole="header"
                aria-level={2}
                className="self-start text-base font-semibold text-content-primary text-start"
            >
                {label}
            </RNText>
            {children}
        </CardPanel>
    );
}

interface Choice {
    readonly value: string;
    readonly label: string;
    /** What the choice means — the band's kcal range, a length's total — under the label. */
    readonly sub?: string | undefined;
    readonly testID: string;
}

/**
 * A single-choice card: option cards when there is a choice to make, the answer as text when there
 * is not. Side by side from `md`, stacked on a phone, where three cards abreast would each be a
 * column of broken words.
 */
function ChoiceRow({
    label,
    choices,
    value,
    onChange,
    testID,
}: {
    readonly label: string;
    readonly choices: readonly Choice[];
    readonly value: string;
    readonly onChange: (value: string) => void;
    readonly testID: string;
}) {
    const only = choices.length === 1 ? choices[0] : undefined;

    return (
        <Row label={label} testID={testID}>
            {only === undefined ? (
                <View role="radiogroup" aria-label={label} className="flex-col gap-3 md:flex-row">
                    {choices.map((choice) => {
                        const chosen = choice.value === value;
                        return (
                            <OptionCard
                                key={choice.value}
                                testID={choice.testID}
                                label={choice.label}
                                sub={choice.sub}
                                chosen={chosen}
                                {...(chosen
                                    ? {}
                                    : {
                                          onPress: () => {
                                              onChange(choice.value);
                                          },
                                      })}
                            />
                        );
                    })}
                </View>
            ) : (
                <View className="flex-col gap-0.5">
                    <RNText
                        testID={`${testID}-only`}
                        className="self-start text-base font-semibold text-content-primary text-start"
                    >
                        {only.label}
                    </RNText>
                    {only.sub === undefined ? null : (
                        <RNText
                            testID={`${testID}-detail`}
                            className="self-start text-sm tabular-nums text-content-secondary text-start"
                        >
                            {only.sub}
                        </RNText>
                    )}
                </View>
            )}
        </Row>
    );
}

/* ── ① plan: band, meals, length ─────────────────────────────────────────────────────────────── */

export interface PlanStepProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    /** A combination was chosen; the screen moves to the nearest variant that offers it. */
    readonly onCombination: (key: string) => void;
}

export function PlanStep({ plan, variant, state, patch, onCombination }: PlanStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const combinations = mealCombinations(plan);

    return (
        <View testID="configurator-step-plan" className="flex-col gap-4">
            <ChoiceRow
                testID="configurator-variant"
                label={t('commerce:configurator.plan.variantLabel')}
                value={state.variantId === null ? '' : String(state.variantId)}
                onChange={(next) => {
                    const chosen = plan.variants.find((option) => String(option.id) === next);
                    if (chosen !== undefined) patch({ variantId: chosen.id });
                }}
                choices={plan.variants.map((option) => ({
                    value: String(option.id),
                    label: variantName(option, formatter.formatNumber, t),
                    sub: [
                        t('commerce:configurator.plan.band', {
                            min: formatter.formatNumber(option.energyRange.min),
                            max: formatter.formatNumber(option.energyRange.max),
                        }),
                        t('catalogue:plan.pricePerDay', {
                            price: formatMoney(formatter, listDayPrice(option)),
                        }),
                    ].join(' · '),
                    testID: `configurator-variant-${String(option.id)}`,
                }))}
            />

            <ChoiceRow
                testID="configurator-combination"
                label={t('commerce:configurator.combination.label')}
                value={variant === null ? '' : combinationKey(variant)}
                onChange={onCombination}
                choices={combinations.map((combination) => ({
                    value: combinationKey(combination),
                    label: combinationLabel(combination, formatter.formatNumber, t),
                    testID: `configurator-combination-${combinationKey(combination)}`,
                }))}
            />

            {/* A plan with no length on sale says so; a row of nothing would leave the step with
                a question it cannot answer and a Continue it cannot pass. */}
            {plan.durations.length === 0 ? (
                <Row
                    label={t('commerce:configurator.duration.label')}
                    testID="configurator-duration"
                >
                    <RNText
                        testID="configurator-duration-none"
                        className="self-start text-base text-content-secondary text-start"
                    >
                        {t('catalogue:plan.noDurations')}
                    </RNText>
                </Row>
            ) : (
                <ChoiceRow
                    testID="configurator-duration"
                    label={t('commerce:configurator.duration.label')}
                    value={state.duration ?? ''}
                    onChange={(next) => {
                        const option = plan.durations.find((each) => each.duration === next);
                        if (option !== undefined) patch({ duration: option.duration });
                    }}
                    choices={plan.durations.map((option) => {
                        const total = estimatedTotal(variant, option);
                        return {
                            value: option.duration,
                            label: durationLabel(option.days, t, formatter.formatNumber),
                            sub: [
                                t('commerce:configurator.summary.balance', { count: option.days }),
                                ...(total === null
                                    ? []
                                    : [
                                          t('catalogue:plan.durationTotal', {
                                              total: formatMoney(formatter, total),
                                          }),
                                      ]),
                                option.discountPercent > 0
                                    ? t('catalogue:plan.durationDiscount', {
                                          discount: formatter.formatNumber(option.discountPercent),
                                      })
                                    : t('catalogue:plan.durationNoDiscount'),
                            ].join(' · '),
                            testID: `configurator-duration-${option.duration}`,
                        };
                    })}
                />
            )}
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
    return t('commerce:configurator.plan.bandName', {
        min: formatNumber(variant.energyRange.min),
        max: formatNumber(variant.energyRange.max),
    });
}

/** The chosen weekdays as a run of names — or "Every day" when it is all seven. */
export function weekdayRun(weekdays: readonly number[], t: TFunction): string {
    if (weekdays.length === 7) return t('commerce:configurator.summary.everyDay');
    return [...weekdays]
        .sort((a, b) => a - b)
        .map((weekday) => t(weekdayKey(weekday)))
        .join(t('commerce:common.listSeparator'));
}

/* ── ② delivery: days, start, window, address, diet and allergies ───────────────────────────── */

export interface DeliveryStepProps {
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly allowedWeekdays: readonly number[] | null;
    /** The first day a start may fall on: tomorrow, or later when the cut-off reaches past it. */
    readonly earliestStartDate: string;
    /** The plan's change cut-off, so the step can say why the earliest start is what it is. */
    readonly cutoffHours: number;
    readonly areaStatus: DeliveryAreaStatus;
    readonly servedAreas: readonly string[];
    /** The plan's published dishes, checked against the person's allergy list. */
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
 * ② Delivery.
 *
 * ## The address is chosen, never typed
 *
 * A subscription is placed against a saved address's identifier and nothing else (D-084), so the
 * address question is a pick from the address book plus "Add a delivery address" — which opens the
 * address editor and returns here with the new entry selected. There used to be an inline form for
 * somebody with nothing saved; it validated, the address went nowhere, and Subscribe was refused
 * every time with no way forward (plans-02). An account with no address now sees the one action
 * that fixes it, in the place it is needed.
 *
 * ## The start date starts where the kitchen can start
 *
 * The earliest date offered already honours the plan's change cut-off and its delivery weekdays,
 * and the step says why. The server used to move a start inside the cut-off forward on its own, so
 * the summary promised one date and the subscription began on another (plans-17).
 *
 * ## Allergies are read, not collected
 *
 * The kitchen reads the person's dietary profile at generation. The step shows that list, which of
 * this plan's dishes cross it, and the way to change it — the "leave out" pills it replaced were
 * sent nowhere (plans-16).
 */
export function DeliveryStep({
    state,
    patch,
    allowedWeekdays,
    earliestStartDate,
    cutoffHours,
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
    const startWeekday = state.startDate === null ? null : isoWeekday(state.startDate);
    const startWeekdayAllowed = startWeekday === null || startDays.includes(startWeekday);
    const startTooSoon = state.startDate !== null && state.startDate < earliestStartDate;
    // The repair offered beside a rejected date: the first chosen day on or after the floor.
    const repair =
        state.startDate === null || (startWeekdayAllowed && !startTooSoon)
            ? null
            : nextAllowedDate(startTooSoon ? earliestStartDate : state.startDate, startDays);

    const hasSaved = savedAddresses.length > 0;
    const area = savedAddresses.find((entry) => entry.id === addressId)?.areaName ?? '';

    const toggle = <T,>(list: readonly T[], value: T, on: boolean): T[] =>
        on ? [...list, value] : list.filter((each) => each !== value);

    return (
        <View testID="configurator-step-delivery" className="flex-col gap-4">
            <Row
                label={t('commerce:configurator.delivery.weekdaysTitle')}
                testID="configurator-weekdays"
            >
                <View className="flex-row flex-wrap gap-2">
                    {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                        const on = state.deliveryWeekdays.includes(weekday);
                        return (
                            <PillChip
                                key={weekday}
                                testID={`configurator-weekday-${String(weekday)}`}
                                label={t(weekdayKey(weekday))}
                                selected={on}
                                disabled={allowedWeekdays !== null && !allowed.includes(weekday)}
                                onPress={() => {
                                    patch({
                                        deliveryWeekdays: toggle(
                                            state.deliveryWeekdays,
                                            weekday,
                                            !on,
                                        ),
                                    });
                                }}
                            />
                        );
                    })}
                </View>
                {allowedWeekdays === null || allowed.length === 7 ? null : (
                    <RNText
                        testID="configurator-weekdays-limited"
                        className="self-start text-sm text-content-secondary text-start"
                    >
                        {t('commerce:configurator.delivery.weekdaysLimited', {
                            days: allowed.map((weekday) => t(weekdayKey(weekday))).join(separator),
                        })}
                    </RNText>
                )}
            </Row>

            <CardPanel className="md:flex-row md:gap-6">
                <View testID="configurator-start-date" className="flex-col gap-2 md:flex-1">
                    <DateField
                        testID="configurator-start-date-field"
                        label={t('commerce:configurator.delivery.startLabel')}
                        value={state.startDate}
                        min={earliestStartDate}
                        required
                        onChange={(next) => {
                            patch({ startDate: next });
                        }}
                        {...(showIssues && startTooSoon
                            ? {
                                  error: t('commerce:configurator.issues.startTooSoon', {
                                      date: formatter.formatDate(earliestStartDate, {
                                          dateStyle: 'medium',
                                      }),
                                  }),
                              }
                            : showIssues && !startWeekdayAllowed
                              ? { error: t('commerce:configurator.issues.startWeekday') }
                              : {})}
                    />
                    {cutoffHours <= 0 ? null : (
                        <RNText
                            testID="configurator-start-date-cutoff"
                            className="self-start text-sm text-content-secondary text-start"
                        >
                            {t('commerce:configurator.delivery.cutoffNote', {
                                count: cutoffHours,
                                date: formatter.formatDate(earliestStartDate, {
                                    dateStyle: 'medium',
                                }),
                            })}
                        </RNText>
                    )}
                    {repair === null ? null : (
                        <View className="self-start">
                            <Chip
                                testID="configurator-start-date-repair"
                                tone="info"
                                label={t('commerce:configurator.delivery.useNextAllowed', {
                                    date: formatter.formatDate(repair, { dateStyle: 'medium' }),
                                })}
                                onPress={() => {
                                    patch({ startDate: repair });
                                }}
                            />
                        </View>
                    )}
                </View>
                <View testID="configurator-slot" className="flex-col gap-3 md:flex-1">
                    <RNText className="text-sm font-semibold text-content-primary text-start">
                        {t('commerce:configurator.delivery.slotTitle')}
                    </RNText>
                    <View
                        role="radiogroup"
                        aria-label={t('commerce:configurator.delivery.slotTitle')}
                        className="flex-row flex-wrap gap-2"
                    >
                        {DELIVERY_SLOTS.map((slot) => (
                            <PillChip
                                key={slot.code}
                                testID={`configurator-slot-${slot.code}`}
                                mode="radio"
                                label={t(`commerce:slots.${slot.code}`)}
                                selected={state.slotCode === slot.code}
                                onPress={() => {
                                    patch({ slotCode: slot.code });
                                }}
                            />
                        ))}
                    </View>
                </View>
            </CardPanel>

            <Row
                label={t('commerce:configurator.delivery.addressTitle')}
                testID="configurator-address"
            >
                {hasSaved ? (
                    <Select
                        testID="configurator-address-picker"
                        label={t('commerce:configurator.delivery.addressTitle')}
                        labelHidden
                        value={addressId}
                        onChange={onAddressIdChange}
                        options={savedAddresses.map((entry) => ({
                            value: entry.id,
                            label: [entry.label, entry.line1, entry.areaName]
                                .filter((part) => part.trim() !== '')
                                .join(' · '),
                        }))}
                        placeholder={t('commerce:configurator.delivery.addressPlaceholder')}
                        {...(showIssues && addressId === null
                            ? { error: t('commerce:validation.required') }
                            : {})}
                    />
                ) : null}
                {addressId === null ? null : (
                    <AreaStatus status={areaStatus} area={area} servedAreas={servedAreas} />
                )}
                {/* A bordered button when there is nothing to pick from — it is then the step's
                    only way on; beside the picker it is the quieter second choice. */}
                <View className="self-start">
                    <Button
                        testID="configurator-add-address"
                        variant={hasSaved ? 'quiet' : 'secondary'}
                        size="sm"
                        label={t('commerce:configurator.delivery.addAddress')}
                        onPress={onAddAddress}
                    />
                </View>
            </Row>

            <Row
                label={t('commerce:configurator.delivery.allergensTitle')}
                testID="configurator-allergens"
            >
                <PlanAllergyNotice
                    testID="configurator-allergy-notice"
                    meals={chosenMeals}
                    checked={chosenMealsLoaded}
                    returnTo={returnTo}
                />
            </Row>
        </View>
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

/* ── ④ review: the choices, the meals, the server's price ───────────────────────────────────── */

export interface ReviewStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly preview: SubscriptionPreview | undefined;
    /** The saved address chosen on the delivery step, when one was. */
    readonly savedAddress: CustomerAddress | undefined;
    /** The dishes picked for the run, checked against the person's allergy list once more here. */
    readonly chosenMeals: readonly MarketplaceMeal[];
    readonly chosenMealsLoaded: boolean;
    /** This step's own URL — where the allergy editor comes back to. */
    readonly returnTo: string;
    readonly onEdit: (step: ConfiguratorStep) => void;
}

export function ReviewStep({
    plan,
    state,
    preview,
    savedAddress,
    chosenMeals,
    chosenMealsLoaded,
    returnTo,
    onEdit,
}: ReviewStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const variant = variantById(plan, state.variantId);
    const option = durationOption(plan, state.duration);
    const days = configuredDeliveryDates(state, plan).length;

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
            ? formatAddress(toDeliveryAddress(state.address))
            : [savedAddress.label, savedAddress.line1, savedAddress.areaName]
                  .filter((part) => part.trim() !== '')
                  .join(' · ');

    return (
        <View testID="configurator-step-review" className="flex-col gap-4">
            <SummaryCard
                testID="configurator-review-plan"
                title={t('commerce:configurator.review.planTitle')}
                action={{
                    label: t('commerce:configurator.edit'),
                    testID: 'configurator-review-plan-edit',
                    onPress: () => {
                        onEdit('plan');
                    },
                }}
                rows={[
                    {
                        key: 'plan',
                        testID: 'configurator-summary-plan',
                        label: t('commerce:configurator.summary.plan'),
                        value:
                            variant === null
                                ? plan.name
                                : `${variantName(variant, formatter.formatNumber, t)} · ${combinationLabel(variant, formatter.formatNumber, t)}`,
                    },
                    {
                        key: 'duration',
                        testID: 'configurator-summary-duration',
                        label: t('commerce:configurator.summary.duration'),
                        value:
                            option === undefined
                                ? '—'
                                : durationWithBalance(option.days, t, formatter.formatNumber),
                    },
                ]}
            />

            <SummaryCard
                testID="configurator-review-delivery"
                title={t('commerce:configurator.review.deliveryTitle')}
                action={{
                    label: t('commerce:configurator.edit'),
                    testID: 'configurator-review-delivery-edit',
                    onPress: () => {
                        onEdit('delivery');
                    },
                }}
                rows={[
                    {
                        key: 'days',
                        testID: 'configurator-summary-days',
                        label: t('commerce:configurator.summary.days'),
                        value: `${weekdayRun(state.deliveryWeekdays, t)} · ${t(`commerce:slots.${state.slotCode}`)}`,
                    },
                    {
                        key: 'window',
                        testID: 'configurator-summary-window',
                        label: t('commerce:configurator.summary.window'),
                        value:
                            preview === undefined
                                ? state.startDate === null
                                    ? '—'
                                    : formatter.formatDate(state.startDate, { dateStyle: 'medium' })
                                : t('commerce:configurator.summary.windowValue', {
                                      first: formatter.formatDate(preview.firstDeliveryDate, {
                                          dateStyle: 'medium',
                                      }),
                                      last: formatter.formatDate(preview.lastDeliveryDate, {
                                          dateStyle: 'medium',
                                      }),
                                  }),
                    },
                    {
                        key: 'address',
                        testID: 'configurator-summary-address',
                        label: t('commerce:configurator.summary.address'),
                        value: address,
                    },
                ]}
            />

            <SummaryCard
                testID="configurator-review-meals"
                title={t('commerce:configurator.review.mealsTitle')}
                action={{
                    label: t('commerce:configurator.edit'),
                    testID: 'configurator-review-meals-edit',
                    onPress: () => {
                        onEdit('meals');
                    },
                }}
                rows={[
                    {
                        key: 'meals',
                        testID: 'configurator-summary-meals',
                        label: t('commerce:configurator.summary.meals'),
                        value: t('commerce:configurator.meals.daysChosen', { count: days }),
                    },
                ]}
            />

            <SummaryCard
                testID="configurator-review-allergens"
                title={t('commerce:configurator.summary.allergens')}
            >
                <PlanAllergyNotice
                    testID="configurator-review-allergy-notice"
                    meals={chosenMeals}
                    checked={chosenMealsLoaded}
                    returnTo={returnTo}
                />
            </SummaryCard>

            {preview === undefined ? null : (
                <SummaryCard
                    testID="configurator-summary-price"
                    title={t('commerce:configurator.review.priceTitle')}
                >
                    <PriceSummary rows={rows} testID="configurator-price" />
                </SummaryCard>
            )}

            {displayableWarnings(preview?.warnings ?? []).map((code) => (
                <Callout
                    key={code}
                    testID={`configurator-warning-${code.replace(/\./g, '-')}`}
                    role={isCriticalWarning(code) ? 'alert' : 'note'}
                    tone={isCriticalWarning(code) ? 'danger' : 'warning'}
                    icon="warning"
                    title={t(warningMessageKey(code), { code })}
                />
            ))}

            <MedicalDisclaimer context={t('commerce:configurator.disclaimerContext')} />
        </View>
    );
}

/**
 * The terms acknowledgement, drawn by the screen beside the Subscribe button rather than in the
 * step: it is the last thing standing between the person and the action. When it is missing the
 * summary's notice says so, directly above it — once, rather than here as well.
 */
export function TermsAcknowledgement({
    state,
    patch,
}: {
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
}) {
    const { t } = useTranslation();

    return (
        <Checkbox
            testID="configurator-confirm-acknowledge"
            checked={state.termsAcknowledged}
            onChange={(checked) => {
                patch({ termsAcknowledged: checked });
            }}
            label={t('commerce:configurator.confirm.acknowledgeLabel')}
            required
        />
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
 * server quoted; and a day after the discount is the figure a refund is computed from. The gross
 * and the saving are derived in one currency, and the authority for what is owed remains
 * `preview.total`, rendered as it arrived. It used to show a "weekly price" and a gross of four
 * calendar weeks beside a total of twenty-eight delivery days, so "before discount" was smaller
 * than the total it was discounted to (plans-19).
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
