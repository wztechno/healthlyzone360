import { isValidationFailure } from '@healthy360/api-client/contracts';
import type { LocalisedText, PlanAdmin } from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Cascade,
    DatePickerButton,
    Dialog,
    ErrorState,
    FilterChip,
    FormGrid,
    FormIssueBanner,
    FormSection,
    FormSkeleton,
    Icon,
    Inline,
    Skeleton,
    spanWidth,
    Stack,
    Tabs,
    Text,
    TextInputField,
    useFormSteps,
    useToast,
} from '@healthy360/design-system';
import type { GridSpanProps } from '@healthy360/design-system';
import { DIET_CLASSIFICATIONS, SubscriptionPlanId } from '@healthy360/domain-types';
import type { DietClassification } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    mealsFromPages,
    priceListsFromPages,
    useAdminMealsQuery,
    useAdminPlanQuery,
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
import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { PlanMatrixGrid } from '../commercial/plan-matrix-grid.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import {
    dietClassificationKey,
    displayName,
    isTranslationIncomplete,
    statusKey,
    statusTone,
    summarisePlanDurations,
    summarisePlanPrices,
} from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import {
    EMPTY_MENU,
    MENU_CYCLE_DAY_MAX,
    isFirstPublication,
    isMenuPublished,
    isMenuWithdrawal,
    menuDays,
    menuDocumentErrors,
    menuDraft,
    largestServing,
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
import { serverFieldErrors } from '../server-field-errors.ts';
import type { ServerFieldTarget } from '../server-field-errors.ts';
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
 * A **new** plan is the exception, and only because there is nothing to lock yet: its one `Save the
 * plan` creates the record and then chains the configurations, the durations and the menu on each
 * other's echo (see `createPlan`).
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

/*
 * No `categorySlugs`: the server has nowhere to keep a plan's categories (the marketplace answers
 * `[]` for every plan), so a field here would be edited, sent and silently lost. The contract keeps
 * the property for the read; the editor does not offer it.
 */
interface DetailsDraft {
    readonly name: LocalisedText;
    readonly summary: LocalisedText;
    readonly description: LocalisedText;
    readonly dietClassifications: readonly DietClassification[];
    readonly changeCutOffHours: number | null;
}

/** The 24-hour rule the source material states, as the default a new plan starts from. */
const DEFAULT_CUT_OFF_HOURS = 24;
/**
 * What this editor accepts for the cut-off: half a day to a week. The server takes 0–720 and is
 * not narrowed; these are the figures a kitchen can actually buy and cook against, and anything
 * outside them is far more likely a typo than a decision.
 */
const CUT_OFF_HOURS_MIN = 12;
const CUT_OFF_HOURS_MAX = 168;
/** The longest cut-off the example sentence names a weekday for; past it the weekday misleads. */
const CUT_OFF_WEEKDAY_MAX = 144;
/** A Friday at noon, UTC — the example delivery the cut-off sentence counts back from. */
const EXAMPLE_FRIDAY_MS = Date.UTC(2026, 0, 2, 12);

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    summary: { en: '', ar: '' },
    description: { en: '', ar: '' },
    dietClassifications: [],
    changeCutOffHours: DEFAULT_CUT_OFF_HOURS,
};

function detailsFrom(plan: PlanAdmin): DetailsDraft {
    return {
        name: plan.name,
        summary: plan.summary,
        description: plan.description,
        dietClassifications: plan.dietClassifications,
        changeCutOffHours: plan.changeCutOffHours,
    };
}

/** The same set of codes, whatever order the chips were pressed in. */
function sameDiets(
    left: readonly DietClassification[],
    right: readonly DietClassification[],
): boolean {
    const sortedRight = [...right].sort();
    return (
        left.length === right.length &&
        [...left].sort().every((code, index) => code === sortedRight[index])
    );
}

interface CutOffFieldProps extends GridSpanProps {
    readonly label: string;
    readonly hint: string;
    /** Drawn inside the frame at its trailing edge, the way the menu's cycle field carries "days". */
    readonly unit: string;
    readonly placeholder: string;
    /** The figure in plain words, under the field; `null` while there is no figure to explain. */
    readonly example: string | null;
    readonly error?: string | undefined;
    readonly disabled: boolean;
    readonly value: number | null;
    readonly onChange: (next: number | null) => void;
    /** The field's own id and test id; the sentence under it is `{testID}-example`. */
    readonly testID: string;
}

/**
 * The change cut-off: whole hours, with the sentence that says what they mean.
 *
 * Its own element because `FormGrid` reads the span off its direct child, and a field and a line
 * of caption under it have to share one cell — a caption placed after the grid would sit under
 * the whole section rather than under this figure.
 */
function CutOffField({
    label,
    hint,
    unit,
    placeholder,
    example,
    error,
    disabled,
    value,
    onChange,
    testID,
}: CutOffFieldProps) {
    return (
        <View className="flex-col gap-hair">
            <TextInputField
                testID={testID}
                id={testID}
                label={label}
                hint={hint}
                placeholder={placeholder}
                size="sm"
                inputMode="numeric"
                autoCorrect={false}
                required
                disabled={disabled}
                trailing={
                    <Text variant="caption" tone="secondary">
                        {unit}
                    </Text>
                }
                value={value === null ? '' : String(value)}
                {...(error === undefined ? {} : { error })}
                onChangeText={(text) => {
                    const digits = text.replace(/[^0-9]/g, '');
                    onChange(digits === '' ? null : Number.parseInt(digits, 10));
                }}
            />
            {example === null ? null : (
                <Text testID={`${testID}-example`} variant="caption" tone="secondary">
                    {example}
                </Text>
            )}
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Steps
 * ---------------------------------------------------------------------------------------------- */

/*
 * The plan first — its name, summary and cut-off, which is what a new plan is asked before anything
 * else — then Configurations · Matrix · Durations, the design's three (Commercial §3.3), then the
 * fixed menu. A new plan walks the same five steps, because the design's `New plan` is the same
 * editor with nothing in it, and its one Save writes all of them. The menu is optional there as
 * everywhere: left empty, the plan is created with no menu.
 */
const PLAN_STEPS = ['plan', 'variants', 'matrix', 'durations', 'menu'] as const;
type PlanStep = (typeof PLAN_STEPS)[number];

/*
 * The rows a new plan opens with: one configuration and one duration, because a plan is not
 * written without either, and an empty section with an Add button makes the reader discover that.
 * More are added from the section heading. Their keys are fixed so the form can tell a starter row
 * nobody has touched — whose blanks wait for Save, like any required field — from one being typed.
 */
const STARTER_VARIANT_KEY = 'variant-starter';
const STARTER_DURATION_KEY = 'duration-starter';

function isBlankVariant(row: VariantDraft): boolean {
    return (
        row.name.en.trim() === '' &&
        row.name.ar.trim() === '' &&
        row.mealsPerDay === null &&
        row.snacksPerDay === null &&
        row.energyMin === null &&
        row.energyMax === null
    );
}

function isBlankDuration(row: DurationDraft): boolean {
    return row.days === null && row.discountPercent === null;
}

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
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);
    // Cancel and the not-found link step back to wherever the reader came from — the plan list as
    // they left it — and only open a fresh list when there is no history to return to.
    const back = useReturnTo(undefined, '/kitchen/plans');

    const isCreating = plan === undefined || plan === 'new';
    // Every plan, new or saved, opens on the plan itself and walks the same five steps.
    const planSteps: readonly PlanStep[] = PLAN_STEPS;
    const form = useFormSteps(planSteps);
    /*
     * The record a create has already minted, held while the sections after it are still being
     * written. If one of those writes fails the screen is still at `/new`, and without this a second
     * press would create a second plan instead of finishing the first.
     */
    const [created, setCreated] = useState<PlanAdmin | null>(null);
    const parsed = isCreating ? null : SubscriptionPlanId.safeParse(plan);

    const record = useAdminPlanQuery(parsed);
    const priceLists = usePriceListsQuery({ limit: 100 });
    const menuRecord = usePlanMenuQuery(parsed);
    /*
     * The dishes the menu picker offers.
     *
     * Published only, because the server refuses anything else with `422` — "a menu entry is a
     * promise to serve the dish" — and a picker that offered a draft would turn that promise into a
     * refusal after the fact. Whole listing rather than a page, for the reason every editor here
     * takes one: a page control on a select is nonsense. A new plan needs it too — its menu is
     * written in the same pass as everything else.
     */
    const meals = useAdminMealsQuery({ limit: 100, statuses: ['published'] });

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

    const [combinations, setCombinations] = useState<readonly CombinationDraft[]>([]);
    const [combinationsDirty, setCombinationsDirty] = useState(false);

    const [variants, setVariants] = useState<readonly VariantDraft[]>(
        isCreating ? [emptyVariant(STARTER_VARIANT_KEY)] : [],
    );
    const [variantsDirty, setVariantsDirty] = useState(false);

    const [durations, setDurations] = useState<readonly DurationDraft[]>(
        isCreating ? [emptyDuration(STARTER_DURATION_KEY)] : [],
    );
    const [durationsDirty, setDurationsDirty] = useState(false);

    const [menu, setMenu] = useState<MenuDraft>(EMPTY_MENU);
    const [menuKey, setMenuKey] = useState<string | null>(null);
    const [menuDirty, setMenuDirty] = useState(false);
    const [showWithdrawMenu, setShowWithdrawMenu] = useState(false);

    const [matrixKey, setMatrixKey] = useState<string | null>(null);
    const [ordinal, setOrdinal] = useState(1);

    const [showPublish, setShowPublish] = useState(false);
    const [showRetire, setShowRetire] = useState(false);
    /** Whether Save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);

    const data = record.data;

    /*
     * The trail's last crumb — what makes `Plans` above it a link back. The create form names
     * itself; a saved plan waits for its record rather than showing a placeholder for a frame.
     */
    useKitchenTrailLeaf(
        isCreating
            ? t('kitchen:plans.createTitle')
            : data === undefined
              ? null
              : displayName(data.name, locale).value || t('kitchen:plans.editTitle'),
    );

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

    // The matrix is what is on sale, so a withdrawn configuration — kept, not deleted, because
    // subscribers and prices still point at it — draws no cell, row or band of its own.
    const soldVariants = useMemo(() => variants.filter((variant) => variant.isActive), [variants]);
    const bands = useMemo(() => matrixBands(soldVariants, []), [soldVariants]);
    const rows = useMemo(
        () => matrixRows(combinations, soldVariants),
        [combinations, soldVariants],
    );

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
                energyDuplicate: t('kitchen:plans.variantDuplicate'),
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

    const menuRowErrors = useMemo(() => {
        const serving = largestServing(variants);
        return menuEntryErrors(
            menu,
            {
                beyondCycle: t('kitchen:plans.menuBeyondCycle'),
                mealRequired: t('kitchen:plans.menuMealRequired'),
                sequenceRequired: t('kitchen:plans.menuSequenceRequired'),
                duplicateCoordinate: t('kitchen:plans.menuDuplicateCoordinate'),
            },
            serving === null
                ? undefined
                : {
                      ...serving,
                      message: t('kitchen:plans.menuOverServing', {
                          meals: serving.meals,
                          snacks: serving.snacks,
                      }),
                  },
        );
    }, [menu, variants, t]);

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
    // Blank waits for Save like any required field; a figure outside the range is wrong at once.
    const cutOffMissing = details.changeCutOffHours === null;
    const cutOffOutOfRange =
        details.changeCutOffHours !== null &&
        (details.changeCutOffHours < CUT_OFF_HOURS_MIN ||
            details.changeCutOffHours > CUT_OFF_HOURS_MAX);
    const detailsBlocked = nameMissing || cutOffMissing || cutOffOutOfRange;

    /**
     * The cut-off in plain words, under the field: when a Friday delivery locks. A whole number of
     * days names the weekday — that is how a kitchen thinks of it — and anything else is said in
     * hours, because "Thursday at a different time" is not a sentence anybody plans by.
     */
    const cutOffExample = (() => {
        const hours = details.changeCutOffHours;
        if (hours === null || hours <= 0) return null;
        if (hours % 24 === 0 && hours <= CUT_OFF_WEEKDAY_MAX) {
            return t('kitchen:plans.cutOffExample', {
                weekday: formatter.formatDate(EXAMPLE_FRIDAY_MS - hours * 3_600_000, {
                    weekday: 'long',
                    timeZone: 'UTC',
                }),
            });
        }
        return t('kitchen:plans.cutOffExampleHours', { count: hours });
    })();

    /** A starter row still exactly as the form opened it — its blanks are required, not wrong. */
    const untouchedVariant = (key: string): boolean =>
        variants.some(
            (row) => row.key === key && key === STARTER_VARIANT_KEY && isBlankVariant(row),
        );
    const untouchedDuration = (key: string): boolean =>
        durations.some(
            (row) => row.key === key && key === STARTER_DURATION_KEY && isBlankDuration(row),
        );
    const variantsRequiredOnly = [...variantRowErrors.keys()].every(untouchedVariant);
    const durationsRequiredOnly = [...durationRowErrors.keys()].every(untouchedDuration);

    /*
     * Everything on the form that needs the reader, each naming the step it is on and the field
     * that fixes it — the recipe editor's list, on the plan's five steps. Counted on each step's
     * tab; Save takes the reader to the first of them in step order (`saveBlockers`).
     *
     * `required` separates a blank, which waits for Save to be pressed, from something already
     * typed wrong, which is named at once. `blocksSave` is what stops *this* header's Save: the
     * plan's own fields always, and the configuration and duration rows only while creating, when
     * that one button writes them too. On a saved plan those rows have their own save, which refuses
     * them in the same way; they are still named here, because the tab row and the banner are where a
     * reader looks for what is wrong.
     */
    const issues: readonly {
        readonly key: string;
        readonly label: string;
        readonly step: PlanStep;
        readonly fieldId: string | null;
        readonly required: boolean;
        readonly blocksSave: boolean;
    }[] = [
        ...(variantRowErrors.size > 0
            ? [
                  {
                      key: 'variants',
                      label: t('kitchen:plans.variantsTitle'),
                      step: 'variants' as const,
                      fieldId: null,
                      required: variantsRequiredOnly,
                      blocksSave: isCreating,
                  },
              ]
            : []),
        ...(durationRowErrors.size > 0
            ? [
                  {
                      key: 'durations',
                      label: t('kitchen:plans.sectionDurations'),
                      step: 'durations' as const,
                      fieldId: null,
                      required: durationsRequiredOnly,
                      blocksSave: isCreating,
                  },
              ]
            : []),
        ...(nameMissing
            ? [
                  {
                      key: 'name',
                      label: t('kitchen:bilingual.englishShort', {
                          field: t('kitchen:fields.name'),
                      }),
                      step: 'plan' as const,
                      fieldId: 'kitchen-plan-name-en',
                      required: true,
                      blocksSave: true,
                  },
              ]
            : []),
        ...(cutOffMissing || cutOffOutOfRange
            ? [
                  {
                      key: 'cut-off',
                      label: t('kitchen:plans.cutOffLabel'),
                      step: 'plan' as const,
                      fieldId: 'kitchen-plan-cut-off',
                      required: cutOffMissing,
                      blocksSave: true,
                  },
              ]
            : []),
        /*
         * The menu's rows always, and its document rule too while creating — then the one Save
         * writes the menu, so a half-written one (a cycle with no dishes, dishes with no anchor)
         * has to stop it here rather than be refused by the server after the plan already exists.
         * On a saved plan the section's own Save refuses the document and its Callout says why.
         */
        ...(menuRowErrors.size > 0 || (isCreating && menuBlockers.length > 0)
            ? [
                  {
                      key: 'menu',
                      label: t('kitchen:plans.sectionMenu'),
                      step: 'menu' as const,
                      fieldId: null,
                      required: false,
                      blocksSave: isCreating,
                  },
              ]
            : []),
    ];

    /* Before the first Save, only what has already been typed wrong; after it, everything. */
    const shownIssues = attempted ? issues : issues.filter((entry) => !entry.required);
    const shows = (key: string): boolean => shownIssues.some((entry) => entry.key === key);
    // In step order, so Save opens the first step that stops it rather than the first one listed.
    const saveBlockers = issues
        .filter((entry) => entry.blocksSave)
        .sort((left, right) => PLAN_STEPS.indexOf(left.step) - PLAN_STEPS.indexOf(right.step));

    const goTo = (step: PlanStep, fieldId: string | null) => {
        form.goTo(step);
        if (fieldId !== null) focusField(fieldId);
    };

    /**
     * The solid pill a step's tab carries while something on it needs attention. `refused` is what
     * the server turned down on that step, counted where the refusal is read.
     */
    const stepIssues = (step: PlanStep, refused = 0) => {
        const count = shownIssues.filter((entry) => entry.step === step).length + refused;
        if (count === 0) return undefined;
        return {
            count,
            tone: 'danger' as const,
            label: t('kitchen:forms.toFixCount', { count }),
        };
    };

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
        /*
         * The *saved* menu, for the same reason as every other line here. A rotation with a day
         * nobody is served on is a subscriber who gets nothing that day; a plan with no menu at
         * all is a different, legitimate state (orders without dishes) and is not a blocker.
         */
        if (menuRecord.data !== undefined && menuRecord.data.cycleDays !== null) {
            const emptyDays = menuDays(menuDraft(menuRecord.data)).filter(
                (day) => !day.isBeyondCycle && day.entries.length === 0,
            ).length;
            if (emptyDays > 0) {
                reasons.push(t('kitchen:plans.blockMenuDaysEmpty', { count: emptyDays }));
            }
        }
        if (detailsDirty || combinationsDirty || variantsDirty || durationsDirty || menuDirty) {
            reasons.push(t('kitchen:plans.blockUnsaved'));
        }
        return reasons;
    }, [
        data,
        menuRecord.data,
        coverage,
        detailsDirty,
        combinationsDirty,
        variantsDirty,
        durationsDirty,
        menuDirty,
        t,
    ]);

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    /*
     * What the server may refuse on the plan itself, in the order the plan step draws the fields —
     * so the first one refused is the first one the reader meets. All of them are on that step.
     */
    const serverTargets: Readonly<Record<string, ServerFieldTarget>> = {
        name_en: {
            label: t('kitchen:bilingual.englishShort', { field: t('kitchen:fields.name') }),
            fieldId: 'kitchen-plan-name-en',
        },
        name_ar: {
            label: t('kitchen:bilingual.arabicShort', { field: t('kitchen:fields.name') }),
            fieldId: 'kitchen-plan-name-ar',
        },
        summary_en: {
            label: t('kitchen:bilingual.englishShort', { field: t('kitchen:plans.summaryLabel') }),
            fieldId: 'kitchen-plan-summary-en',
        },
        summary_ar: {
            label: t('kitchen:bilingual.arabicShort', { field: t('kitchen:plans.summaryLabel') }),
            fieldId: 'kitchen-plan-summary-ar',
        },
        description_en: {
            label: t('kitchen:bilingual.englishShort', {
                field: t('kitchen:plans.descriptionLabel'),
            }),
            fieldId: 'kitchen-plan-description-en',
        },
        description_ar: {
            label: t('kitchen:bilingual.arabicShort', {
                field: t('kitchen:plans.descriptionLabel'),
            }),
            fieldId: 'kitchen-plan-description-ar',
        },
        change_cutoff_hours: {
            label: t('kitchen:plans.cutOffLabel'),
            fieldId: 'kitchen-plan-cut-off',
        },
    };

    /**
     * Where a refused write takes the reader: the step it was about — where the refused row or the
     * section's own callout says why — and on the plan step the first field the server named. A
     * lost race is the conflict dialog's question, and moves nothing.
     */
    const showRefusal = (step: PlanStep, error: unknown) => {
        if (concurrency.capture(error)) return;
        if (step !== 'plan') {
            goTo(step, null);
            return;
        }
        const refused = serverFieldErrors(toFailure(error), serverTargets);
        const first = Object.entries(serverTargets).find(
            ([field]) => refused.errorFor(field) !== undefined,
        )?.[1];
        goTo('plan', first?.fieldId ?? null);
    };

    /**
     * The new-plan save (Commercial §3.3, `New plan`): the record, then its configurations, its
     * durations and its menu, from the one `Save the plan` button the design draws.
     *
     * Four lock-versioned methods still, so this is up to four writes chained on each other's echo —
     * each carries the `lockVersion` the previous one returned, and a section with nothing in it is
     * skipped (an empty menu is no menu, which is what every plan starts with). A later write can
     * fail with the earlier ones applied: the failing section keeps its rows and says why, `created`
     * keeps the minted record, and pressing Save again finishes that plan rather than creating
     * another. The menu is last because it is the only write that leaves the item's version behind
     * it unread — nothing follows it but the navigation. The address moves to the record only once
     * every write has landed, so nothing typed is discarded by a navigation.
     *
     * Save is pressed from whichever step the reader is on, so a refusal of another section's rows
     * would land out of sight: `stage` names the step each write is about, and a refusal opens it,
     * where the refused row carries the server's note.
     */
    const createPlan = (changeCutOffHours: number) => {
        void (async () => {
            let stage: PlanStep = 'plan';
            try {
                let record =
                    created ??
                    (await create.mutateAsync({
                        name: details.name,
                        summary: details.summary,
                        description: details.description,
                        dietClassifications: details.dietClassifications,
                        changeCutOffHours,
                    }));
                setCreated(record);

                if (record.variants.length === 0 && variants.length > 0) {
                    stage = 'variants';
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
                    stage = 'durations';
                    record = await saveDurationsMutation.mutateAsync({
                        planId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            durations: durationRequest(durations),
                        },
                    });
                    setCreated(record);
                }
                if (!isMenuWithdrawal(menu)) {
                    stage = 'menu';
                    const body = menuRequest(menu);
                    await saveMenuMutation.mutateAsync({
                        planId: record.id,
                        request: {
                            lockVersion: record.meta.lockVersion,
                            entries: body.entries,
                            cycleDays: body.cycleDays,
                            anchorDate: body.anchorDate,
                        },
                    });
                }

                settle({ details: false, variants: false, durations: false, menu: false });
                toast.show({
                    testID: 'kitchen-plan-created-toast',
                    tone: 'success',
                    message: t('kitchen:plans.createdToast', {
                        name: displayName(record.name, locale).value,
                    }),
                });
                router.replace(`/kitchen/plans/${String(record.id)}` as never);
            } catch (error) {
                showRefusal(stage, error);
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
                    // Only when changed: the set is replaced wholesale, and an unchanged echo of
                    // what was read is a write that can only lose to a concurrent edit.
                    ...(sameDiets(details.dietClassifications, data.dietClassifications)
                        ? {}
                        : { dietClassifications: details.dietClassifications }),
                    changeCutOffHours: details.changeCutOffHours,
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
                    showRefusal('plan', error);
                },
            },
        );
    };

    /*
     * Save the plan is pressable over an incomplete form, from any step, as on the ingredient and
     * recipe editors. The press marks the form attempted — the blank required fields say so and each
     * step's tab counts them — and takes the reader to the first thing that stops it, switching
     * step on the way.
     */
    const attemptSave = () => {
        if (!canManage) return;
        setAttempted(true);
        const first = saveBlockers[0];
        if (first !== undefined) {
            goTo(first.step, first.fieldId);
            return;
        }
        saveDetails();
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
                    // The refused row is on the configurations step; a reader who moved on
                    // while the save was in flight is brought back to it.
                    showRefusal('variants', error);
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
                    showRefusal('durations', error);
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
                    showRefusal('menu', error);
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
                    actions={
                        <Button
                            testID="kitchen-plan-not-found-back"
                            variant="quiet"
                            label={t('kitchen:plans.backToList')}
                            onPress={back.leave}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <FormSkeleton
                testID="kitchen-plan-editor-loading"
                partTestID="kitchen-plan"
                sections={3}
            />
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

    /* ── what the server refused, put on the fields it named (BUG-06) ──────────────────────── */

    const server = serverFieldErrors(saveFailure, serverTargets);
    /*
     * A configuration's refusal is about one row of the configurations step, and a row there has
     * no field of its own to mark — the message becomes the row's note. The server names the row
     * either whole (`cells.2`, a cell already sold) or by a field of it (`cells.2.name_en`), and
     * both are read. `cells` holds the rows `variantRequest` sent, which skips none once the save
     * is allowed.
     */
    const variantsServer = serverFieldErrors(matrixFailure, {
        'cells.*': { label: t('kitchen:plans.variantsTitle'), fieldId: 'kitchen-plan-variants' },
        'cells.*.*': { label: t('kitchen:plans.variantsTitle'), fieldId: 'kitchen-plan-variants' },
    });
    const sentVariants = variants.filter((row) => variantRequest([row]).length > 0);
    const variantServerNotes = new Map(
        sentVariants.flatMap((row, index) => {
            const message =
                variantsServer.errorFor(`cells.${String(index)}`) ??
                variantsServer.errorFor(`cells.${String(index)}.*`);
            return message === undefined ? [] : [[row.key, message] as const];
        }),
    );
    /*
     * What the server said about the configurations and could not put on a row. Drawn on the
     * configurations step as well as the matrix, because the save that was refused is pressed on
     * the former and a refusal that only showed on the latter went unread.
     */
    const matrixErrorCallout =
        matrixFailure === null ||
        (variantsServer.isValidation && variantsServer.unplaced === null) ? null : (
            <Callout
                testID="kitchen-plan-matrix-error"
                role="alert"
                tone="danger"
                title={t('kitchen:plans.matrixSaveError')}
                body={variantsServer.unplaced ?? matrixFailure.message}
            />
        );
    // Neither of these has a field to mark: a refusal's own words go in the section's callout.
    const durationsServer = serverFieldErrors(durationsFailure);
    const menuServer = serverFieldErrors(menuFailure);

    /*
     * What the server turned down on each step, for that step's red pill: the plan's own fields,
     * the configuration rows it named and anything about them it could not place, and the
     * durations' and the menu's callouts — neither has a field of its own to mark.
     */
    const refusedOn = (step: PlanStep): number =>
        step === 'plan'
            ? server.items.length
            : step === 'variants'
              ? variantsServer.items.length + (matrixErrorCallout === null ? 0 : 1)
              : step === 'durations'
                ? durationsFailure === null
                    ? 0
                    : 1
                : step === 'menu'
                  ? menuFailure === null
                      ? 0
                      : 1
                  : 0;
    const menuLoadFailure = toFailure(menuRecord.error);
    const mealRows = mealsFromPages(meals.data?.pages);
    /*
     * The cutover question, asked of the *server's* menu rather than the draft's origin: has this
     * plan ever had one, and is this draft about to give it one?
     */
    /*
     * Never on a new plan: the warning is about orders that have been generated without dishes
     * until now, and a plan that does not exist yet has none.
     */
    const menuCutover =
        !isCreating && menuRecord.data !== undefined && isFirstPublication(menuRecord.data, menu);
    const menuOnServer = menuRecord.data !== undefined && isMenuPublished(menuRecord.data);
    // A saved plan's menu waits for its own read; a new plan's has nothing to read.
    const menuLoading = !isCreating && menuRecord.isPending;
    const menuLoadBlocked = !isCreating && menuLoadFailure !== null;
    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishRefusedByStatus = Object.keys(publishFields).includes('status');
    const publishRefusedByPrice = Object.keys(publishFields).includes('price');
    const quarantined = data?.meta.status === 'review_required';
    const isPublished = data?.meta.status === 'published';

    const busy =
        create.isPending ||
        update.isPending ||
        (isCreating &&
            (saveVariantsMutation.isPending ||
                saveDurationsMutation.isPending ||
                saveMenuMutation.isPending));
    const status = data?.meta.status ?? 'draft';

    const title = isCreating
        ? t('kitchen:plans.createTitle')
        : data === undefined
          ? t('kitchen:plans.editTitle')
          : displayName(data.name, locale).value;

    /** Each step, numbered, with what it holds and — once there is something — what needs fixing. */
    const tabItems = planSteps.map((key) => ({
        value: key,
        label: t(PLAN_STEP_LABELS[key]),
        ...(key === 'variants'
            ? { count: variants.length }
            : key === 'durations'
              ? { count: durations.length }
              : key === 'menu'
                ? { count: menu.entries.length }
                : {}),
        issues: stepIssues(key, refusedOn(key)),
        // The ids the progress row used to carry, so a suite that walks the steps still can.
        testID: `kitchen-plan-editor-screen-steps-${key}`,
    }));

    return (
        <Cascade space="md" testID="kitchen-plan-editor-screen">
            {/*
             * The opening, as the recipe editor draws it: the title with its status beside it, the
             * actions at the inline end — Save among them, so it is on screen on every step — and
             * the steps as numbered tabs on a sunken track, each carrying its count and, when
             * something on it needs attention, a solid red pill. The pills are how a reader finds
             * what needs fixing; the field itself says what. No trail here — `KitchenOpsShell`
             * draws it.
             */}
            <Stack space="sm">
                <CataloguePageHeader
                    testID="kitchen-plan-editor-screen-header"
                    titleTestID="kitchen-plan-editor-screen-title"
                    title={title}
                    titleAside={
                        <Inline
                            space="xs"
                            align="center"
                            wrap
                            testID="kitchen-plan-editor-screen-meta"
                        >
                            <Badge
                                variant="caps"
                                testID="kitchen-plan-editor-screen-status"
                                tone={statusTone(status)}
                                icon={null}
                                label={t(statusKey(status))}
                            />
                            <Badge
                                variant="label"
                                testID="kitchen-plan-editor-screen-chip"
                                tone="brand"
                                icon={null}
                                label={t('kitchen:plans.createChip')}
                            />
                            {guard.isDirty ? (
                                <Badge
                                    variant="label"
                                    testID="kitchen-plan-editor-screen-dirty"
                                    tone="warning"
                                    icon="warning"
                                    label={t('kitchen:editor.unsaved')}
                                />
                            ) : null}
                        </Inline>
                    }
                    primaryAction={
                        <Inline space="xs" align="center" wrap justify="end">
                            <Button
                                testID="kitchen-plan-editor-screen-back"
                                variant="secondary"
                                label={t('kitchen:editor.cancel')}
                                onPress={() => {
                                    guard.intercept(back.leave);
                                }}
                            />
                            {/* Publication is never offered before the plan exists. */}
                            {isCreating || !canManage ? null : isPublished ? (
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
                                    label={t('kitchen:publish.action')}
                                    onPress={() => {
                                        setShowPublish(true);
                                    }}
                                />
                            )}
                            {/*
                             * The commit, last, on every step: a new plan is written whole from
                             * here, and a saved one is edited in any order.
                             */}
                            <Button
                                testID="kitchen-plan-editor-screen-save"
                                // The design's own word for this button (Commercial §3.3).
                                label={t('kitchen:plans.savePlan')}
                                loading={busy}
                                disabled={!canManage || busy}
                                onPress={attemptSave}
                            />
                        </Inline>
                    }
                />

                <Tabs<PlanStep>
                    testID="kitchen-plan-steps"
                    label={t('kitchen:plans.stepsLabel')}
                    items={tabItems}
                    value={form.current}
                    onChange={form.goTo}
                    variant="steps"
                />

                {/*
                 * What the server said about the plan and could not put on a field: one line under
                 * the steps, on every step, since it belongs to none of them.
                 */}
                {saveFailure === null ||
                (server.isValidation && server.unplaced === null) ? null : (
                    <FormIssueBanner
                        testID="kitchen-plan-save-error"
                        tone="danger"
                        summary={server.unplaced ?? saveFailure.message}
                        items={[]}
                    />
                )}
            </Stack>

            {quarantined ? (
                <Callout
                    testID="kitchen-plan-quarantine"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:publish.quarantineTitle')}
                />
            ) : null}

            {isPublished && data !== undefined ? (
                <Callout
                    testID="kitchen-plan-published"
                    role="note"
                    tone="success"
                    title={t('kitchen:plans.publishedTitle')}
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

            {/* ── the plan itself ──────────────────────────────────────────────────────────── */}
            {/*
             * Its own step, drawn the way the ingredient editor draws a record: sections, each a
             * title and a hairline, and the fields on the half track — a name and its translation are
             * one answer in two boxes across four tracks, and the cut-off is a figure in two.
             */}
            {form.current !== 'plan' ? null : (
                <View testID="kitchen-plan-details" className="z-auto flex-col gap-loose">
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-plan-identity"
                        title={t('kitchen:forms.description')}
                    >
                        <FormGrid track="half" maxColumns={4} testID="kitchen-plan-identity-grid">
                            <BilingualField
                                span={4}
                                layout="row"
                                testID="kitchen-plan-name"
                                fieldLabel={t('kitchen:fields.name')}
                                placeholder={{
                                    en: t('kitchen:fields.planNamePlaceholderEn'),
                                    ar: t('kitchen:fields.planNamePlaceholderAr'),
                                }}
                                value={details.name}
                                requiredEnglish
                                disabled={!canManage}
                                {...(shows('name')
                                    ? { englishError: t('kitchen:forms.required') }
                                    : { englishError: server.errorFor('name_en') })}
                                arabicError={server.errorFor('name_ar')}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setDetails({ ...details, name: next });
                                        setDetailsDirty(true);
                                    });
                                }}
                            />

                            <BilingualField
                                span={4}
                                layout="row"
                                testID="kitchen-plan-summary"
                                fieldLabel={t('kitchen:plans.summaryLabel')}
                                placeholder={{
                                    en: t('kitchen:plans.summaryPlaceholderEn'),
                                    ar: t('kitchen:plans.summaryPlaceholderAr'),
                                }}
                                value={details.summary}
                                disabled={!canManage}
                                englishError={server.errorFor('summary_en')}
                                arabicError={server.errorFor('summary_ar')}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setDetails({ ...details, summary: next });
                                        setDetailsDirty(true);
                                    });
                                }}
                            />

                            <BilingualField
                                span={4}
                                layout="row"
                                testID="kitchen-plan-description"
                                fieldLabel={t('kitchen:plans.descriptionLabel')}
                                placeholder={{
                                    en: t('kitchen:plans.descriptionPlaceholderEn'),
                                    ar: t('kitchen:plans.descriptionPlaceholderAr'),
                                }}
                                multiline
                                value={details.description}
                                disabled={!canManage}
                                englishError={server.errorFor('description_en')}
                                arabicError={server.errorFor('description_ar')}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setDetails({ ...details, description: next });
                                        setDetailsDirty(true);
                                    });
                                }}
                            />

                            {/*
                             * A figure with its unit in the frame and the rule as the (i), and
                             * under it the one sentence that says what the figure means for a
                             * delivery — the number is abstract until it names a day.
                             */}
                            <CutOffField
                                span={2}
                                testID="kitchen-plan-cut-off"
                                label={t('kitchen:plans.cutOffLabel')}
                                hint={t('kitchen:plans.cutOffHint')}
                                unit={t('kitchen:plans.cutOffUnit')}
                                placeholder={String(DEFAULT_CUT_OFF_HOURS)}
                                example={cutOffExample}
                                disabled={!canManage}
                                value={details.changeCutOffHours}
                                {...(shows('cut-off') && cutOffMissing
                                    ? { error: t('kitchen:plans.cutOffRequired') }
                                    : cutOffOutOfRange
                                      ? {
                                            error: t('kitchen:plans.cutOffRange', {
                                                min: CUT_OFF_HOURS_MIN,
                                                max: CUT_OFF_HOURS_MAX,
                                            }),
                                        }
                                      : server.flag('change_cutoff_hours'))}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setDetails({ ...details, changeCutOffHours: next });
                                        setDetailsDirty(true);
                                    });
                                }}
                            />
                        </FormGrid>
                    </FormSection>

                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-plan-diets-section"
                        title={t('kitchen:plans.dietsLabel')}
                    >
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
                    </FormSection>
                </View>
            )}

            {/* `z-auto` down the column: see `FormSection` on why a View would trap a dropdown. */}
            <View className="z-auto flex-col gap-loose">
                {/* ── the matrix ───────────────────────────────────────────────────────── */}
                {form.current !== 'matrix' ? null : (
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-plan-matrix"
                        title={t('kitchen:plans.tabMatrix')}
                    >
                        <Stack space="md">
                            {matrixErrorCallout}

                            <PlanMatrixGrid
                                testID="kitchen-plan-matrix-grid"
                                rows={rows}
                                bands={bands}
                                variants={soldVariants}
                            />
                        </Stack>
                    </FormSection>
                )}

                {/* ── every configuration in full ──────────────────────────────────────── */}
                {form.current !== 'variants' ? null : (
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-plan-variants-section"
                        title={t('kitchen:plans.variantsTitle')}
                        actions={
                            canManage ? (
                                <Inline space="xs" wrap>
                                    <Button
                                        testID="kitchen-plan-variants-add"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:plans.addVariant')}
                                        iconStart={<Icon name="plus" size="sm" />}
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
                            ) : undefined
                        }
                    >
                        <Stack space="md">
                            {matrixErrorCallout}

                            <PlanVariantRows
                                testID="kitchen-plan-variants"
                                rows={variants}
                                errors={
                                    // The form's own check first; the server's note where none.
                                    new Map([
                                        ...variantServerNotes,
                                        ...(attempted
                                            ? variantRowErrors
                                            : [...variantRowErrors].filter(
                                                  ([key]) => !untouchedVariant(key),
                                              )),
                                    ])
                                }
                                keepOne={isCreating}
                                canManage={canManage}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setVariants(next);
                                        setVariantsDirty(true);
                                    });
                                }}
                            />
                        </Stack>
                    </FormSection>
                )}

                {/* ── durations ────────────────────────────────────────────────────────── */}
                {form.current !== 'durations' ? null : (
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-plan-durations"
                        title={t('kitchen:plans.sectionDurations')}
                        actions={
                            canManage ? (
                                <Inline space="xs" wrap>
                                    <Button
                                        testID="kitchen-plan-durations-add"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:plans.addDuration')}
                                        iconStart={<Icon name="plus" size="sm" />}
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
                            ) : undefined
                        }
                    >
                        <Stack space="md">
                            {durationsFailure === null ? null : (
                                <Callout
                                    testID="kitchen-plan-durations-error"
                                    role="alert"
                                    tone="danger"
                                    title={t('kitchen:plans.durationsSaveError')}
                                    body={durationsServer.unplaced ?? durationsFailure.message}
                                />
                            )}

                            <PlanDurationRows
                                testID="kitchen-plan-duration-rows"
                                rows={durations}
                                errors={
                                    attempted
                                        ? durationRowErrors
                                        : new Map(
                                              [...durationRowErrors].filter(
                                                  ([key]) => !untouchedDuration(key),
                                              ),
                                          )
                                }
                                keepOne={isCreating}
                                canManage={canManage}
                                onChange={(next) => {
                                    markDirty(() => {
                                        setDurations(next);
                                        setDurationsDirty(true);
                                    });
                                }}
                            />
                        </Stack>
                    </FormSection>
                )}

                {/* ── the fixed menu ───────────────────────────────────────────────────── */}
                {/*
                 * Drawn the way the durations are: the section's own Withdraw and Save at the
                 * heading's inline end on a saved plan (a new plan has one Save, under the form),
                 * the state as two badges beside the title, the two document fields on the half
                 * track, then the days as a table.
                 */}
                {form.current !== 'menu' ? null : (
                    <FormSection
                        first
                        variant="card"
                        testID="kitchen-plan-menu"
                        title={t('kitchen:plans.sectionMenu')}
                        aside={
                            menuLoading || menuLoadBlocked ? undefined : (
                                <Inline space="xs" wrap testID="kitchen-plan-menu-summary">
                                    <Badge
                                        testID="kitchen-plan-menu-entry-count"
                                        variant="label"
                                        tone={menu.entries.length === 0 ? 'neutral' : 'info'}
                                        icon={null}
                                        label={t('kitchen:plans.menuEntryCount', {
                                            count: menu.entries.length,
                                        })}
                                    />
                                    {isCreating ? null : (
                                        <Badge
                                            testID="kitchen-plan-menu-state"
                                            variant="label"
                                            tone={menuOnServer ? 'success' : 'neutral'}
                                            icon={null}
                                            label={
                                                menuOnServer
                                                    ? t('kitchen:plans.menuStatePublished')
                                                    : t('kitchen:plans.menuStateNone')
                                            }
                                        />
                                    )}
                                </Inline>
                            )
                        }
                        actions={
                            canManage && !isCreating && !menuLoading && !menuLoadBlocked ? (
                                <Inline space="xs" wrap>
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
                                        size="sm"
                                        label={t('kitchen:plans.saveMenu')}
                                        loading={saveMenuMutation.isPending}
                                        disabled={
                                            saveMenuMutation.isPending ||
                                            menuRowErrors.size > 0 ||
                                            menuBlockers.length > 0
                                        }
                                        onPress={() => {
                                            if (menuRowErrors.size > 0 || menuBlockers.length > 0) {
                                                return;
                                            }
                                            saveMenu(menu);
                                        }}
                                    />
                                </Inline>
                            ) : undefined
                        }
                    >
                        <Stack space="md">
                            {menuLoading ? (
                                <Skeleton
                                    testID="kitchen-plan-menu-skeleton"
                                    heightClassName="h-32"
                                />
                            ) : menuLoadBlocked && menuLoadFailure !== null ? (
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
                                        />
                                    ) : null}

                                    {menuFailure === null ? null : (
                                        <Callout
                                            testID="kitchen-plan-menu-error"
                                            role="alert"
                                            tone="danger"
                                            title={t('kitchen:plans.menuSaveError')}
                                            body={menuServer.unplaced ?? menuFailure.message}
                                        />
                                    )}

                                    {/*
                                     * The two fields that make the menu a rotation, and under them
                                     * the one sentence that keeps them apart from the step before:
                                     * a cycle is how often the *dishes* repeat, not how long
                                     * anybody subscribes, and day 1 is fixed for the plan, not for
                                     * each subscriber. One line under both rather than a hint on
                                     * each, because the picker carries no hint and two fields whose
                                     * boxes start at different heights read as misaligned.
                                     */}
                                    <View className="z-auto flex-row flex-wrap items-start gap-x-base gap-y-snug">
                                        <View style={{ width: spanWidth(1) }}>
                                            <TextInputField
                                                testID="kitchen-plan-menu-cycle-days"
                                                id="kitchen-plan-menu-cycle-days"
                                                label={t('kitchen:plans.menuCycleDaysLabel')}
                                                hint={t('kitchen:plans.menuExplainer')}
                                                /*
                                                 * The day number counts calendar days from day 1,
                                                 * so only a whole number of weeks keeps Monday's
                                                 * dishes on a Monday. Anything else is allowed —
                                                 * a cycle of 1 is every day the same — and said.
                                                 */
                                                {...(menu.cycleDays !== null &&
                                                menu.cycleDays > 1 &&
                                                menu.cycleDays % 7 !== 0
                                                    ? {
                                                          warning: t(
                                                              'kitchen:plans.menuCycleNotWeekly',
                                                          ),
                                                      }
                                                    : {})}
                                                size="sm"
                                                inputMode="numeric"
                                                autoCorrect={false}
                                                disabled={!canManage}
                                                trailing={
                                                    <Text variant="caption" tone="secondary">
                                                        {t('kitchen:plans.daysUnit')}
                                                    </Text>
                                                }
                                                value={
                                                    menu.cycleDays === null
                                                        ? ''
                                                        : String(menu.cycleDays)
                                                }
                                                onChangeText={(text) => {
                                                    const digits = text.replace(/[^0-9]/g, '');
                                                    const next =
                                                        digits === ''
                                                            ? null
                                                            : Math.min(
                                                                  Number.parseInt(digits, 10),
                                                                  MENU_CYCLE_DAY_MAX,
                                                              );
                                                    markDirty(() => {
                                                        setMenu(withCycleDays(menu, next));
                                                        setMenuDirty(true);
                                                    });
                                                }}
                                            />
                                        </View>
                                        <View style={{ width: spanWidth(1) }} className="z-auto">
                                            {/*
                                             * Picked from a month, as every date on the desk is.
                                             * Clearable, because an empty anchor is half of the one
                                             * legal empty menu. Read-only without the permission:
                                             * the picker has no disabled state to fall back on.
                                             */}
                                            {canManage ? (
                                                <DatePickerButton
                                                    testID="kitchen-plan-menu-anchor"
                                                    label={t('kitchen:plans.menuAnchorLabel')}
                                                    labelVisible
                                                    placeholder={t(
                                                        'kitchen:plans.menuAnchorPlaceholder',
                                                    )}
                                                    value={menu.anchorDate ?? ''}
                                                    onChange={(next) => {
                                                        markDirty(() => {
                                                            setMenu(withAnchorDate(menu, next));
                                                            setMenuDirty(true);
                                                        });
                                                    }}
                                                    onClear={() => {
                                                        markDirty(() => {
                                                            setMenu(withAnchorDate(menu, null));
                                                            setMenuDirty(true);
                                                        });
                                                    }}
                                                />
                                            ) : (
                                                <Stack
                                                    space="none"
                                                    testID="kitchen-plan-menu-anchor"
                                                >
                                                    <Text variant="label">
                                                        {t('kitchen:plans.menuAnchorLabel')}
                                                    </Text>
                                                    <Text tone="secondary">
                                                        {menu.anchorDate ?? '—'}
                                                    </Text>
                                                </Stack>
                                            )}
                                        </View>
                                    </View>

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
                                </>
                            )}
                        </Stack>
                    </FormSection>
                )}

                {/* ── prices, stated rather than edited ────────────────────────────────── */}
                {form.current !== 'plan' || isCreating ? null : (
                    <FormSection
                        first
                        variant="card"
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

            {/* ── the two guards ───────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-plan-editor-screen-unsaved-dialog"
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:unsaved.title')}
                description={t('kitchen:unsaved.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-plan-editor-screen-unsaved-keep"
                            variant="quiet"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID="kitchen-plan-editor-screen-unsaved-discard"
                            variant="danger"
                            label={t('kitchen:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />

            <Dialog
                testID="kitchen-plan-editor-screen-conflict-dialog"
                open={concurrency.conflict !== null}
                onClose={concurrency.keepEditing}
                dismissOnBackdrop={false}
                title={t('kitchen:conflict.title')}
                description={t('kitchen:conflict.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-plan-editor-screen-conflict-keep"
                            variant="quiet"
                            label={t('kitchen:conflict.keepEditing')}
                            onPress={concurrency.keepEditing}
                        />
                        <Button
                            testID="kitchen-plan-editor-screen-conflict-reload"
                            variant="danger"
                            label={t('kitchen:conflict.reload')}
                            onPress={concurrency.reload}
                        />
                    </>
                }
            >
                {concurrency.conflict === null ? null : (
                    <Text
                        testID="kitchen-plan-editor-screen-conflict-detail"
                        tone="secondary"
                        variant="caption"
                    >
                        {concurrency.conflict.failure.message}
                    </Text>
                )}
            </Dialog>
        </Cascade>
    );
}
