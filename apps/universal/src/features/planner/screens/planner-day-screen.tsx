import {
    Button,
    Callout,
    Dialog,
    EmptyState,
    FadeIn,
    Heading,
    Inline,
    Stack,
    Text,
    useMotion,
} from '@healthy360/design-system';
import type { Kitchen, MealPlanEntry } from '@healthy360/api-client/contracts';
import type { KitchenId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import {
    useCurrentPlanQuery,
    usePlannerDayQuery,
    useRegenerateDayMutation,
} from '../../../data/planner-hooks.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { AddEntryDrawer } from '../add-entry-drawer.tsx';
import { PlannerAnnouncer, usePlannerAnnouncement } from '../announcer.tsx';
import {
    PLANNER_MEAL_TYPES,
    dateInstant,
    entriesForSlot,
    hasSafetyWarning,
    isPlannerDate,
    mondayOf,
    todayIso,
} from '../format.ts';
import { PlannerMealCard } from '../meal-card.tsx';
import { CostEstimate, NutritionSummary } from '../nutrition-summary.tsx';
import { ReplacementDrawer } from '../replacement-drawer.tsx';

/**
 * `/customer/planner/day/{date}` — one day, in full.
 *
 * The week grid answers "what does my week look like"; this answers "what am I eating today, and
 * does it add up". So it is an agenda at every width — there is nothing to lay out in columns — and
 * the day's own nutrition summary is the headline rather than a footnote.
 *
 * ## Adding an entry is where all four kinds live
 *
 * `PLAN_ENTRY_KINDS` has four members and the day screen is the only surface where all four make
 * sense: a food, a recipe, a kitchen meal and a planned restaurant meal all go *into a day*. They
 * are in a drawer rather than four buttons because the choice of kind changes the whole form.
 *
 * ## Day regeneration, and what it leaves alone
 *
 * `regenerateDay` rewrites every unlocked entry on the day and touches nothing else — not the rest
 * of the week, not the notes, not a locked entry. The button says so before it is pressed.
 */
export interface PlannerDayScreenProps {
    readonly date: string | undefined;
}

export function PlannerDayScreen({ date }: PlannerDayScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const motion = useMotion();
    const { me } = useSession();
    const signedIn = me !== null;

    const { message, announce } = usePlannerAnnouncement();

    const day = isPlannerDate(date) ? date : null;

    const currentPlan = useCurrentPlanQuery(signedIn);
    const planId = currentPlan.data?.planId ?? null;
    const dayQuery = usePlannerDayQuery(planId, day);
    const kitchens = useKitchensQuery({ limit: 20 });

    const regenerateDay = useRegenerateDayMutation();

    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const [addOpen, setAddOpen] = useState(false);
    const [replacing, setReplacing] = useState<MealPlanEntry | null>(null);

    const kitchenNames = useMemo<ReadonlyMap<KitchenId, string>>(
        () =>
            new Map(
                (kitchens.data?.items ?? []).map(
                    (kitchen: Kitchen) => [kitchen.id, kitchen.name] as const,
                ),
            ),
        [kitchens.data],
    );

    const data = dayQuery.data;
    const entries: readonly MealPlanEntry[] = data?.entries ?? [];
    const warned = entries.filter(hasSafetyWarning);

    if (day === null) {
        return (
            <Stack space="lg" testID="planner-day-screen">
                <EmptyState
                    testID="planner-day-not-found"
                    title={t('planner:day.notFoundTitle')}
                    body={t('planner:day.notFoundBody')}
                    actions={
                        <Button
                            testID="planner-day-not-found-planner"
                            label={t('planner:day.backToWeek')}
                            onPress={() => {
                                router.replace('/customer/planner' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    const dayLabel = formatter.formatDate(dateInstant(day), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
    });

    return (
        <Stack space="lg" testID="planner-day-screen">
            <PlannerAnnouncer message={message} />

            <Stack space="xs">
                <Heading level={1} testID="planner-day-title">
                    {dayLabel}
                </Heading>
                {day === todayIso() ? (
                    <Text testID="planner-day-today" tone="secondary" variant="caption">
                        {t('planner:day.today')}
                    </Text>
                ) : null}
            </Stack>

            <Inline space="sm" wrap testID="planner-day-navigation">
                <Button
                    testID="planner-day-back-to-week"
                    variant="quiet"
                    size="sm"
                    label={t('planner:day.backToWeek')}
                    onPress={() => {
                        router.push(`/customer/planner/week/${mondayOf(day)}` as never);
                    }}
                />
                <Button
                    testID="planner-day-add"
                    size="sm"
                    label={t('planner:day.addEntry')}
                    disabled={planId === null}
                    onPress={() => {
                        setAddOpen(true);
                    }}
                />
                <Button
                    testID="planner-day-regenerate"
                    size="sm"
                    variant="secondary"
                    label={t('planner:day.regenerate')}
                    disabled={planId === null || regenerateDay.isPending}
                    onPress={() => {
                        setConfirmRegenerate(true);
                    }}
                />
            </Inline>

            <QueryStates
                query={dayQuery}
                isEmpty={data !== undefined && entries.length === 0}
                emptyTitle={t('planner:day.emptyTitle')}
                emptyBody={t('planner:day.emptyBody')}
                emptyActions={
                    <Button
                        testID="planner-day-empty-add"
                        label={t('planner:day.addEntry')}
                        disabled={planId === null}
                        onPress={() => {
                            setAddOpen(true);
                        }}
                    />
                }
                skeletonCount={3}
                testID="planner-day"
            >
                {data === undefined ? null : (
                    <Stack space="lg">
                        {warned.length === 0 ? null : (
                            <Callout
                                testID="planner-day-warnings"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('planner:day.warningsTitle')}
                                body={t('planner:day.warningsBody', {
                                    items: warned.length,
                                    meals: warned
                                        .map((entry) => entry.label)
                                        .join(t('planner:common.listSeparator')),
                                })}
                            />
                        )}

                        <NutritionSummary
                            testID="planner-day-summary"
                            title={t('planner:day.summaryTitle')}
                            planned={data.summary.planned}
                            actual={data.summary.actual}
                            targets={data.targets}
                            headline
                        />

                        <CostEstimate
                            testID="planner-day-cost"
                            title={t('planner:day.costTitle')}
                            entries={entries}
                            estimatedCost={data.summary.estimatedCost}
                        />

                        <Stack space="lg" testID="planner-day-agenda">
                            {PLANNER_MEAL_TYPES.map((mealType) => {
                                const slotEntries = entriesForSlot(entries, day, mealType);
                                return (
                                    <Stack
                                        key={mealType}
                                        space="sm"
                                        testID={`planner-day-slot-${mealType}`}
                                    >
                                        <Heading level={2}>
                                            {t(`marketplace:mealTypes.${mealType}`)}
                                        </Heading>
                                        {slotEntries.length === 0 ? (
                                            <Text
                                                testID={`planner-day-slot-${mealType}-empty`}
                                                tone="secondary"
                                            >
                                                {t('planner:day.emptySlot')}
                                            </Text>
                                        ) : (
                                            slotEntries.map((entry, index) => (
                                                <FadeIn
                                                    key={String(entry.id)}
                                                    delayMs={motion.stagger(index)}
                                                >
                                                    <PlannerMealCard
                                                        planId={entry.planId}
                                                        entry={entry}
                                                        density="agenda"
                                                        kitchenNames={kitchenNames}
                                                        onReplace={setReplacing}
                                                        onAnnounce={announce}
                                                    />
                                                </FadeIn>
                                            ))
                                        )}
                                    </Stack>
                                );
                            })}
                        </Stack>
                    </Stack>
                )}
            </QueryStates>

            <Dialog
                testID="planner-day-regenerate-dialog"
                open={confirmRegenerate}
                onClose={() => {
                    setConfirmRegenerate(false);
                }}
                title={t('planner:day.regenerateTitle')}
                description={t('planner:day.regenerateBody')}
                actions={
                    <>
                        <Button
                            testID="planner-day-regenerate-cancel"
                            variant="quiet"
                            label={t('planner:common.cancel')}
                            onPress={() => {
                                setConfirmRegenerate(false);
                            }}
                        />
                        <Button
                            testID="planner-day-regenerate-confirm"
                            label={t('planner:day.regenerateConfirm')}
                            disabled={planId === null || regenerateDay.isPending}
                            onPress={() => {
                                if (planId === null) return;
                                regenerateDay.mutate(
                                    { planId, date: day },
                                    {
                                        onSuccess: () => {
                                            setConfirmRegenerate(false);
                                            announce(
                                                t('planner:announce.dayRegenerated', {
                                                    day: formatter.formatDate(dateInstant(day), {
                                                        weekday: 'long',
                                                    }),
                                                }),
                                            );
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Text testID="planner-day-regenerate-locks">
                    {t('planner:day.regenerateLocksSurvive')}
                </Text>
            </Dialog>

            {planId === null ? null : (
                <>
                    <AddEntryDrawer
                        planId={planId}
                        date={day}
                        open={addOpen}
                        onClose={() => {
                            setAddOpen(false);
                        }}
                        onAnnounce={announce}
                    />
                    <ReplacementDrawer
                        planId={planId}
                        entry={replacing}
                        onClose={() => {
                            setReplacing(null);
                        }}
                        onAnnounce={announce}
                        kitchens={kitchens.data?.items}
                        {...(data === undefined
                            ? {}
                            : { targets: data.targets, dayPlanned: data.summary.planned })}
                    />
                </>
            )}
        </Stack>
    );
}
