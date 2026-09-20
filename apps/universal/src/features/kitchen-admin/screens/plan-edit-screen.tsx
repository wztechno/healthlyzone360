import { isValidationFailure } from '@healthy360/api-client/contracts';
import type { LocalisedText, PlanAdmin } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    FormSection,
    DateField,
    Dialog,
    ErrorState,
    FilterChip,
    Inline,
    NumberStepper,
    spanWidth,
    Skeleton,
    Stack,
    Text,
    TextInputField,
    useFormSteps,
    useToast,
} from '@healthy360/design-system';
import { DIET_CLASSIFICATIONS, SubscriptionPlanId } from '@healthy360/domain-types';
import type { DietClassification } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    mealsFromPages,
    plansFromPages,
    priceListsFromPages,
    useAdminMealsQuery,
    useAdminPlanQuery,
    useAdminPlansQuery,
    useCreatePlanMutation,
    usePlanMenuQuery,
    usePriceListsQuery,
    usePublishPlanMutation,
    useReplacePlanMenuMutation,
    useRetirePlanMutation,
    useSetPlanDurationsMutation,
    useSetPlanVariantsMutation,
    useUpdatePlanMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { weekdayKey } from '../../marketplace/format.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { DayToggle } from '../delivery-row-editors.tsx';
import { PlanMatrixGrid } from '../commercial/plan-matrix-grid.tsx';
import { EditorFrame } from '../editor-frame.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    ISO_WEEKDAYS,
    dietClassificationKey,
    displayName,
    humaniseCode,
    isTranslationIncomplete,
    summarisePlanDurations,
    summarisePlanPrices,
} from '../format.ts';
import {
    EMPTY_MENU,
    MENU_CYCLE_DAY_MAX,
    isFirstPublication,
    isMenuPublished,
    isMenuWithdrawal,
    menuDocumentErrors,
    menuDraft,
    menuEntryErrors,
    menuRequest,
    withAnchorDate,
    withCycleDays,
} from '../plan-menu.ts';
import type { MenuDraft } from '../plan-menu.ts';
import { PlanMenuDays } from '../plan-menu-row-editors.tsx';
import { PlanDurationRows, PlanVariantRows } from '../plan-row-editors.tsx';
import {
    combinationDraft,
    durationDraft,
    durationErrors,
    durationRequest,
    emptyVariant,
    emptyDuration,
    matrixBands,
    matrixRows,
    variantDraft,
    variantErrors,
    variantRequest,
} from '../plan-matrix.ts';
import type { CombinationDraft, DurationDraft, VariantDraft } from '../plan-matrix.ts';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/plans/{plan}` — the commercial definition of a subscription plan.
 *
 * ## Five writes, five save controls, and that is the contract's shape rather than a preference
 *
 * `KitchenAdminRepository` publishes `updatePlan`, `setPlanCombinations`, `setPlanVariants`,
 * `setPlanDurations` and `replacePlanMenu` as five separate lock-versioned methods. Each section
 * therefore saves itself, exactly as the meal editor's availability does: one request, one
 * `lockVersion` read at the moment of pressing, one refusal to render if the server has moved on.
 * Folding them into a single button would mean chaining five writes and inventing an answer to "the
 * second one failed — is the first one still applied?", which is a question a screen should never
 * have to ask. All five carry the **catalogue item's** version, including the menu, whose own table
 * is not lock-versioned at all.
 *
 * ## The menu is the one section that changes what a kitchen cooks
 *
 * The other four are commercial: what is sold, in what sizes, for how long, at what price. The fifth
 * says which dish is served on which day — and publishing one for the first time is a **cutover**.
 * Until a plan has a menu its generated subscription orders carry no meal lines and deduct no stock;
 * from the first save they do, and an un-recipe'd dish starts producing consumption exceptions. That
 * is stated once, in a Callout that appears only when this save would be the first one (see
 * `../plan-menu.ts`'s `isFirstPublication`), rather than as a warning on every visit.
 *
 * ## The matrix, and what it is *not*
 *
 * The mental model is combination × energy band → sold or not sold, and the contract expresses that
 * with combinations and variants and nothing else: there is **no tier field** and **no energy-band
 * entity**. The rows are the declared combinations (the source material's "Standard / Premium ×
 * meals per day" table, keyed by a kitchen-set code); the columns are the bands the variants
 * themselves carry, plus any added here; a cell exists exactly when a variant sits in it. See
 * `../plan-matrix.ts` — the model is pure, so the toggle can be asserted without rendering.
 *
 * The seeded prototype plans and the workbook shape the importer will bring are different fillings
 * of the same grid, and the editor handles both without being told which it has: the family plan
 * sells one meal a day at one band in three household sizes, so one cell holds three variants and
 * the cell says so; an imported plan whose variants carry shapes no combination declares gets those
 * rows drawn anyway, marked, rather than hidden.
 *
 * ## Publishing states the two things that block it
 *
 * A quarantined plan is refused structurally (plan §4.7). A plan with no *confirmed* price anywhere
 * in this kitchen's price lists is refused too, because publishing it would advertise a placeholder
 * (plan §2.4, §3 #15) — and this screen reads the same price lists the server checks, so the reason
 * appears in the dialog before the button is pressed rather than as a refusal afterwards.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copy
 * ---------------------------------------------------------------------------------------------- */

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly summary: LocalisedText;
    readonly description: LocalisedText;
    readonly categorySlugs: readonly string[];
    readonly dietClassifications: readonly DietClassification[];
    readonly changeCutOffHours: number | null;
    readonly deliveryWeekdays: readonly number[];
}

/** The 24-hour rule the source material states, as the default a new plan starts from. */
const DEFAULT_CUT_OFF_HOURS = 24;

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    summary: { en: '', ar: '' },
    description: { en: '', ar: '' },
    categorySlugs: [],
    dietClassifications: [],
    changeCutOffHours: DEFAULT_CUT_OFF_HOURS,
    deliveryWeekdays: [1, 2, 3, 4, 5],
};

function detailsFrom(plan: PlanAdmin): DetailsDraft {
    return {
        name: plan.name,
        summary: plan.summary,
        description: plan.description,
        categorySlugs: plan.categorySlugs,
        dietClassifications: plan.dietClassifications,
        changeCutOffHours: plan.changeCutOffHours,
        deliveryWeekdays: plan.deliveryWeekdays,
    };
}

/** Seven 34px day squares and their hairline gaps, the delivery zones' weekday track. */
const WEEKDAYS_TRACK = 260;

/* ------------------------------------------------------------------------------------------------
 * Steps
 * ---------------------------------------------------------------------------------------------- */

/*
 * Configurations · Matrix · Durations, the design's three (Commercial §3.3), then the two subjects
 * the design does not draw — the plan's own details and its fixed menu. A new plan walks the same
 * steps, because the design's `New plan` is the same editor with nothing in it. Only the menu waits
 * for the record: it is written against published dishes and its first save is a cutover, neither
 * of which means anything before a plan exists.
 */
const PLAN_STEPS = ['variants', 'matrix', 'durations', 'plan', 'menu'] as const;
type PlanStep = (typeof PLAN_STEPS)[number];
const NEW_PLAN_STEPS: readonly PlanStep[] = ['variants', 'matrix', 'durations', 'plan'];

const PLAN_STEP_LABELS: Record<PlanStep, string> = {
    variants: 'kitchen:plans.tabVariants',
    matrix: 'kitchen:plans.tabMatrix',
    durations: 'kitchen:plans.sectionDurations',
    plan: 'kitchen:plans.sectionDetails',
    menu: 'kitchen:plans.sectionMenu',
};

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface PlanEditScreenProps {
    /** The route parameter. `'new'` opens the create form; anything else is an identifier. */
    readonly plan: string | undefined;
}

export function PlanEditScreen({ plan }: PlanEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-plan-editor"
        >
            <PlanEditor plan={plan} />
        </Gate>
    );
}

function PlanEditor({ plan }: PlanEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = plan === undefined || plan === 'new';
    // Every plan, new or saved, opens on its configurations: the matrix only reads what they say.
    const planSteps: readonly PlanStep[] = isCreating ? NEW_PLAN_STEPS : PLAN_STEPS;
    const form = useFormSteps(planSteps);
    /*
     * The record a create has already minted, held while the sections after it are still being
     * written. If one of those writes fails the screen is still at `/new`, and without this a second
     * press would create a second plan instead of finishing the first.
     */
    const [created, setCreated] = useState<PlanAdmin | null>(null);
    const parsed = isCreating ? null : SubscriptionPlanId.safeParse(plan);

    const record = useAdminPlanQuery(parsed);
    const allPlans = useAdminPlansQuery({ limit: 100 });
    const priceLists = usePriceListsQuery({ limit: 100 });
    const menuRecord = usePlanMenuQuery(parsed);
    /*
     * The dishes the menu picker offers.
     *
     * Published only, because the server refuses anything else with `422` — "a menu entry is a
     * promise to serve the dish" — and a picker that offered a draft would turn that promise into a
     * refusal after the fact. Whole listing rather than a page, for the reason every editor here
     * takes one: a page control on a select is nonsense.
     */
    const meals = useAdminMealsQuery({ limit: 100, statuses: ['published'] }, !isCreating);

    const create = useCreatePlanMutation();
    const update = useUpdatePlanMutation();
    const saveVariantsMutation = useSetPlanVariantsMutation();
    const saveDurationsMutation = useSetPlanDurationsMutation();
    const saveMenuMutation = useReplacePlanMenuMutation();
    const publish = usePublishPlanMutation();
    const retire = useRetirePlanMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);
    const [newCategory, setNewCategory] = useState('');

    const [combinations, setCombinations] = useState<readonly CombinationDraft[]>([]);
    const [combinationsDirty, setCombinationsDirty] = useState(false);

    const [variants, setVariants] = useState<readonly VariantDraft[]>([]);
    const [variantsDirty, setVariantsDirty] = useState(false);

    const [durations, setDurations] = useState<readonly DurationDraft[]>([]);
    const [durationsDirty, setDurationsDirty] = useState(false);

    const [menu, setMenu] = useState<MenuDraft>(EMPTY_MENU);
    const [menuKey, setMenuKey] = useState<string | null>(null);
    const [menuDirty, setMenuDirty] = useState(false);
    const [showWithdrawMenu, setShowWithdrawMenu] = useState(false);

    const [matrixKey, setMatrixKey] = useState<string | null>(null);
    const [ordinal, setOrdinal] = useState(1);

    const [showPublish, setShowPublish] = useState(false);
    const [showRetire, setShowRetire] = useState(false);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    // Adjusting state during render is React's sanctioned answer to "derive from new props": an
    // effect would render one frame with the previous record's rows still in the form.
    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (
        data !== undefined &&
        serverKey !== matrixKey &&
        !combinationsDirty &&
        !variantsDirty &&
        !durationsDirty
    ) {
        setMatrixKey(serverKey);
        setCombinations(data.combinations.map(combinationDraft));
        setVariants(data.variants.map(variantDraft));
        setDurations(data.durations.map(durationDraft));
    }

    /*
     * The menu rebases on its own key, not on the record's.
     *
     * It is a separate document on a separate read, and it moves for reasons the record does not:
     * the *item's* lock version is what both carry, so any other section's save advances it and
     * refetches this. Rebasing is skipped while the menu is dirty, exactly as the four above skip
     * theirs — a refetch that discarded a half-written fortnight would be the worst of the five.
     */
    const menuServerKey =
        menuRecord.data === undefined
            ? null
            : `${String(menuRecord.data.planId)}:${String(menuRecord.data.meta.lockVersion)}`;

    if (menuRecord.data !== undefined && menuServerKey !== menuKey && !menuDirty) {
        setMenuKey(menuServerKey);
        setMenu(menuDraft(menuRecord.data));
    }

    const takeKey = (prefix: string): string => {
        const key = `${prefix}-${String(ordinal)}`;
        setOrdinal(ordinal + 1);
        return key;
    };

    const markDirty = (mark: () => void) => {
        mark();
        guard.markDirty();
    };

    const settle = (next: {
        readonly details?: boolean;
        readonly combinations?: boolean;
        readonly variants?: boolean;
        readonly durations?: boolean;
        readonly menu?: boolean;
    }) => {
        const after = {
            details: next.details ?? detailsDirty,
            combinations: next.combinations ?? combinationsDirty,
            variants: next.variants ?? variantsDirty,
            durations: next.durations ?? durationsDirty,
            menu: next.menu ?? menuDirty,
        };
        setDetailsDirty(after.details);
        setCombinationsDirty(after.combinations);
        setVariantsDirty(after.variants);
        setDurationsDirty(after.durations);
        setMenuDirty(after.menu);
        if (
            !after.details &&
            !after.combinations &&
            !after.variants &&
            !after.durations &&
            !after.menu
        ) {
            guard.markClean();
        }
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setCombinationsDirty(false);
        setVariantsDirty(false);
        setDurationsDirty(false);
        setMenuDirty(false);
        setDetailsKey(null);
        setMatrixKey(null);
        setMenuKey(null);
        guard.markClean();
        void record.refetch();
        void menuRecord.refetch();
    }, [guard, record, menuRecord]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── derived vocabularies ────────────────────────────────────────────────────────────────── */

    /**
     * The category slugs already in use across this kitchen's plans.
     *
     * There is no category resource on this contract — `categorySlugs` is a free list of strings —
     * so the chips are what the catalogue already says rather than a vocabulary the server
     * publishes, and a slug not yet used by anything is typed rather than picked. The same honest
     * derivation the product list makes for its categories.
     */
    const categoryOptions = useMemo(() => {
        const slugs = new Set<string>(details.categorySlugs);
        for (const row of plansFromPages(allPlans.data?.pages)) {
            for (const slug of row.categorySlugs) slugs.add(slug);
        }
        return [...slugs].sort((left, right) => left.localeCompare(right));
    }, [allPlans.data, details.categorySlugs]);

    const bands = useMemo(() => matrixBands(variants, []), [variants]);
    const rows = useMemo(() => matrixRows(combinations, variants), [combinations, variants]);

    const lists = priceListsFromPages(priceLists.data?.pages);
    const pricesReady = !priceLists.isPending && priceLists.error === null;
    const coverage = useMemo(
        () => (data === undefined || !pricesReady ? null : summarisePlanPrices(data, lists)),
        [data, lists, pricesReady],
    );

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const variantRowErrors = useMemo(
        () =>
            variantErrors(variants, {
                nameRequired: t('kitchen:plans.variantNameRequired'),
                servingsRequired: t('kitchen:plans.servingsRequired'),
                energyRequired: t('kitchen:plans.energyRequired'),
                energyReversed: t('kitchen:plans.energyReversed'),
            }),
        [variants, t],
    );

    const durationRowErrors = useMemo(
        () =>
            durationErrors(durations, {
                daysRequired: t('kitchen:plans.daysRequired'),
                duplicate: t('kitchen:plans.durationDuplicate'),
                discountInvalid: t('kitchen:plans.discountInvalid'),
            }),
        [durations, t],
    );

    const menuRowErrors = useMemo(
        () =>
            menuEntryErrors(menu, {
                beyondCycle: t('kitchen:plans.menuBeyondCycle'),
                mealRequired: t('kitchen:plans.menuMealRequired'),
                sequenceRequired: t('kitchen:plans.menuSequenceRequired'),
                duplicateCoordinate: t('kitchen:plans.menuDuplicateCoordinate'),
            }),
        [menu, t],
    );

    const menuBlockers = useMemo(
        () =>
            menuDocumentErrors(menu, {
                entriesRequired: t('kitchen:plans.menuEntriesRequired'),
                cycleRequired: t('kitchen:plans.menuCycleRequired'),
                anchorRequired: t('kitchen:plans.menuAnchorRequired'),
                cycleOutOfRange: t('kitchen:plans.menuCycleOutOfRange'),
                anchorMalformed: t('kitchen:plans.menuAnchorMalformed'),
                tooManyEntries: t('kitchen:plans.menuTooManyEntries'),
            }),
        [menu, t],
    );

    const nameMissing = details.name.en.trim() === '';
    const cutOffInvalid = details.changeCutOffHours === null || details.changeCutOffHours < 0;
    const detailsBlocked = nameMissing || cutOffInvalid;

    /**
     * Everything standing between this plan and a public listing.
     *
     * Unsaved work is a blocker for the reason every editor in this workspace gives: publishing
     * publishes what the server holds, not what is on screen. The price blocker is the one that
     * would otherwise arrive as a surprise refusal, so it is stated here from the same evidence the
     * server uses.
     */
    const publishBlockers = useMemo(() => {
        if (data === undefined) return [];
        const reasons: string[] = [];
        if (isTranslationIncomplete(data.name)) reasons.push(t('kitchen:plans.blockName'));
        if (isTranslationIncomplete(data.summary)) reasons.push(t('kitchen:plans.blockSummary'));
        if (data.variants.length === 0) reasons.push(t('kitchen:plans.blockVariants'));
        if (data.durations.length === 0) reasons.push(t('kitchen:plans.blockDurations'));
        const savedDurations = summarisePlanDurations(data.durations);
        if (savedDurations.inconsistent > 0) {
            reasons.push(
                t('kitchen:plans.blockInconsistentDurations', {
                    count: savedDurations.inconsistent,
                }),
            );
        }
        if (coverage !== null && coverage.confirmed === 0) {
            reasons.push(t('kitchen:plans.blockNoConfirmedPrice'));
        }
        if (detailsDirty || combinationsDirty || variantsDirty || durationsDirty || menuDirty) {
            reasons.push(t('kitchen:plans.blockUnsaved'));
        }
        return reasons;
    }, [
        data,
        coverage,
        detailsDirty,
        combinationsDirty,
        variantsDirty,
        durationsDirty,
        menuDirty,
        t,
    ]);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    /**
     * The new-plan save (Commercial §3.3, `New plan`): the record, then its configurations and its
     * durations, from the one `Save the plan` button the design draws.
     *
     * Three lock-versioned methods still, so this is up to three writes chained on each other's echo —
     * each carries the `lockVersion` the previous one returned, and a section with nothing in it is
     * skipped. A later write can fail with the earlier ones applied: the failing section keeps its
     * rows and says why, `created` keeps the minted record, and pressing Save again finishes that
     * plan rather than creating another. The address moves to the record only once every write has
     * landed, so nothing typed is discarded by a navigation.
     */
    const createPlan = (changeCutOffHours: number) => {
        void (async () => {
            try {
                let record =
                    created ??
                    (await create.mutateAsync({
                        name: details.name,
                        summary: details.summary,
                        description: details.description,
                        categorySlugs: details.categorySlugs,
                        dietClassifications: details.dietClassifications,
                        changeCutOffHours,
                        deliveryWeekdays: details.deliveryWeekdays,
                    }));
                setCreated(record);

                if (record.variants.length === 0 && variants.length > 0) {
                    record = await saveVariantsMutation.mutateAsync({
                        planId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            variants: variantRequest(variants),
                        },
                    });
                    setCreated(record);
                }
                if (record.durations.length === 0 && durations.length > 0) {
                    record = await saveDurationsMutation.mutateAsync({
                        planId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            durations: durationRequest(durations),
                        },
                    });
                    setCreated(record);
                }

                settle({ details: false, variants: false, durations: false });
                toast.show({
                    testID: 'kitchen-plan-created-toast',
                    tone: 'success',
                    message: t('kitchen:plans.createdToast', {
                        name: displayName(record.name, locale).value,
                    }),
                });
                router.replace(`/kitchen/plans/${String(record.id)}` as never);
            } catch (error) {
                concurrency.capture(error);
            }
        })();
    };

    const saveDetails = () => {
        if (detailsBlocked || details.changeCutOffHours === null) return;

        if (isCreating) {
            createPlan(details.changeCutOffHours);
            return;
        }

        if (data === undefined) return;
        update.mutate(
            {
                planId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    summary: details.summary,
                    description: details.description,
                    categorySlugs: details.categorySlugs,
                    dietClassifications: details.dietClassifications,
                    changeCutOffHours: details.changeCutOffHours,
                    deliveryWeekdays: details.deliveryWeekdays,
                },
            },
            {
                onSuccess: () => {
                    settle({ details: false });
                    toast.show({
                        testID: 'kitchen-plan-saved-toast',
                        tone: 'success',
                        message: t('kitchen:editor.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const saveVariants = () => {
        if (data === undefined || variantRowErrors.size > 0) return;
        saveVariantsMutation.mutate(
            {
                planId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    variants: variantRequest(variants),
                },
            },
            {
                onSuccess: (saved) => {
                    /*
                     * Rebased on the server's echo, and this is the one that matters most: a
                     * configuration a cell created went up with `id: null` and comes back with the
                     * identifier the server minted. The whole-record rebuild below is skipped while
                     * any *other* section is still dirty — it must be, or it would discard unsaved
                     * work — so without this a second save would send the same row with a null
                     * identifier again and create a duplicate.
                     */
                    setVariants(saved.variants.map(variantDraft));
                    settle({ variants: false });
                    toast.show({
                        testID: 'kitchen-plan-variants-saved-toast',
                        tone: 'success',
                        message: t('kitchen:plans.variantsSavedToast', {
                            count: saved.variants.length,
                        }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    const saveDurations = () => {
        if (data === undefined || durationRowErrors.size > 0) return;
        saveDurationsMutation.mutate(
            {
                planId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    durations: durationRequest(durations),
                },
            },
            {
                onSuccess: (saved) => {
                    setDurations(saved.durations.map(durationDraft));
                    settle({ durations: false });
                    toast.show({
                        testID: 'kitchen-plan-durations-saved-toast',
                        tone: 'success',
                        message: t('kitchen:plans.durationsSavedToast', {
                            count: saved.durations.length,
                        }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /**
     * The fifth write.
     *
     * `data.meta.lockVersion` is read **here**, at the moment of pressing, exactly as its four
     * siblings do: the menu read carries the same number, but taking it from the record keeps all
     * five saves answering to one version of one row rather than to two copies that can disagree.
     *
     * The whole document goes up every time — entries, cycle length and anchor — because that is
     * what the endpoint takes and what "replace" means. Withdrawal is the same call with all three
     * empty, which is why it needs no method of its own.
     */
    const saveMenu = (next: MenuDraft) => {
        if (data === undefined) return;
        const withdrawing = isMenuWithdrawal(next);
        const body = menuRequest(next);

        saveMenuMutation.mutate(
            {
                planId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    entries: body.entries,
                    cycleDays: body.cycleDays,
                    anchorDate: body.anchorDate,
                },
            },
            {
                onSuccess: (saved) => {
                    // Rebased on the server's echo, for `saveVariants`'s reason: the whole-record
                    // rebuild above is skipped while any other section is dirty, so each save
                    // rebases its own rows or the next one sends stale coordinates.
                    setMenu(menuDraft(saved));
                    setShowWithdrawMenu(false);
                    settle({ menu: false });
                    toast.show({
                        testID: 'kitchen-plan-menu-saved-toast',
                        tone: 'success',
                        message: withdrawing
                            ? t('kitchen:plans.menuWithdrawnToast')
                            : t('kitchen:plans.menuSavedToast', { count: saved.entries.length }),
                    });
                },
                onError: (error) => {
                    setShowWithdrawMenu(false);
                    concurrency.capture(error);
                },
            },
        );
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="lg" testID="kitchen-plan-editor-screen">
                <Callout
                    testID="kitchen-plan-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:plans.notFoundTitle')}
                    body={t('kitchen:plans.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-plan-not-found-back"
                            variant="quiet"
                            label={t('kitchen:plans.backToList')}
                            onPress={() => {
                                router.push('/kitchen/plans' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-plan-editor-loading">
                <Skeleton testID="kitchen-plan-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-plan-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-plan-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-plan-editor-screen">
                <ErrorState
                    testID="kitchen-plan-load-error"
                    failure={loadFailure}
                    title={t('kitchen:plans.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error ?? create.error);
    const matrixFailure = toFailure(saveVariantsMutation.error);
    const durationsFailure = toFailure(saveDurationsMutation.error);
    const menuFailure = toFailure(saveMenuMutation.error);
    const menuLoadFailure = toFailure(menuRecord.error);
    const mealRows = mealsFromPages(meals.data?.pages);
    /*
     * The cutover question, asked of the *server's* menu rather than the draft's origin: has this
     * plan ever had one, and is this draft about to give it one?
     */
    const menuCutover = menuRecord.data !== undefined && isFirstPublication(menuRecord.data, menu);
    const menuOnServer = menuRecord.data !== undefined && isMenuPublished(menuRecord.data);
    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishRefusedByStatus = Object.keys(publishFields).includes('status');
    const publishRefusedByPrice = Object.keys(publishFields).includes('price');
    const quarantined = data?.meta.status === 'review_required';
    const isPublished = data?.meta.status === 'published';

    const stepItems = planSteps.map((key) => ({
        key,
        label: t(PLAN_STEP_LABELS[key]),
    }));

    return (
        <EditorFrame
            testID="kitchen-plan-editor-screen"
            hideTitle={isCreating}
            title={
                isCreating
                    ? t('kitchen:plans.createTitle')
                    : data === undefined
                      ? t('kitchen:plans.editTitle')
                      : displayName(data.name, locale).value
            }
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveDetails}
            titleChip={{ label: t('kitchen:plans.createChip'), tone: 'brand' }}
            // The design's own word for this button (Commercial §3.3), not the generic draft save.
            saveLabel={t('kitchen:plans.savePlan')}
            saving={
                create.isPending ||
                update.isPending ||
                (isCreating && (saveVariantsMutation.isPending || saveDurationsMutation.isPending))
            }
            saveDisabled={
                !canManage ||
                detailsBlocked ||
                (isCreating && (variantRowErrors.size > 0 || durationRowErrors.size > 0))
            }
            steps={{ form, steps: stepItems }}
            backLabel={t('kitchen:plans.backToList')}
            onBack={() => {
                router.push('/kitchen/plans' as never);
            }}
            primaryAction={
                isCreating || !canManage ? null : (
                    <Inline space="xs" wrap justify="end">
                        {isPublished ? (
                            <Button
                                testID="kitchen-plan-retire"
                                variant="secondary"
                                label={t('kitchen:plans.retire')}
                                onPress={() => {
                                    setShowRetire(true);
                                }}
                            />
                        ) : (
                            <Button
                                testID="kitchen-plan-publish"
                                variant="secondary"
                                label={t('kitchen:publish.action')}
                                onPress={() => {
                                    setShowPublish(true);
                                }}
                            />
                        )}
                    </Inline>
                )
            }
            banner={
                <Stack space="sm">
                    {quarantined ? (
                        <Callout
                            testID="kitchen-plan-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {isPublished && data !== undefined ? (
                        <Callout
                            testID="kitchen-plan-published"
                            role="note"
                            tone="success"
                            title={t('kitchen:plans.publishedTitle')}
                            body={t('kitchen:plans.publishedBody')}
                            actions={
                                <Button
                                    testID="kitchen-plan-view-public"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:plans.viewPublic')}
                                    onPress={() => {
                                        guard.intercept(() => {
                                            router.push(`/plans/${String(data.id)}` as never);
                                        });
                                    }}
                                />
                            }
                        />
                    ) : null}

                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-plan-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/* ── the plan itself ──────────────────────────────────────────────────────────── */}
            {/*
             * Its own step, and drawn the way the product and meal editors draw a record: each
             * bilingual pair fills the panel as one answer in two boxes, the short answers sit on the
             * 280px track, and nothing carries a paragraph of hint. The step names it, so no heading.
             */}
            {form.current !== 'plan' ? null : (
                <View testID="kitchen-plan-details" className="z-auto flex-col gap-base">
                    <BilingualField
                        testID="kitchen-plan-name"
                        layout="fill"
                        fieldLabel={t('kitchen:fields.name')}
                        value={details.name}
                        requiredEnglish
                        {...(nameMissing ? { englishError: t('kitchen:plans.nameRequired') } : {})}
                        onChange={(next) => {
                            markDirty(() => {
                                setDetails({ ...details, name: next });
                                setDetailsDirty(true);
                            });
                        }}
                    />

                    <BilingualField
                        testID="kitchen-plan-summary"
                        layout="fill"
                        fieldLabel={t('kitchen:plans.summaryLabel')}
                        value={details.summary}
                        onChange={(next) => {
                            markDirty(() => {
                                setDetails({ ...details, summary: next });
                                setDetailsDirty(true);
                            });
                        }}
                    />

                    <BilingualField
                        testID="kitchen-plan-description"
                        layout="fill"
                        fieldLabel={t('kitchen:plans.descriptionLabel')}
                        multiline
                        value={details.description}
                        onChange={(next) => {
                            markDirty(() => {
                                setDetails({ ...details, description: next });
                                setDetailsDirty(true);
                            });
                        }}
                    />

                    <View style={{ width: spanWidth(1) }}>
                        <TextInputField
                            testID="kitchen-plan-cut-off"
                            id="kitchen-plan-cut-off"
                            label={t('kitchen:plans.cutOffLabel')}
                            placeholder={t('kitchen:plans.cutOffUnit')}
                            size="sm"
                            inputMode="numeric"
                            autoCorrect={false}
                            required
                            disabled={!canManage}
                            value={
                                details.changeCutOffHours === null
                                    ? ''
                                    : String(details.changeCutOffHours)
                            }
                            {...(cutOffInvalid ? { error: t('kitchen:plans.cutOffRequired') } : {})}
                            onChangeText={(text) => {
                                const digits = text.replace(/[^0-9]/g, '');
                                markDirty(() => {
                                    setDetails({
                                        ...details,
                                        changeCutOffHours:
                                            digits === '' ? null : Number.parseInt(digits, 10),
                                    });
                                    setDetailsDirty(true);
                                });
                            }}
                        />
                    </View>

                    <Stack space="xs">
                        <Text variant="label" testID="kitchen-plan-categories-label">
                            {t('kitchen:plans.categoriesLabel')}
                        </Text>
                        {categoryOptions.length === 0 ? null : (
                            <Inline space="xs" wrap testID="kitchen-plan-categories">
                                {categoryOptions.map((slug) => (
                                    <FilterChip
                                        key={slug}
                                        testID={`kitchen-plan-category-${slug}`}
                                        label={humaniseCode(slug)}
                                        selected={details.categorySlugs.includes(slug)}
                                        disabled={!canManage}
                                        onChange={(selected) => {
                                            markDirty(() => {
                                                setDetails({
                                                    ...details,
                                                    categorySlugs: selected
                                                        ? [...details.categorySlugs, slug]
                                                        : details.categorySlugs.filter(
                                                              (entry) => entry !== slug,
                                                          ),
                                                });
                                                setDetailsDirty(true);
                                            });
                                        }}
                                    />
                                ))}
                            </Inline>
                        )}
                        {canManage ? (
                            <Inline space="xs" align="center" wrap>
                                <View style={{ width: spanWidth(1) }}>
                                    <TextInputField
                                        testID="kitchen-plan-category-new"
                                        id="kitchen-plan-category-new"
                                        label={t('kitchen:plans.categoryAddLabel')}
                                        labelHidden
                                        placeholder={t('kitchen:plans.categoryAddLabel')}
                                        size="sm"
                                        value={newCategory}
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        onChangeText={setNewCategory}
                                    />
                                </View>
                                <Button
                                    testID="kitchen-plan-category-add"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:plans.categoryAddAction')}
                                    disabled={newCategory.trim() === ''}
                                    onPress={() => {
                                        const slug = newCategory.trim().toLocaleLowerCase();
                                        if (slug === '' || details.categorySlugs.includes(slug))
                                            return;
                                        markDirty(() => {
                                            setDetails({
                                                ...details,
                                                categorySlugs: [...details.categorySlugs, slug],
                                            });
                                            setDetailsDirty(true);
                                        });
                                        setNewCategory('');
                                    }}
                                />
                            </Inline>
                        ) : null}
                    </Stack>

                    <Stack space="xs">
                        <Text variant="label" testID="kitchen-plan-diets-label">
                            {t('kitchen:plans.dietsLabel')}
                        </Text>
                        <Inline space="xs" wrap testID="kitchen-plan-diets">
                            {DIET_CLASSIFICATIONS.map((diet) => (
                                <FilterChip
                                    key={diet}
                                    testID={`kitchen-plan-diet-${diet}`}
                                    label={t(dietClassificationKey(diet))}
                                    selected={details.dietClassifications.includes(diet)}
                                    disabled={!canManage}
                                    onChange={(selected) => {
                                        markDirty(() => {
                                            setDetails({
                                                ...details,
                                                dietClassifications: selected
                                                    ? [...details.dietClassifications, diet]
                                                    : details.dietClassifications.filter(
                                                          (entry) => entry !== diet,
                                                      ),
                                            });
                                            setDetailsDirty(true);
                                        });
                                    }}
                                />
                            ))}
                        </Inline>
                    </Stack>
                </View>
            )}

            <View className="flex-col">
                {/* ── the matrix ───────────────────────────────────────────────────────── */}
                {form.current !== 'matrix' ? null : (
                    <View testID="kitchen-plan-matrix" className="z-auto flex-col">
                        <Stack space="md">
                            {matrixFailure === null ? null : (
                                <Callout
                                    testID="kitchen-plan-matrix-error"
                                    role="alert"
                                    tone="danger"
                                    title={t('kitchen:plans.matrixSaveError')}
                                    body={matrixFailure.message}
                                />
                            )}

                            <PlanMatrixGrid
                                testID="kitchen-plan-matrix-grid"
                                rows={rows}
                                bands={bands}
                                variants={variants}
                            />
                        </Stack>
                    </View>
                )}

                {/* ── every configuration in full ──────────────────────────────────────── */}
                {form.current !== 'variants' ? null : (
                    <FormSection
                        first
                        testID="kitchen-plan-variants-section"
                        title={t('kitchen:plans.variantsTitle')}
                    >
                        <Stack space="md">
                            <PlanVariantRows
                                testID="kitchen-plan-variants"
                                rows={variants}
                                errors={variantRowErrors}
                                canManage={canManage}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setVariants(next);
                                        setVariantsDirty(true);
                                    });
                                }}
                            />

                            {canManage ? (
                                <Inline space="xs" wrap>
                                    <Button
                                        testID="kitchen-plan-variants-add"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:plans.addVariant')}
                                        onPress={() => {
                                            markDirty(() => {
                                                setVariants([
                                                    ...variants,
                                                    emptyVariant(takeKey('variant')),
                                                ]);
                                                setVariantsDirty(true);
                                            });
                                        }}
                                    />
                                    {isCreating ? null : (
                                        <Button
                                            testID="kitchen-plan-variants-save"
                                            size="sm"
                                            label={t('kitchen:plans.saveVariants')}
                                            loading={saveVariantsMutation.isPending}
                                            disabled={
                                                saveVariantsMutation.isPending ||
                                                variantRowErrors.size > 0
                                            }
                                            onPress={saveVariants}
                                        />
                                    )}
                                </Inline>
                            ) : null}
                        </Stack>
                    </FormSection>
                )}

                {/* ── durations ────────────────────────────────────────────────────────── */}
                {form.current !== 'durations' ? null : (
                    <View testID="kitchen-plan-durations" className="z-auto flex-col">
                        <Stack space="md">
                            {durationsFailure === null ? null : (
                                <Callout
                                    testID="kitchen-plan-durations-error"
                                    role="alert"
                                    tone="danger"
                                    title={t('kitchen:plans.durationsSaveError')}
                                    body={durationsFailure.message}
                                />
                            )}

                            {/*
                             * The days of the week a plan delivers on, as the delivery zones pick
                             * them: seven lettered squares, Monday to Sunday. This is the plan's own
                             * `deliveryWeekdays` — a duration stores a count of days, not which ones —
                             * and it saves with the plan.
                             */}
                            <Stack space="xs">
                                <Text variant="label" testID="kitchen-plan-weekdays-label">
                                    {t('kitchen:plans.weekdaysLabel')}
                                </Text>
                                <View
                                    style={{ width: WEEKDAYS_TRACK }}
                                    className="flex-row gap-hair"
                                    role="group"
                                    aria-label={t('kitchen:plans.weekdaysLabel')}
                                    testID="kitchen-plan-weekdays"
                                >
                                    {ISO_WEEKDAYS.map((weekday) => (
                                        <DayToggle
                                            key={weekday}
                                            testID={`kitchen-plan-weekday-${String(weekday)}`}
                                            initial={t(
                                                `kitchen:windows.dayInitial.${String(weekday)}`,
                                            )}
                                            name={t(weekdayKey(weekday))}
                                            selected={details.deliveryWeekdays.includes(weekday)}
                                            disabled={!canManage}
                                            onChange={(selected) => {
                                                markDirty(() => {
                                                    setDetails({
                                                        ...details,
                                                        deliveryWeekdays: selected
                                                            ? [
                                                                  ...details.deliveryWeekdays,
                                                                  weekday,
                                                              ].sort((left, right) => left - right)
                                                            : details.deliveryWeekdays.filter(
                                                                  (entry) => entry !== weekday,
                                                              ),
                                                    });
                                                    setDetailsDirty(true);
                                                });
                                            }}
                                        />
                                    ))}
                                </View>
                            </Stack>

                            <PlanDurationRows
                                testID="kitchen-plan-duration-rows"
                                rows={durations}
                                errors={durationRowErrors}
                                canManage={canManage}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setDurations(next);
                                        setDurationsDirty(true);
                                    });
                                }}
                            />

                            {canManage ? (
                                <Inline space="xs" wrap>
                                    <Button
                                        testID="kitchen-plan-durations-add"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:plans.addDuration')}
                                        onPress={() => {
                                            markDirty(() => {
                                                setDurations([
                                                    ...durations,
                                                    emptyDuration(takeKey('duration')),
                                                ]);
                                                setDurationsDirty(true);
                                            });
                                        }}
                                    />
                                    {isCreating ? null : (
                                        <Button
                                            testID="kitchen-plan-durations-save"
                                            size="sm"
                                            label={t('kitchen:plans.saveDurations')}
                                            loading={saveDurationsMutation.isPending}
                                            disabled={
                                                saveDurationsMutation.isPending ||
                                                durationRowErrors.size > 0
                                            }
                                            onPress={saveDurations}
                                        />
                                    )}
                                </Inline>
                            ) : null}
                        </Stack>
                    </View>
                )}

                {/* ── the fixed menu ───────────────────────────────────────────────────── */}
                {form.current !== 'menu' || isCreating ? null : (
                    <View testID="kitchen-plan-menu" className="z-auto flex-col">
                        <Stack space="md">
                            {menuRecord.isPending ? (
                                <Skeleton
                                    testID="kitchen-plan-menu-skeleton"
                                    heightClassName="h-32"
                                />
                            ) : menuLoadFailure !== null ? (
                                /*
                                 * The editing controls are withheld rather than rendered empty. An
                                 * empty menu is a *legitimate save* — the one that withdraws it —
                                 * so a menu that merely failed to load, drawn as though it had
                                 * none, is one save away from turning this plan's stock deduction
                                 * off by accident.
                                 */
                                <ErrorState
                                    testID="kitchen-plan-menu-load-error"
                                    failure={menuLoadFailure}
                                    title={t('kitchen:plans.menuLoadErrorTitle')}
                                    onRetry={() => {
                                        void menuRecord.refetch();
                                    }}
                                    retrying={menuRecord.isFetching}
                                />
                            ) : (
                                <>
                                    {menuCutover ? (
                                        <Callout
                                            testID="kitchen-plan-menu-cutover"
                                            role="note"
                                            tone="warning"
                                            title={t('kitchen:plans.menuCutoverTitle')}
                                            body={t('kitchen:plans.menuCutoverBody')}
                                        />
                                    ) : null}

                                    {menuFailure === null ? null : (
                                        <Callout
                                            testID="kitchen-plan-menu-error"
                                            role="alert"
                                            tone="danger"
                                            title={t('kitchen:plans.menuSaveError')}
                                            body={menuFailure.message}
                                        />
                                    )}

                                    <Inline space="sm" wrap>
                                        <NumberStepper
                                            testID="kitchen-plan-menu-cycle-days"
                                            id="kitchen-plan-menu-cycle-days"
                                            label={t('kitchen:plans.menuCycleDaysLabel')}
                                            unit={t('kitchen:plans.daysUnit')}
                                            min={1}
                                            max={MENU_CYCLE_DAY_MAX}
                                            disabled={!canManage}
                                            value={menu.cycleDays}
                                            onChange={(next) => {
                                                markDirty(() => {
                                                    setMenu(withCycleDays(menu, next));
                                                    setMenuDirty(true);
                                                });
                                            }}
                                        />
                                        <DateField
                                            testID="kitchen-plan-menu-anchor"
                                            id="kitchen-plan-menu-anchor"
                                            label={t('kitchen:plans.menuAnchorLabel')}
                                            disabled={!canManage}
                                            value={menu.anchorDate}
                                            onChange={(next) => {
                                                markDirty(() => {
                                                    setMenu(withAnchorDate(menu, next));
                                                    setMenuDirty(true);
                                                });
                                            }}
                                        />
                                    </Inline>

                                    <Inline space="xs" wrap testID="kitchen-plan-menu-summary">
                                        <Badge
                                            testID="kitchen-plan-menu-entry-count"
                                            tone={menu.entries.length === 0 ? 'neutral' : 'info'}
                                            label={t('kitchen:plans.menuEntryCount', {
                                                count: menu.entries.length,
                                            })}
                                        />
                                        <Badge
                                            testID="kitchen-plan-menu-state"
                                            tone={menuOnServer ? 'success' : 'neutral'}
                                            label={
                                                menuOnServer
                                                    ? t('kitchen:plans.menuStatePublished')
                                                    : t('kitchen:plans.menuStateNone')
                                            }
                                        />
                                    </Inline>

                                    {menuBlockers.length === 0 ? null : (
                                        <Callout
                                            testID="kitchen-plan-menu-blocked"
                                            role="alert"
                                            tone="warning"
                                            title={t('kitchen:plans.menuBlockedTitle')}
                                        >
                                            <Stack space="none">
                                                {menuBlockers.map((reason) => (
                                                    <Text key={reason} variant="caption">
                                                        {reason}
                                                    </Text>
                                                ))}
                                            </Stack>
                                        </Callout>
                                    )}

                                    <PlanMenuDays
                                        testID="kitchen-plan-menu-days"
                                        draft={menu}
                                        errors={menuRowErrors}
                                        meals={mealRows}
                                        mealsPending={meals.isPending}
                                        canManage={canManage}
                                        nextKey={() => takeKey('menu')}
                                        onChange={(next) => {
                                            markDirty(() => {
                                                setMenu(next);
                                                setMenuDirty(true);
                                            });
                                        }}
                                    />

                                    {canManage ? (
                                        <Inline space="sm" wrap justify="between">
                                            {menuOnServer ? (
                                                <Button
                                                    testID="kitchen-plan-menu-withdraw"
                                                    size="sm"
                                                    variant="ghost"
                                                    label={t('kitchen:plans.menuWithdraw')}
                                                    onPress={() => {
                                                        setShowWithdrawMenu(true);
                                                    }}
                                                />
                                            ) : null}
                                            <Button
                                                testID="kitchen-plan-menu-save"
                                                variant="secondary"
                                                label={t('kitchen:plans.saveMenu')}
                                                loading={saveMenuMutation.isPending}
                                                disabled={
                                                    saveMenuMutation.isPending ||
                                                    menuRowErrors.size > 0 ||
                                                    menuBlockers.length > 0
                                                }
                                                onPress={() => {
                                                    if (
                                                        menuRowErrors.size > 0 ||
                                                        menuBlockers.length > 0
                                                    ) {
                                                        return;
                                                    }
                                                    saveMenu(menu);
                                                }}
                                            />
                                        </Inline>
                                    ) : null}
                                </>
                            )}
                        </Stack>
                    </View>
                )}

                {/* ── prices, stated rather than edited ────────────────────────────────── */}
                {form.current !== 'plan' || isCreating ? null : (
                    <FormSection
                        testID="kitchen-plan-prices"
                        title={t('kitchen:plans.sectionPrices')}
                    >
                        <Stack space="sm">
                            {coverage === null ? (
                                <Text testID="kitchen-plan-prices-pending" tone="secondary">
                                    {t('kitchen:plans.pricesPending')}
                                </Text>
                            ) : (
                                <Inline space="xs" wrap testID="kitchen-plan-prices-summary">
                                    <Badge
                                        testID="kitchen-plan-prices-confirmed"
                                        tone={coverage.confirmed === 0 ? 'warning' : 'success'}
                                        {...(coverage.confirmed === 0
                                            ? { icon: 'warning' as const }
                                            : {})}
                                        label={t('kitchen:plans.confirmedPriceCount', {
                                            count: coverage.confirmed,
                                        })}
                                    />
                                    <Badge
                                        testID="kitchen-plan-prices-placeholder"
                                        tone={coverage.placeholder === 0 ? 'neutral' : 'warning'}
                                        label={t('kitchen:plans.placeholderPriceCount', {
                                            count: coverage.placeholder,
                                        })}
                                    />
                                    <Badge
                                        testID="kitchen-plan-prices-unpriced"
                                        tone="neutral"
                                        label={t('kitchen:plans.unpricedCount', {
                                            count: coverage.unpriced,
                                        })}
                                    />
                                </Inline>
                            )}

                            <Button
                                testID="kitchen-plan-prices-open"
                                size="sm"
                                variant="ghost"
                                label={t('kitchen:plans.openPriceLists')}
                                onPress={() => {
                                    guard.intercept(() => {
                                        router.push('/kitchen/price-lists' as never);
                                    });
                                }}
                            />
                        </Stack>
                    </FormSection>
                )}
            </View>

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-plan-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:plans.publishTitle')}
                description={t('kitchen:plans.publishBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-plan-publish-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-plan-publish-confirm"
                            label={t('kitchen:publish.confirm')}
                            loading={publish.isPending}
                            disabled={publishBlockers.length > 0 || quarantined}
                            onPress={() => {
                                if (data === undefined) return;
                                publish.mutate(
                                    {
                                        planId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: (published) => {
                                            setShowPublish(false);
                                            toast.show({
                                                testID: 'kitchen-plan-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:plans.publishedToast', {
                                                    name: displayName(published.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Stack space="sm">
                    <Text testID="kitchen-plan-publish-consequence">
                        {t('kitchen:plans.publishConsequence', {
                            count: data?.variants.length ?? 0,
                        })}
                    </Text>

                    <Callout
                        testID="kitchen-plan-publish-prices"
                        role="note"
                        tone={coverage !== null && coverage.confirmed === 0 ? 'warning' : 'info'}
                        title={t('kitchen:plans.publishPricesTitle')}
                        body={
                            coverage === null
                                ? t('kitchen:plans.pricesPending')
                                : t('kitchen:plans.publishPricesBody', {
                                      confirmed: coverage.confirmed,
                                      placeholders: coverage.placeholder + coverage.unpriced,
                                  })
                        }
                    />

                    {quarantined ? (
                        <Callout
                            testID="kitchen-plan-publish-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID="kitchen-plan-publish-blocked"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:plans.publishBlockedTitle')}
                        >
                            <Stack space="none">
                                {publishBlockers.map((reason) => (
                                    <Text key={reason} variant="caption">
                                        {reason}
                                    </Text>
                                ))}
                            </Stack>
                        </Callout>
                    )}

                    {publishFailure === null ? null : (
                        <Callout
                            testID={
                                publishRefusedByStatus
                                    ? 'kitchen-plan-publish-refused-quarantine'
                                    : publishRefusedByPrice
                                      ? 'kitchen-plan-publish-refused-price'
                                      : 'kitchen-plan-publish-failed'
                            }
                            role="alert"
                            tone={publishRefusedByStatus ? 'warning' : 'danger'}
                            title={
                                publishRefusedByStatus
                                    ? t('kitchen:publish.quarantineTitle')
                                    : publishRefusedByPrice
                                      ? t('kitchen:plans.publishRefusedPriceTitle')
                                      : t('kitchen:publish.failedTitle')
                            }
                            body={publishFailure.message}
                        />
                    )}
                </Stack>
            </Dialog>

            {/* ── withdraw the menu ────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-plan-menu-withdraw-dialog"
                open={showWithdrawMenu}
                onClose={() => {
                    setShowWithdrawMenu(false);
                }}
                title={t('kitchen:plans.menuWithdrawTitle')}
                description={t('kitchen:plans.menuWithdrawBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-plan-menu-withdraw-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowWithdrawMenu(false);
                            }}
                        />
                        <Button
                            testID="kitchen-plan-menu-withdraw-confirm"
                            variant="danger"
                            label={t('kitchen:plans.menuWithdrawConfirm')}
                            loading={saveMenuMutation.isPending}
                            onPress={() => {
                                // All three parts empty, in one deliberate write. This is the only
                                // control in the section that does not send what is on screen —
                                // the dialog above is where the consequence was agreed to.
                                saveMenu(EMPTY_MENU);
                            }}
                        />
                    </>
                }
            >
                <Text testID="kitchen-plan-menu-withdraw-consequence">
                    {t('kitchen:plans.menuWithdrawConsequence')}
                </Text>
            </Dialog>

            {/* ── retire ───────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-plan-retire-dialog"
                open={showRetire}
                onClose={() => {
                    setShowRetire(false);
                }}
                title={t('kitchen:plans.retireTitle')}
                description={t('kitchen:plans.retireBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-plan-retire-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowRetire(false);
                            }}
                        />
                        <Button
                            testID="kitchen-plan-retire-confirm"
                            variant="danger"
                            label={t('kitchen:plans.retireConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                retire.mutate(
                                    {
                                        planId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowRetire(false);
                                            toast.show({
                                                testID: 'kitchen-plan-retired-toast',
                                                tone: 'success',
                                                message: t('kitchen:plans.retiredToast', {
                                                    name: displayName(details.name, locale).value,
                                                }),
                                            });
                                        },
                                        onError: (error) => {
                                            setShowRetire(false);
                                            concurrency.capture(error);
                                        },
                                    },
                                );
                            }}
                        />
                    </>
                }
            >
                <Text testID="kitchen-plan-retire-consequence">
                    {t('kitchen:plans.retireConsequence')}
                </Text>
            </Dialog>
        </EditorFrame>
    );
}
