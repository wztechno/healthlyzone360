import {
    Callout,
    Checkbox,
    Chip,
    Collapse,
    DateField,
    Icon,
    Select,
    cx,
} from '@healthy360/design-system';
import type {
    CustomerAddress,
    MarketplaceMeal,
    PlanVariant,
    SubscriptionPlan,
    SubscriptionPreview,
} from '@healthy360/api-client/contracts';
import type { AllergenCode, DietClassification, MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { PillChip } from '../../ui/pill-chip.tsx';
import { weekdayKey } from '../marketplace/format.ts';
import { formatAddress, toDeliveryAddress } from './address.ts';
import type { AddressErrors, AddressField } from './address.ts';
import { AddressForm } from './address-form.tsx';
import {
    combinationKey,
    configuredDeliveryDates,
    diffAllergens,
    grossMinorUnits,
    mealCombinations,
    perDeliveryPrice,
    variantById,
    weeksFor,
} from './configurator.ts';
import type { ConfiguratorState, ConfiguratorStep } from './configurator.ts';
import { earliestStartDate, isoWeekday, nextAllowedDate } from './dates.ts';
import { DELIVERY_SLOTS } from './delivery.ts';
import type { DeliveryAreaStatus } from './delivery.ts';
import { PriceSummary } from './price-summary.tsx';
import type { PriceRow } from './price-summary.tsx';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from './warnings.ts';

/**
 * The three step bodies of the subscription configurator — plan, delivery, review.
 *
 * Each is a stack of labelled rows divided by a hairline. A choice with several options is a row of
 * `PillChip` radios; a choice with **one** option is the answer as plain text, because a lone
 * pre-selected chip is a control that asks a question nobody can answer differently. The screen
 * owns navigation, validation, the request and the summary; these own layout and nothing else.
 */

export interface StepPatch {
    (patch: Partial<ConfiguratorState>): void;
}

/* ── shared rows ─────────────────────────────────────────────────────────────────────────────── */

/** One labelled row of a step, divided from the next by a hairline. */
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
        <View testID={testID} className="flex-col gap-3 border-b border-stroke-subtle py-5">
            <RNText className="text-sm font-semibold text-content-primary text-start">
                {label}
            </RNText>
            {children}
        </View>
    );
}

interface Choice {
    readonly value: string;
    readonly label: string;
    readonly testID: string;
}

/**
 * A single-choice row: radio pills when there is a choice to make, the answer as text when there is
 * not.
 */
function ChoiceRow({
    label,
    choices,
    value,
    onChange,
    detail,
    testID,
}: {
    readonly label: string;
    readonly choices: readonly Choice[];
    readonly value: string;
    readonly onChange: (value: string) => void;
    /** A line of data under the choice — the band's kcal range, say. */
    readonly detail?: string | undefined;
    readonly testID: string;
}) {
    const only = choices.length === 1 ? choices[0] : undefined;

    return (
        <Row label={label} testID={testID}>
            {only === undefined ? (
                <View role="radiogroup" aria-label={label} className="flex-row flex-wrap gap-2">
                    {choices.map((choice) => (
                        <PillChip
                            key={choice.value}
                            testID={choice.testID}
                            mode="radio"
                            label={choice.label}
                            selected={choice.value === value}
                            onPress={() => {
                                onChange(choice.value);
                            }}
                        />
                    ))}
                </View>
            ) : (
                <RNText
                    testID={`${testID}-only`}
                    className="self-start text-base text-content-primary text-start"
                >
                    {only.label}
                </RNText>
            )}
            {detail === undefined ? null : (
                <RNText
                    testID={`${testID}-detail`}
                    className="self-start text-sm tabular-nums text-content-secondary text-start"
                >
                    {detail}
                </RNText>
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
        <View testID="configurator-step-plan" className="flex-col">
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
                    label: option.name,
                    testID: `configurator-variant-${String(option.id)}`,
                }))}
                detail={
                    variant === null
                        ? undefined
                        : t('commerce:configurator.plan.band', {
                              min: formatter.formatNumber(variant.energyRange.min),
                              max: formatter.formatNumber(variant.energyRange.max),
                          })
                }
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

            <ChoiceRow
                testID="configurator-duration"
                label={t('commerce:configurator.duration.label')}
                value={state.duration}
                onChange={(next) => {
                    const option = plan.durations.find((each) => each.duration === next);
                    if (option !== undefined) patch({ duration: option.duration });
                }}
                choices={plan.durations.map((option) => ({
                    value: option.duration,
                    label:
                        option.discountPercent > 0
                            ? t('commerce:configurator.duration.withDiscount', {
                                  duration: t(`catalogue:compare.duration.${option.duration}`),
                                  percent: formatter.formatNumber(option.discountPercent),
                              })
                            : t(`catalogue:compare.duration.${option.duration}`),
                    testID: `configurator-duration-${option.duration}`,
                }))}
            />
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
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    /**
     * Address edits go through their own handler rather than through `patch`, and the difference is
     * not cosmetic: `patch` composes a whole new address from the *rendered* state, so two field
     * changes inside one React batch would both start from the same snapshot and the second would
     * discard the first. This one updates a single field against the latest edits.
     */
    readonly onAddressField: (field: AddressField, value: string) => void;
    readonly allowedWeekdays: readonly number[] | null;
    readonly areaStatus: DeliveryAreaStatus;
    readonly servedAreas: readonly string[];
    readonly addressErrors: AddressErrors;
    /** Allergens this kitchen declares on its own menu, plus anything the profile already excludes. */
    readonly allergenOptions: readonly AllergenCode[];
    readonly storedAllergens: readonly AllergenCode[];
    readonly showIssues: boolean;
    readonly savedAddresses?: readonly CustomerAddress[] | undefined;
    readonly addressId?: string | null | undefined;
    readonly onAddressIdChange?: ((id: string | null) => void) | undefined;
}

export function DeliveryStep({
    plan,
    state,
    patch,
    onAddressField,
    allowedWeekdays,
    areaStatus,
    servedAreas,
    addressErrors,
    allergenOptions,
    storedAllergens,
    showIssues,
    savedAddresses,
    addressId,
    onAddressIdChange,
}: DeliveryStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const separator = t('commerce:common.listSeparator');

    const allowed = allowedWeekdays ?? [];
    const startWeekday = state.startDate === null ? null : isoWeekday(state.startDate);
    const startWeekdayAllowed =
        allowedWeekdays === null || startWeekday === null || allowed.includes(startWeekday);
    const repair =
        state.startDate === null || startWeekdayAllowed
            ? null
            : nextAllowedDate(state.startDate, allowed);

    const change = diffAllergens(storedAllergens, state.excludeAllergens);
    const hasSaved = savedAddresses !== undefined && savedAddresses.length > 0;
    const area =
        savedAddresses?.find((entry) => entry.id === addressId)?.areaName ?? state.address.area;

    const toggle = <T,>(list: readonly T[], value: T, on: boolean): T[] =>
        on ? [...list, value] : list.filter((each) => each !== value);

    return (
        <View testID="configurator-step-delivery" className="flex-col">
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

            <View className="flex-col border-b border-stroke-subtle md:flex-row md:gap-6">
                <View testID="configurator-start-date" className="flex-col gap-2 py-5 md:flex-1">
                    <DateField
                        testID="configurator-start-date-field"
                        label={t('commerce:configurator.delivery.startLabel')}
                        value={state.startDate}
                        min={earliestStartDate()}
                        required
                        onChange={(next) => {
                            patch({ startDate: next });
                        }}
                        {...(showIssues && !startWeekdayAllowed
                            ? { error: t('commerce:configurator.issues.startWeekday') }
                            : {})}
                    />
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
                <View testID="configurator-slot" className="flex-col gap-3 py-5 md:flex-1">
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
            </View>

            <Row
                label={t('commerce:configurator.delivery.addressTitle')}
                testID="configurator-address"
            >
                {hasSaved ? (
                    <Select
                        testID="configurator-address-picker"
                        label={t('commerce:configurator.delivery.addressTitle')}
                        labelHidden
                        value={addressId ?? null}
                        onChange={(next) => {
                            onAddressIdChange?.(next);
                        }}
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
                ) : (
                    <AddressForm
                        testID="configurator-address-form"
                        values={state.address}
                        errors={showIssues ? addressErrors : {}}
                        onChange={onAddressField}
                    />
                )}
                {hasSaved && addressId === null ? null : (
                    <AreaStatus status={areaStatus} area={area} servedAreas={servedAreas} />
                )}
            </Row>

            {plan.dietClassifications.length === 0 ? null : (
                <Row
                    label={t('commerce:configurator.dietary.dietsTitle')}
                    testID="configurator-diets"
                >
                    <View className="flex-row flex-wrap gap-2">
                        {plan.dietClassifications.map((diet: DietClassification) => {
                            const on = state.dietClassifications.includes(diet);
                            return (
                                <PillChip
                                    key={diet}
                                    testID={`configurator-diet-${diet}`}
                                    label={t(`marketplace:diets.${diet}`)}
                                    selected={on}
                                    onPress={() => {
                                        patch({
                                            dietClassifications: toggle(
                                                state.dietClassifications,
                                                diet,
                                                !on,
                                            ),
                                        });
                                    }}
                                />
                            );
                        })}
                    </View>
                </Row>
            )}

            <Row
                label={t('commerce:configurator.dietary.allergensTitle')}
                testID="configurator-allergens"
            >
                {allergenOptions.length === 0 ? (
                    <RNText
                        testID="configurator-allergens-none"
                        className="self-start text-base text-content-secondary text-start"
                    >
                        {t('commerce:configurator.checks.noAllergens')}
                    </RNText>
                ) : (
                    <View className="flex-row flex-wrap gap-2">
                        {allergenOptions.map((code) => {
                            const on = state.excludeAllergens.includes(code);
                            return (
                                <PillChip
                                    key={code}
                                    testID={`configurator-allergen-${code}`}
                                    label={t(`marketplace:allergens.${code}`)}
                                    selected={on}
                                    onPress={() => {
                                        patch({
                                            allergensTouched: true,
                                            excludeAllergens: toggle(
                                                state.excludeAllergens,
                                                code,
                                                !on,
                                            ),
                                        });
                                    }}
                                />
                            );
                        })}
                    </View>
                )}

                {/*
                 * Adding an exclusion tightens what the kitchen may send and needs no ceremony.
                 * Removing one the profile records widens it — a safety decision — so it is an
                 * alert that names what was dropped, and it has to be acknowledged.
                 */}
                {change.relaxed ? (
                    <View className="flex-col gap-3">
                        <Callout
                            testID="configurator-allergen-relaxed"
                            role="alert"
                            tone="danger"
                            icon="warning"
                            title={t('commerce:configurator.dietary.relaxedTitle', {
                                allergens: change.removed
                                    .map((code) => t(`marketplace:allergens.${code}`))
                                    .join(separator),
                            })}
                        />
                        <Checkbox
                            testID="configurator-checks-acknowledge"
                            checked={state.checksAcknowledged}
                            onChange={(checked) => {
                                patch({ checksAcknowledged: checked });
                            }}
                            label={t('commerce:configurator.checks.acknowledgeLabel')}
                            required
                            {...(showIssues && !state.checksAcknowledged
                                ? { error: t('commerce:configurator.issues.checks') }
                                : {})}
                        />
                    </View>
                ) : null}
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

/* ── ③ review: the choices, the server's price, first-week meals, the terms ─────────────────── */

export interface ReviewStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly preview: SubscriptionPreview | undefined;
    /** The saved address chosen on the delivery step, when one was. */
    readonly savedAddress: CustomerAddress | undefined;
    readonly menu: readonly MarketplaceMeal[];
    readonly showIssues: boolean;
    readonly onEdit: (step: ConfiguratorStep) => void;
}

export function ReviewStep({
    plan,
    state,
    patch,
    preview,
    savedAddress,
    menu,
    showIssues,
    onEdit,
}: ReviewStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const separator = t('commerce:common.listSeparator');
    const variant = variantById(plan, state.variantId);
    const [mealsOpen, setMealsOpen] = useState(false);

    const rows: readonly PriceRow[] =
        preview === undefined
            ? []
            : buildPriceRows(preview, {
                  weekly: t('commerce:configurator.summary.weekly'),
                  gross: t('commerce:configurator.summary.gross', {
                      weeks: formatter.formatNumber(weeksFor(preview.configuration.duration)),
                  }),
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
        <View testID="configurator-step-review" className="flex-col">
            <ReviewGroup
                testID="configurator-review-plan"
                onEdit={() => {
                    onEdit('plan');
                }}
                rows={[
                    {
                        key: 'plan',
                        label: t('commerce:configurator.summary.plan'),
                        value:
                            variant === null
                                ? plan.name
                                : `${variant.name} · ${combinationLabel(variant, formatter.formatNumber, t)}`,
                    },
                    {
                        key: 'duration',
                        label: t('commerce:configurator.summary.duration'),
                        value: t(`catalogue:compare.duration.${state.duration}`),
                    },
                ]}
            />
            <ReviewGroup
                testID="configurator-review-delivery"
                onEdit={() => {
                    onEdit('delivery');
                }}
                rows={[
                    {
                        key: 'days',
                        label: t('commerce:configurator.summary.days'),
                        value: `${weekdayRun(state.deliveryWeekdays, t)} · ${t(`commerce:slots.${state.slotCode}`)}`,
                    },
                    {
                        key: 'window',
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
                        label: t('commerce:configurator.summary.address'),
                        value: address,
                    },
                    {
                        key: 'allergens',
                        label: t('commerce:configurator.summary.allergens'),
                        value:
                            state.excludeAllergens.length === 0
                                ? t('commerce:configurator.checks.noAllergens')
                                : state.excludeAllergens
                                      .map((code) => t(`marketplace:allergens.${code}`))
                                      .join(separator),
                    },
                ]}
            />

            {preview === undefined ? null : (
                <View
                    testID="configurator-summary-price"
                    className="border-b border-stroke-subtle py-5"
                >
                    <PriceSummary rows={rows} testID="configurator-price" />
                </View>
            )}

            {displayableWarnings(preview?.warnings ?? []).map((code) => (
                <View key={code} className="pt-5">
                    <Callout
                        testID={`configurator-warning-${code.replace(/\./g, '-')}`}
                        role={isCriticalWarning(code) ? 'alert' : 'note'}
                        tone={isCriticalWarning(code) ? 'danger' : 'warning'}
                        icon="warning"
                        title={t(warningMessageKey(code), { code })}
                    />
                </View>
            ))}

            <View className="border-b border-stroke-subtle py-2">
                <Pressable
                    testID="configurator-meals-toggle"
                    role="button"
                    accessibilityRole="button"
                    aria-expanded={mealsOpen}
                    accessibilityState={{ expanded: mealsOpen }}
                    aria-controls="configurator-meals"
                    onPress={() => {
                        setMealsOpen((open) => !open);
                    }}
                    className="min-h-touch flex-row items-center justify-between gap-3"
                >
                    <RNText className="text-sm font-semibold text-content-primary text-start">
                        {t('commerce:configurator.meals.title')}
                    </RNText>
                    <Icon
                        name={mealsOpen ? 'chevronUp' : 'chevronDown'}
                        size="sm"
                        className="text-content-secondary"
                    />
                </Pressable>
                <Collapse
                    open={mealsOpen}
                    nativeID="configurator-meals"
                    testID="configurator-meals"
                >
                    <FirstWeekMeals plan={plan} state={state} patch={patch} menu={menu} />
                </Collapse>
            </View>

            <View className="flex-col gap-4 pt-5">
                <Checkbox
                    testID="configurator-confirm-acknowledge"
                    checked={state.termsAcknowledged}
                    onChange={(checked) => {
                        patch({ termsAcknowledged: checked });
                    }}
                    label={t('commerce:configurator.confirm.acknowledgeLabel')}
                    required
                    {...(showIssues && !state.termsAcknowledged
                        ? { error: t('commerce:configurator.issues.terms') }
                        : {})}
                />
                <MedicalDisclaimer context={t('commerce:configurator.disclaimerContext')} />
            </View>
        </View>
    );
}

/** A group of review rows that share one Edit, back to the step that set them. */
function ReviewGroup({
    rows,
    onEdit,
    testID,
}: {
    readonly rows: readonly {
        readonly key: string;
        readonly label: string;
        readonly value: string;
    }[];
    readonly onEdit: () => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();

    return (
        <View
            testID={testID}
            className="flex-row items-start gap-4 border-b border-stroke-subtle py-5"
        >
            <View className="min-w-0 flex-1 flex-col gap-3">
                {rows.map((row) => (
                    <View
                        key={row.key}
                        testID={`configurator-summary-${row.key}`}
                        className="flex-col gap-0.5 md:flex-row md:gap-4"
                    >
                        <RNText className="self-start text-sm text-content-secondary text-start md:w-[140px]">
                            {row.label}
                        </RNText>
                        <RNText className="min-w-0 shrink self-start text-base text-content-primary text-start">
                            {row.value}
                        </RNText>
                    </View>
                ))}
            </View>
            <Pressable
                testID={`${testID}-edit`}
                role="button"
                accessibilityRole="button"
                onPress={onEdit}
                className="min-h-touch justify-center"
            >
                <RNText className="text-sm font-semibold text-content-on-brand-subtle">
                    {t('commerce:configurator.edit')}
                </RNText>
            </Pressable>
        </View>
    );
}

/** How many delivery days the first-week picker shows: one week, the rotation the kitchen publishes. */
const SAMPLE_DAYS = 7;

/** The first week's meals, one picker per delivery day. Optional: untouched, the plan's rotation. */
function FirstWeekMeals({
    plan,
    state,
    patch,
    menu,
}: {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly menu: readonly MarketplaceMeal[];
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const dates = configuredDeliveryDates(state).slice(0, SAMPLE_DAYS);
    const swappable = menu.length > 0;

    /** The default meal for a slot: the plan's own sample list, rotated. */
    const defaultMealId = (index: number): MealId | null =>
        plan.sampleMealIds[index % Math.max(1, plan.sampleMealIds.length)] ?? null;
    const chosenAt = (index: number): MealId | null =>
        state.selectedMealIds[index] ?? defaultMealId(index);
    const nameFor = (mealId: MealId | null): string =>
        mealId === null
            ? t('commerce:configurator.meals.unknown')
            : (menu.find((meal) => meal.id === mealId)?.name ??
              t('commerce:configurator.meals.unknown'));

    const select = (index: number, mealId: MealId) => {
        const next = dates.map((_, position) =>
            position === index ? mealId : (chosenAt(position) ?? mealId),
        );
        patch({ selectedMealIds: next.filter((value): value is MealId => value !== null) });
    };

    return (
        <View testID="configurator-meals-week" className="flex-col gap-3 pb-4 pt-2">
            {dates.map((date, index) => {
                const mealId = chosenAt(index);
                const day = formatter.formatDate(date, { dateStyle: 'medium' });
                return (
                    <View
                        key={date}
                        testID={`configurator-meal-${date}`}
                        className="flex-col gap-1 md:flex-row md:items-center md:gap-4"
                    >
                        <RNText className="self-start text-sm text-content-secondary text-start md:w-[140px] md:self-center">
                            {day}
                        </RNText>
                        <View className={cx('min-w-0 md:flex-1')}>
                            {swappable ? (
                                <Select
                                    testID={`configurator-meal-${date}-select`}
                                    label={t('commerce:configurator.meals.selectLabel', {
                                        date: day,
                                    })}
                                    labelHidden
                                    value={mealId === null ? null : String(mealId)}
                                    placeholder={t('commerce:configurator.meals.unknown')}
                                    onChange={(next) => {
                                        const meal = menu.find(
                                            (option) => String(option.id) === next,
                                        );
                                        if (meal !== undefined) select(index, meal.id);
                                    }}
                                    options={menu.map((meal) => ({
                                        value: String(meal.id),
                                        label: meal.name,
                                    }))}
                                />
                            ) : (
                                <RNText
                                    testID={`configurator-meal-${date}-static`}
                                    className="self-start text-base text-content-primary text-start"
                                >
                                    {nameFor(mealId)}
                                </RNText>
                            )}
                        </View>
                    </View>
                );
            })}
        </View>
    );
}

export interface PriceLabels {
    readonly weekly: string;
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
 * The gross and the saving are derived — same currency, no cross-currency addition anywhere — and
 * the authority for what is owed remains `preview.total`, which is rendered as it arrived.
 */
export function buildPriceRows(
    preview: SubscriptionPreview,
    labels: PriceLabels,
): readonly PriceRow[] {
    const weeks = weeksFor(preview.configuration.duration);
    const currency = preview.total.currency;
    const gross = { amount: grossMinorUnits(preview.weeklyPrice.amount, weeks), currency };
    const saving = gross.amount - preview.total.amount;
    const perDelivery = perDeliveryPrice(preview.total, preview.deliveryCount);

    return [
        { key: 'weekly', label: labels.weekly, amount: preview.weeklyPrice },
        { key: 'gross', label: labels.gross, amount: gross },
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
