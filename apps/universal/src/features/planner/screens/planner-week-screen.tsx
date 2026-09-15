import {
    ActionSheet,
    Button,
    CalendarGrid,
    Callout,
    Card,
    Dialog,
    EmptyState,
    FadeIn,
    Heading,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
    useBreakpoint,
    useMotion,
} from '@healthy360/design-system';
import type { CalendarCell, CalendarDay } from '@healthy360/design-system';
import type { Kitchen, MealPlanEntry } from '@healthy360/api-client/contracts';
import type { KitchenId, MealType } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useKitchensQuery } from '../../../data/marketplace-hooks.ts';
import {
    useCurrentPlanQuery,
    useDuplicatePlanMutation,
    useGeneratePlanMutation,
    usePlannerWeekQuery,
    useRegenerateWeekMutation,
    useSaveTemplateMutation,
} from '../../../data/planner-hooks.ts';
import { usePrototypeAction } from '../../../prototype/index.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { PlannerAnnouncer, usePlannerAnnouncement } from '../announcer.tsx';
import {
    PLANNER_MEAL_TYPES,
    addDays,
    dateInstant,
    entriesForSlot,
    hasSafetyWarning,
    isPlannerDate,
    mondayOf,
    todayIso,
    weekDates,
} from '../format.ts';
import { PlannerMealCard } from '../meal-card.tsx';
import { CostEstimate, NutritionSummary } from '../nutrition-summary.tsx';
import { PlanHistoryDrawer } from '../plan-history.tsx';
import { PlanNotesPanel } from '../plan-notes.tsx';
import { ReplacementDrawer } from '../replacement-drawer.tsx';

/**
 * `/customer/planner/week/{monday}` — the weekly planner.
 *
 * ## Two layouts, not one layout with things hidden
 *
 * At `lg` and above this is a genuine seven-column grid: every day of the week visible at once,
 * dense, with four meal rows. Below it, an agenda grouped by day. Doc 17, PLN-14 asks for the grid
 * to survive tablet width rather than collapsing to a phone agenda, which is why the branch is at
 * `lg` (1024) and not at `md`.
 *
 * The branch is in JavaScript rather than in class variants because rendering both and hiding one
 * would leave an entire off-screen planner in the accessibility tree — axe flags it and screen
 * reader users walk straight into it.
 *
 * `CalendarGrid` lays its day columns out as flex children in source order, so in Arabic Monday
 * sits on the *right* with no mirrored geometry anywhere. That is asserted by bounding box in the
 * RTL spec rather than trusted.
 *
 * ## Any week, not just the fixture week
 *
 * The prototype's generated week is pinned to Monday 27 July 2026, and this screen must work for
 * every other week too. `getWeek` answers for any Monday — a week with no entries in it comes back
 * as seven empty days rather than a failure — so the empty state here is a *designed* state with a
 * real action in it (`POST /api/v1/meal-plans/generate`) rather than an error page.
 *
 * A malformed date in the URL is a different thing again, and gets an honest not-found.
 *
 * ## Regeneration keeps what you kept
 *
 * The confirmation dialog says so, and it is true: the store filters locked entries out of every
 * regeneration scope, and the week returns with them in place. The spec's rule and the fixture
 * store's behaviour agree, and the LTR journey spec proves it by locking a card, regenerating the
 * week and asserting the card is still there.
 */
export interface PlannerWeekScreenProps {
    readonly week: string | undefined;
}

export function PlannerWeekScreen({ week }: PlannerWeekScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const router = useRouter();
    const { atLeast } = useBreakpoint();
    const motion = useMotion();
    const runPrototype = usePrototypeAction();
    const { me } = useSession();
    const signedIn = me !== null;

    const { message, announce } = usePlannerAnnouncement();

    const weekStart = isPlannerDate(week) ? mondayOf(week) : null;

    const currentPlan = useCurrentPlanQuery(signedIn);
    const planId = currentPlan.data?.planId ?? null;
    const planWeek = usePlannerWeekQuery(planId, weekStart);
    const kitchens = useKitchensQuery({ limit: 20 });

    const regenerateWeek = useRegenerateWeekMutation();
    const generate = useGeneratePlanMutation();
    const saveTemplate = useSaveTemplateMutation();
    const duplicate = useDuplicatePlanMutation();

    const [menuOpen, setMenuOpen] = useState(false);
    const [confirmRegenerate, setConfirmRegenerate] = useState(false);
    const [notesOpen, setNotesOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [templateOpen, setTemplateOpen] = useState(false);
    const [templateName, setTemplateName] = useState('');
    const [duplicateOpen, setDuplicateOpen] = useState(false);
    const [duplicateWeek, setDuplicateWeek] = useState<string>(
        weekStart === null ? '' : addDays(weekStart, 7),
    );
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

    const data = planWeek.data;
    const entries = useMemo<readonly MealPlanEntry[]>(
        () => (data === undefined ? [] : data.days.flatMap((day) => day.entries)),
        [data],
    );
    const warned = entries.filter(hasSafetyWarning);

    /** The day the entry being replaced sits in, so the drawer can project the day's energy. */
    const replacingDayPlanned =
        replacing === null
            ? undefined
            : data?.days.find((day) => day.date === replacing.date)?.summary.planned;

    const today = todayIso();
    const dates = weekStart === null ? [] : weekDates(weekStart);

    const calendarDays: readonly CalendarDay[] = dates.map((date) => ({
        key: date,
        label: formatter.formatDate(dateInstant(date), {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
        }),
        shortLabel: formatter.formatDate(dateInstant(date), { weekday: 'short' }),
        sublabel: formatter.formatDate(dateInstant(date), { day: 'numeric', month: 'short' }),
        today: date === today,
    }));

    /**
     * The stagger index, computed from the entry's position rather than counted during render.
     *
     * A running counter would be a variable mutated while React renders — it disagrees with itself
     * under concurrent rendering and makes the animation depend on the order cells happen to be
     * called in. Position is deterministic: day column, then meal row, then position within the
     * slot. `motion.stagger` applies the cap and the reduced-motion branch.
     */
    const staggerFor = (entry: MealPlanEntry, within: number): number => {
        const dayIndex = Math.max(0, dates.indexOf(entry.date));
        const slotIndex = Math.max(0, PLANNER_MEAL_TYPES.indexOf(entry.mealType));
        return motion.stagger(dayIndex * PLANNER_MEAL_TYPES.length + slotIndex + within);
    };

    const renderEntry = (entry: MealPlanEntry, density: 'grid' | 'agenda', within: number) => (
        <FadeIn key={String(entry.id)} delayMs={staggerFor(entry, within)}>
            <PlannerMealCard
                planId={entry.planId}
                entry={entry}
                density={density}
                kitchenNames={kitchenNames}
                onReplace={setReplacing}
                onAnnounce={announce}
            />
        </FadeIn>
    );

    const renderCell = (cell: CalendarCell) => {
        const mealType = (cell.slot?.key ?? 'breakfast') as MealType;
        const slotEntries = entriesForSlot(entries, cell.day.key, mealType);
        if (slotEntries.length === 0) {
            return (
                <Card
                    testID={`planner-week-empty-${cell.day.key}-${mealType}`}
                    padding="sm"
                    tone="sunken"
                >
                    <Text variant="caption" tone="secondary">
                        {t('planner:week.emptySlot')}
                    </Text>
                </Card>
            );
        }
        return (
            <Stack space="xs">
                {slotEntries.map((entry, index) => renderEntry(entry, 'grid', index))}
            </Stack>
        );
    };

    const weekLabel =
        weekStart === null
            ? ''
            : t('planner:week.range', {
                  from: formatter.formatDate(dateInstant(weekStart), {
                      day: 'numeric',
                      month: 'long',
                  }),
                  to: formatter.formatDate(dateInstant(addDays(weekStart, 6)), {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                  }),
              });

    const goToWeek = (next: string) => {
        router.push(`/customer/planner/week/${next}` as never);
    };

    const planActions = [
        {
            key: 'notes',
            label: t('planner:week.actionNotes'),
            description: t('planner:week.actionNotesHint'),
            icon: 'info' as const,
            testID: 'planner-week-action-notes',
            onPress: () => {
                setNotesOpen(true);
            },
        },
        {
            key: 'history',
            label: t('planner:week.actionHistory'),
            description: t('planner:week.actionHistoryHint'),
            icon: 'refresh' as const,
            testID: 'planner-week-action-history',
            onPress: () => {
                setHistoryOpen(true);
            },
        },
        {
            key: 'template',
            label: t('planner:week.actionTemplate'),
            description: t('planner:week.actionTemplateHint'),
            icon: 'star' as const,
            testID: 'planner-week-action-template',
            onPress: () => {
                setTemplateOpen(true);
            },
        },
        {
            key: 'duplicate',
            label: t('planner:week.actionDuplicate'),
            description: t('planner:week.actionDuplicateHint'),
            icon: 'plus' as const,
            testID: 'planner-week-action-duplicate',
            onPress: () => {
                setDuplicateOpen(true);
            },
        },
        {
            key: 'share',
            label: t('planner:week.actionShare'),
            description: t('planner:week.actionShareHint'),
            icon: 'user' as const,
            testID: 'planner-week-action-share',
            onPress: () => {
                runPrototype({ contract: 'POST /api/v1/meal-plans/{plan}/share' });
            },
        },
        {
            key: 'export',
            label: t('planner:week.actionExport'),
            description: t('planner:week.actionExportHint'),
            icon: 'device' as const,
            testID: 'planner-week-action-export',
            onPress: () => {
                runPrototype({ contract: 'GET /api/v1/meal-plans/{plan}/export' });
            },
        },
    ];

    const duplicateOptions =
        weekStart === null
            ? []
            : [7, 14, 21, 28].map((offset) => {
                  const date = addDays(weekStart, offset);
                  return {
                      value: date,
                      label: formatter.formatDate(dateInstant(date), {
                          day: 'numeric',
                          month: 'long',
                      }),
                  };
              });

    if (weekStart === null) {
        return (
            <Stack space="lg" testID="planner-week-screen">
                <EmptyState
                    testID="planner-week-not-found"
                    title={t('planner:week.notFoundTitle')}
                    body={t('planner:week.notFoundBody')}
                    actions={
                        <Button
                            testID="planner-week-not-found-current"
                            label={t('planner:week.openCurrent')}
                            onPress={() => {
                                router.replace('/customer/planner' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID="planner-week-screen">
            <PlannerAnnouncer message={message} />

            <Stack space="xs">
                <Heading level={1} testID="planner-week-title">
                    {t('planner:week.title')}
                </Heading>
                <Text testID="planner-week-range" tone="secondary">
                    {weekLabel}
                </Text>
            </Stack>

            {/* One row, one baseline (§2.5): week navigation leads, the week's actions trail,
                and the gap between them does the separating. */}
            <View
                className="flex-row flex-wrap items-center gap-2"
                testID="planner-week-navigation"
            >
                <Button
                    testID="planner-week-previous"
                    variant="secondary"
                    size="sm"
                    label={t('planner:week.previous')}
                    onPress={() => {
                        goToWeek(addDays(weekStart, -7));
                    }}
                />
                <Button
                    testID="planner-week-next"
                    variant="secondary"
                    size="sm"
                    label={t('planner:week.next')}
                    onPress={() => {
                        goToWeek(addDays(weekStart, 7));
                    }}
                />
                <Button
                    testID="planner-week-grocery"
                    variant="ghost"
                    size="sm"
                    label={t('planner:week.groceryList')}
                    onPress={() => {
                        router.push(`/customer/grocery/${weekStart}` as never);
                    }}
                />
                <View className="grow" />
                <Button
                    testID="planner-week-regenerate"
                    size="sm"
                    label={t('planner:week.regenerate')}
                    disabled={planId === null || regenerateWeek.isPending}
                    onPress={() => {
                        setConfirmRegenerate(true);
                    }}
                />
                <Button
                    testID="planner-week-menu"
                    variant="ghost"
                    size="sm"
                    label={t('planner:week.planActions')}
                    disabled={planId === null}
                    onPress={() => {
                        setMenuOpen(true);
                    }}
                />
            </View>

            <QueryStates
                query={planWeek}
                isEmpty={data !== undefined && entries.length === 0}
                emptyTitle={t('planner:week.emptyTitle')}
                emptyBody={t('planner:week.emptyBody')}
                emptyActions={
                    <Inline space="sm" wrap>
                        <Button
                            testID="planner-week-generate"
                            label={
                                generate.isPending
                                    ? t('planner:week.generating')
                                    : t('planner:week.generate')
                            }
                            disabled={generate.isPending}
                            onPress={() => {
                                generate.mutate(
                                    { weekStart },
                                    {
                                        onSuccess: () => {
                                            announce(t('planner:announce.weekGenerated'));
                                        },
                                    },
                                );
                            }}
                        />
                        <Button
                            testID="planner-week-empty-virtual-dietitian"
                            variant="secondary"
                            label={t('planner:index.startVirtualDietitian')}
                            onPress={() => {
                                router.push('/customer/virtual-dietitian');
                            }}
                        />
                    </Inline>
                }
                skeletonCount={3}
                testID="planner-week"
            >
                {data === undefined ? null : (
                    <Stack space="lg">
                        {warned.length === 0 ? null : (
                            <Callout
                                testID="planner-week-warnings"
                                role="alert"
                                tone="danger"
                                icon="warning"
                                title={t('planner:week.warningsTitle')}
                                body={t('planner:week.warningsBody', {
                                    items: warned.length,
                                    meals: warned
                                        .map((entry) => entry.label)
                                        .join(t('planner:common.listSeparator')),
                                })}
                            />
                        )}

                        <NutritionSummary
                            testID="planner-week-summary"
                            title={t('planner:week.summaryTitle')}
                            planned={data.summary.dailyAverage}
                            actual={null}
                            targets={data.targets}
                            headline
                        />

                        <CostEstimate
                            testID="planner-week-cost"
                            title={t('planner:week.costTitle')}
                            entries={entries}
                            estimatedCost={data.summary.estimatedCost}
                        />

                        {atLeast('lg') ? (
                            <CalendarGrid
                                testID="planner-week-grid"
                                label={t('planner:week.gridLabel', { week: weekLabel })}
                                days={calendarDays}
                                slots={PLANNER_MEAL_TYPES.map((mealType) => ({
                                    key: mealType,
                                    label: t(`marketplace:mealTypes.${mealType}`),
                                }))}
                                renderCell={renderCell}
                            />
                        ) : (
                            <Stack space="lg" testID="planner-week-agenda">
                                {data.days.map((day) => (
                                    <Stack
                                        key={day.date}
                                        space="sm"
                                        testID={`planner-week-agenda-${day.date}`}
                                    >
                                        <Inline space="sm" align="center" wrap>
                                            <Heading level={2}>
                                                {formatter.formatDate(dateInstant(day.date), {
                                                    weekday: 'long',
                                                    day: 'numeric',
                                                    month: 'long',
                                                })}
                                            </Heading>
                                            <Button
                                                testID={`planner-week-open-day-${day.date}`}
                                                variant="ghost"
                                                size="sm"
                                                label={t('planner:week.openDay')}
                                                onPress={() => {
                                                    router.push(
                                                        `/customer/planner/day/${day.date}` as never,
                                                    );
                                                }}
                                            />
                                        </Inline>

                                        {day.entries.length === 0 ? (
                                            <Text
                                                testID={`planner-week-agenda-${day.date}-empty`}
                                                tone="secondary"
                                            >
                                                {t('planner:week.emptyDay')}
                                            </Text>
                                        ) : (
                                            day.entries.map((entry, index) =>
                                                renderEntry(entry, 'agenda', index),
                                            )
                                        )}
                                    </Stack>
                                ))}
                            </Stack>
                        )}

                        {atLeast('lg') ? (
                            <Inline space="xs" wrap testID="planner-week-day-links">
                                {data.days.map((day) => (
                                    <Button
                                        key={day.date}
                                        testID={`planner-week-open-day-${day.date}`}
                                        variant="ghost"
                                        size="sm"
                                        label={formatter.formatDate(dateInstant(day.date), {
                                            weekday: 'long',
                                        })}
                                        onPress={() => {
                                            router.push(
                                                `/customer/planner/day/${day.date}` as never,
                                            );
                                        }}
                                    />
                                ))}
                            </Inline>
                        ) : null}
                    </Stack>
                )}
            </QueryStates>

            {/* ── dialogs and drawers ─────────────────────────────────────────────────────── */}

            <Dialog
                testID="planner-week-regenerate-dialog"
                open={confirmRegenerate}
                onClose={() => {
                    setConfirmRegenerate(false);
                }}
                title={t('planner:week.regenerateTitle')}
                description={t('planner:week.regenerateBody')}
                actions={
                    <>
                        <Button
                            testID="planner-week-regenerate-cancel"
                            variant="quiet"
                            label={t('planner:common.cancel')}
                            onPress={() => {
                                setConfirmRegenerate(false);
                            }}
                        />
                        <Button
                            testID="planner-week-regenerate-confirm"
                            label={t('planner:week.regenerateConfirm')}
                            disabled={planId === null || regenerateWeek.isPending}
                            onPress={() => {
                                if (planId === null) return;
                                regenerateWeek.mutate(
                                    { planId },
                                    {
                                        onSuccess: () => {
                                            setConfirmRegenerate(false);
                                            announce(t('planner:announce.weekRegenerated'));
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Text testID="planner-week-regenerate-locks">
                    {t('planner:week.regenerateLocksSurvive')}
                </Text>
            </Dialog>

            <ActionSheet
                testID="planner-week-actions"
                open={menuOpen}
                onClose={() => {
                    setMenuOpen(false);
                }}
                title={t('planner:week.planActions')}
                description={weekLabel}
                actions={planActions}
            />

            <Dialog
                testID="planner-week-template-dialog"
                open={templateOpen}
                onClose={() => {
                    setTemplateOpen(false);
                }}
                title={t('planner:week.templateTitle')}
                description={t('planner:week.templateBody')}
                actions={
                    <>
                        <Button
                            testID="planner-week-template-cancel"
                            variant="quiet"
                            label={t('planner:common.cancel')}
                            onPress={() => {
                                setTemplateOpen(false);
                            }}
                        />
                        <Button
                            testID="planner-week-template-confirm"
                            label={t('planner:week.templateConfirm')}
                            disabled={
                                planId === null ||
                                templateName.trim() === '' ||
                                saveTemplate.isPending
                            }
                            onPress={() => {
                                if (planId === null) return;
                                saveTemplate.mutate(
                                    { planId, request: { name: templateName.trim() } },
                                    {
                                        onSuccess: (summary) => {
                                            setTemplateOpen(false);
                                            announce(
                                                t('planner:announce.templateSaved', {
                                                    name: summary.name ?? templateName.trim(),
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
                <TextInputField
                    testID="planner-week-template-name"
                    id="planner-week-template-name"
                    label={t('planner:week.templateNameLabel')}
                    value={templateName}
                    onChangeText={setTemplateName}
                />
            </Dialog>

            <Dialog
                testID="planner-week-duplicate-dialog"
                open={duplicateOpen}
                onClose={() => {
                    setDuplicateOpen(false);
                }}
                title={t('planner:week.duplicateTitle')}
                description={t('planner:week.duplicateBody')}
                actions={
                    <>
                        <Button
                            testID="planner-week-duplicate-cancel"
                            variant="quiet"
                            label={t('planner:common.cancel')}
                            onPress={() => {
                                setDuplicateOpen(false);
                            }}
                        />
                        <Button
                            testID="planner-week-duplicate-confirm"
                            label={t('planner:week.duplicateConfirm')}
                            disabled={planId === null || duplicate.isPending}
                            onPress={() => {
                                if (planId === null) return;
                                duplicate.mutate(
                                    {
                                        planId,
                                        request: {
                                            weekStart: duplicateWeek,
                                            includeNotes: true,
                                        },
                                    },
                                    {
                                        onSuccess: () => {
                                            setDuplicateOpen(false);
                                            announce(
                                                t('planner:announce.duplicated', {
                                                    week: formatter.formatDate(
                                                        dateInstant(duplicateWeek),
                                                        { day: 'numeric', month: 'long' },
                                                    ),
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
                <Select
                    testID="planner-week-duplicate-week"
                    id="planner-week-duplicate-week"
                    label={t('planner:week.duplicateWeekLabel')}
                    value={duplicateWeek}
                    onChange={setDuplicateWeek}
                    options={duplicateOptions}
                />
            </Dialog>

            {planId === null ? null : (
                <>
                    <PlanNotesPanel
                        planId={planId}
                        open={notesOpen}
                        onClose={() => {
                            setNotesOpen(false);
                        }}
                        onAnnounce={announce}
                    />
                    <PlanHistoryDrawer
                        planId={planId}
                        open={historyOpen}
                        onClose={() => {
                            setHistoryOpen(false);
                        }}
                    />
                    <ReplacementDrawer
                        planId={planId}
                        entry={replacing}
                        onClose={() => {
                            setReplacing(null);
                        }}
                        onAnnounce={announce}
                        kitchens={kitchens.data?.items}
                        {...(data === undefined ? {} : { targets: data.targets })}
                        {...(replacingDayPlanned === undefined
                            ? {}
                            : { dayPlanned: replacingDayPlanned })}
                    />
                </>
            )}
        </Stack>
    );
}
