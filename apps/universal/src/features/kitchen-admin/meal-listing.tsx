import { PRODUCTION_MODES, isValidationFailure } from '@healthy360/api-client/contracts';
import type {
    LocalisedText,
    MealAdmin,
    MeasurementUnitOption,
    ProductionMode,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Dialog,
    EmptyState,
    ErrorState,
    FilterChip,
    FormSection,
    FormSkeleton,
    Inline,
    Select,
    Stack,
    Switch,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { MEAL_TYPES } from '@healthy360/domain-types';
import type { MealId, MealType } from '@healthy360/domain-types';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import {
    ingredientsFromPages,
    useAdminMealQuery,
    useIngredientsQuery,
    usePublishMealMutation,
    useRetireMealMutation,
    useSetMealAvailabilityMutation,
    useUpdateMealMutation,
} from '../../data/kitchen-admin-hooks.ts';
import { useProcurementReferenceQuery } from '../../data/kitchen-ops-hooks.ts';
import { BilingualField } from './bilingual-field.tsx';
import {
    MealAvailabilityEditor,
    availabilityErrors,
    emptyAvailabilityDay,
} from './catalogue-row-editors.tsx';
import type { AvailabilityDraft } from './catalogue-row-editors.tsx';
import { EditorFrame } from './editor-frame.tsx';
import {
    CATALOGUE_MANAGE_PERMISSION,
    CATALOGUE_VIEW_PERMISSION,
    INVENTORY_VIEW_PERMISSION,
} from './entity-registry.ts';
import { GateRailCard } from './gate-rail-card.tsx';
import {
    displayName,
    isTranslationIncomplete,
    mealTypeKey,
    parseClockTime,
    parseQuantity,
    parseWholeNumber,
    unitDimension,
    unitKey,
} from './format.ts';
import { useOptimisticConcurrency } from './use-optimistic-concurrency.ts';
import { useUnsavedGuard } from './use-unsaved-guard.ts';

/**
 * A meal's listing — the Selling tab of its page, and the one form in this workspace whose save a
 * shopper can see.
 *
 * ## The page is the recipe
 *
 * A meal's page is its recipe's in the recipe book (`/kitchen/recipes/{recipe}`,
 * `RecipeBookEditScreen`): the recipe the meal is made from, with this listing on a tab of its own,
 * exactly as a sauce's is. So nothing here chooses a recipe — the page already is one — and nothing
 * here creates a meal: the recipe's first save writes the listing that sells it. What stays is
 * everything about the dish *as sold*: its name on the menu, the portion, when in the day it sits,
 * the days it can be ordered, and whether it is public.
 *
 * ## Publication is the whole point of the screen
 *
 * A published meal is in `marketplace.listMeals` and on its own public page; a draft one is invisible
 * outside the kitchen. In this world that is literally true rather than a claim about a future
 * backend — admin and consumer read one store — so the publish dialog states the consequence, lists
 * the allergen label about to go public, and the editor offers a link straight to the public page
 * afterwards. That link is not decoration: it is the shortest way for the person who pressed the
 * button to check that what they published is what a customer now sees.
 *
 * ## Three things are read-only here, each for its own reason
 *
 * 1. **Allergens.** `MealAdmin.allergens` is frozen at publication from the recipe version's
 *    declaration and the contract has no meal-level setter. Editing a meal's label directly is
 *    exactly the food-safety hole the derivation exists to close, so the panel names its provenance —
 *    the recipe and the version — and links to the place the label can actually be changed.
 * 2. **Channel availability.** `setProductChannelAvailability` is a *product* method. Meals carry
 *    channels on the read shape with no writer, so they are shown as a fact.
 * 3. **The margin.** Confidential, and a number nobody can retype: it is derived from the recipe's
 *    cost per serving against a confirmed price. `null` when either side is missing, which is honest —
 *    a margin over a placeholder price is a fiction (plan §2.4).
 *
 * ## Availability is a calendar, not a rule
 *
 * `setMealAvailability` takes days keyed by `YYYY-MM-DD`. See `../catalogue-row-editors.tsx`: the
 * editor renders exactly that and invents no recurrence the contract cannot store.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

/** The "no shelf of its own" answer of the produced-item picker. Never a real identifier. */
const NO_INGREDIENT = '__none__';

/** The "not stated" answer of the production-mode picker. `production_mode` is nullable. */
const NO_MODE = '__unset__';

/**
 * The catalogue string each production mode is named by.
 *
 * A record rather than a template, for the reason `mealTypeKey` is a function in `format.ts`:
 * `pnpm gen:i18n-keys` reads literal keys, and a key assembled by interpolation is invisible to it.
 */
const PRODUCTION_MODE_KEYS: Record<ProductionMode, string> = {
    production: 'kitchen:meals.productionModeProduction',
    supplier: 'kitchen:meals.productionModeSupplier',
    both: 'kitchen:meals.productionModeBoth',
};

/**
 * Diet classifications are **not** here, and that is a scoping decision rather than an oversight.
 *
 * The handoff for this screen draws three sections and none of them is a diet filter, so the chips
 * that used to edit `dietClassifications` are gone. The field itself is untouched: every write below
 * sends back the value the server already holds, so a meal classified elsewhere keeps its
 * classification through a save made here. Nothing on this screen can set one, and nothing on this
 * screen can clear one either.
 *
 * The same is true of `channelAvailability`, which was only ever displayed — `setProductChannel-
 * Availability` is a product method and meals carry channels read-only.
 */
interface DetailsDraft {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly portionFactor: string;
    /**
     * The finished-stock chain (PROD1), in the order the server checks it: a
     * kitchen that produces the meal, an ingredient its batches make, the opt-in
     * itself, and how much of that ingredient one sold unit is.
     *
     * `netContentQuantity` is the person's own text while they type, like
     * `portionFactor` above — parsed once, on save.
     */
    readonly productionMode: ProductionMode | null;
    readonly ingredientId: string | null;
    readonly sellsFromFinishedStock: boolean;
    readonly netContentQuantity: string;
    readonly netContentUnitId: string | null;
    readonly mealTypes: readonly MealType[];
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    description: { en: '', ar: '' },
    portionFactor: '1',
    productionMode: null,
    ingredientId: null,
    sellsFromFinishedStock: false,
    netContentQuantity: '',
    netContentUnitId: null,
    mealTypes: [],
};

function detailsFrom(meal: MealAdmin): DetailsDraft {
    return {
        name: meal.name,
        description: meal.description,
        portionFactor: String(meal.portionFactor),
        productionMode: meal.productionMode,
        ingredientId: meal.ingredientId,
        sellsFromFinishedStock: meal.sellsFromFinishedStock,
        netContentQuantity: meal.netContentQuantity ?? '',
        netContentUnitId: meal.netContentUnitId,
        mealTypes: meal.mealTypes,
    };
}

/**
 * Draft rows in the shape `setMealAvailability` takes.
 *
 * A row with no date is dropped rather than sent: the contract keys days by date, so a dateless row
 * is not a day yet.
 */
function availabilityRequestDays(rows: readonly AvailabilityDraft[]) {
    return rows.flatMap((row) =>
        row.date === null
            ? []
            : [
                  {
                      date: row.date,
                      isAvailable: row.isAvailable,
                      remaining:
                          row.remaining.trim() === '' ? null : parseWholeNumber(row.remaining),
                      orderCutOffAt:
                          row.orderCutOffAt.trim() === ''
                              ? null
                              : parseClockTime(row.orderCutOffAt),
                  },
              ],
    );
}

function availabilityFrom(meal: MealAdmin): readonly AvailabilityDraft[] {
    return meal.availability.map((day, index) => ({
        key: `seed-${String(index)}-${day.date}`,
        date: day.date,
        isAvailable: day.isAvailable,
        remaining: day.remaining === null ? '' : String(day.remaining),
        orderCutOffAt: day.orderCutOffAt ?? '',
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface MealListingProps {
    /** The meal, already resolved by the page — it never opens on a meal that does not exist. */
    readonly meal: MealId;
    /** Told when the listing's unsaved state changes, so the page can guard its own exits. */
    readonly onDirtyChange?: ((dirty: boolean) => void) | undefined;
}

export function MealListing({ meal, onDirtyChange }: MealListingProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-meal-editor"
        >
            <MealListingEditor meal={meal} onDirtyChange={onDirtyChange} />
        </Gate>
    );
}

function MealListingEditor({ meal, onDirtyChange }: MealListingProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const record = useAdminMealQuery(meal);

    const update = useUpdateMealMutation();
    const setAvailability = useSetMealAvailabilityMutation();
    const publish = usePublishMealMutation();
    const retire = useRetireMealMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    useEffect(() => {
        onDirtyChange?.(guard.isDirty);
    }, [guard.isDirty, onDirtyChange]);

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [detailsKey, setDetailsKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);

    const [days, setDays] = useState<readonly AvailabilityDraft[]>([]);
    const [daysKey, setDaysKey] = useState<string | null>(null);
    const [daysDirty, setDaysDirty] = useState(false);
    const [nextDayOrdinal, setNextDayOrdinal] = useState(1);

    const [showPublish, setShowPublish] = useState(false);
    const [showRetire, setShowRetire] = useState(false);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;

    if (data !== undefined && serverKey !== detailsKey && !detailsDirty) {
        setDetailsKey(serverKey);
        setDetails(detailsFrom(data));
    }
    if (data !== undefined && serverKey !== daysKey && !daysDirty) {
        setDaysKey(serverKey);
        setDays(availabilityFrom(data));
    }

    const markDetailsDirty = () => {
        setDetailsDirty(true);
        guard.markDirty();
    };

    const markDaysDirty = () => {
        setDaysDirty(true);
        guard.markDirty();
    };

    const settle = (nextDetailsDirty: boolean, nextDaysDirty: boolean) => {
        setDetailsDirty(nextDetailsDirty);
        setDaysDirty(nextDaysDirty);
        if (!nextDetailsDirty && !nextDaysDirty) guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setDaysDirty(false);
        setDetailsKey(null);
        setDaysKey(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    const takeDayKey = (): string => {
        const key = `day-${String(nextDayOrdinal)}`;
        setNextDayOrdinal(nextDayOrdinal + 1);
        return key;
    };

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    /*
     * The produced item is picked from the ingredient library, and only the library — a meal's
     * shelf is an ingredient a published recipe outputs, and the server refuses anything else. One
     * page of a hundred is what the recipe picker takes too; `searchable` filters within it.
     */
    const ingredients = useIngredientsQuery({ limit: 100 });
    const ingredientRows = ingredientsFromPages(ingredients.data?.pages);
    const ingredientOptions: readonly SelectOption[] = useMemo(
        () => [
            { value: NO_INGREDIENT, label: t('kitchen:meals.producedIngredientNone') },
            ...ingredientRows.map((row) => ({
                value: String(row.id),
                label: displayName(row.name, locale).value,
                description: t(unitKey(row.measurementUnit)),
            })),
        ],
        [ingredientRows, locale, t],
    );

    const producedIngredient =
        ingredientRows.find((row) => String(row.id) === details.ingredientId) ?? null;

    /*
     * Net content is stated against a measurement unit **identifier**, and the only read that
     * carries one is the goods-receipt reference — `useUnitOptions` in `catalogue-row-editors.tsx`
     * builds its options from `MeasureUnit` *codes*, which is what a pack variant stores and is not
     * what this column holds. That read is behind `inventory.view_organisation`, so a
     * catalogue-only role cannot fill this pair in. It is told so rather than shown an empty picker
     * it would blame itself for: see `unitsUnavailable` below.
     */
    const canReadUnits = useCan(INVENTORY_VIEW_PERMISSION);
    const reference = useProcurementReferenceQuery(canReadUnits);
    const referenceUnits: readonly MeasurementUnitOption[] | undefined =
        reference.data?.measurementUnits;
    const unitOptions: readonly SelectOption[] = useMemo(
        () =>
            (referenceUnits ?? []).map((unit) => ({
                value: unit.id,
                label: unit.code,
                description: unit.nameEn,
            })),
        [referenceUnits],
    );
    const unitsUnavailable = !canReadUnits;

    const productionModeOptions: readonly SelectOption[] = useMemo(
        () => [
            { value: NO_MODE, label: t('kitchen:meals.productionModeUnset') },
            ...PRODUCTION_MODES.map((mode) => ({
                value: mode,
                label: t(PRODUCTION_MODE_KEYS[mode]),
            })),
        ],
        [t],
    );

    /* ── validation ──────────────────────────────────────────────────────────────────────────── */

    const dayErrors = useMemo(
        () =>
            availabilityErrors(days, {
                dateRequired: t('kitchen:availability.dateRequired'),
                dateDuplicate: t('kitchen:availability.dateDuplicate'),
                remainingInvalid: t('kitchen:availability.remainingInvalid'),
                cutOffInvalid: t('kitchen:availability.cutOffInvalid'),
            }),
        [days, t],
    );

    const nameMissing = details.name.en.trim() === '';
    const portion = parseQuantity(details.portionFactor);
    const portionInvalid = portion === null || portion <= 0;

    /* ── the finished-stock chain ────────────────────────────────────────────────────────────── */

    /**
     * Why the toggle cannot be turned on yet, in the words the server would have refused with, or
     * `null` when it can.
     *
     * Two preconditions, checked in the order `CatalogueItemService::finishedStockDeclaration()`
     * checks them: a kitchen that produces the meal, then an ingredient its batches make. Naming
     * the first one that fails rather than both is deliberate — they are sequential, and a person
     * who has set neither is told to set the mode, which is the field above.
     */
    const finishedStockBlockedReason =
        details.productionMode === 'production' || details.productionMode === 'both'
            ? details.ingredientId === null
                ? t('kitchen:meals.finishedStockBlockedIngredient')
                : null
            : t('kitchen:meals.finishedStockBlockedMode');

    /**
     * Whether the shelf behind this meal is counted by weight or volume, which is what makes net
     * content compulsory rather than optional (PROD1).
     *
     * The same rule as `CatalogueItemService::requireNetContentOnAWeighedShelf()`, read one step
     * earlier: the server asks the ingredient's default unit for its dimension, and
     * {@link IngredientAdmin.measurementUnit} *is* that unit. `count`, `package` and `serving`
     * shelves need none — `portionFactor` already means something there.
     *
     * `false` while the ingredient list is still loading, or when the chosen ingredient is on a
     * page this screen has not fetched. Withholding the requirement is the honest failure: the
     * server still refuses the save and says why, where guessing `true` would block a save that is
     * in fact legal.
     */
    const producedShelfWeighed =
        producedIngredient !== null &&
        !['count', 'package', 'serving'].includes(
            unitDimension(producedIngredient.measurementUnit),
        );

    const netContentText = details.netContentQuantity.trim();
    const netContent = netContentText === '' ? null : parseQuantity(netContentText);
    const netContentInvalid = netContentText !== '' && (netContent === null || netContent <= 0);
    /*
     * A number with no unit is not half an answer the server keeps — it silently nulls both, to
     * match the table's own CHECK. Blocking here is what turns that into something a person can
     * see, rather than a figure that vanishes on save.
     */
    const netContentUnitMissing = netContentText !== '' && details.netContentUnitId === null;
    const netContentRequired =
        details.sellsFromFinishedStock && producedShelfWeighed && netContentText === '';

    const detailsBlocked =
        nameMissing ||
        portionInvalid ||
        netContentInvalid ||
        netContentUnitMissing ||
        netContentRequired;

    /**
     * Everything standing between this meal and a public listing.
     *
     * Split from the quarantine deliberately: a blocker is something a person can fix here and now,
     * while a quarantine is a fact about the record that publication is refused from structurally.
     * Unsaved changes are a blocker because publishing publishes what the server holds, not what is
     * on screen — the same rule the recipe editor states.
     *
     * **Meal types are not one of them**, and that is a statement about the contract rather than a
     * relaxation. Nothing on `catalogue_items` records whether a dish is a breakfast or a dinner —
     * the marketplace names `meal_types` among the filters it accepts and cannot honour, and the
     * admin item shape has no field for it — so `MealAdmin.mealTypes` is empty for every meal this
     * API can answer with. Blocking on it disabled the confirm button of every publish dialog in the
     * workspace behind a reason nobody could clear. The gates that are real live on the server
     * (`CatalogueItemReadiness`), and its refusal is rendered below.
     */
    const publishBlockers = useMemo(() => {
        if (data === undefined) return [];
        const reasons: string[] = [];
        if (isTranslationIncomplete(data.name)) reasons.push(t('kitchen:meals.blockName'));
        // A half-translated *description* no longer blocks publication. The public page falls back
        // to English for it, which is a degraded listing rather than a wrong one — unlike the name,
        // which is what a shopper searches and scans by. The readiness evaluator on the server is
        // still the authority on everything it refuses.
        if (data.availability.length === 0) reasons.push(t('kitchen:meals.blockServiceDays'));
        if (detailsDirty || daysDirty) reasons.push(t('kitchen:meals.blockUnsaved'));
        return reasons;
    }, [data, detailsDirty, daysDirty, t]);

    /**
     * The same three predicates as {@link publishBlockers}, shaped for the gate rail: a labelled
     * pass/fail row each, with the blocker sentence as the failing row's fix-note. Derived, never a
     * fourth source of truth — the rail's dots and the publish button disable together.
     */
    const gateChecks = useMemo(
        () => [
            {
                key: 'name',
                label: t('kitchen:meals.gateCheckName'),
                passed: !isTranslationIncomplete(data?.name ?? details.name),
                note: t('kitchen:meals.blockName'),
            },
            {
                key: 'saved',
                label: t('kitchen:meals.gateCheckSaved'),
                passed: !(detailsDirty || daysDirty),
                note: t('kitchen:meals.blockUnsaved'),
            },
            {
                key: 'serviceDays',
                label: t('kitchen:meals.gateCheckServiceDays'),
                passed: (data?.availability.length ?? days.length) > 0,
                note: t('kitchen:meals.blockServiceDays'),
            },
        ],
        [data, details.name, days.length, detailsDirty, daysDirty, t],
    );

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    /**
     * The finished-stock chain as a request fragment, shared by the create and update branches.
     *
     * Every key is sent on every save, `null` included — these are not optional-on-the-wire fields
     * being omitted, they are four settings whose cleared state is a real answer. Clearing the
     * produced item must reach the server as `null`, or a meal could never be taken back off a
     * shelf. The one asymmetry is the net-content pair: a quantity the person has half-typed goes
     * as a pair or not at all, which is the all-or-nothing the column's own CHECK states.
     */
    const finishedStockRequest = {
        productionMode: details.productionMode,
        ingredientId: details.ingredientId,
        sellsFromFinishedStock: details.sellsFromFinishedStock,
        netContentQuantity:
            netContent === null || details.netContentUnitId === null ? null : netContent,
        netContentUnitId: netContent === null ? null : details.netContentUnitId,
    };

    const saveDetails = () => {
        if (detailsBlocked || portion === null) return;
        if (data === undefined) return;
        update.mutate(
            {
                mealId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    name: details.name,
                    description: details.description,
                    // No recipe: the page is the recipe, and the writer sends only what it is given.
                    portionFactor: portion,
                    mealTypes: details.mealTypes,
                    // Echoed back untouched so a save here cannot clear a classification set
                    // elsewhere — see the note on DetailsDraft.
                    dietClassifications: data.dietClassifications,
                    ...finishedStockRequest,
                },
            },
            {
                onSuccess: () => {
                    settle(false, daysDirty);
                    toast.show({
                        testID: 'kitchen-meal-saved-toast',
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

    const saveAvailability = () => {
        if (data === undefined || dayErrors.size > 0) return;

        setAvailability.mutate(
            {
                mealId: data.id,
                request: {
                    lockVersion: data.meta.lockVersion,
                    days: availabilityRequestDays(days),
                },
            },
            {
                onSuccess: () => {
                    settle(detailsDirty, false);
                    toast.show({
                        testID: 'kitchen-meal-availability-saved-toast',
                        tone: 'success',
                        message: t('kitchen:availability.savedToast'),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (record.isPending) {
        return (
            <FormSkeleton
                testID="kitchen-meal-editor-loading"
                partTestID="kitchen-meal"
                sections={3}
                heading={false}
            />
        );
    }

    const loadFailure = toFailure(record.error);
    if (loadFailure !== null) {
        return (
            <Stack space="lg" testID="kitchen-meal-editor-screen">
                <ErrorState
                    testID="kitchen-meal-load-error"
                    failure={loadFailure}
                    title={t('kitchen:meals.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const saveFailure = toFailure(update.error);
    const availabilityFailure = toFailure(setAvailability.error);
    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishRefusedByStatus = Object.keys(publishFields).includes('status');
    const quarantined = data?.meta.status === 'review_required';
    const isPublished = data?.meta.status === 'published';

    return (
        <EditorFrame
            testID="kitchen-meal-editor-screen"
            title={t('kitchen:meals.editTitle')}
            meta={data?.meta ?? null}
            guard={guard}
            concurrency={concurrency}
            onSaveDraft={saveDetails}
            saveLabel={t('kitchen:common.saveDraft')}
            saving={update.isPending}
            saveDisabled={!canManage || detailsBlocked}
            backLabel={t('kitchen:common.cancel')}
            onBack={() => {
                router.push('/kitchen/recipes?kind=meal' as never);
            }}
            actionsPlacement="header"
            headerVariant="plain"
            embedded
            rail={
                /*
                 * Three cards, in the order the handoff stacks them: what stops publication, what
                 * the recipe decided, and the number nobody outside the kitchen sees. All three
                 * render on an unsaved meal too — an empty gate and two empty states say more about
                 * what this record still needs than a blank column does.
                 */
                <Stack space="md">
                    <GateRailCard
                        testID="kitchen-meal-gate"
                        title={t('kitchen:meals.gateTitle')}
                        checks={gateChecks}
                        action={
                            !canManage || isPublished ? undefined : (
                                <Button
                                    testID="kitchen-meal-publish"
                                    label={t('kitchen:publish.action')}
                                    // The acceptance check: visibly disabled while any gate check
                                    // fails. The dialog's confirm keeps the same guard.
                                    disabled={publishBlockers.length > 0 || quarantined}
                                    onPress={() => {
                                        setShowPublish(true);
                                    }}
                                />
                            )
                        }
                    />

                    {/*
                     * Derived and frozen — see the module note. The provenance line stays because
                     * "which version of the recipe is this label from?" is the question a person has
                     * when the label and the recipe disagree.
                     */}
                    <View
                        testID="kitchen-meal-allergens"
                        className="gap-2 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
                    >
                        <Inline space="xs" align="center" wrap>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:meals.allergensRailTitle')}
                            </Text>
                            <Badge
                                testID="kitchen-meal-allergens-source"
                                tone="neutral"
                                label={t('kitchen:meals.allergensFromRecipe')}
                            />
                        </Inline>

                        {data === undefined || data.allergens.length === 0 ? (
                            <Text
                                testID="kitchen-meal-allergens-none"
                                variant="caption"
                                tone="secondary"
                            >
                                {t('kitchen:meals.allergensRailEmpty')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {data.allergens.map((code) => (
                                    <Badge
                                        key={code}
                                        testID={`kitchen-meal-allergen-${String(code)}`}
                                        tone="danger"
                                        label={String(code)}
                                    />
                                ))}
                            </Inline>
                        )}

                        <Text
                            testID="kitchen-meal-allergens-provenance"
                            variant="caption"
                            tone="secondary"
                        >
                            {data?.recipeVersionId == null
                                ? t('kitchen:meals.allergensRailFrozen')
                                : t('kitchen:meals.allergensProvenance', {
                                      version: String(data.recipeVersionId),
                                  })}
                        </Text>
                    </View>

                    <View
                        testID="kitchen-meal-confidential"
                        className="gap-2 rounded-panel border border-brand-100 bg-surface-raised p-4 shadow-elevation-card"
                    >
                        <Inline space="xs" align="center" wrap>
                            <Text variant="micro" tone="secondary">
                                {t('kitchen:meals.marginRailTitle')}
                            </Text>
                            <Badge
                                testID="kitchen-meal-confidential-badge"
                                tone="danger"
                                icon="eyeOff"
                                label={t('kitchen:meals.confidential')}
                            />
                        </Inline>

                        {data?.marginPercent == null ? (
                            <>
                                <Text
                                    testID="kitchen-meal-margin-unknown"
                                    variant="bodyStrong"
                                    tone="secondary"
                                >
                                    {t('kitchen:meals.marginEmpty')}
                                </Text>
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:meals.marginUnknown')}
                                </Text>
                            </>
                        ) : (
                            <Text testID="kitchen-meal-margin" variant="bodyStrong">
                                {t('kitchen:meals.marginValue', { percent: data.marginPercent })}
                            </Text>
                        )}
                    </View>
                </Stack>
            }
            primaryAction={
                !canManage ? null : (
                    <Inline space="xs" wrap justify="end">
                        {isPublished ? (
                            <Button
                                testID="kitchen-meal-retire"
                                variant="secondary"
                                label={t('kitchen:meals.retire')}
                                onPress={() => {
                                    setShowRetire(true);
                                }}
                            />
                        ) : // Publish lives on the gate rail now, beside the checks that gate it.
                        null}
                    </Inline>
                )
            }
            banner={
                <Stack space="sm">
                    {quarantined ? (
                        <Callout
                            testID="kitchen-meal-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {/*
                     * The proof, offered where it is useful. In this world the marketplace reads
                     * the same catalogue, so this link goes to the page a customer sees — which is
                     * the only way the person who pressed Publish can check what they published.
                     */}
                    {isPublished && data !== undefined ? (
                        <Callout
                            testID="kitchen-meal-published"
                            role="note"
                            tone="success"
                            title={t('kitchen:meals.publishedTitle')}
                            body={t('kitchen:meals.publishedBody')}
                            actions={
                                <Button
                                    testID="kitchen-meal-view-public"
                                    size="sm"
                                    variant="secondary"
                                    label={t('kitchen:meals.viewPublic')}
                                    onPress={() => {
                                        guard.intercept(() => {
                                            router.push(`/meals/${String(data.id)}` as never);
                                        });
                                    }}
                                />
                            }
                        />
                    ) : null}

                    {data?.meta.status === 'retired' ? (
                        <Callout
                            testID="kitchen-meal-retired"
                            role="note"
                            tone="info"
                            title={t('kitchen:meals.retiredTitle')}
                            body={t('kitchen:meals.retiredBody')}
                        />
                    ) : null}

                    {saveFailure === null ? null : (
                        <Callout
                            testID="kitchen-meal-save-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:editor.saveError')}
                            body={saveFailure.message}
                        />
                    )}
                </Stack>
            }
        >
            {/*
             * One panel, three ruled sections — not four stacked cards.
             *
             * `EditorFrame` already draws the panel around these children, so every `Card` in here
             * was a second rectangle inside the first. `FormSection` is the treatment the handoff
             * asks for and the one the Catalogue already standardised on: a title, a
             * hairline, and the fields. See `forms/form-section.tsx` for why that beats a panel.
             */}
            {/*
             * 12px, not 24. `FormSection` already draws 24px under its own hairline and 12px under
             * its title, so a `loose` container gap on top of that put 48px of nothing between a
             * chip row and the rule below it — a third of the panel spent on separation. This is
             * the space above each rule only; the section owns everything after it.
             */}
            <View className="z-auto flex-col gap-snug">
                {/* ── identity ─────────────────────────────────────────────────────────────── */}
                <FormSection
                    first
                    testID="kitchen-meal-details"
                    title={t('kitchen:meals.sectionIdentity')}
                >
                    <Stack space="md">
                        <BilingualField
                            testID="kitchen-meal-name"
                            layout="fill"
                            fieldLabel={t('kitchen:fields.name')}
                            value={details.name}
                            requiredEnglish
                            {...(nameMissing
                                ? { englishError: t('kitchen:meals.nameRequired') }
                                : {})}
                            onChange={(next) => {
                                setDetails({ ...details, name: next });
                                markDetailsDirty();
                            }}
                        />

                        <BilingualField
                            testID="kitchen-meal-description"
                            layout="fill"
                            fieldLabel={t('kitchen:meals.descriptionLabel')}
                            multiline
                            value={details.description}
                            onChange={(next) => {
                                setDetails({ ...details, description: next });
                                markDetailsDirty();
                            }}
                        />

                        {/*
                         * The portion this listing sells, relative to one serving of the recipe the
                         * page is — half a portion of the same dish takes half its ingredients off the
                         * shelf and carries half its nutrition.
                         */}
                        <TextInputField
                            testID="kitchen-meal-portion"
                            id="kitchen-meal-portion"
                            label={t('kitchen:meals.portionLabel')}
                            hint={t('kitchen:meals.portionHint')}
                            value={details.portionFactor}
                            inputMode="decimal"
                            required
                            disabled={!canManage}
                            {...(portionInvalid
                                ? { error: t('kitchen:meals.portionInvalid') }
                                : {})}
                            onChangeText={(next) => {
                                setDetails({ ...details, portionFactor: next });
                                markDetailsDirty();
                            }}
                        />
                    </Stack>
                </FormSection>

                {/* ── production and finished stock ────────────────────────────────────────── */}
                {/*
                 * The chain the server checks, in the order it checks it (PROD1). A meal sells one
                 * of two ways: cooked when ordered, which explodes its recipe onto the raw-material
                 * shelves, or made in advance, which draws the finished item's own shelf instead.
                 * The second is what the toggle sets, and it is refused until the two fields above
                 * it qualify — so they are here, above it, rather than in an API call.
                 *
                 * Nothing is cleared on switching off, for the reason the ingredient editor's sale
                 * panel states: a meal taken off finished stock for a season keeps the item and the
                 * net content it had, and putting it back is one switch rather than one switch and
                 * two fields somebody has to find again.
                 */}
                <FormSection
                    testID="kitchen-meal-production"
                    title={t('kitchen:meals.sectionProduction')}
                    aside={
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:meals.sectionProductionHint')}
                        </Text>
                    }
                >
                    <Stack space="md">
                        <View className="z-auto flex-col gap-base md:flex-row">
                            <View className="z-auto min-w-0 flex-1">
                                <Select
                                    testID="kitchen-meal-production-mode"
                                    id="kitchen-meal-production-mode"
                                    label={t('kitchen:meals.productionModeLabel')}
                                    hint={t('kitchen:meals.productionModeHint')}
                                    disabled={!canManage}
                                    options={productionModeOptions}
                                    value={details.productionMode ?? NO_MODE}
                                    onChange={(next) => {
                                        setDetails({
                                            ...details,
                                            productionMode:
                                                next === NO_MODE ? null : (next as ProductionMode),
                                        });
                                        markDetailsDirty();
                                    }}
                                />
                            </View>

                            <View className="z-auto min-w-0 flex-1">
                                <Select
                                    testID="kitchen-meal-produced-ingredient"
                                    id="kitchen-meal-produced-ingredient"
                                    label={t('kitchen:meals.producedIngredientLabel')}
                                    hint={t('kitchen:meals.producedIngredientHint')}
                                    searchable
                                    disabled={!canManage}
                                    options={ingredientOptions}
                                    value={details.ingredientId ?? NO_INGREDIENT}
                                    onChange={(next) => {
                                        setDetails({
                                            ...details,
                                            ingredientId: next === NO_INGREDIENT ? null : next,
                                        });
                                        markDetailsDirty();
                                    }}
                                />
                            </View>
                        </View>

                        <Switch
                            testID="kitchen-meal-finished-stock"
                            id="kitchen-meal-finished-stock"
                            label={t('kitchen:meals.finishedStockToggleLabel')}
                            /*
                             * When the chain is incomplete the state label says which link is
                             * missing instead of which way the switch is set — the switch cannot be
                             * set, and "Off" would be a true answer to a question nobody asked. The
                             * wording is the server's own refusal, so pressing save later says the
                             * same thing this said first.
                             */
                            stateLabel={
                                finishedStockBlockedReason ??
                                (details.sellsFromFinishedStock
                                    ? t('kitchen:meals.finishedStockOn')
                                    : t('kitchen:meals.finishedStockOff'))
                            }
                            checked={details.sellsFromFinishedStock}
                            disabled={!canManage || finishedStockBlockedReason !== null}
                            onChange={(next) => {
                                setDetails({ ...details, sellsFromFinishedStock: next });
                                markDetailsDirty();
                            }}
                        />

                        {/*
                         * Net content is asked only once the meal actually sells from a shelf — it
                         * is the conversion between a sold unit and that shelf's unit, and there is
                         * nothing to convert until there is a shelf. Same `sc-if` shape as the sale
                         * prices in the ingredient editor, and the same refusal to clear on hiding.
                         */}
                        {!details.sellsFromFinishedStock ? null : unitsUnavailable ? (
                            <Callout
                                testID="kitchen-meal-net-content-unavailable"
                                tone="info"
                                title={t('kitchen:meals.netContentLabel')}
                                body={t('kitchen:meals.netContentUnitsForbidden')}
                            />
                        ) : (
                            <View className="z-auto flex-col gap-base md:flex-row">
                                <View className="z-auto min-w-0 flex-1">
                                    <TextInputField
                                        testID="kitchen-meal-net-content"
                                        id="kitchen-meal-net-content"
                                        label={t('kitchen:meals.netContentLabel')}
                                        hint={t('kitchen:meals.netContentHint')}
                                        value={details.netContentQuantity}
                                        inputMode="decimal"
                                        required={producedShelfWeighed}
                                        disabled={!canManage}
                                        {...(netContentInvalid
                                            ? { error: t('kitchen:meals.netContentInvalid') }
                                            : netContentRequired
                                              ? { error: t('kitchen:meals.netContentRequired') }
                                              : {})}
                                        onChangeText={(next) => {
                                            setDetails({ ...details, netContentQuantity: next });
                                            markDetailsDirty();
                                        }}
                                    />
                                </View>

                                <View className="z-auto min-w-0 flex-1">
                                    <Select
                                        testID="kitchen-meal-net-content-unit"
                                        id="kitchen-meal-net-content-unit"
                                        label={t('kitchen:meals.netContentUnitLabel')}
                                        searchable
                                        disabled={!canManage}
                                        options={unitOptions}
                                        value={details.netContentUnitId ?? ''}
                                        {...(netContentUnitMissing
                                            ? { error: t('kitchen:meals.netContentUnitMissing') }
                                            : {})}
                                        onChange={(next) => {
                                            setDetails({ ...details, netContentUnitId: next });
                                            markDetailsDirty();
                                        }}
                                    />
                                </View>
                            </View>
                        )}
                    </Stack>
                </FormSection>

                {/* ── where it sits in the day ──────────────────────────────────────────────── */}
                {/*
                 * Chips rather than a multi-select: the vocabulary is a short, closed platform enum
                 * and every value is worth seeing at once — "is this a snack as well as a lunch?" is
                 * answered by looking, not by opening a dialog. `Select` in this design system is a
                 * single-answer modal radio group, so it could not express this without being made
                 * to lie about the interaction.
                 */}
                <FormSection
                    testID="kitchen-meal-types-section"
                    title={t('kitchen:meals.sectionWhen')}
                    aside={
                        <Text variant="caption" tone="secondary">
                            {t('kitchen:meals.sectionWhenHint')}
                        </Text>
                    }
                >
                    <Inline space="xs" wrap testID="kitchen-meal-types">
                        {MEAL_TYPES.map((type) => (
                            <FilterChip
                                key={type}
                                testID={`kitchen-meal-type-${type}`}
                                size="sm"
                                label={t(mealTypeKey(type))}
                                selected={details.mealTypes.includes(type)}
                                disabled={!canManage}
                                onChange={(selected) => {
                                    setDetails({
                                        ...details,
                                        mealTypes: selected
                                            ? [...details.mealTypes, type]
                                            : details.mealTypes.filter((entry) => entry !== type),
                                    });
                                    markDetailsDirty();
                                }}
                            />
                        ))}
                    </Inline>
                </FormSection>

                {/* ── source transcription ──────────────────────────────────────────────────── */}
                {data?.composition == null && data?.kitchenCategory == null ? null : (
                    <FormSection
                        testID="kitchen-meal-composition"
                        title={t('kitchen:fields.composition')}
                    >
                        <Stack space="xs">
                            {data.kitchenCategory === null ? null : (
                                <Text
                                    testID="kitchen-meal-composition-category"
                                    variant="caption"
                                    tone="secondary"
                                >
                                    {data.kitchenSubcategory === null
                                        ? data.kitchenCategory
                                        : `${data.kitchenCategory} / ${data.kitchenSubcategory}`}
                                </Text>
                            )}
                            {data.composition === null ? null : (
                                <Text testID="kitchen-meal-composition-text">
                                    {data.composition}
                                </Text>
                            )}
                        </Stack>
                    </FormSection>
                )}

                {/* ── service days ──────────────────────────────────────────────────────────── */}
                <FormSection
                    testID="kitchen-meal-availability"
                    title={t('kitchen:availability.sectionServiceDays')}
                    aside={
                        <Text
                            testID="kitchen-meal-availability-count"
                            variant="caption"
                            tone="secondary"
                        >
                            {days.length === 0
                                ? t('kitchen:availability.noneYet')
                                : t('kitchen:availability.dayCount', { count: days.length })}
                        </Text>
                    }
                    actions={
                        !canManage ? undefined : (
                            <Button
                                testID="kitchen-meal-availability-add"
                                size="sm"
                                variant="secondary"
                                label={t('kitchen:availability.addDay')}
                                onPress={() => {
                                    setDays([...days, emptyAvailabilityDay(takeDayKey())]);
                                    markDaysDirty();
                                }}
                            />
                        )
                    }
                >
                    <Stack space="md">
                        {availabilityFailure === null ? null : (
                            <Callout
                                testID="kitchen-meal-availability-error"
                                role="alert"
                                tone="danger"
                                title={t('kitchen:availability.saveError')}
                                body={availabilityFailure.message}
                            />
                        )}

                        {days.length === 0 ? (
                            <EmptyState
                                testID="kitchen-meal-availability-empty"
                                title={t('kitchen:availability.emptyTitle')}
                                body={t('kitchen:availability.emptyBody')}
                            />
                        ) : (
                            <MealAvailabilityEditor
                                testID="kitchen-meal-availability-editor"
                                rows={days}
                                errors={dayErrors}
                                canManage={canManage}
                                onChange={(next) => {
                                    setDays(next);
                                    markDaysDirty();
                                }}
                            />
                        )}

                        {/*
                         * Availability saves separately from the record — a different endpoint and
                         * a different lock — so its control appears once there is something to
                         * save, rather than sitting under an untouched empty state.
                         */}
                        {!canManage || !daysDirty ? null : (
                            <Inline space="sm" wrap justify="end">
                                <Button
                                    testID="kitchen-meal-availability-save"
                                    variant="secondary"
                                    label={t('kitchen:availability.save')}
                                    loading={setAvailability.isPending}
                                    disabled={setAvailability.isPending || dayErrors.size > 0}
                                    onPress={saveAvailability}
                                />
                            </Inline>
                        )}
                    </Stack>
                </FormSection>
            </View>

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-meal-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:meals.publishTitle')}
                description={t('kitchen:meals.publishBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-meal-publish-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-meal-publish-confirm"
                            label={t('kitchen:publish.confirm')}
                            loading={publish.isPending}
                            disabled={publishBlockers.length > 0 || quarantined}
                            onPress={() => {
                                if (data === undefined) return;
                                publish.mutate(
                                    {
                                        mealId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: (published) => {
                                            setShowPublish(false);
                                            toast.show({
                                                testID: 'kitchen-meal-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:meals.publishedToast', {
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
                    <Text testID="kitchen-meal-publish-consequence">
                        {t('kitchen:meals.publishConsequence')}
                    </Text>

                    <Stack space="xs" testID="kitchen-meal-publish-allergens">
                        <Text variant="label">{t('kitchen:meals.publishAllergensTitle')}</Text>
                        {data === undefined || data.allergens.length === 0 ? (
                            <Text
                                testID="kitchen-meal-publish-allergens-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:meals.publishAllergensNone')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap>
                                {data.allergens.map((code) => (
                                    <Badge
                                        key={code}
                                        testID={`kitchen-meal-publish-allergen-${String(code)}`}
                                        tone="danger"
                                        label={String(code)}
                                    />
                                ))}
                            </Inline>
                        )}
                    </Stack>

                    {quarantined ? (
                        <Callout
                            testID="kitchen-meal-publish-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID="kitchen-meal-publish-blocked"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:meals.publishBlockedTitle')}
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
                                    ? 'kitchen-meal-publish-refused-quarantine'
                                    : 'kitchen-meal-publish-failed'
                            }
                            role="alert"
                            tone={publishRefusedByStatus ? 'warning' : 'danger'}
                            title={
                                publishRefusedByStatus
                                    ? t('kitchen:publish.quarantineTitle')
                                    : t('kitchen:publish.failedTitle')
                            }
                            body={publishFailure.message}
                        />
                    )}
                </Stack>
            </Dialog>

            {/* ── retire ───────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-meal-retire-dialog"
                open={showRetire}
                onClose={() => {
                    setShowRetire(false);
                }}
                title={t('kitchen:meals.retireTitle')}
                description={t('kitchen:meals.retireBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-meal-retire-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowRetire(false);
                            }}
                        />
                        <Button
                            testID="kitchen-meal-retire-confirm"
                            variant="danger"
                            label={t('kitchen:meals.retireConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                retire.mutate(
                                    {
                                        mealId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowRetire(false);
                                            toast.show({
                                                testID: 'kitchen-meal-retired-toast',
                                                tone: 'success',
                                                message: t('kitchen:meals.retiredToast', {
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
                <Text testID="kitchen-meal-retire-consequence">
                    {t('kitchen:meals.retireConsequence')}
                </Text>
            </Dialog>
        </EditorFrame>
    );
}
