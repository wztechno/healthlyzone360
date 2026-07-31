import {
    ActionSheet,
    Badge,
    Button,
    Callout,
    Card,
    Checkbox,
    Chip,
    Dialog,
    Inline,
    NumberStepper,
    Select,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { ActionSheetAction, BadgeTone } from '@healthy360/design-system';
import type { MealPlanEntry } from '@healthy360/api-client/contracts';
import type { IconName } from '@healthy360/design-system';
import type { KitchenId, MealPlanId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    useAdjustPortionMutation,
    useLockEntryMutation,
    useRegenerateEntryMutation,
    useRemoveEntryMutation,
    useRepeatMealMutation,
} from '../../data/planner-hooks.ts';
import { formatMoney, nutrientValue } from '../marketplace/format.ts';
import {
    addDays,
    badgesFor,
    dateInstant,
    detailHrefFor,
    mondayOf,
    nutritionWarnings,
    safetyWarnings,
    weekDates,
} from './format.ts';
import type { PlannerBadgeKind } from './format.ts';

/**
 * A planner entry, as a card.
 *
 * This is the surface the whole planner is judged on, and it carries eleven of the specification's
 * planner requirements at once: the badges, the lock, the portion control, the preparation-time
 * indicator, the cost, the two warning states and the entry menu that reaches regeneration,
 * replacement, repeat, removal and the record behind the entry.
 *
 * ## Locking is a planning constraint, and the copy never says otherwise
 *
 * Doc 10, PRS-03 records the reference product's clearest documented defect: locking a meal and
 * marking it eaten are the same control there, and the consequence — documented by the vendor — is
 * that keeping a meal silently removes its ingredients from the shopping list. Doc 17, PLN-02 and
 * PLN-03 reject that emphatically, and this card is where the rejection has to be visible.
 *
 * So the control is called **"Keep this meal"**, its state reads "Kept — regeneration will not
 * change it", and nothing on this card claims anything about consumption. `MealPlanEntry` carries
 * `locked` and no `consumed`, `DailyNutritionSummary` carries `planned` and `actual` as separate
 * fields, and the summaries read `planned`. The gap — no contract operation records a `consumed`
 * state — is in the wave report rather than papered over with a lock that pretends to be both.
 *
 * ## Why regenerate is disabled rather than allowed to fail
 *
 * `regenerateEntry` rejects a locked entry with a validation failure (`mock/prototype/store.ts`).
 * Offering the action and then explaining the refusal would be a control that exists to produce an
 * error; the action is disabled with the reason attached instead, which is the same information one
 * step earlier.
 *
 * ## Portion adjustment is a real mutation and rescales everything
 *
 * `PATCH .../entries/{entry}/portion` scales the facts, the cost and re-derives the warnings
 * (doc 17, PLN-07 — the reference conflates portion adjustment with a pre-generation size setting).
 * The stepper commits on change rather than behind a save button, because the figures beside it are
 * the confirmation.
 */

const BADGE_TONE: Readonly<Record<PlannerBadgeKind, BadgeTone>> = {
    kitchen: 'brand',
    home_prepared: 'neutral',
    restaurant: 'neutral',
    food: 'neutral',
    dietitian_approved: 'success',
    leftover: 'info',
    locked: 'warning',
};

const BADGE_ICON: Readonly<Record<PlannerBadgeKind, IconName>> = {
    kitchen: 'organisation',
    home_prepared: 'branch',
    restaurant: 'dot',
    food: 'dotOutline',
    dietitian_approved: 'success',
    leftover: 'refresh',
    locked: 'check',
};

export const PORTION_STEP = 0.25;
export const PORTION_MIN = 0.25;
export const PORTION_MAX = 4;

export interface PlannerMealCardProps {
    readonly planId: MealPlanId;
    readonly entry: MealPlanEntry;
    /** `grid` is the dense desktop cell; `agenda` is the full-width mobile and day-screen row. */
    readonly density?: 'grid' | 'agenda' | undefined;
    /** Kitchen names by identifier, so the kitchen badge names the kitchen rather than a UUID. */
    readonly kitchenNames?: ReadonlyMap<KitchenId, string> | undefined;
    /** Opens the replacement drawer for this entry. */
    readonly onReplace: (entry: MealPlanEntry) => void;
    /** Every mutation reports through here, into the screen's live region. */
    readonly onAnnounce: (message: string) => void;
    readonly testID?: string | undefined;
}

export function PlannerMealCard({
    planId,
    entry,
    density = 'agenda',
    kitchenNames,
    onReplace,
    onAnnounce,
    testID,
}: PlannerMealCardProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();

    const [menuOpen, setMenuOpen] = useState(false);
    const [repeatOpen, setRepeatOpen] = useState(false);
    const [repeatDate, setRepeatDate] = useState<string>(addDays(entry.date, 1));
    const [repeatAsLeftover, setRepeatAsLeftover] = useState(true);

    const lock = useLockEntryMutation();
    const regenerate = useRegenerateEntryMutation();
    const remove = useRemoveEntryMutation();
    const repeat = useRepeatMealMutation();
    const portion = useAdjustPortionMutation();

    const base = testID ?? `planner-entry-${String(entry.id)}`;
    const compact = density === 'grid';

    const mealTypeLabel = t(`marketplace:mealTypes.${entry.mealType}`);
    const dayLabel = formatter.formatDate(dateInstant(entry.date), { weekday: 'long' });
    /** "Lunch on Tuesday" — the phrase every announcement on this card is built from. */
    const slotLabel = t('planner:card.slot', { mealType: mealTypeLabel, day: dayLabel });

    const badges = badgesFor(entry);
    const safety = safetyWarnings(entry);
    const nutrition = nutritionWarnings(entry);
    const detailHref = detailHrefFor(entry);
    const kitchenName =
        entry.kitchenId === null ? null : (kitchenNames?.get(entry.kitchenId) ?? null);

    const busy =
        lock.isPending ||
        regenerate.isPending ||
        remove.isPending ||
        repeat.isPending ||
        portion.isPending;

    const failed =
        lock.isError || regenerate.isError || remove.isError || repeat.isError || portion.isError;

    const badgeLabel = (kind: PlannerBadgeKind): string => {
        if (kind === 'kitchen') {
            return kitchenName === null
                ? t('planner:badges.kitchen')
                : t('planner:badges.kitchenNamed', { kitchen: kitchenName });
        }
        return t(`planner:badges.${kind}`);
    };

    const onToggleLock = () => {
        const next = !entry.locked;
        lock.mutate(
            { planId, entryId: entry.id, locked: next },
            {
                onSuccess: () => {
                    onAnnounce(
                        t(next ? 'planner:announce.locked' : 'planner:announce.unlocked', {
                            slot: slotLabel,
                            meal: entry.label,
                        }),
                    );
                },
            },
        );
    };

    const onRegenerate = () => {
        regenerate.mutate(
            { planId, entryId: entry.id },
            {
                onSuccess: (next) => {
                    onAnnounce(
                        t('planner:announce.entryRegenerated', {
                            slot: slotLabel,
                            meal: next.label,
                        }),
                    );
                },
            },
        );
    };

    const onRemove = () => {
        remove.mutate(
            { planId, entryId: entry.id },
            {
                onSuccess: () => {
                    onAnnounce(
                        t('planner:announce.removed', { slot: slotLabel, meal: entry.label }),
                    );
                },
            },
        );
    };

    const onPortion = (value: number | null) => {
        if (value === null || value === entry.portionFactor) return;
        portion.mutate(
            { planId, entryId: entry.id, request: { portionFactor: value } },
            {
                onSuccess: (next) => {
                    onAnnounce(
                        t('planner:announce.portion', {
                            slot: slotLabel,
                            meal: next.label,
                            portion: formatter.formatNumber(next.portionFactor, {
                                maximumFractionDigits: 2,
                            }),
                        }),
                    );
                },
            },
        );
    };

    const onConfirmRepeat = () => {
        repeat.mutate(
            {
                planId,
                request: {
                    entryId: entry.id,
                    dates: [repeatDate],
                    asLeftovers: repeatAsLeftover,
                },
            },
            {
                onSuccess: () => {
                    setRepeatOpen(false);
                    onAnnounce(
                        t(
                            repeatAsLeftover
                                ? 'planner:announce.repeatedLeftover'
                                : 'planner:announce.repeated',
                            {
                                meal: entry.label,
                                day: formatter.formatDate(dateInstant(repeatDate), {
                                    weekday: 'long',
                                }),
                            },
                        ),
                    );
                },
            },
        );
    };

    const actions: readonly ActionSheetAction[] = [
        {
            key: 'regenerate',
            label: t('planner:card.regenerate'),
            description: entry.locked
                ? t('planner:card.regenerateLockedHint')
                : t('planner:card.regenerateHint'),
            icon: 'refresh',
            disabled: entry.locked,
            testID: `${base}-regenerate`,
            onPress: onRegenerate,
        },
        {
            key: 'replace',
            label: t('planner:card.replace'),
            description: t('planner:card.replaceHint'),
            icon: 'search',
            testID: `${base}-replace`,
            onPress: () => {
                onReplace(entry);
            },
        },
        {
            key: 'repeat',
            label: t('planner:card.repeat'),
            description: t('planner:card.repeatHint'),
            icon: 'calendar',
            testID: `${base}-repeat`,
            onPress: () => {
                setRepeatOpen(true);
            },
        },
        ...(detailHref === null
            ? []
            : [
                  {
                      key: 'detail',
                      label:
                          entry.kind === 'recipe'
                              ? t('planner:card.openRecipe')
                              : t('planner:card.openMeal'),
                      icon: 'info' as IconName,
                      testID: `${base}-open-detail`,
                      onPress: () => {
                          router.push(detailHref as never);
                      },
                  },
              ]),
        {
            key: 'remove',
            label: t('planner:card.remove'),
            description: t('planner:card.removeHint'),
            tone: 'destructive' as const,
            testID: `${base}-remove`,
            onPress: onRemove,
        },
    ];

    const repeatOptions = weekDates(mondayOf(entry.date))
        .filter((date) => date !== entry.date)
        .map((date) => ({
            value: date,
            label: formatter.formatDate(dateInstant(date), {
                weekday: 'long',
                day: 'numeric',
                month: 'short',
            }),
        }));

    return (
        <Card
            testID={base}
            padding={compact ? 'sm' : 'md'}
            tone={entry.locked ? 'brand' : safety.length > 0 ? 'danger' : 'raised'}
        >
            <Stack space={compact ? 'xs' : 'sm'}>
                <Stack space="none">
                    <Text testID={`${base}-meal-type`} variant="caption" tone="secondary">
                        {mealTypeLabel}
                    </Text>
                    <Text testID={`${base}-name`} variant="bodyStrong">
                        {entry.label}
                    </Text>
                </Stack>

                <Text testID={`${base}-nutrition`} variant="caption" tone="secondary">
                    {t('planner:card.nutritionLine', {
                        energy: formatter.formatNumber(nutrientValue(entry.nutrition, 'energy')),
                        protein: formatter.formatNumber(nutrientValue(entry.nutrition, 'protein')),
                        carbohydrate: formatter.formatNumber(
                            nutrientValue(entry.nutrition, 'carbohydrate'),
                        ),
                        fat: formatter.formatNumber(nutrientValue(entry.nutrition, 'fat')),
                    })}
                </Text>

                <Inline space="xs" wrap testID={`${base}-badges`}>
                    {badges.map((kind) => (
                        <Badge
                            key={kind}
                            testID={`${base}-badge-${kind}`}
                            tone={BADGE_TONE[kind]}
                            icon={BADGE_ICON[kind]}
                            label={badgeLabel(kind)}
                        />
                    ))}
                    {entry.preparationMinutes === null ? null : (
                        <Chip
                            testID={`${base}-prep-time`}
                            tone="neutral"
                            icon="calendar"
                            label={t('planner:card.preparationMinutes', {
                                minutes: formatter.formatNumber(entry.preparationMinutes),
                            })}
                        />
                    )}
                    {entry.estimatedCost === null ? (
                        <Chip
                            testID={`${base}-cost-unknown`}
                            tone="neutral"
                            label={t('planner:card.costUnknown')}
                        />
                    ) : (
                        <Chip
                            testID={`${base}-cost`}
                            tone="neutral"
                            label={formatMoney(formatter, entry.estimatedCost)}
                        />
                    )}
                </Inline>

                {safety.length === 0 ? null : (
                    <Callout
                        testID={`${base}-allergy-warning`}
                        role="alert"
                        tone="danger"
                        icon="warning"
                        title={t('planner:warnings.allergenTitle')}
                        body={t('planner:warnings.allergenBody', {
                            meal: entry.label,
                            allergens: entry.allergens
                                .map((code) => t(`marketplace:allergens.${code}`))
                                .join(t('planner:common.listSeparator')),
                        })}
                    />
                )}

                {nutrition.map((code) => (
                    <Callout
                        key={code}
                        testID={`${base}-nutrition-warning`}
                        role="status"
                        tone="warning"
                        icon="warning"
                        title={t('planner:warnings.nutritionTitle')}
                        body={t(`planner:warnings.codes.${code.replace('planner.', '')}`, {
                            defaultValue: t('planner:warnings.nutritionFallback'),
                            meal: entry.label,
                        })}
                    />
                ))}

                <NumberStepper
                    testID={`${base}-portion`}
                    id={`${base}-portion`}
                    label={t('planner:card.portionLabel')}
                    hint={t('planner:card.portionHint')}
                    value={entry.portionFactor}
                    min={PORTION_MIN}
                    max={PORTION_MAX}
                    step={PORTION_STEP}
                    disabled={portion.isPending}
                    onChange={onPortion}
                />

                <Inline space="xs" wrap>
                    <Button
                        testID={`${base}-lock`}
                        size="sm"
                        variant={entry.locked ? 'primary' : 'secondary'}
                        label={entry.locked ? t('planner:card.unlock') : t('planner:card.lock')}
                        disabled={lock.isPending}
                        onPress={onToggleLock}
                    />
                    <Button
                        testID={`${base}-menu`}
                        size="sm"
                        variant="ghost"
                        label={t('planner:card.menu', { meal: entry.label })}
                        onPress={() => {
                            setMenuOpen(true);
                        }}
                    />
                </Inline>

                <Text testID={`${base}-lock-state`} variant="caption" tone="secondary">
                    {entry.locked ? t('planner:card.lockedState') : t('planner:card.unlockedState')}
                </Text>

                {busy ? (
                    <Text testID={`${base}-busy`} variant="caption" tone="secondary">
                        {t('planner:card.working')}
                    </Text>
                ) : null}

                {failed ? (
                    <Callout
                        testID={`${base}-error`}
                        role="alert"
                        tone="danger"
                        icon="error"
                        title={t('planner:card.actionErrorTitle')}
                        body={t('planner:card.actionErrorBody')}
                    />
                ) : null}
            </Stack>

            <ActionSheet
                testID={`${base}-actions`}
                open={menuOpen}
                onClose={() => {
                    setMenuOpen(false);
                }}
                title={entry.label}
                description={slotLabel}
                actions={actions}
            />

            <Dialog
                testID={`${base}-repeat-dialog`}
                open={repeatOpen}
                onClose={() => {
                    setRepeatOpen(false);
                }}
                title={t('planner:card.repeatTitle', { meal: entry.label })}
                description={t('planner:card.repeatBody')}
                actions={
                    <>
                        <Button
                            testID={`${base}-repeat-cancel`}
                            variant="secondary"
                            label={t('planner:common.cancel')}
                            onPress={() => {
                                setRepeatOpen(false);
                            }}
                        />
                        <Button
                            testID={`${base}-repeat-confirm`}
                            label={t('planner:card.repeatConfirm')}
                            disabled={repeat.isPending || repeatOptions.length === 0}
                            onPress={onConfirmRepeat}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Select
                        testID={`${base}-repeat-day`}
                        id={`${base}-repeat-day`}
                        label={t('planner:card.repeatDayLabel')}
                        value={repeatDate}
                        onChange={setRepeatDate}
                        options={repeatOptions}
                    />
                    <Checkbox
                        testID={`${base}-repeat-leftover`}
                        label={t('planner:card.repeatLeftoverLabel')}
                        description={t('planner:card.repeatLeftoverHint')}
                        checked={repeatAsLeftover}
                        onChange={setRepeatAsLeftover}
                    />
                </Stack>
            </Dialog>
        </Card>
    );
}
