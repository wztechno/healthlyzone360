import {
    Badge,
    Callout,
    Card,
    Checkbox,
    Chip,
    DateField,
    FilterChip,
    Inline,
    SegmentedControl,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type {
    MarketplaceMeal,
    PlanVariant,
    SubscriptionPlan,
    SubscriptionPreview,
    CustomerAddress,
} from '@healthy360/api-client/contracts';
import type { AllergenCode, DietClassification, MealId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import { MedicalDisclaimer } from '../../safety/medical-disclaimer.tsx';
import { formatMoney, weekdayKey } from '../marketplace/format.ts';
import { formatAddress, toDeliveryAddress } from './address.ts';
import type { AddressErrors, AddressField } from './address.ts';
import { AddressForm } from './address-form.tsx';
import {
    combinationKey,
    configuredDeliveryDates,
    diffAllergens,
    discountedTotalMinorUnits,
    grossMinorUnits,
    mealCombinations,
    perDeliveryPrice,
    savingMinorUnits,
    variantById,
    weeksFor,
} from './configurator.ts';
import type { ConfiguratorState } from './configurator.ts';
import { earliestStartDate, isoWeekday, nextAllowedDate } from './dates.ts';
import { DELIVERY_SLOTS } from './delivery.ts';
import type { DeliveryAreaStatus } from './delivery.ts';
import { PriceSummary } from './price-summary.tsx';
import type { PriceRow } from './price-summary.tsx';
import { displayableWarnings, isCriticalWarning, warningMessageKey } from './warnings.ts';

/**
 * The eight step bodies of the subscription configurator.
 *
 * They are components rather than a switch inside the screen so each one takes exactly the data it
 * needs — a step that cannot reach the preview cannot accidentally show a price, which is the
 * property the SUB-02 ordering depends on. The screen owns navigation, validation and the request;
 * these own layout and nothing else.
 */

export interface StepPatch {
    (patch: Partial<ConfiguratorState>): void;
}

/* ── 1. plan and variant ─────────────────────────────────────────────────────────────────────── */

export interface PlanStepProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
}

export function PlanStep({ plan, variant, state, patch }: PlanStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="md" testID="configurator-step-plan">
            <Stack space="xs">
                <Text variant="label">{plan.name}</Text>
                <Text tone="secondary">{plan.summary}</Text>
            </Stack>

            <SegmentedControl
                testID="configurator-variant-picker"
                label={t('commerce:configurator.plan.variantLabel')}
                block
                value={state.variantId === null ? '' : String(state.variantId)}
                onChange={(next) => {
                    const chosen = plan.variants.find((option) => String(option.id) === next);
                    if (chosen !== undefined) patch({ variantId: chosen.id });
                }}
                items={plan.variants.map((option) => ({
                    value: String(option.id),
                    label: option.name,
                    testID: `configurator-variant-${String(option.id)}`,
                }))}
            />

            {variant === null ? null : (
                <Stack space="sm">
                    <Text testID="configurator-energy-band">
                        {t('commerce:configurator.plan.band', {
                            min: formatter.formatNumber(variant.energyRange.min),
                            max: formatter.formatNumber(variant.energyRange.max),
                        })}
                    </Text>

                    <Stack space="xs" testID="configurator-macro-ranges">
                        <Text variant="label">{t('commerce:configurator.plan.macrosTitle')}</Text>
                        {(
                            [
                                ['protein', variant.proteinRange],
                                ['carbohydrate', variant.carbohydrateRange],
                                ['fat', variant.fatRange],
                            ] as const
                        ).map(([nutrientId, range]) =>
                            range === null ? null : (
                                <Text key={nutrientId} testID={`configurator-macro-${nutrientId}`}>
                                    {t('commerce:configurator.plan.macroRange', {
                                        nutrient: t(`marketplace:nutrients.${nutrientId}`),
                                        min: formatter.formatNumber(range.min),
                                        max: formatter.formatNumber(range.max),
                                    })}
                                </Text>
                            ),
                        )}
                        {/* Doc 17, SUB-07: ranges, with the variability said out loud. A rotating
                            menu has no single true protein figure and a point value would be false
                            precision dressed up as accuracy. */}
                        <Text tone="secondary" variant="caption">
                            {t('commerce:configurator.plan.macroCaveat')}
                        </Text>
                    </Stack>

                    <Text tone="secondary" testID="configurator-plan-price">
                        {t('commerce:configurator.plan.weeklyPrice', {
                            price: formatMoney(formatter, variant.pricePerWeek),
                        })}
                    </Text>
                </Stack>
            )}

            <MedicalDisclaimer context={t('commerce:configurator.disclaimerContext')} />
        </Stack>
    );
}

/* ── 2. meal combination ─────────────────────────────────────────────────────────────────────── */

export interface CombinationStepProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly onSelect: (key: string) => void;
}

export function CombinationStep({ plan, variant, onSelect }: CombinationStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const combinations = mealCombinations(plan);
    const selected = variant === null ? '' : combinationKey(variant);

    return (
        <Stack space="md" testID="configurator-step-combination">
            <Text tone="secondary">{t('commerce:configurator.combination.body')}</Text>

            <SegmentedControl
                testID="configurator-combination-picker"
                label={t('commerce:configurator.combination.label')}
                block
                value={selected}
                onChange={onSelect}
                items={combinations.map((combination) => ({
                    value: combinationKey(combination),
                    label: t('commerce:configurator.combination.option', {
                        meals: formatter.formatNumber(combination.mealsPerDay),
                        snacks: formatter.formatNumber(combination.snacksPerDay),
                    }),
                    testID: `configurator-combination-${combinationKey(combination)}`,
                }))}
            />

            {variant === null ? null : (
                <Inline space="xs" wrap testID="configurator-combination-detail">
                    <Badge
                        tone="neutral"
                        label={t('commerce:configurator.combination.meals', {
                            count: variant.mealsPerDay,
                            meals: formatter.formatNumber(variant.mealsPerDay),
                        })}
                    />
                    <Badge
                        testID="configurator-combination-snacks"
                        tone="neutral"
                        label={
                            variant.snacksPerDay === 0
                                ? t('commerce:configurator.combination.noSnacks')
                                : t('commerce:configurator.combination.snacks', {
                                      count: variant.snacksPerDay,
                                      snacks: formatter.formatNumber(variant.snacksPerDay),
                                  })
                        }
                    />
                </Inline>
            )}

            {/*
             * Doc 17, SUB-08. Meals and snacks *are* two separate attributes here, which is the
             * half of the recommendation the catalogue contract already satisfies. What it does not
             * satisfy is independence: both live on the same `PlanVariant` as the calorie band, so
             * changing the combination can move the band. Saying so is better than a control that
             * quietly changes a number the person chose two steps ago.
             */}
            <Callout
                testID="configurator-combination-note"
                role="note"
                tone="info"
                title={t('commerce:configurator.combination.couplingTitle')}
                body={t('commerce:configurator.combination.couplingBody')}
            />
        </Stack>
    );
}

/* ── 3. duration ─────────────────────────────────────────────────────────────────────────────── */

export interface DurationStepProps {
    readonly plan: SubscriptionPlan;
    readonly variant: PlanVariant | null;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
}

export function DurationStep({ plan, variant, state, patch }: DurationStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="md" testID="configurator-step-duration">
            <Text tone="secondary">{t('commerce:configurator.duration.body')}</Text>

            <Stack space="sm" testID="configurator-duration-options">
                {plan.durations.map((option) => {
                    const weeks = weeksFor(option.duration);
                    const weekly = variant?.pricePerWeek ?? null;
                    const total =
                        weekly === null
                            ? null
                            : {
                                  amount: discountedTotalMinorUnits(
                                      weekly.amount,
                                      weeks,
                                      option.discountPercent,
                                  ),
                                  currency: weekly.currency,
                              };
                    const saving =
                        weekly === null
                            ? null
                            : {
                                  amount: savingMinorUnits(
                                      weekly.amount,
                                      weeks,
                                      option.discountPercent,
                                  ),
                                  currency: weekly.currency,
                              };
                    const chosen = state.duration === option.duration;

                    return (
                        <Card
                            key={option.duration}
                            testID={`configurator-duration-${option.duration}`}
                            padding="md"
                            tone={chosen ? 'brand' : 'default'}
                            onPress={() => {
                                patch({ duration: option.duration });
                            }}
                            accessibilityLabel={t('commerce:configurator.duration.optionLabel', {
                                duration: t(`commerce:durations.${option.duration}`),
                            })}
                        >
                            <Stack space="xs">
                                <Inline space="sm" align="center" justify="between">
                                    <Text variant="bodyStrong">
                                        {t(`commerce:durations.${option.duration}`)}
                                    </Text>
                                    {/* Doc 17, SUB-05: the discount is a badge on the option
                                        itself, not a separate promotional block. */}
                                    <Badge
                                        testID={`configurator-duration-${option.duration}-discount`}
                                        tone={option.discountPercent > 0 ? 'success' : 'neutral'}
                                        label={
                                            option.discountPercent > 0
                                                ? t('commerce:configurator.duration.discount', {
                                                      percent: formatter.formatNumber(
                                                          option.discountPercent,
                                                      ),
                                                  })
                                                : t('commerce:configurator.duration.noDiscount')
                                        }
                                    />
                                </Inline>
                                {total === null ? null : (
                                    <Text testID={`configurator-duration-${option.duration}-total`}>
                                        {t('commerce:configurator.duration.total', {
                                            total: formatMoney(formatter, total),
                                            weeks: formatter.formatNumber(weeks),
                                        })}
                                    </Text>
                                )}
                                {saving === null || saving.amount === 0 ? null : (
                                    <Text tone="success" variant="caption">
                                        {t('commerce:configurator.duration.saving', {
                                            saving: formatMoney(formatter, saving),
                                        })}
                                    </Text>
                                )}
                                {chosen ? (
                                    <Text tone="secondary" variant="caption">
                                        {t('commerce:configurator.duration.selected')}
                                    </Text>
                                ) : null}
                            </Stack>
                        </Card>
                    );
                })}
            </Stack>

            <Text tone="secondary" variant="caption" testID="configurator-duration-caveat">
                {t('commerce:configurator.duration.caveat')}
            </Text>
        </Stack>
    );
}

/* ── 4. dietary preferences and allergies ────────────────────────────────────────────────────── */

export interface DietaryStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    /** Allergens this kitchen declares on its own menu, plus anything the profile already excludes. */
    readonly allergenOptions: readonly AllergenCode[];
    readonly storedAllergens: readonly AllergenCode[];
    readonly restrictionsPending: boolean;
}

export function DietaryStep({
    plan,
    state,
    patch,
    allergenOptions,
    storedAllergens,
    restrictionsPending,
}: DietaryStepProps) {
    const { t } = useTranslation();
    const change = diffAllergens(storedAllergens, state.excludeAllergens);

    const toggleDiet = (diet: DietClassification, selected: boolean) => {
        patch({
            dietClassifications: selected
                ? [...state.dietClassifications, diet]
                : state.dietClassifications.filter((value) => value !== diet),
        });
    };

    const toggleAllergen = (code: AllergenCode, selected: boolean) => {
        patch({
            allergensTouched: true,
            excludeAllergens: selected
                ? [...state.excludeAllergens, code]
                : state.excludeAllergens.filter((value) => value !== code),
        });
    };

    return (
        <Stack space="lg" testID="configurator-step-dietary">
            <Stack space="sm" testID="configurator-diets">
                <Text variant="label">{t('commerce:configurator.dietary.dietsTitle')}</Text>
                <Text tone="secondary" variant="caption">
                    {t('commerce:configurator.dietary.dietsBody')}
                </Text>
                <Inline space="xs" wrap>
                    {plan.dietClassifications.map((diet) => (
                        <FilterChip
                            key={diet}
                            testID={`configurator-diet-${diet}`}
                            label={t(`marketplace:diets.${diet}`)}
                            selected={state.dietClassifications.includes(diet)}
                            onChange={(selected) => {
                                toggleDiet(diet, selected);
                            }}
                        />
                    ))}
                </Inline>
            </Stack>

            <Stack space="sm" testID="configurator-allergens">
                <Text variant="label">{t('commerce:configurator.dietary.allergensTitle')}</Text>
                <Text tone="secondary" variant="caption">
                    {restrictionsPending
                        ? t('commerce:configurator.dietary.allergensLoading')
                        : t('commerce:configurator.dietary.allergensBody')}
                </Text>
                {allergenOptions.length === 0 ? (
                    <Text testID="configurator-allergens-none">
                        {t('commerce:configurator.dietary.allergensNone')}
                    </Text>
                ) : (
                    <Inline space="xs" wrap>
                        {allergenOptions.map((code) => (
                            <FilterChip
                                key={code}
                                testID={`configurator-allergen-${code}`}
                                label={t(`marketplace:allergens.${code}`)}
                                selected={state.excludeAllergens.includes(code)}
                                onChange={(selected) => {
                                    toggleAllergen(code, selected);
                                }}
                            />
                        ))}
                    </Inline>
                )}
            </Stack>

            {/*
             * Adding an exclusion tightens what the kitchen may send and needs no ceremony.
             * Removing one is a person telling the product to stop filtering for something they
             * previously recorded as an allergy — so it is an alert, it names what was dropped, and
             * it travels with the medical disclaimer.
             */}
            {change.relaxed ? (
                <Callout
                    testID="configurator-allergen-relaxed"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('commerce:configurator.dietary.relaxedTitle')}
                    body={t('commerce:configurator.dietary.relaxedBody', {
                        allergens: change.removed
                            .map((code) => t(`marketplace:allergens.${code}`))
                            .join(t('commerce:common.listSeparator')),
                    })}
                />
            ) : null}

            {change.changed && !change.relaxed ? (
                <Callout
                    testID="configurator-allergen-added"
                    role="status"
                    tone="info"
                    title={t('commerce:configurator.dietary.addedTitle')}
                    body={t('commerce:configurator.dietary.addedBody', {
                        allergens: change.added
                            .map((code) => t(`marketplace:allergens.${code}`))
                            .join(t('commerce:common.listSeparator')),
                    })}
                />
            ) : null}

            <MedicalDisclaimer context={t('commerce:configurator.allergyDisclaimerContext')} />
        </Stack>
    );
}

/* ── 5. delivery, and the two checks that come before any price ──────────────────────────────── */

export interface DeliveryStepProps {
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
    readonly weekdaysPending: boolean;
    readonly areaStatus: DeliveryAreaStatus;
    readonly servedAreas: readonly string[];
    readonly addressErrors: AddressErrors;
    readonly storedAllergens: readonly AllergenCode[];
    readonly showIssues: boolean;
    readonly savedAddresses?: readonly CustomerAddress[] | undefined;
    readonly addressId?: string | null | undefined;
    readonly addressesPending?: boolean | undefined;
    readonly onAddressIdChange?: ((id: string | null) => void) | undefined;
}

export function DeliveryStep({
    state,
    patch,
    onAddressField,
    allowedWeekdays,
    weekdaysPending,
    areaStatus,
    servedAreas,
    addressErrors,
    storedAllergens,
    showIssues,
    savedAddresses,
    addressId,
    addressesPending,
    onAddressIdChange,
}: DeliveryStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const allowed = allowedWeekdays ?? [];
    const startWeekday = state.startDate === null ? null : isoWeekday(state.startDate);
    const startWeekdayAllowed =
        allowedWeekdays === null || startWeekday === null || allowed.includes(startWeekday);
    const repair =
        state.startDate === null || startWeekdayAllowed
            ? null
            : nextAllowedDate(state.startDate, allowed);

    const change = diffAllergens(storedAllergens, state.excludeAllergens);

    return (
        <Stack space="lg" testID="configurator-step-delivery">
            <Stack space="sm" testID="configurator-start-date">
                <DateField
                    testID="configurator-start-date-field"
                    label={t('commerce:configurator.delivery.startLabel')}
                    hint={t('commerce:configurator.delivery.startHint')}
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
                )}
            </Stack>

            <Stack space="sm" testID="configurator-weekdays">
                <Text variant="label">{t('commerce:configurator.delivery.weekdaysTitle')}</Text>
                <Text tone="secondary" variant="caption">
                    {weekdaysPending
                        ? t('commerce:configurator.delivery.weekdaysLoading')
                        : t('commerce:configurator.delivery.weekdaysBody')}
                </Text>
                <Inline space="xs" wrap>
                    {[1, 2, 3, 4, 5, 6, 7].map((weekday) => {
                        const available = allowedWeekdays === null || allowed.includes(weekday);
                        return (
                            <FilterChip
                                key={weekday}
                                testID={`configurator-weekday-${String(weekday)}`}
                                label={t(weekdayKey(weekday))}
                                selected={state.deliveryWeekdays.includes(weekday)}
                                disabled={!available}
                                onChange={(selected) => {
                                    patch({
                                        deliveryWeekdays: selected
                                            ? [...state.deliveryWeekdays, weekday]
                                            : state.deliveryWeekdays.filter(
                                                  (value) => value !== weekday,
                                              ),
                                    });
                                }}
                            />
                        );
                    })}
                </Inline>
                {allowedWeekdays === null || allowed.length === 7 ? null : (
                    <Text tone="secondary" variant="caption" testID="configurator-weekdays-limited">
                        {t('commerce:configurator.delivery.weekdaysLimited', {
                            days: allowed
                                .map((weekday) => t(weekdayKey(weekday)))
                                .join(t('commerce:common.listSeparator')),
                        })}
                    </Text>
                )}
            </Stack>

            <Stack space="sm" testID="configurator-slot">
                <Text variant="label">{t('commerce:configurator.delivery.slotTitle')}</Text>
                <SegmentedControl
                    testID="configurator-slot-picker"
                    label={t('commerce:configurator.delivery.slotTitle')}
                    block
                    value={state.slotCode}
                    onChange={(next) => {
                        patch({ slotCode: next });
                    }}
                    items={DELIVERY_SLOTS.map((slot) => ({
                        value: slot.code,
                        label: t(`commerce:slots.${slot.code}`),
                        testID: `configurator-slot-${slot.code}`,
                    }))}
                />
            </Stack>

            <Stack space="sm" testID="configurator-address">
                <Text variant="label">{t('commerce:configurator.delivery.addressTitle')}</Text>
                {savedAddresses === undefined || savedAddresses.length === 0 ? (
                    <AddressForm
                        testID="configurator-address-form"
                        values={state.address}
                        errors={showIssues ? addressErrors : {}}
                        onChange={onAddressField}
                    />
                ) : (
                    <Select
                        testID="configurator-address-picker"
                        label={t('commerce:configurator.delivery.addressTitle')}
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
                        placeholder={t('commerce:configurator.delivery.addressTitle')}
                    />
                )}
                {addressesPending === true ? (
                    <Text tone="secondary" variant="caption">
                        {t('commerce:configurator.delivery.weekdaysLoading')}
                    </Text>
                ) : null}
                {showIssues &&
                addressId === null &&
                savedAddresses !== undefined &&
                savedAddresses.length > 0 ? (
                    <Text tone="danger" variant="caption" testID="configurator-address-error">
                        {t('commerce:validation.required')}
                    </Text>
                ) : null}
            </Stack>

            {/*
             * The SUB-02 checkpoint (doc 11 §3, DEC-SUB-01; doc 17, SUB-02).
             *
             * The reference confirms delivery availability after the pricing decision and routes
             * allergies to customer service after purchase. Both are answered here — before the
             * price step — because both are cheap to ask and both are dispositive, and selling a
             * subscription that cannot be delivered or cannot be eaten is worse than one extra
             * question.
             */}
            <Card testID="configurator-checks" padding="md" tone="sunken">
                <Stack space="md">
                    <Stack space="xs">
                        <Text variant="label">{t('commerce:configurator.checks.title')}</Text>
                        <Text tone="secondary" variant="caption">
                            {t('commerce:configurator.checks.body')}
                        </Text>
                    </Stack>

                    <AreaCheck
                        status={areaStatus}
                        area={state.address.area}
                        servedAreas={servedAreas}
                    />

                    <Stack space="xs" testID="configurator-check-allergens">
                        <Text>
                            {state.excludeAllergens.length === 0
                                ? t('commerce:configurator.checks.noAllergens')
                                : t('commerce:configurator.checks.allergens', {
                                      allergens: state.excludeAllergens
                                          .map((code) => t(`marketplace:allergens.${code}`))
                                          .join(t('commerce:common.listSeparator')),
                                  })}
                        </Text>
                        {change.relaxed ? (
                            <Callout
                                testID="configurator-check-relaxed"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('commerce:configurator.checks.relaxedTitle')}
                                body={t('commerce:configurator.checks.relaxedBody', {
                                    allergens: change.removed
                                        .map((code) => t(`marketplace:allergens.${code}`))
                                        .join(t('commerce:common.listSeparator')),
                                })}
                            />
                        ) : null}
                    </Stack>

                    <Checkbox
                        testID="configurator-checks-acknowledge"
                        checked={state.checksAcknowledged}
                        onChange={(checked) => {
                            patch({ checksAcknowledged: checked });
                        }}
                        label={t('commerce:configurator.checks.acknowledgeLabel')}
                        description={t('commerce:configurator.checks.acknowledgeDescription')}
                        required
                        {...(showIssues && !state.checksAcknowledged
                            ? { error: t('commerce:configurator.issues.checks') }
                            : {})}
                    />
                </Stack>
            </Card>

            <MedicalDisclaimer context={t('commerce:configurator.allergyDisclaimerContext')} />
        </Stack>
    );
}

interface AreaCheckProps {
    readonly status: DeliveryAreaStatus;
    readonly area: string;
    readonly servedAreas: readonly string[];
}

function AreaCheck({ status, area, servedAreas }: AreaCheckProps) {
    const { t } = useTranslation();
    const areas = servedAreas.join(t('commerce:common.listSeparator'));

    if (status === 'served') {
        return (
            <Callout
                testID="configurator-area-served"
                role="status"
                tone="success"
                icon="success"
                title={t('commerce:configurator.checks.areaServedTitle')}
                body={t('commerce:configurator.checks.areaServedBody', { area })}
            />
        );
    }

    if (status === 'unserved') {
        return (
            <Callout
                testID="configurator-area-unserved"
                role="alert"
                tone="danger"
                icon="warning"
                title={t('commerce:configurator.checks.areaUnservedTitle')}
                body={t('commerce:configurator.checks.areaUnservedBody', { area, areas })}
            />
        );
    }

    return (
        <Callout
            testID="configurator-area-unknown"
            role="note"
            tone="warning"
            icon="info"
            title={t('commerce:configurator.checks.areaUnknownTitle')}
            body={t('commerce:configurator.checks.areaUnknownBody')}
        />
    );
}

/* ── 6. the sample week ──────────────────────────────────────────────────────────────────────── */

export interface MealsStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    /** The kitchen's own menu. Empty when it could not be loaded — the step degrades honestly. */
    readonly menu: readonly MarketplaceMeal[];
    readonly menuPending: boolean;
}

/** How many delivery days the preview shows. One week, which is the rotation the kitchen publishes. */
const SAMPLE_DAYS = 7;

export function MealsStep({ plan, state, patch, menu, menuPending }: MealsStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const dates = configuredDeliveryDates(state).slice(0, SAMPLE_DAYS);
    const swappable = menu.length > 0;

    /** The default meal for a slot: the plan's own sample list, rotated. */
    const defaultMealId = (index: number): MealId | null =>
        plan.sampleMealIds[index % Math.max(1, plan.sampleMealIds.length)] ?? null;

    const chosenAt = (index: number): MealId | null =>
        state.selectedMealIds[index] ?? defaultMealId(index);

    const nameFor = (mealId: MealId | null): string => {
        if (mealId === null) return t('commerce:configurator.meals.unknown');
        return (
            menu.find((meal) => meal.id === mealId)?.name ??
            t('commerce:configurator.meals.fromPlan')
        );
    };

    const select = (index: number, mealId: MealId) => {
        const next = dates.map((_, position) =>
            position === index ? mealId : (chosenAt(position) ?? mealId),
        );
        patch({ selectedMealIds: next.filter((value): value is MealId => value !== null) });
    };

    return (
        <Stack space="md" testID="configurator-step-meals">
            <Text tone="secondary">{t('commerce:configurator.meals.body')}</Text>

            {dates.length === 0 ? (
                <Text testID="configurator-meals-empty">
                    {t('commerce:configurator.meals.noDates')}
                </Text>
            ) : (
                <Stack space="sm" testID="configurator-meals-week">
                    {dates.map((date, index) => {
                        const mealId = chosenAt(index);
                        return (
                            <Card key={date} testID={`configurator-meal-${date}`} padding="md">
                                <Stack space="xs">
                                    <Text variant="label">
                                        {formatter.formatDate(date, { dateStyle: 'full' })}
                                    </Text>
                                    {swappable ? (
                                        <Select
                                            testID={`configurator-meal-${date}-select`}
                                            label={t('commerce:configurator.meals.selectLabel', {
                                                date: formatter.formatDate(date, {
                                                    dateStyle: 'medium',
                                                }),
                                            })}
                                            value={mealId === null ? null : String(mealId)}
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
                                        <Text testID={`configurator-meal-${date}-static`}>
                                            {nameFor(mealId)}
                                        </Text>
                                    )}
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
            )}

            <Callout
                testID="configurator-meals-note"
                role="note"
                tone="info"
                title={t('commerce:configurator.meals.noteTitle')}
                body={
                    menuPending
                        ? t('commerce:configurator.meals.noteLoading')
                        : swappable
                          ? t('commerce:configurator.meals.noteSwappable')
                          : t('commerce:configurator.meals.noteStatic')
                }
            />
        </Stack>
    );
}

/* ── 7. summary and price ────────────────────────────────────────────────────────────────────── */

export interface SummaryStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly preview: SubscriptionPreview | undefined;
}

export function SummaryStep({ plan, state, preview }: SummaryStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const variant = variantById(plan, state.variantId);

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
                  perDeliveryNote: t('commerce:configurator.summary.perDeliveryNote', {
                      count: preview.deliveryCount,
                      deliveries: formatter.formatNumber(preview.deliveryCount),
                  }),
              });

    return (
        <Stack space="lg" testID="configurator-step-summary">
            <Stack space="sm" testID="configurator-summary-configuration">
                <Text variant="label">{t('commerce:configurator.summary.configTitle')}</Text>
                <SummaryRow
                    testID="configurator-summary-plan"
                    label={t('commerce:configurator.summary.plan')}
                    value={`${plan.name} · ${variant?.name ?? '—'}`}
                />
                <SummaryRow
                    testID="configurator-summary-duration"
                    label={t('commerce:configurator.summary.duration')}
                    value={t(`commerce:durations.${state.duration}`)}
                />
                <SummaryRow
                    testID="configurator-summary-days"
                    label={t('commerce:configurator.summary.days')}
                    value={state.deliveryWeekdays
                        .map((weekday) => t(weekdayKey(weekday)))
                        .join(t('commerce:common.listSeparator'))}
                />
                <SummaryRow
                    testID="configurator-summary-slot"
                    label={t('commerce:configurator.summary.slot')}
                    value={t(`commerce:slots.${state.slotCode}`)}
                />
                <SummaryRow
                    testID="configurator-summary-address"
                    label={t('commerce:configurator.summary.address')}
                    value={formatAddress(toDeliveryAddress(state.address))}
                />
                <SummaryRow
                    testID="configurator-summary-allergens"
                    label={t('commerce:configurator.summary.allergens')}
                    value={
                        state.excludeAllergens.length === 0
                            ? t('commerce:configurator.checks.noAllergens')
                            : state.excludeAllergens
                                  .map((code) => t(`marketplace:allergens.${code}`))
                                  .join(t('commerce:common.listSeparator'))
                    }
                />
                {preview === undefined ? null : (
                    <SummaryRow
                        testID="configurator-summary-window"
                        label={t('commerce:configurator.summary.window')}
                        value={t('commerce:configurator.summary.windowValue', {
                            first: formatter.formatDate(preview.firstDeliveryDate, {
                                dateStyle: 'medium',
                            }),
                            last: formatter.formatDate(preview.lastDeliveryDate, {
                                dateStyle: 'medium',
                            }),
                        })}
                    />
                )}
            </Stack>

            {/* The SUB-02 checks, restated where the price is, so the ordering is visible and not
                merely true. */}
            <Callout
                testID="configurator-summary-checks"
                role="note"
                tone="success"
                icon="success"
                title={t('commerce:configurator.summary.checksTitle')}
                body={t('commerce:configurator.summary.checksBody')}
            />

            {preview === undefined ? null : (
                <Card testID="configurator-summary-price" padding="md" tone="sunken">
                    <Stack space="md">
                        <Text variant="label">{t('commerce:configurator.summary.priceTitle')}</Text>
                        <PriceSummary
                            rows={rows}
                            testID="configurator-price"
                            caption={t('commerce:configurator.summary.priceCaption')}
                        />
                    </Stack>
                </Card>
            )}

            {displayableWarnings(preview?.warnings ?? []).map((code) => (
                <Callout
                    key={code}
                    testID={`configurator-warning-${code.replace(/\./g, '-')}`}
                    role={isCriticalWarning(code) ? 'alert' : 'note'}
                    tone={isCriticalWarning(code) ? 'danger' : 'warning'}
                    icon="warning"
                    title={t('commerce:warnings.title')}
                    body={t(warningMessageKey(code), { code })}
                />
            ))}

            <MedicalDisclaimer context={t('commerce:configurator.disclaimerContext')} />
        </Stack>
    );
}

export interface PriceLabels {
    readonly weekly: string;
    readonly gross: string;
    readonly discount: string;
    readonly total: string;
    readonly perDelivery: string;
    readonly perDeliveryNote: string;
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
            : [
                  {
                      key: 'per-delivery',
                      label: labels.perDelivery,
                      amount: perDelivery,
                      note: labels.perDeliveryNote,
                  },
              ]),
    ];
}

interface SummaryRowProps {
    readonly label: string;
    readonly value: string;
    readonly testID: string;
}

function SummaryRow({ label, value, testID }: SummaryRowProps) {
    return (
        <Inline space="sm" align="center" justify="between" testID={testID}>
            <Text tone="secondary">{label}</Text>
            <Text variant="bodyStrong">{value}</Text>
        </Inline>
    );
}

/* ── 8. confirm ──────────────────────────────────────────────────────────────────────────────── */

export interface ConfirmStepProps {
    readonly plan: SubscriptionPlan;
    readonly state: ConfiguratorState;
    readonly patch: StepPatch;
    readonly preview: SubscriptionPreview | undefined;
    readonly showIssues: boolean;
}

export function ConfirmStep({ plan, state, patch, preview, showIssues }: ConfirmStepProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <Stack space="lg" testID="configurator-step-confirm">
            <Stack space="xs">
                <Text variant="label">{t('commerce:configurator.confirm.title')}</Text>
                <Text tone="secondary">{t('commerce:configurator.confirm.body')}</Text>
            </Stack>

            {preview === undefined ? null : (
                <Card testID="configurator-confirm-summary" padding="md" tone="sunken">
                    <Stack space="xs">
                        <Text testID="configurator-confirm-plan" variant="bodyStrong">
                            {plan.name}
                        </Text>
                        <Text testID="configurator-confirm-total">
                            {t('commerce:configurator.confirm.total', {
                                total: formatMoney(formatter, preview.total),
                                duration: t(`commerce:durations.${state.duration}`),
                            })}
                        </Text>
                        <Text tone="secondary" variant="caption">
                            {t('commerce:configurator.confirm.deliveries', {
                                count: preview.deliveryCount,
                                deliveries: formatter.formatNumber(preview.deliveryCount),
                                first: formatter.formatDate(preview.firstDeliveryDate, {
                                    dateStyle: 'medium',
                                }),
                            })}
                        </Text>
                    </Stack>
                </Card>
            )}

            <Callout
                testID="configurator-confirm-terms"
                role="note"
                tone="info"
                title={t('commerce:configurator.confirm.termsTitle')}
                body={t('commerce:configurator.confirm.termsBody')}
            />

            <Checkbox
                testID="configurator-confirm-acknowledge"
                checked={state.termsAcknowledged}
                onChange={(checked) => {
                    patch({ termsAcknowledged: checked });
                }}
                label={t('commerce:configurator.confirm.acknowledgeLabel')}
                description={t('commerce:configurator.confirm.acknowledgeDescription')}
                required
                {...(showIssues && !state.termsAcknowledged
                    ? { error: t('commerce:configurator.issues.terms') }
                    : {})}
            />
        </Stack>
    );
}
