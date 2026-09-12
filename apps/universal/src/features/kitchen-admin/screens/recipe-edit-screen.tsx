import { PACKAGING_CATEGORY_CODE, isValidationFailure } from '@healthy360/api-client/contracts';
import type {
    CostAmount,
    IngredientAdmin,
    LocalisedText,
    RecipeAdmin,
    RecipeLineInput,
    RecipePackagingLineInput,
    RecipeRollupDraft,
    RecipeVersionAdmin,
    RecipeVersionSummary,
    ReferenceSeries,
} from '@healthy360/api-client/contracts';
import {
    Badge,
    Button,
    Callout,
    Card,
    Dialog,
    ErrorState,
    FormGrid,
    FormSection,
    Icon,
    Inline,
    QuantityInput,
    Select,
    Skeleton,
    Stack,
    Tabs,
    Tag,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { CardTone, SelectOption, TagTone } from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { IngredientId } from '@healthy360/domain-types';
import type { CurrencyCode } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import type { MeasureUnit, NutritionFacts } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    ingredientsFromPages,
    useCreateRecipeMutation,
    useIngredientsByIds,
    useIngredientsQuery,
    useNextReferenceQuery,
    useOpenRecipeDraftMutation,
    usePublishRecipeMutation,
    useRecipeQuery,
    useRecipeRollupQuery,
    useRecipeTechnicalSheetQuery,
    useRetireRecipeMutation,
    useSetRecipeLinesMutation,
    useSetRecipePackagingMutation,
    useUpdateRecipeMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { DerivedPanel } from '../catalogue/derived-panel.tsx';
import type { DerivedFigure } from '../catalogue/derived-panel.tsx';
import { CATALOGUE_MANAGE_PERMISSION, CATALOGUE_VIEW_PERMISSION } from '../entity-registry.ts';
import {
    amountToInput,
    costPerPackage,
    currencySymbol,
    displayName,
    formatMoney,
    isTranslationIncomplete,
    lineCost,
    marginPercent,
    parseAmount,
    parseQuantity,
    statusKey,
    statusShortKey,
    statusTone,
    unitShortKey,
} from '../format.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import { RecipeLineTable, ingredientEntry, packagingEntry } from '../recipe-line-table.tsx';
import type { PickerEntry } from '../recipe-line-table.tsx';
import type { LineDraft } from '../recipe-line-table.tsx';
import { TechnicalSheetPanel } from '../technical-sheet-panel.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/recipes/{recipe}` — the recipe editor, as `Catalogue.dc.html` draws it (`isRecipeEdit`,
 * around line 313).
 *
 * It is also what `/kitchen/sauces/{item}` and `/kitchen/dressings/{item}` draw. A sauce is cooked
 * and owns a recipe of its own — the import writes one per SC-/DR- row — so the questions asked of
 * one are these questions, and `CookedItemEditScreen` resolves the catalogue item to its recipe and
 * hands it here with `withoutPackaging`. Four tabs there, five here; everything else is identical
 * because it is the same component rather than a copy of it.
 *
 * ```
 * Kitchen workspace › Recipes › Thousand Islands   <- the shell's trail
 * Thousand Islands  DRAFT  RESTRICTED       [ Discard ] [ Save draft ] [ Publish ]
 * RC-0104 · Production · yields 1.7 kg · 9 raw materials · 6.66 SAR/kg
 * ── Description │ Production 9 │ Packaging 3 │ Costing │ Technical sheet ────────
 * ```
 *
 * Five tabs, in the design's order. The two-pane layout this replaced put the formulation on the
 * left and the derived label on the right; the design splits the same material along a different
 * seam — by *what you came to do* rather than by cause and effect — and the seam is better on a
 * sheet with nine lines, three packaging rows and a cost cascade, because none of those three fit
 * beside each other and all of them fit alone.
 *
 * What the right-hand roll-up pane used to say lives on **Technical sheet** now: the derived
 * nutrients, the inherited allergen classes and the print view, in one place instead of two.
 *
 * ## The design draws six fields this contract cannot store
 *
 * Category, Shelf life and Storage on Description, and the Selling price, Packaging waste and
 * packaging lines on Costing, exist in the prototype's own state and nowhere on
 * `KitchenAdminRepository`. `UpdateRecipeRequest` is name, description, yield, yield unit, yield
 * pieces and waste percent — that is the whole writable surface of a recipe.
 *
 * They are handled two different ways, on purpose:
 *
 * - **Category, Shelf life and Storage are simply not drawn.** A `Select` that wrote nowhere is a
 *   control that lies twice — once when you set it, again when it comes back empty. The ingredient
 *   editor made the same call about the four fields the design dropped from it.
 * - **Packaging and its two coefficients *are* drawn, and say plainly that they do not persist.**
 *   They are not a field on a record, they are a whole costing model the kitchen's own sheets are
 *   built on (`Recipes Instructions.xlsx` gives packaging its own table, its own total and its own
 *   waste coefficient), and half a cost cascade is not worth drawing. So the tab is real, the
 *   arithmetic is the design's, and a banner states that the figures live in this session only
 *   until the endpoint exists.
 *
 * ## There is no Method section
 *
 * The design's Description tab draws Identity, Yield and Method; this one draws Identity and Yield.
 * The free-text "Preparation notes" box and the ordered step list that stood under it are both gone
 * at the kitchen's request — a formulation is its lines, and the prose was a second place to say
 * what the lines already say.
 *
 * `setRecipeSteps` therefore has no caller here. Steps already on a version are **not** cleared by
 * that: the save writes only the sections it has edited, and a section this screen no longer edits
 * is never in that set. What is lost is the ability to *change* them from here, not the data.
 *
 * `description` follows the notes box out of the form, so it is no longer a publication blocker
 * either — a gate nothing on the screen can clear is a recipe that can never be published.
 *
 * Outputs went the same way. `setRecipeOutputs` makes a version's product stockable as an
 * ingredient, which is a real capability and a rare one; the design draws no editor for it and the
 * kitchen does not want one here. Same rule as the steps — existing outputs are untouched, because
 * a section this screen does not edit is never in the set a save writes.
 *
 * ## Every tab works before the first save
 *
 * Production, Packaging and Technical sheet used to answer "save the recipe first" while creating
 * one, which put the two things a person opens this screen to do — add ingredients, see what they
 * cost — behind a form they had not filled in yet. Lines are now drafted in state on a new recipe
 * and written immediately after `createRecipe` answers, in the same save. The roll-up
 * runs off the draft lines rather than off the record, so Composition and the allergen classes are
 * live too; only the printable sheet waits, because a technical sheet is a snapshot of a version
 * that exists.
 *
 * ## Unit price is a figure on this screen, never a field
 *
 * The design draws the raw-material Unit price in an input box. `RecipeLineInput` carries no money,
 * so it renders as a figure read from the ingredient record — the reasoning is on
 * {@link RecipeLineTable}, where the column lives.
 *
 * ## One save, several writes, and the lock version rebases between them
 *
 * Unchanged from the two-pane editor, and deliberately so: the contract splits a version into four
 * writes — `updateRecipe` for the record and the yield, then a wholesale setter each for lines,
 * outputs and steps — and each answers with the whole `RecipeAdmin` at its **new** lock version. The
 * save runs them in sequence and carries the version forward from one answer to the next. Only the
 * dirty sections are written: every write is an audited act server-side, and a save that rewrote an
 * untouched method would put a false entry in the log.
 *
 * ## A published version is immutable, and the editor says so rather than pretending
 *
 * Editing a published version does not change it — the server opens the next draft and the edit
 * lands there (plan §4.7). So this screen never presents one as editable. The version list on
 * Description renders it read-only with the one control that can actually happen next.
 *
 * ## Costs are confidential
 *
 * `CostAmount` exists on this contract and on no other (plan §4.8). Every figure derived from it is
 * labelled, and the header carries the design's `RESTRICTED` badge on every recipe rather than on
 * the ones somebody remembered to mark.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copies
 * ---------------------------------------------------------------------------------------------- */

interface DetailsDraft {
    readonly name: LocalisedText;
    readonly description: LocalisedText;
    readonly yieldQuantity: string;
    readonly yieldUnit: MeasureUnit;
    readonly yieldPieces: string;
    readonly wastePercent: string;
    /**
     * The two list prices the version is sold at, per unit of yield — trade and consumer.
     *
     * They replace the single "selling price" this tab used to collect, and the replacement is the
     * point rather than a rename: one figure was right for one channel and wrong for the other, so
     * the margin it fed was wrong for the other too. They live in `DetailsDraft` — not beside the
     * session-only packaging fields below — because the contract now has a home for them on the
     * version, which is what makes them saveable at all.
     */
    readonly b2bPrice: string;
    readonly b2cPrice: string;
    /**
     * The kitchen's own filing word for this formulation — `cooking_sauce`, `marinade_prep`.
     *
     * Edited only where a route supplies the vocabulary for it: `/kitchen/recipes` files nothing,
     * because the recipe library has no one list of words to offer, while a sauce is always one of
     * four. The column is free text with no CHECK, so whatever is already stored survives a save
     * from a form that would not have offered it.
     */
    readonly recipeCategory: string;
}

const EMPTY_DETAILS: DetailsDraft = {
    name: { en: '', ar: '' },
    description: { en: '', ar: '' },
    yieldQuantity: '1',
    // Kilograms, always. See the Yield section: the unit is fixed, so the draft never starts in a
    // unit the form has no way to change.
    yieldUnit: 'kg',
    yieldPieces: '',
    wastePercent: '0',
    b2bPrice: '',
    b2cPrice: '',
    recipeCategory: '',
};

function detailsFrom(recipe: RecipeAdmin): DetailsDraft {
    const version = recipe.currentVersion;
    return {
        name: recipe.name,
        description: recipe.description,
        yieldQuantity: String(version.yieldQuantity),
        yieldUnit: version.yieldUnit,
        yieldPieces: version.yieldPieces === null ? '' : String(version.yieldPieces),
        wastePercent: String(version.wastePercent),
        b2bPrice: amountToInput(version.b2bPrice),
        b2cPrice: amountToInput(version.b2cPrice),
        recipeCategory: recipe.recipeCategory ?? '',
    };
}

function linesFrom(version: RecipeVersionAdmin): readonly LineDraft[] {
    return version.lines.map((line, index) => ({
        key: `line-${String(index)}`,
        ingredientId: String(line.ingredientId),
        quantity: String(line.quantity),
        unit: line.unit,
        note: line.sourceDesignation ?? '',
        isOptional: line.isOptional,
    }));
}

/**
 * The version's saved packaging, as the table draws it.
 *
 * The quantity comes back computed for two of the three bases, so this reads what the server
 * stored rather than what the draft asked for — which is the whole reason the setter answers with
 * rows instead of echoing the request.
 */
function packagingFrom(version: RecipeVersionAdmin): readonly LineDraft[] {
    return version.packaging.map((line, index) => ({
        key: `packaging-${String(index)}`,
        ingredientId: String(line.ingredientId),
        quantity: String(line.quantity),
        unit: line.unit,
        note: line.comment ?? '',
        isOptional: false,
    }));
}

/** The lines that are complete enough to send. Incomplete rows block the save instead. */
function lineInputsFrom(rows: readonly LineDraft[]): readonly RecipeLineInput[] {
    return rows.flatMap((row) => {
        const quantity = parseQuantity(row.quantity);
        if (row.ingredientId === null || quantity === null) return [];
        const note = row.note.trim();
        return [
            {
                ingredientId: IngredientId.unsafe(row.ingredientId),
                quantity,
                unit: row.unit,
                ...(note === '' ? {} : { sourceDesignation: note }),
                isOptional: row.isOptional,
            },
        ];
    });
}

/**
 * The distinct catalogue rows a draft names, in the branded shape `useIngredientsByIds` takes.
 *
 * One definition for both tables. Food and packaging are one `ingredients` table again, so the two
 * sets resolve through the same endpoint and differ only in which draft they are read from.
 */
function uniqueIngredientIds(rows: readonly LineDraft[]): readonly IngredientId[] {
    const seen = new Set<string>();
    const found: IngredientId[] = [];
    for (const row of rows) {
        if (row.ingredientId === null || seen.has(String(row.ingredientId))) continue;
        seen.add(String(row.ingredientId));
        found.push(IngredientId.unsafe(row.ingredientId));
    }
    return found;
}

/** Long enough that typing "1250" is one request, short enough to feel like a consequence. */
const ROLLUP_DEBOUNCE_MS = 400;

/**
 * The draft the preview actually runs against.
 *
 * Two speeds, because two kinds of edit deserve two answers. A quantity being *typed* is a stream of
 * intermediate values — `1`, `12`, `125`, `1250` — and previewing each of them would be four
 * requests to show three numbers nobody meant. Adding, removing, reordering or re-uniting a line is
 * a completed decision, and waiting four hundred milliseconds to acknowledge it feels broken.
 *
 * So the *structure* of the line set (which ingredients, in which order, in which units) is compared
 * on every change: different structure runs at once, same structure waits. The policy lives here
 * rather than in the query hook because only the editor knows which edit just happened.
 */
function useDebouncedRollupDraft(draft: RecipeRollupDraft | null): RecipeRollupDraft | null {
    const structure =
        draft === null
            ? 'none'
            : JSON.stringify(draft.lines.map((line) => [String(line.ingredientId), line.unit]));

    const [settled, setSettled] = useState<RecipeRollupDraft | null>(draft);
    const [appliedStructure, setAppliedStructure] = useState<string | null>(null);

    // Adjusted during render rather than in an effect: this is the "immediate" half of the policy,
    // and React's own answer to deriving state from new input. An effect would paint one frame with
    // the previous structure's figures still undimmed, which is exactly the wrong frame to paint.
    if (appliedStructure !== structure) {
        setAppliedStructure(structure);
        setSettled(draft);
    }

    // `draft` is memoised by the caller on its own contents, so it is a legitimate dependency: the
    // timer restarts exactly when the draft changes and never merely because a sibling piece of
    // state did.
    useEffect(() => {
        if (appliedStructure !== structure) return;
        const timer = setTimeout(() => {
            setSettled(draft);
        }, ROLLUP_DEBOUNCE_MS);
        return () => {
            clearTimeout(timer);
        };
    }, [draft, structure, appliedStructure]);

    return settled;
}

/* ------------------------------------------------------------------------------------------------
 * The tabs
 * ---------------------------------------------------------------------------------------------- */

/**
 * The design's five, in its order. A union rather than an array — nothing iterates them; the tab row
 * is built by hand so each entry can carry its own count and testID.
 *
 * Four of them on `/kitchen/sauces/{item}` and `/kitchen/dressings/{item}`, which are this same
 * editor with {@link RecipeEditScreenProps.withoutPackaging}.
 */
type RecipeTab = 'description' | 'production' | 'packaging' | 'costing' | 'sheet';

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface RecipeEditScreenProps {
    /** The route parameter. `'new'` or absent creates. */
    readonly recipe?: string | undefined;
    /**
     * Drop the Packaging tab.
     *
     * The sauce and dressing routes pass it. A sauce owns a recipe of its own — the import writes
     * one per SC-/DR- row — and `/kitchen/sauces/{item}` is this editor over that recipe; what a
     * sauce is *packed* in is its catalogue item's pack variants, a commercial fact on a different
     * record, so the tab that lists the consumables a batch eats has nothing to say there.
     */
    readonly withoutPackaging?: boolean | undefined;
    /**
     * Where Discard and the not-found notice return to. `/kitchen/recipes` unless a host route says
     * otherwise — a sauce opened from `/kitchen/sauces` must go back to the list it came from.
     */
    readonly backTo?: string | undefined;
    /**
     * The filing this route already knows, and the words it offers for the rest of it.
     *
     * `/kitchen/sauces` knows its category is Sauces & marinades before the form is drawn — it is
     * what makes it that page — so the category is stated rather than asked, and what is left to
     * choose is the sub-category. Omitted on `/kitchen/recipes`, where the library spans every
     * family and there is no one list to offer.
     */
    readonly classification?:
        | {
              /** Already decided by the route. Drawn read-only. */
              readonly categoryLabel: string;
              readonly subcategoryLabel: string;
              readonly subcategoryPlaceholder: string;
              readonly options: readonly SelectOption[];
          }
        | undefined;
    /**
     * What to do with a freshly created recipe, instead of routing to `/kitchen/recipes/{id}`.
     *
     * The sauce route uses it to write the catalogue item that sells this formulation and route to
     * *that*, so a sauce created here appears in the list it was created from.
     */
    readonly onCreated?: ((recipe: RecipeAdmin) => void) | undefined;
    /**
     * Which reference series this record numbers in. The recipe library's unless a route says
     * otherwise — a sauce is `SAC-`, a dressing `DRS-`.
     *
     * It drives the Ref. box on the create form. On the sauce and dressing routes the handle it
     * shows is the *item's* — `SAC-044` — because that is the sauce's own handle, the one the list
     * prints and a cook quotes; the recipe behind it keeps a library `RC-` handle of its own, which
     * nobody reads off this screen.
     */
    readonly referenceSeries?: ReferenceSeries | undefined;
}

export function RecipeEditScreen({ recipe, ...rest }: RecipeEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [CATALOGUE_VIEW_PERMISSION] }}
            testID="kitchen-recipe-editor"
        >
            <RecipeEditor recipe={recipe} {...rest} />
        </Gate>
    );
}

function RecipeEditor({
    recipe,
    withoutPackaging = false,
    backTo = '/kitchen/recipes',
    classification,
    onCreated,
    referenceSeries = 'RC-',
}: RecipeEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(CATALOGUE_MANAGE_PERMISSION);

    const isCreating = recipe === undefined || recipe === 'new';
    const parsed = isCreating ? null : RecipeId.safeParse(recipe);

    const record = useRecipeQuery(parsed);
    // Only usable rows reach the pickers: an inactive or archived ingredient stays visible in the
    // catalogue list (greyed) but is not offered to a formulation — the server refuses it anyway,
    // and a picker that offered it would invite the refusal.
    const ingredientsPage = useIngredientsQuery({ limit: 100, statuses: ['published'] });
    const ingredients: readonly IngredientAdmin[] = ingredientsFromPages(
        ingredientsPage.data?.pages,
    );

    const create = useCreateRecipeMutation();
    const update = useUpdateRecipeMutation();
    // Only while creating: a saved record has a reference of its own, and asking what the *next*
    // one would be while looking at it is a question nobody on this screen is asking.
    const nextReference = useNextReferenceQuery(referenceSeries, isCreating);
    const setLines = useSetRecipeLinesMutation();
    const setPackagingLines = useSetRecipePackagingMutation();
    const publish = usePublishRecipeMutation();
    const retire = useRetireRecipeMutation();
    const openDraft = useOpenRecipeDraftMutation();

    const guard = useUnsavedGuard({ message: t('kitchen:unsaved.browserPrompt') });

    const [tab, setTab] = useState<RecipeTab>('description');

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [lines, setLinesDraft] = useState<readonly LineDraft[]>([]);

    /*
     * Session-only, because the contract has no home for either — see the docblock. Held here
     * rather than in `DetailsDraft` so nothing can accidentally post them: `DetailsDraft` is what
     * the save reads, and these two are not in it.
     *
     * The list prices used to sit here as a third. They no longer do: `RecipeVersionAdmin` carries
     * `b2bPrice` and `b2cPrice`, so they belong in the draft the save reads.
     */
    const [packaging, setPackaging] = useState<readonly LineDraft[]>([]);
    const [packagingWaste, setPackagingWaste] = useState('5');

    const [hydratedKey, setHydratedKey] = useState<string | null>(null);
    const [detailsDirty, setDetailsDirty] = useState(false);
    const [linesDirty, setLinesDirty] = useState(false);
    const [packagingDirty, setPackagingDirty] = useState(false);

    const [rowOrdinal, setRowOrdinal] = useState(1);
    const [selectedVersionId, setSelectedVersionId] = useState<RecipeVersionId | null>(null);
    const [showPublish, setShowPublish] = useState(false);
    const [showRetire, setShowRetire] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;
    const anyDirty = detailsDirty || linesDirty || packagingDirty;

    /*
     * One rehydration key for the whole record rather than one per section: `setRecipeLines` against
     * a published version *opens a new version*, so the steps a person is looking at may now belong
     * to a different row entirely. Rebasing the untouched sections together is the only reading that
     * stays true.
     */
    if (data !== undefined && serverKey !== hydratedKey && !anyDirty) {
        setHydratedKey(serverKey);
        setDetails(detailsFrom(data));
        setLinesDraft(linesFrom(data.currentVersion));
        setPackaging(packagingFrom(data.currentVersion));
    }

    /**
     * The packaging draft as the contract states it.
     *
     * Every line goes as `per_batch` with the count somebody typed. The other two bases —
     * `fills_yield` and `per_container` — compute their own quantity from the yield, and this table
     * has no control for choosing between them yet, so declaring one of those here would silently
     * throw away the number in the box. A basis picker is the next thing this tab needs; until it
     * exists, the honest reading of a hand-entered count is "this many per batch".
     */
    const packagingInputs = useMemo(
        (): readonly RecipePackagingLineInput[] =>
            packaging.flatMap((row) => {
                const quantity = parseQuantity(row.quantity);
                if (row.ingredientId === null || quantity === null) return [];
                return [
                    {
                        ingredientId: IngredientId.unsafe(row.ingredientId),
                        basis: 'per_batch' as const,
                        quantity,
                        ...(row.note.trim() === '' ? {} : { comment: row.note.trim() }),
                    },
                ];
            }),
        [packaging],
    );

    const nextKey = useCallback((): string => {
        const key = `row-${String(rowOrdinal)}`;
        setRowOrdinal((current) => current + 1);
        return key;
    }, [rowOrdinal]);

    const markDirty = (section: 'details' | 'lines' | 'packaging') => {
        if (section === 'details') setDetailsDirty(true);
        if (section === 'lines') setLinesDirty(true);
        if (section === 'packaging') setPackagingDirty(true);
        guard.markDirty();
    };

    const settle = () => {
        setDetailsDirty(false);
        setLinesDirty(false);
        setPackagingDirty(false);
        guard.markClean();
    };

    const reload = useCallback(() => {
        setDetailsDirty(false);
        setLinesDirty(false);
        setHydratedKey(null);
        setSaveError(null);
        guard.markClean();
        void record.refetch();
    }, [guard, record]);

    const concurrency = useOptimisticConcurrency({ onReload: reload });

    /* ── the version being looked at ─────────────────────────────────────────────────────────── */

    const versions: readonly RecipeVersionSummary[] = data?.versions ?? [];
    const currentVersion = data?.currentVersion ?? null;
    const selected =
        selectedVersionId === null
            ? (versions.find((version) => version.isCurrent) ?? null)
            : (versions.find((version) => version.id === selectedVersionId) ?? null);
    const isViewingCurrent = selected === null || selected.isCurrent;
    const versionStatus = currentVersion?.status ?? 'draft';
    const isEditable =
        isViewingCurrent && (versionStatus === 'draft' || versionStatus === 'review_required');
    /*
     * True while creating, too: with no record yet `versionStatus` falls back to `draft` and there
     * is no non-current version to be looking at, so a new recipe is editable on every tab. Its
     * lines are drafted in state and written straight after `createRecipe` answers.
     */
    const editable = canManage && isEditable;

    const title = isCreating
        ? t('kitchen:recipes.createTitle')
        : displayName(data?.name ?? { en: '', ar: '' }, locale).value;

    useKitchenTrailLeaf(isCreating || data !== undefined ? title : null);

    /* ── the roll-up preview ─────────────────────────────────────────────────────────────────── */

    const servings = parseQuantity(details.yieldQuantity) ?? 1;
    const wastePercent = parseQuantity(details.wastePercent) ?? 0;
    const lineInputs = useMemo(() => lineInputsFrom(lines), [lines]);

    const rollupDraft: RecipeRollupDraft | null = useMemo(
        () =>
            lineInputs.length === 0
                ? null
                : {
                      recipeId: data?.id ?? null,
                      servings: servings > 0 ? servings : 1,
                      wastePercent,
                      lines: lineInputs,
                  },
        [data?.id, servings, wastePercent, lineInputs],
    );

    // Debounced, so a quantity being typed is one request rather than four — the policy is on
    // `useDebouncedRollupDraft`, and it is what keeps the Technical sheet's figures from flickering
    // through three intermediate values on the way to the one that was meant.
    const previewDraft = useDebouncedRollupDraft(rollupDraft);
    const rollup = useRecipeRollupQuery(previewDraft);
    const technicalSheet = useRecipeTechnicalSheetQuery(
        parsed,
        data === undefined ? null : data.currentVersion.id,
    );

    /* ── option lists ────────────────────────────────────────────────────────────────────────── */

    /*
     * The specific ingredients this recipe's lines name.
     *
     * The page above is the first hundred of several hundred, so a saved line whose ingredient sorts
     * onto page two had no designation and no unit price to render — the other half of "not all
     * ingredients are showing". The picker solves its own half by searching the server; a drawn row
     * cannot search, it knows an id, so the ids are resolved directly.
     *
     * Packaging is resolved the same way below. The show endpoint has no packaging exclusion — the
     * two families are one table again — so a packaging id resolves through it exactly as a food id
     * does, and the note that used to stand here saying otherwise was describing a table that no
     * longer exists.
     */
    const lineIngredientIds = useMemo(() => uniqueIngredientIds(lines), [lines]);
    const packagingIngredientIds = useMemo(() => uniqueIngredientIds(packaging), [packaging]);

    const lineIngredients = useIngredientsByIds(lineIngredientIds);
    const packagingIngredients = useIngredientsByIds(packagingIngredientIds);

    /*
     * One pool, for drawing rows and for costing them: the first page plus every ingredient the
     * lines actually name. Deduped by id — the two sources overlap whenever a line's ingredient
     * happened to be on page one anyway.
     *
     * The pickers are *not* fed from here. Each one searches the catalogue itself and scopes itself
     * by category, which is what makes all of it reachable rather than the hundred rows that
     * happened to arrive first.
     */
    const library = useMemo(() => {
        const byId = new Map<string, IngredientAdmin>();
        for (const entry of ingredients) byId.set(String(entry.id), entry);
        for (const [id, entry] of Object.entries(lineIngredients)) byId.set(id, entry);
        return [...byId.values()];
    }, [ingredients, lineIngredients]);

    /** The same pool, in the shape the line table draws rows from. */
    const libraryEntries = useMemo(
        (): readonly PickerEntry[] => library.map(ingredientEntry),
        [library],
    );

    /*
     * The packaging pool the packaging rows resolve against — same two sources as the food one.
     *
     * It used to be a single *numbered page* of eighteen, on the argument that one page is the whole
     * catalogue. There are thirty-one packaging rows, so rows nineteen onward resolved to nothing: a
     * saved line naming one drew "Unnamed line" with no price, and its cost silently left the
     * cascade. A hundred-row read plus a by-id resolution of whatever the lines name closes both
     * halves, exactly as it does above.
     */
    const packagingCatalogue = useIngredientsQuery({
        limit: 100,
        categoryCode: PACKAGING_CATEGORY_CODE,
    });
    const packagingLibrary = useMemo((): readonly PickerEntry[] => {
        const byId = new Map<string, IngredientAdmin>();
        for (const entry of ingredientsFromPages(packagingCatalogue.data?.pages)) {
            byId.set(String(entry.id), entry);
        }
        for (const [id, entry] of Object.entries(packagingIngredients)) byId.set(id, entry);
        return [...byId.values()].map(packagingEntry);
    }, [packagingCatalogue.data?.pages, packagingIngredients]);

    /* ── the cost cascade, as the design computes it ─────────────────────────────────────────── */

    const costs = useMemo(
        () =>
            costCascade({
                lines,
                packaging,
                ingredients: libraryEntries,
                packagingItems: packagingLibrary,
                yieldQuantity: servings,
                productionWaste: wastePercent,
                packagingWaste: parseQuantity(packagingWaste) ?? 0,
            }),
        [
            lines,
            packaging,
            libraryEntries,
            packagingLibrary,
            servings,
            wastePercent,
            packagingWaste,
        ],
    );

    /*
     * The uncosted lines by name, across both pools.
     *
     * Both, because a row is uncosted for the same two reasons on either tab — no recorded price, or
     * a unit that will not convert — and the reader wants the designation either way. Empty when
     * everything the cascade touched could be costed.
     */
    const uncostedNames = costs.uncostedIds
        .map((id) => [...libraryEntries, ...packagingLibrary].find((entry) => entry.id === id))
        .filter((entry): entry is PickerEntry => entry !== undefined)
        .map((entry) => displayName(entry.name, locale).value)
        .join(', ');

    /*
     * Whether a missing currency is "the rows disagree" rather than "nothing is priced yet".
     *
     * `displayCurrency` is null in both cases and only one of them is worth saying out loud. Read off
     * the *rows*, not the pools: a fully priced library under a recipe with no lines is not a
     * currency conflict.
     */
    const anyRowPriced = (rows: readonly LineDraft[], pool: readonly PickerEntry[]): boolean =>
        rows.some((row) => pool.find((entry) => entry.id === row.ingredientId)?.unitPrice != null);
    const anythingPriced =
        anyRowPriced(lines, libraryEntries) || anyRowPriced(packaging, packagingLibrary);

    // Derived rather than read off the record, so the Technical sheet tab answers from the draft.
    const allergenSources = rollup.data?.allergenSources ?? [];

    /* ── the two list prices, and the margin they make against the cascade ───────────────────── */

    /**
     * The currency the two prices are quoted in.
     *
     * Nothing on the session, the organisation or this contract publishes "the currency this
     * kitchen trades in" — the gap `kitchen-admin-hooks.ts` records as 17 — so this resolves it the
     * way the ingredient editor does. The version's own money first, because a priced version has
     * already answered the question; then the money the cascade is already adding up, by frequency,
     * because a price stated in a different currency from the cost beneath it is not comparable to
     * it. `null` means nothing on this screen carries a currency yet, and the fields say so rather
     * than guessing a country's money.
     */
    const currency = useMemo<CurrencyCode | null>(() => {
        const own = [data?.currentVersion.b2bPrice, data?.currentVersion.b2cPrice];
        for (const price of own) {
            if (price !== null && price !== undefined) return price.currency;
        }

        const counts = new Map<CurrencyCode, number>();
        for (const entry of [...libraryEntries, ...packagingLibrary]) {
            if (entry.unitPrice === null) continue;
            counts.set(entry.unitPrice.currency, (counts.get(entry.unitPrice.currency) ?? 0) + 1);
        }

        let best: CurrencyCode | null = null;
        let bestCount = 0;
        for (const [code, count] of counts) {
            if (count > bestCount) {
                best = code;
                bestCount = count;
            }
        }
        return best;
    }, [data, libraryEntries, packagingLibrary]);

    const b2bPriceValue = parseAmount(details.b2bPrice);
    const b2cPriceValue = parseAmount(details.b2cPrice);
    const pricesInvalid = b2bPriceValue === undefined || b2cPriceValue === undefined;

    // A price cannot be written without a currency to write it in, so an amount typed with no
    // currency resolved is a blocked save rather than a guess.
    const currencyMissing =
        currency === null &&
        [b2bPriceValue, b2cPriceValue].some((value) => typeof value === 'number');

    /*
     * The margin is read against `costs.total` — the cost of one yield unit *after* both waste
     * coefficients — and not against the raw line sum. That is the figure the cascade's tinted card
     * states directly above these fields, so the two answer the same question; a margin against the
     * batch total would be a percentage of a different denominator sitting inches from the one it
     * looks like it used.
     *
     * The trade price is the numerator, matching the ingredient editor: the B2C margin is a
     * different conversation (it carries delivery, packaging on the plate, and a channel fee this
     * screen knows nothing about), and stating it here as though it were the same sum would be the
     * confident kind of wrong.
     */
    const margin = marginPercent(b2bPriceValue, costs.total);

    /* ── readiness ───────────────────────────────────────────────────────────────────────────── */

    const incompleteLines = lines.filter(
        (row) => row.ingredientId === null || parseQuantity(row.quantity) === null,
    );
    const nameMissing = details.name.en.trim() === '';
    const yieldInvalid = parseQuantity(details.yieldQuantity) === null || servings <= 0;

    const saveBlocked =
        !canManage ||
        nameMissing ||
        yieldInvalid ||
        pricesInvalid ||
        currencyMissing ||
        incompleteLines.length > 0;

    /**
     * Everything that stands between this version and a published label.
     *
     * Split into two lists on purpose. *Blocking* items are ones where publishing would state
     * something untrue — no formulation at all, an untranslated name a consumer surface would have
     * to fall back on, a label derived from an ingredient that is itself quarantined or withdrawn.
     * The *unmapped* list is different in kind: an ingredient with no allergen mapping is either
     * genuinely free of all fourteen or has never been checked, and this contract cannot tell those
     * two apart. Blocking on it would make every honest olive oil unpublishable; saying nothing
     * would let an unchecked one onto a label. So it is stated, named ingredient by named
     * ingredient, each linked to the editor where the determination is recorded.
     */
    const publishBlockers = useMemo(() => {
        if (data === null || data === undefined) return [] as readonly string[];
        const reasons: string[] = [];
        if (data.currentVersion.lines.length === 0) reasons.push(t('kitchen:publish.blockNoLines'));
        if (isTranslationIncomplete(data.name)) reasons.push(t('kitchen:publish.blockName'));
        // The description is no longer edited here (see the docblock), so it is no longer gated on:
        // a blocker with no control on the screen to clear it is a recipe that can never publish.
        if (anyDirty) reasons.push(t('kitchen:publish.blockUnsaved'));

        const unsafe = data.currentVersion.lines
            .map((line) => ingredients.find((entry) => entry.id === line.ingredientId))
            .filter(
                (entry): entry is IngredientAdmin =>
                    entry !== undefined &&
                    (entry.meta.status === 'review_required' || entry.meta.status === 'retired'),
            );
        for (const entry of unsafe) {
            reasons.push(
                t('kitchen:publish.blockIngredientState', {
                    name: displayName(entry.name, locale).value,
                    status: t(statusKey(entry.meta.status)),
                }),
            );
        }
        return reasons;
    }, [data, anyDirty, ingredients, locale, t]);

    const unmappedIngredients = useMemo(() => {
        if (data === null || data === undefined) return [] as readonly IngredientAdmin[];
        const seen = new Set<string>();
        const rows: IngredientAdmin[] = [];
        for (const line of data.currentVersion.lines) {
            const entry = ingredients.find((candidate) => candidate.id === line.ingredientId);
            if (entry === undefined || entry.allergens.length > 0) continue;
            if (seen.has(String(entry.id))) continue;
            seen.add(String(entry.id));
            rows.push(entry);
        }
        return rows;
    }, [data, ingredients]);

    const quarantined = data?.meta.status === 'review_required';

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    const saveAll = () => {
        if (saveBlocked) return;
        setSaveError(null);

        /** A typed amount as the contract's `CostAmount`, or the null that clears it. */
        const costOf = (value: number | null | undefined): CostAmount | null =>
            typeof value === 'number' && currency !== null ? { amount: value, currency } : null;

        if (isCreating) {
            /*
             * Create, then immediately write whatever was drafted on the other tabs.
             *
             * `createRecipe` takes the record and its yield and nothing else — lines are
             * their own setters and need a recipe id to address. So a new recipe with nine lines is
             * one press and three requests, each rebasing on the lock version the last one answered
             * with, exactly as an edit does. Without this the Production tab could be filled in and
             * then silently lost on the first save, which is worse than not offering it.
             */
            const createAll = async () => {
                const b2b = costOf(b2bPriceValue);
                const b2c = costOf(b2cPriceValue);

                const created = await create.mutateAsync({
                    name: details.name,
                    description: details.description,
                    yieldQuantity: servings,
                    yieldUnit: details.yieldUnit,
                    ...(parseQuantity(details.yieldPieces) === null
                        ? {}
                        : { yieldPieces: parseQuantity(details.yieldPieces)! }),
                    wastePercent,
                    // Omitted rather than sent as null on a create: there is nothing to clear on a
                    // recipe that does not exist yet, and `CreateRecipeRequest` says so by taking
                    // no null.
                    ...(b2b === null ? {} : { b2bPrice: b2b }),
                    ...(b2c === null ? {} : { b2cPrice: b2c }),
                    ...(details.recipeCategory === ''
                        ? {}
                        : { recipeCategory: details.recipeCategory }),
                });

                const drafted = lineInputsFrom(lines);

                let written = created;

                if (drafted.length > 0) {
                    written = await setLines.mutateAsync({
                        recipeId: created.id,
                        request: { lockVersion: created.meta.lockVersion, lines: drafted },
                    });
                }

                // After the lines, on the lock version they returned: both writes bump the record,
                // so sending the stale one here would come back a conflict.
                if (packagingInputs.length > 0) {
                    written = await setPackagingLines.mutateAsync({
                        recipeId: created.id,
                        versionId: written.currentVersion.id,
                        request: {
                            lockVersion: written.meta.lockVersion,
                            packaging: packagingInputs,
                        },
                    });
                }

                return written;
            };

            void createAll().then(
                (created) => {
                    settle();
                    toast.show({
                        testID: 'kitchen-recipe-created-toast',
                        tone: 'success',
                        message: t('kitchen:recipes.createdToast', {
                            name: displayName(created.name, locale).value,
                        }),
                    });
                    if (onCreated !== undefined) {
                        onCreated(created);
                        return;
                    }
                    router.replace(`/kitchen/recipes/${String(created.id)}` as never);
                },
                (error: unknown) => {
                    setSaveError(toFailure(error)?.message ?? t('kitchen:recipes.saveFailed'));
                },
            );
            return;
        }

        if (data === undefined) return;
        const recipeId = data.id;

        const run = async () => {
            // Still carried forward rather than read twice: `updateRecipe` answers at a new version,
            // and the line write that follows has to be based on the one it just produced.
            let lockVersion = data.meta.lockVersion;

            if (detailsDirty) {
                const answer = await update.mutateAsync({
                    recipeId,
                    request: {
                        lockVersion,
                        name: details.name,
                        description: details.description,
                        yieldQuantity: servings,
                        yieldUnit: details.yieldUnit,
                        yieldPieces: parseQuantity(details.yieldPieces),
                        wastePercent,
                        // `null` here is a clear, not an omission — an emptied price box removes
                        // the price rather than leaving the stored one in place.
                        b2bPrice: costOf(b2bPriceValue),
                        b2cPrice: costOf(b2cPriceValue),
                        // Only where the form offered it. A route that draws no picker must not
                        // clear a word it never showed the reader.
                        ...(classification === undefined
                            ? {}
                            : {
                                  recipeCategory:
                                      details.recipeCategory === '' ? null : details.recipeCategory,
                              }),
                    },
                });
                lockVersion = answer.meta.lockVersion;
            }

            if (linesDirty) {
                const written = await setLines.mutateAsync({
                    recipeId,
                    request: { lockVersion, lines: lineInputsFrom(lines) },
                });
                lockVersion = written.meta.lockVersion;
            }

            if (packagingDirty && data !== undefined) {
                await setPackagingLines.mutateAsync({
                    recipeId,
                    versionId: data.currentVersion.id,
                    request: { lockVersion, packaging: packagingInputs },
                });
            }
        };

        void run().then(
            () => {
                settle();
                toast.show({
                    testID: 'kitchen-recipe-saved-toast',
                    tone: 'success',
                    message: t('kitchen:recipes.savedToast'),
                });
            },
            (error: unknown) => {
                if (concurrency.capture(error)) return;
                setSaveError(toFailure(error)?.message ?? t('kitchen:recipes.saveFailed'));
            },
        );
    };

    const goBack = () => {
        router.push(backTo as never);
    };

    /* ── loading, refusal and not-found ──────────────────────────────────────────────────────── */

    if (!isCreating && parsed === null) {
        return (
            <Stack space="md" testID="kitchen-recipe-editor-screen">
                <Callout
                    testID="kitchen-recipe-not-found"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:recipes.notFoundTitle')}
                    body={t('kitchen:recipes.notFoundBody')}
                    actions={
                        <Button
                            testID="kitchen-recipe-not-found-back"
                            variant="quiet"
                            label={t('kitchen:recipes.backToList')}
                            onPress={goBack}
                        />
                    }
                />
            </Stack>
        );
    }

    if (!isCreating && record.isPending) {
        return (
            <Stack space="md" testID="kitchen-recipe-editor-loading">
                <Skeleton testID="kitchen-recipe-skeleton-1" heightClassName="h-8" />
                <Skeleton testID="kitchen-recipe-skeleton-2" heightClassName="h-32" />
                <Skeleton testID="kitchen-recipe-skeleton-3" heightClassName="h-32" />
            </Stack>
        );
    }

    const loadFailure = toFailure(record.error);
    if (!isCreating && loadFailure !== null) {
        return (
            <Stack space="md" testID="kitchen-recipe-editor-screen">
                <ErrorState
                    testID="kitchen-recipe-load-error"
                    failure={loadFailure}
                    title={t('kitchen:recipes.loadErrorTitle')}
                    onRetry={() => {
                        void record.refetch();
                    }}
                    retrying={record.isFetching}
                />
            </Stack>
        );
    }

    const publishFailure = toFailure(publish.error);
    const publishFields =
        publishFailure !== null && isValidationFailure(publishFailure) ? publishFailure.fields : {};
    const publishQuarantined = Object.keys(publishFields).includes('status');

    /* ── the header's own line ───────────────────────────────────────────────────────────────── */

    const summary = [
        data === undefined ? null : data.slug,
        data?.sourceKind ?? null,
        t('kitchen:recipes.summaryYield', {
            quantity: formatter.formatNumber(servings, YIELD_DIGITS),
            unit: t(unitShortKey(details.yieldUnit)),
        }),
        t('kitchen:recipes.summaryLines', { count: lines.length }),
        t('kitchen:recipes.summaryPerUnit', {
            cost: formatMoney(formatter, costs.total, costs.displayCurrency, COST_DIGITS),
            unit: t(unitShortKey(details.yieldUnit)),
        }),
    ]
        .filter((part): part is string => part !== null && part !== '')
        .join(' · ');

    const tabItems = [
        {
            value: 'description' as const,
            label: t('kitchen:recipes.tabDescription'),
            testID: 'kitchen-recipe-tab-description',
        },
        {
            value: 'production' as const,
            label: t('kitchen:recipes.tabProduction'),
            count: lines.length,
            testID: 'kitchen-recipe-tab-production',
        },
        ...(withoutPackaging
            ? []
            : [
                  {
                      value: 'packaging' as const,
                      label: t('kitchen:recipes.tabPackaging'),
                      count: packaging.length,
                      testID: 'kitchen-recipe-tab-packaging',
                  },
              ]),
        {
            value: 'costing' as const,
            label: t('kitchen:recipes.tabCosting'),
            testID: 'kitchen-recipe-tab-costing',
        },
        {
            value: 'sheet' as const,
            label: t('kitchen:recipes.tabSheet'),
            testID: 'kitchen-recipe-tab-sheet',
        },
    ];

    /*
     * The tab row, as an order to walk.
     *
     * Read off `tabItems` rather than written out, so the sauce routes — which drop Packaging — step
     * over four rather than falling into a gap. `-1` is unreachable in practice and still guarded:
     * `indexOf` answering it would disable both controls rather than stepping off the end.
     */
    const order = tabItems.map((item) => item.value);
    const at = order.indexOf(tab);

    return (
        <Stack space="md" testID="kitchen-recipe-editor-screen">
            {/*
             * The opening — title, badges, actions, the meta line and the tab row — is one 4px block
             * inside the page's 16px rhythm, exactly as the ingredient editor and the two lists
             * tighten theirs. No trail here: `KitchenOpsShell` draws it and this screen names its
             * last crumb through `useKitchenTrailLeaf`.
             */}
            <Stack space="xs">
                <CataloguePageHeader
                    testID="kitchen-recipe-editor-screen-header"
                    titleTestID="kitchen-recipe-editor-screen-title"
                    title={title}
                    titleAside={
                        <Inline space="xs" align="center" wrap>
                            <Badge
                                testID="kitchen-recipe-editor-screen-status"
                                tone={data === undefined ? 'neutral' : statusTone(data.meta.status)}
                                label={
                                    data === undefined
                                        ? t('kitchen:statusShort.draft')
                                        : t(statusShortKey(data.meta.status))
                                }
                            />
                            {/*
                             * On every recipe, not on the ones somebody remembered to mark. A
                             * formulation and its costs are confidential by their nature (plan
                             * §4.8), and a badge that appears only sometimes teaches the reader
                             * that its absence means "safe to share".
                             */}
                            <Badge
                                testID="kitchen-recipe-editor-screen-restricted"
                                tone="danger"
                                icon="eyeOff"
                                label={t('kitchen:recipes.restricted')}
                            />
                            {guard.isDirty ? (
                                <Badge
                                    testID="kitchen-recipe-editor-screen-dirty"
                                    tone="warning"
                                    icon="warning"
                                    label={t('kitchen:editor.unsaved')}
                                />
                            ) : null}
                        </Inline>
                    }
                    primaryAction={
                        <Inline space="xs" align="center">
                            {/* The design's Discard · Save draft · Publish, at the header's one `md`. */}
                            <Button
                                testID="kitchen-recipe-editor-screen-discard"
                                variant="secondary"
                                label={t('kitchen:recipes.discard')}
                                onPress={() => {
                                    guard.intercept(goBack);
                                }}
                            />
                            <Button
                                testID="kitchen-recipe-editor-screen-save"
                                variant="secondary"
                                label={t('kitchen:common.saveDraft')}
                                loading={create.isPending || update.isPending || setLines.isPending}
                                disabled={saveBlocked || !isEditable}
                                onPress={saveAll}
                            />
                            {isCreating || !canManage ? null : (
                                <Button
                                    testID="kitchen-recipe-publish"
                                    label={t('kitchen:publish.action')}
                                    disabled={!isEditable}
                                    onPress={() => {
                                        setShowPublish(true);
                                    }}
                                />
                            )}
                        </Inline>
                    }
                />

                <Text
                    testID="kitchen-recipe-editor-screen-summary"
                    tone="secondary"
                    variant="caption"
                >
                    {summary}
                </Text>

                <Tabs<RecipeTab>
                    testID="kitchen-recipe-tabs"
                    label={t('kitchen:recipes.tabsLabel')}
                    items={tabItems}
                    value={tab}
                    onChange={setTab}
                />
            </Stack>

            {quarantined ? (
                <Callout
                    testID="kitchen-recipe-quarantine"
                    role="alert"
                    tone="warning"
                    title={t('kitchen:publish.quarantineTitle')}
                    body={t('kitchen:publish.quarantineBody')}
                />
            ) : null}
            {saveError === null ? null : (
                <Callout
                    testID="kitchen-recipe-save-error"
                    role="alert"
                    tone="danger"
                    title={t('kitchen:recipes.saveErrorTitle')}
                    body={saveError}
                />
            )}

            {/* ── Description ──────────────────────────────────────────────────────────────── */}
            {tab !== 'description' ? null : (
                <>
                    <FormSection
                        first
                        testID="kitchen-recipe-identity"
                        title={t('kitchen:recipes.sectionIdentity')}
                        description={t('kitchen:recipes.identityDescription')}
                    >
                        <FormGrid testID="kitchen-recipe-identity-grid">
                            {/*
                             * Id first, before the designation.
                             *
                             * It is the field a reader identifies the record by and the one they
                             * read back to somebody on the phone, so it opens the section rather
                             * than closing it. Read, never written: the series is the server's to
                             * issue.
                             *
                             * Creating, it is the handle this record is *about* to take, read from
                             * the same scan the save performs. A preview and not a reservation:
                             * two forms open at once are both shown it, and the second save lands
                             * one number later. Empty while it is in flight, and empty if the read
                             * fails — better than a number nothing stands behind.
                             */}
                            <TextInputField
                                testID="kitchen-recipe-reference"
                                id="kitchen-recipe-reference"
                                label={t('kitchen:list.columnReference')}
                                size="sm"
                                placeholder={t('kitchen:fields.referencePlaceholder')}
                                // The record's own `RC-0001`, not its slug: a slug follows the name,
                                // so it moves when the name is edited and sorts alphabetically
                                // rather than by age.
                                value={
                                    isCreating
                                        ? (nextReference.data ?? '')
                                        : (data?.reference ?? '')
                                }
                                disabled
                                onChangeText={() => undefined}
                            />
                            <BilingualField
                                span={2}
                                layout="row"
                                testID="kitchen-recipe-name"
                                // The word the recipe list's own title column uses, so the form
                                // and the table name the same thing the same way.
                                fieldLabel={t('kitchen:recipes.columnName')}
                                value={details.name}
                                requiredEnglish
                                disabled={!editable}
                                {...(nameMissing
                                    ? { englishError: t('kitchen:recipes.nameRequired') }
                                    : {})}
                                onChange={(next) => {
                                    setDetails({ ...details, name: next });
                                    markDirty('details');
                                }}
                            />
                            {/*
                             * Classification — the other half of this section's own title, and
                             * drawn only where the route knows the vocabulary.
                             *
                             * The category is stated, not asked: a form reached through Sauces &
                             * marinades cannot be filed anywhere else, and a picker whose every
                             * other option is wrong is a choice offered only to be a mistake. The
                             * sub-category is the real question, and it is the four words the v6
                             * sheets file these rows under.
                             *
                             * They are two children of the grid, never one wrapper around both:
                             * `FormGrid` gives each *element* child its own cell, and a fragment is
                             * one child — wrapping the pair put them in a single track, stacked,
                             * with the sub-category under the category instead of beside it.
                             *
                             * Before `Ref.`, so the category lands beside the designation the way
                             * the ingredient editor's identity grid places it. The designation pair
                             * claims two of the three tracks, which leaves exactly one next to it,
                             * and the filing is what a reader checks there — a reference they
                             * cannot type is the last thing on the row rather than the middle of it.
                             */}
                            {classification === undefined ? null : (
                                <TextInputField
                                    testID="kitchen-recipe-category"
                                    id="kitchen-recipe-category"
                                    label={t('kitchen:fields.category')}
                                    size="sm"
                                    value={classification.categoryLabel}
                                    disabled
                                    onChangeText={() => undefined}
                                />
                            )}
                            {/*
                             * Dressings pass no options: the sheets file all fourteen alike, and a
                             * picker with one option is a label wearing a chevron.
                             */}
                            {classification === undefined ||
                            classification.options.length === 0 ? null : (
                                <Select
                                    testID="kitchen-recipe-subcategory"
                                    id="kitchen-recipe-subcategory"
                                    label={classification.subcategoryLabel}
                                    placeholder={classification.subcategoryPlaceholder}
                                    disabled={!editable}
                                    options={classification.options}
                                    value={
                                        details.recipeCategory === ''
                                            ? null
                                            : details.recipeCategory
                                    }
                                    onChange={(next) => {
                                        setDetails({ ...details, recipeCategory: next });
                                        markDirty('details');
                                    }}
                                />
                            )}
                        </FormGrid>
                    </FormSection>

                    {isCreating ? null : (
                        <FormSection
                            testID="kitchen-recipe-versions"
                            title={t('kitchen:recipes.sectionVersions')}
                            description={t('kitchen:recipes.versionsDescription')}
                            actions={
                                data?.meta.status === 'published' && canManage ? (
                                    <Button
                                        testID="kitchen-recipe-retire"
                                        size="sm"
                                        variant="secondary"
                                        label={t('kitchen:recipes.retire')}
                                        onPress={() => {
                                            setShowRetire(true);
                                        }}
                                    />
                                ) : undefined
                            }
                        >
                            <Stack space="sm" testID="kitchen-recipe-version-list">
                                {versions.map((version) => {
                                    const rowTestId = `kitchen-recipe-version-${String(version.id)}`;
                                    const isSelected =
                                        selected !== null && selected.id === version.id;
                                    return (
                                        <Card
                                            key={String(version.id)}
                                            testID={rowTestId}
                                            padding="sm"
                                            tone={isSelected ? 'sunken' : 'default'}
                                        >
                                            <Inline
                                                space="sm"
                                                align="center"
                                                justify="between"
                                                wrap
                                            >
                                                <Inline space="sm" align="center" wrap>
                                                    <Text variant="bodyStrong">
                                                        {t('kitchen:recipes.versionNumber', {
                                                            number: version.versionNumber,
                                                        })}
                                                    </Text>
                                                    <Badge
                                                        testID={`${rowTestId}-status`}
                                                        tone={statusTone(version.status)}
                                                        label={t(statusKey(version.status))}
                                                    />
                                                    {version.isCurrent ? (
                                                        <Badge
                                                            testID={`${rowTestId}-current`}
                                                            tone="info"
                                                            label={t(
                                                                'kitchen:recipes.currentVersion',
                                                            )}
                                                        />
                                                    ) : null}
                                                </Inline>
                                                <Button
                                                    testID={`${rowTestId}-select`}
                                                    size="sm"
                                                    variant={isSelected ? 'secondary' : 'ghost'}
                                                    label={
                                                        isSelected
                                                            ? t('kitchen:recipes.versionSelected')
                                                            : t('kitchen:recipes.versionSelect')
                                                    }
                                                    onPress={() => {
                                                        setSelectedVersionId(version.id);
                                                    }}
                                                />
                                            </Inline>
                                        </Card>
                                    );
                                })}

                                {isViewingCurrent ? null : (
                                    <Callout
                                        testID="kitchen-recipe-version-unavailable"
                                        role="note"
                                        tone="info"
                                        title={t('kitchen:recipes.versionUnavailableTitle')}
                                        body={t('kitchen:recipes.versionUnavailableBody')}
                                        actions={
                                            <Button
                                                testID="kitchen-recipe-version-back-to-current"
                                                size="sm"
                                                variant="quiet"
                                                label={t('kitchen:recipes.backToCurrentVersion')}
                                                onPress={() => {
                                                    setSelectedVersionId(null);
                                                }}
                                            />
                                        }
                                    />
                                )}

                                {/*
                                 * A published or retired version is immutable (plan §4.7). The one
                                 * thing that can happen next is the successor draft, and this is the
                                 * control that makes it — an `updateRecipe` carrying nothing but the
                                 * lock version.
                                 */}
                                {isViewingCurrent && !isEditable && canManage ? (
                                    <Callout
                                        testID="kitchen-recipe-immutable"
                                        role="note"
                                        tone="info"
                                        title={t('kitchen:recipes.immutableTitle')}
                                        body={t('kitchen:recipes.immutableBody')}
                                        actions={
                                            <Button
                                                testID="kitchen-recipe-new-draft"
                                                size="sm"
                                                label={t('kitchen:recipes.newDraftFromVersion')}
                                                loading={openDraft.isPending}
                                                onPress={() => {
                                                    if (data === undefined) return;
                                                    openDraft.mutate(
                                                        {
                                                            recipeId: data.id,
                                                            request: {
                                                                lockVersion: data.meta.lockVersion,
                                                            },
                                                        },
                                                        {
                                                            onSuccess: (updated) => {
                                                                setSelectedVersionId(null);
                                                                toast.show({
                                                                    testID: 'kitchen-recipe-draft-opened-toast',
                                                                    tone: 'success',
                                                                    message: t(
                                                                        'kitchen:recipes.draftOpenedToast',
                                                                        {
                                                                            number: updated
                                                                                .currentVersion
                                                                                .versionNumber,
                                                                        },
                                                                    ),
                                                                });
                                                            },
                                                            onError: (error) => {
                                                                concurrency.capture(error);
                                                            },
                                                        },
                                                    );
                                                }}
                                            />
                                        }
                                    />
                                ) : null}
                            </Stack>
                        </FormSection>
                    )}
                </>
            )}

            {/* ── Production ───────────────────────────────────────────────────────────────── */}
            {tab !== 'production' ? null : (
                <>
                    {/*
                     * The hint sits on the title's baseline, not under it — `aside`, not
                     * `description`. The design writes `RAW MATERIALS  Type to add — the picker
                     * stays inline, no modal` as one line, and it reads as a gloss on the heading
                     * rather than as a paragraph the reader has to clear before the table.
                     */}
                    {/*
                     * Yield and waste, above the formulation rather than on Description.
                     *
                     * They belong to the same reading. A yield is only meaningful beside the lines
                     * it is divided into — "1.7 kg from these nine rows" — and the waste coefficient
                     * is the number that turns those lines into that yield. Having them a tab away
                     * meant checking a formulation required remembering a figure from another
                     * screen, which is exactly the kind of thing a reader gets wrong.
                     */}
                    <FormSection
                        first
                        testID="kitchen-recipe-yield"
                        title={t('kitchen:recipes.sectionYieldWaste')}
                        description={t('kitchen:recipes.yieldDescription')}
                    >
                        <FormGrid testID="kitchen-recipe-yield-grid">
                            {/*
                             * `QuantityInput`, not `TextInputField`: it is the numeric field the
                             * ingredient editor uses, so a figure on this form is the same 28px box
                             * with the same digits-only keyboard as a figure on that one.
                             *
                             * The unit rides on the field as a suffix rather than sitting in a
                             * picker beside it. Every recipe in this kitchen yields a mass, the
                             * cost cascade divides by kilograms, and a unit selector whose other
                             * options all produce a cost per portion the costing tab cannot read is
                             * a choice offered only to be wrong. `kg` is stated, not chosen.
                             */}
                            <QuantityInput
                                testID="kitchen-recipe-yield-quantity"
                                id="kitchen-recipe-yield-quantity"
                                label={t('kitchen:recipes.yieldQuantity')}
                                size="sm"
                                unit={t(unitShortKey('kg'))}
                                value={details.yieldQuantity}
                                disabled={!editable}
                                {...(yieldInvalid
                                    ? { error: t('kitchen:recipes.yieldRequired') }
                                    : {})}
                                onChangeText={(next) => {
                                    setDetails({ ...details, yieldQuantity: next });
                                    markDirty('details');
                                }}
                            />
                            <QuantityInput
                                testID="kitchen-recipe-yield-pieces"
                                id="kitchen-recipe-yield-pieces"
                                label={t('kitchen:recipes.yieldPieces')}
                                size="sm"
                                value={details.yieldPieces}
                                disabled={!editable}
                                onChangeText={(next) => {
                                    setDetails({ ...details, yieldPieces: next });
                                    markDirty('details');
                                }}
                            />
                            {/*
                             * Production waste, moved here from Costing.
                             *
                             * It was filed with the money because the cost cascade divides by it,
                             * but it is not a commercial figure — it is a property of the process,
                             * measured in the kitchen, and it belongs next to the yield it reduces.
                             * Costing still reads it; it is simply no longer edited there.
                             */}
                            <QuantityInput
                                testID="kitchen-recipe-waste"
                                id="kitchen-recipe-waste"
                                label={t('kitchen:recipes.productionWastePercent')}
                                size="sm"
                                unit="%"
                                value={details.wastePercent}
                                disabled={!editable}
                                onChangeText={(next) => {
                                    setDetails({ ...details, wastePercent: next });
                                    markDirty('details');
                                }}
                            />
                        </FormGrid>
                    </FormSection>

                    <FormSection
                        testID="kitchen-recipe-lines"
                        title={t('kitchen:recipes.sectionRawMaterials')}
                        aside={
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:recipes.linesPickerHint')}
                            </Text>
                        }
                    >
                        <RecipeLineTable
                            testID="kitchen-recipe-lines-table"
                            rows={lines}
                            ingredients={libraryEntries}
                            canManage={editable}
                            nextKey={nextKey}
                            pickerPlaceholder={t('kitchen:recipes.addIngredientPlaceholder')}
                            onChange={(next) => {
                                setLinesDraft(next);
                                markDirty('lines');
                            }}
                        />
                    </FormSection>
                </>
            )}

            {/* ── Packaging ────────────────────────────────────────────────────────────────── */}
            {tab !== 'packaging' ? null : (
                <View>
                    {/*
                     * The picker's panel has to out-rank what is drawn *after* it, and the raise
                     * belongs on *this* section rather than on a wrapper around both.
                     *
                     * `Picker` raises its own wrapper while open, which is enough on the Production
                     * tab where the table is the last thing on the page. It was not enough here and
                     * a wrapper around the pair did not help either: a z-index orders an element
                     * against its siblings in one stacking context, and both sections were inside
                     * that wrapper — so the panel still had to beat Packaging waste, which is drawn
                     * after it and therefore on top. Raising the section the panel hangs from is
                     * what actually orders the two: this subtree paints above the next one whatever
                     * the views in between do with their own z-indexes.
                     */}
                    <View className="relative z-sticky">
                        <FormSection
                            first
                            testID="kitchen-recipe-packaging"
                            title={t('kitchen:recipes.sectionPackaging')}
                            aside={
                                <Text variant="caption" tone="secondary">
                                    {t('kitchen:recipes.packagingHint')}
                                </Text>
                            }
                        >
                            <RecipeLineTable
                                testID="kitchen-recipe-packaging-table"
                                rows={packaging}
                                ingredients={packagingLibrary}
                                source="packaging"
                                canManage={canManage}
                                nextKey={nextKey}
                                pickerPlaceholder={t('kitchen:recipes.packagingPlaceholder')}
                                onChange={(next) => {
                                    setPackaging(next);
                                    markDirty('packaging');
                                }}
                            />
                        </FormSection>
                    </View>

                    {/*
                     * Packaging waste, moved here from Costing for the reason production waste moved to
                     * Production: it is a property of the packing step, not a commercial input, and the
                     * lines it applies to are on this tab. Costing still reads it.
                     */}
                    <FormSection
                        testID="kitchen-recipe-packaging-coefficients"
                        title={t('kitchen:recipes.sectionPackagingWaste')}
                        description={t('kitchen:recipes.packagingWasteHint')}
                    >
                        <FormGrid testID="kitchen-recipe-packaging-waste-grid">
                            <QuantityInput
                                testID="kitchen-recipe-packaging-waste"
                                id="kitchen-recipe-packaging-waste"
                                label={t('kitchen:recipes.packagingWastePercent')}
                                size="sm"
                                unit="%"
                                value={packagingWaste}
                                disabled={!canManage}
                                onChangeText={setPackagingWaste}
                            />
                        </FormGrid>
                    </FormSection>
                </View>
            )}

            {/* ── Costing ──────────────────────────────────────────────────────────────────── */}
            {tab !== 'costing' ? null : (
                <>
                    <FormSection
                        first
                        testID="kitchen-recipe-cost-cascade"
                        title={t('kitchen:recipes.sectionCostCascade')}
                        description={t('kitchen:recipes.costCascadeHint')}
                        aside={
                            <Badge
                                tone="danger"
                                icon="eyeOff"
                                label={t('kitchen:recipes.confidential')}
                            />
                        }
                    >
                        <Stack space="sm">
                            <CostCascade
                                testID="kitchen-recipe-cost-cards"
                                costs={costs}
                                currency={costs.displayCurrency}
                                yieldQuantity={details.yieldQuantity}
                                yieldUnit={t(unitShortKey(details.yieldUnit))}
                                productionWaste={details.wastePercent}
                                packagingWaste={packagingWaste}
                                withoutPackaging={withoutPackaging}
                                t={t}
                                formatter={formatter}
                            />

                            {/*
                             * The two things that make the figures above less than the whole story,
                             * said under them rather than left for somebody to notice.
                             *
                             * A line with no price is *excluded* from the sums (see `costCascade`),
                             * so without this the cascade reads as the cost of a formulation it has
                             * only partly costed — and names the lines, because "some lines" is not
                             * something a person can act on.
                             */}
                            {uncostedNames === '' ? null : (
                                <Text
                                    testID="kitchen-recipe-uncosted"
                                    variant="caption"
                                    tone="warning"
                                >
                                    {t('kitchen:recipes.uncostedLines', { names: uncostedNames })}
                                </Text>
                            )}

                            {costs.displayCurrency === null && anythingPriced ? (
                                <Text
                                    testID="kitchen-recipe-currency-mixed"
                                    variant="caption"
                                    tone="warning"
                                >
                                    {t('kitchen:recipes.currencyMixed')}
                                </Text>
                            ) : null}
                        </Stack>
                    </FormSection>

                    {/*
                     * Between the cascade and the prices, because that is the order the question is
                     * asked in: what does a kilogram cost, what does one of the things we actually
                     * sell cost, what do we charge for it. Dropped entirely on the sauce routes,
                     * which have no packaging lines to cost.
                     */}
                    {withoutPackaging ? null : (
                        <FormSection
                            testID="kitchen-recipe-package-costs"
                            title={t('kitchen:recipes.sectionPackageCosts')}
                            description={t('kitchen:recipes.packageCostsHint')}
                        >
                            <PackageCosts
                                testID="kitchen-recipe-package-costs"
                                rows={packaging}
                                packagingItems={packagingLibrary}
                                productionPerYieldUnit={costs.productionWithWaste}
                                yieldUnit={details.yieldUnit}
                                packagingWastePercent={parseQuantity(packagingWaste) ?? 0}
                                yieldInvalid={yieldInvalid}
                                currency={costs.displayCurrency}
                                locale={locale}
                                t={t}
                                formatter={formatter}
                            />
                        </FormSection>
                    )}

                    {/*
                     * Two list prices and the margin between the trade one and the cascade above,
                     * on the same three-column 280px track the cost cards use, so the price a
                     * person types lands under the cost it has to beat.
                     *
                     * The currency rides in the unit slot as a static suffix rather than in the
                     * value — a price carrying its own currency is a string, and the save has to
                     * send an amount. The same reasoning is written out on the ingredient editor's
                     * price fields, which these deliberately mirror: an operator who prices a raw
                     * material and a recipe in one sitting meets one control twice, not two.
                     */}
                    <FormSection
                        testID="kitchen-recipe-coefficients"
                        title={t('kitchen:recipes.sectionCoefficients')}
                        description={t('kitchen:recipes.coefficientsHint')}
                    >
                        <Stack space="sm">
                            {currencyMissing ? (
                                <Callout
                                    testID="kitchen-recipe-currency-missing"
                                    role="alert"
                                    tone="warning"
                                    title={t('kitchen:sale.currencyUnknown')}
                                />
                            ) : null}

                            <FormGrid testID="kitchen-recipe-coefficients-grid">
                                <QuantityInput
                                    testID="kitchen-recipe-b2b-price"
                                    id="kitchen-recipe-b2b-price"
                                    size="sm"
                                    label={t('kitchen:recipes.b2bPricePerUnit', {
                                        unit: t(unitShortKey(details.yieldUnit)),
                                    })}
                                    hint={t('kitchen:recipes.b2bPriceHint')}
                                    value={details.b2bPrice}
                                    disabled={!canManage}
                                    {...(currency === null
                                        ? {}
                                        : {
                                              // The mark, not the code: `$` is what a price field
                                              // wears, and `Intl` is what knows which mark this
                                              // locale writes for this code.
                                              unit: currencySymbol(
                                                  formatter.resolvedLocale,
                                                  currency,
                                              ),
                                          })}
                                    {...(b2bPriceValue === undefined
                                        ? { error: t('kitchen:sale.priceInvalid') }
                                        : {})}
                                    onChangeText={(next) => {
                                        setDetails({ ...details, b2bPrice: next });
                                        markDirty('details');
                                    }}
                                />

                                <QuantityInput
                                    testID="kitchen-recipe-b2c-price"
                                    id="kitchen-recipe-b2c-price"
                                    size="sm"
                                    label={t('kitchen:recipes.b2cPricePerUnit', {
                                        unit: t(unitShortKey(details.yieldUnit)),
                                    })}
                                    hint={t('kitchen:recipes.b2cPriceHint')}
                                    value={details.b2cPrice}
                                    disabled={!canManage}
                                    {...(currency === null
                                        ? {}
                                        : {
                                              unit: currencySymbol(
                                                  formatter.resolvedLocale,
                                                  currency,
                                              ),
                                          })}
                                    {...(b2cPriceValue === undefined
                                        ? { error: t('kitchen:sale.priceInvalid') }
                                        : {})}
                                    onChangeText={(next) => {
                                        setDetails({ ...details, b2cPrice: next });
                                        markDirty('details');
                                    }}
                                />

                                {/*
                                 * The derived third cell, in the `readOnly` variant the cost cascade's
                                 * own totals use — a figure on the sunken fill, in a field's shape,
                                 * that nobody types into. Empty rather than a stand-in when the sum
                                 * cannot be stated: the placeholder's em dash says "not calculable",
                                 * where a `0.0` would claim the margin is nil.
                                 */}
                                <QuantityInput
                                    testID="kitchen-recipe-margin"
                                    id="kitchen-recipe-margin"
                                    size="sm"
                                    readOnly
                                    label={t('kitchen:recipes.grossMargin')}
                                    unit="%"
                                    placeholder={t('kitchen:sale.marginUnavailable')}
                                    value={
                                        margin === null
                                            ? ''
                                            : formatter.formatNumber(margin, {
                                                  minimumFractionDigits: 1,
                                                  maximumFractionDigits: 1,
                                                  signDisplay: 'exceptZero',
                                              })
                                    }
                                    hint={
                                        margin === null
                                            ? t('kitchen:recipes.marginNoBasis')
                                            : t('kitchen:recipes.marginHint', {
                                                  cost: formatMoney(
                                                      formatter,
                                                      costs.total,
                                                      costs.displayCurrency,
                                                      COST_DIGITS,
                                                  ),
                                              })
                                    }
                                    onChangeText={() => undefined}
                                />
                            </FormGrid>
                        </Stack>
                    </FormSection>
                </>
            )}

            {/* ── Technical sheet ──────────────────────────────────────────────────────────── */}
            {tab !== 'sheet' ? null : (
                <>
                    <FormSection
                        first
                        testID="kitchen-recipe-composition"
                        title={t('kitchen:composition.title')}
                        description={t('kitchen:recipes.compositionHint')}
                        aside={
                            <Badge
                                tone="info"
                                icon={null}
                                label={t('kitchen:composition.fromDatabase')}
                            />
                        }
                    >
                        <DerivedPanel
                            testID="kitchen-recipe-composition-panel"
                            description={t('kitchen:composition.description')}
                            figures={nutrientFigures(rollup.data?.per100g ?? null, t, formatter)}
                            emptyValue={t('kitchen:list.noValue')}
                        />
                    </FormSection>

                    {/*
                     * The chips come from the *roll-up*, not from the saved version, which is what
                     * lets this tab answer while a recipe is still being written: the roll-up is
                     * computed from the draft lines. `origin` is not on `AllergenSource` — it is a
                     * derivation by definition — so nothing here claims a hand-declared entry.
                     */}
                    <FormSection
                        testID="kitchen-recipe-allergens"
                        title={t('kitchen:recipes.sectionAllergenClasses')}
                        description={t('kitchen:recipes.allergensInheritedFrom', {
                            count: lines.length,
                        })}
                    >
                        {allergenSources.length === 0 ? (
                            <Text
                                testID="kitchen-recipe-allergens-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:recipes.noAllergens')}
                            </Text>
                        ) : (
                            <Inline space="xs" wrap testID="kitchen-recipe-allergen-chips">
                                {allergenSources.map((source) => {
                                    const code = String(source.allergenCode);
                                    // `contains` and `may_contain` are two different claims and
                                    // never one colour: the tone separates them, the label carries
                                    // the rest, and the source names the line that put it there.
                                    const tone: TagTone =
                                        source.containment === 'contains' ? 'danger' : 'warning';
                                    const via = source.ingredientIds
                                        .map((id) => {
                                            const found = ingredients.find(
                                                (entry) => entry.id === id,
                                            );
                                            return found === undefined
                                                ? null
                                                : displayName(found.name, locale).value;
                                        })
                                        .filter((name): name is string => name !== null);

                                    return (
                                        <Tag
                                            key={code}
                                            testID={`kitchen-recipe-allergen-${code}`}
                                            tone={tone}
                                            label={
                                                via.length === 0
                                                    ? code
                                                    : t('kitchen:recipes.allergenVia', {
                                                          code,
                                                          name: via[0],
                                                      })
                                            }
                                        />
                                    );
                                })}
                            </Inline>
                        )}
                    </FormSection>

                    {/*
                     * The print view is the one thing here that genuinely needs a saved record: a
                     * technical sheet is a snapshot of a version, with its number on it, and there
                     * is no version to snapshot until the recipe exists.
                     */}
                    <FormSection
                        testID="kitchen-recipe-sheet"
                        title={t('kitchen:recipes.sheetTitle')}
                        description={t('kitchen:recipes.sheetPrintHint')}
                    >
                        {data === undefined ? (
                            <Text
                                testID="kitchen-recipe-sheet-unsaved"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:recipes.sheetAfterSave')}
                            </Text>
                        ) : (
                            <TechnicalSheetPanel
                                testID="kitchen-recipe-technical-sheet"
                                recipe={data}
                                version={data.currentVersion}
                                sheet={technicalSheet.data}
                                isLoading={technicalSheet.isPending}
                            />
                        )}
                    </FormSection>
                </>
            )}

            {/*
             * Back and forward through the tabs, under whichever one is open.
             *
             * The tab row at the top is how a reader *jumps*; this is how they *work through* — five
             * tabs is a sequence with an order that means something (identity, then formulation, then
             * what it is packed in, then what it costs), and the design's own sale flow uses the same
             * pair for the same reason.
             *
             * Secondary rather than primary: Publish is the page's one primary action and a green
             * Next beside it would compete with it. Both stay drawn at the ends of the sequence and
             * go disabled instead, so the row does not change width as it is walked.
             */}
            <Inline space="sm" wrap testID="kitchen-recipe-tab-steps">
                <Button
                    testID="kitchen-recipe-tab-previous"
                    variant="quiet"
                    iconStart={<Icon name="chevronStart" size="sm" />}
                    label={t('kitchen:recipes.tabPrevious')}
                    disabled={at <= 0}
                    onPress={() => {
                        const previous = order[at - 1];
                        if (previous !== undefined) setTab(previous);
                    }}
                />
                <Button
                    testID="kitchen-recipe-tab-next"
                    variant="secondary"
                    iconEnd={<Icon name="chevronEnd" size="sm" />}
                    label={t('kitchen:recipes.tabNext')}
                    disabled={at < 0 || at === order.length - 1}
                    onPress={() => {
                        const next = order[at + 1];
                        if (next !== undefined) setTab(next);
                    }}
                />
            </Inline>

            {/* ── publish ──────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-recipe-publish-dialog"
                open={showPublish}
                onClose={() => {
                    setShowPublish(false);
                }}
                title={t('kitchen:publish.title')}
                description={t('kitchen:publish.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipe-publish-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowPublish(false);
                            }}
                        />
                        <Button
                            testID="kitchen-recipe-publish-confirm"
                            label={t('kitchen:publish.confirm')}
                            loading={publish.isPending}
                            disabled={publishBlockers.length > 0 || quarantined}
                            onPress={() => {
                                if (data === undefined) return;
                                publish.mutate(
                                    {
                                        recipeId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: (published) => {
                                            setShowPublish(false);
                                            setSelectedVersionId(null);
                                            toast.show({
                                                testID: 'kitchen-recipe-published-toast',
                                                tone: 'success',
                                                message: t('kitchen:publish.publishedToast', {
                                                    number: published.currentVersion.versionNumber,
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
                    <Text testID="kitchen-recipe-publish-consequence">
                        {t('kitchen:publish.consequence')}
                    </Text>

                    <Stack space="xs" testID="kitchen-recipe-publish-allergens">
                        <Text variant="label">{t('kitchen:publish.allergenRowsTitle')}</Text>
                        {currentVersion === null || currentVersion.allergens.length === 0 ? (
                            <Text
                                testID="kitchen-recipe-publish-allergens-none"
                                tone="secondary"
                                variant="caption"
                            >
                                {t('kitchen:publish.allergenRowsNone')}
                            </Text>
                        ) : (
                            currentVersion.allergens.map((declaration) => (
                                <Text
                                    key={declaration.allergenCode}
                                    testID={`kitchen-recipe-publish-allergen-${String(declaration.allergenCode)}`}
                                    variant="caption"
                                >
                                    {t('kitchen:publish.allergenRow', {
                                        code: String(declaration.allergenCode),
                                        containment: t(
                                            declaration.containment === 'contains'
                                                ? 'kitchen:containment.contains'
                                                : 'kitchen:containment.mayContain',
                                        ),
                                        names: declaration.sourceIngredientIds
                                            .map((id) => {
                                                const found = ingredients.find(
                                                    (entry) => entry.id === id,
                                                );
                                                return found === undefined
                                                    ? String(id)
                                                    : displayName(found.name, locale).value;
                                            })
                                            .join(', '),
                                    })}
                                </Text>
                            ))
                        )}
                    </Stack>

                    {quarantined ? (
                        <Callout
                            testID="kitchen-recipe-publish-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={t('kitchen:publish.quarantineBody')}
                        />
                    ) : null}

                    {publishBlockers.length === 0 ? null : (
                        <Callout
                            testID="kitchen-recipe-publish-blocked"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:publish.blockedTitle')}
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

                    {unmappedIngredients.length === 0 ? null : (
                        <Callout
                            testID="kitchen-recipe-publish-allergen-unmapped"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.unmappedTitle')}
                            body={t('kitchen:publish.unmappedBody')}
                        >
                            <Inline space="xs" wrap>
                                {unmappedIngredients.map((entry) => (
                                    <Button
                                        key={String(entry.id)}
                                        testID={`kitchen-recipe-publish-unmapped-${String(entry.id)}`}
                                        size="sm"
                                        variant="ghost"
                                        label={displayName(entry.name, locale).value}
                                        onPress={() => {
                                            setShowPublish(false);
                                            guard.intercept(() => {
                                                router.push(
                                                    `/kitchen/ingredients/${String(entry.id)}` as never,
                                                );
                                            });
                                        }}
                                    />
                                ))}
                            </Inline>
                        </Callout>
                    )}

                    {publishFailure === null ? null : publishQuarantined ? (
                        <Callout
                            testID="kitchen-recipe-publish-refused-quarantine"
                            role="alert"
                            tone="warning"
                            title={t('kitchen:publish.quarantineTitle')}
                            body={(publishFields.status ?? []).join(' ')}
                        />
                    ) : (
                        <Callout
                            testID="kitchen-recipe-publish-error"
                            role="alert"
                            tone="danger"
                            title={t('kitchen:publish.failedTitle')}
                            body={publishFailure.message}
                        >
                            <Stack space="none">
                                {Object.entries(publishFields).map(([field, messages]) => (
                                    <Text
                                        key={field}
                                        testID={`kitchen-recipe-publish-field-${field}`}
                                        variant="caption"
                                    >
                                        {messages.join(' ')}
                                    </Text>
                                ))}
                            </Stack>
                        </Callout>
                    )}
                </Stack>
            </Dialog>

            {/* ── retire ───────────────────────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-recipe-retire-dialog"
                open={showRetire}
                onClose={() => {
                    setShowRetire(false);
                }}
                title={t('kitchen:recipes.archiveTitle')}
                description={t('kitchen:recipes.archiveBody')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipe-retire-cancel"
                            variant="quiet"
                            label={t('kitchen:common.cancel')}
                            onPress={() => {
                                setShowRetire(false);
                            }}
                        />
                        <Button
                            testID="kitchen-recipe-retire-confirm"
                            variant="danger"
                            label={t('kitchen:recipes.archiveConfirm')}
                            loading={retire.isPending}
                            onPress={() => {
                                if (data === undefined) return;
                                retire.mutate(
                                    {
                                        recipeId: data.id,
                                        request: { lockVersion: data.meta.lockVersion },
                                    },
                                    {
                                        onSuccess: () => {
                                            setShowRetire(false);
                                            toast.show({
                                                testID: 'kitchen-recipe-retired-toast',
                                                tone: 'success',
                                                message: t('kitchen:recipes.archivedToast', {
                                                    name: displayName(data.name, locale).value,
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
                {retire.error === null ? null : (
                    <Text testID="kitchen-recipe-retire-error" tone="danger">
                        {toFailure(retire.error)?.message ?? t('kitchen:recipes.archiveFailed')}
                    </Text>
                )}
            </Dialog>

            {/* ── the two safety dialogs ───────────────────────────────────────────────────── */}
            <Dialog
                testID="kitchen-recipe-editor-screen-unsaved-dialog"
                open={guard.isPrompting}
                onClose={guard.cancelDiscard}
                title={t('kitchen:unsaved.title')}
                description={t('kitchen:unsaved.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipe-editor-screen-unsaved-keep"
                            variant="quiet"
                            label={t('kitchen:unsaved.keepEditing')}
                            onPress={guard.cancelDiscard}
                        />
                        <Button
                            testID="kitchen-recipe-editor-screen-unsaved-discard"
                            variant="danger"
                            label={t('kitchen:unsaved.discard')}
                            onPress={guard.confirmDiscard}
                        />
                    </>
                }
            />

            <Dialog
                testID="kitchen-recipe-editor-screen-conflict-dialog"
                open={concurrency.conflict !== null}
                onClose={concurrency.keepEditing}
                dismissOnBackdrop={false}
                title={t('kitchen:conflict.title')}
                description={t('kitchen:conflict.body')}
                actions={
                    <>
                        <Button
                            testID="kitchen-recipe-editor-screen-conflict-keep"
                            variant="quiet"
                            label={t('kitchen:conflict.keepEditing')}
                            onPress={concurrency.keepEditing}
                        />
                        <Button
                            testID="kitchen-recipe-editor-screen-conflict-reload"
                            variant="danger"
                            label={t('kitchen:conflict.reload')}
                            onPress={concurrency.reload}
                        />
                    </>
                }
            >
                {concurrency.conflict === null ? null : (
                    <Text
                        testID="kitchen-recipe-editor-screen-conflict-detail"
                        tone="secondary"
                        variant="caption"
                    >
                        {concurrency.conflict.failure.message}
                    </Text>
                )}
            </Dialog>
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The cost cascade
 * ---------------------------------------------------------------------------------------------- */

const YIELD_DIGITS: Intl.NumberFormatOptions = {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
};
const COST_DIGITS: Intl.NumberFormatOptions = {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
};
const CASCADE_DIGITS: Intl.NumberFormatOptions = {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
};
const PER_UNIT_DIGITS: Intl.NumberFormatOptions = {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
};

interface Cascade {
    readonly productionCost: number;
    readonly productionPerUnit: number;
    readonly productionWithWaste: number;
    readonly packagingCost: number;
    readonly packagingPerUnit: number;
    readonly packagingWithWaste: number;
    readonly total: number;
    /**
     * Rows left out of the sums — no recorded price, or a unit that will not convert to the one the
     * price is quoted against. Named on the Costing tab, because a figure computed from eight of
     * nine lines is not the cost of the recipe and nothing on screen would otherwise say so.
     *
     * A row with nothing picked yet is not here: it is unfinished, and the save already blocks on it.
     */
    readonly uncostedIds: readonly string[];
    /**
     * The one currency every priced row is in, or `null` when they disagree or nothing is priced.
     *
     * `null` renders every cascade figure as a bare number. A sum of two currencies is in neither of
     * them, and stamping one of the two onto the total would make a wrong figure look checked.
     */
    readonly displayCurrency: CurrencyCode | null;
}

/**
 * The kitchen's own arithmetic, from `Recipes Instructions.xlsx` and the design's `costs()`.
 *
 * ```
 * total production cost   = Σ line quantity × the ingredient's unit price
 * 1 kg production cost    = total ÷ quantity produced
 * 3 % waste coefficient   = that × 1.03
 * ```
 *
 * and the same three lines again for packaging, at its own coefficient. The total is the two
 * wasted figures added — *not* the two raw costs with one coefficient over both, which is the
 * mistake the sheet's two separate waste rows exist to prevent: a bottle does not shrink on the
 * stove and a sauce does not get dropped on the floor at the same rate.
 *
 * ## Where the money comes from, and where the server's comes from
 *
 * The client costs a line from `IngredientAdmin.unitPrice` — the **list price per
 * `measurementUnit`** — because it is the only per-ingredient cost the client is given:
 * `RecipeVersionPresenter` withholds `unit_cost_amount` and `line_cost_amount` until the
 * `recipe.view_costs_organisation` split exists, so `RecipeLine.lineCost` is `null` on the wire and
 * `costPer100g` is not on the listing shape this pool is built from.
 *
 * The server's technical sheet prices from the **purchase price** instead
 * (`RecipeVersionService::costOf`), so the two can legitimately differ on a row where a kitchen's
 * list price and its last receipt disagree. Wiring the roll-up preview's `computed_cost` through to
 * this panel is the follow-up that would reconcile them; until then this figure is the live one that
 * moves while a quantity is being typed, and the technical sheet is the audited one.
 *
 * The quantity is converted into the unit the price is quoted against before it is multiplied — see
 * {@link lineCost}. A line the arithmetic cannot state is reported as **uncosted** and left out of
 * the sums, rather than added as a zero: a zero is a measurement, and a costing panel full of them
 * reads as "these things are free".
 */
function costCascade({
    lines,
    packaging,
    ingredients,
    packagingItems,
    yieldQuantity,
    productionWaste,
    packagingWaste,
}: {
    readonly lines: readonly LineDraft[];
    readonly packaging: readonly LineDraft[];
    readonly ingredients: readonly PickerEntry[];
    /**
     * The packaging catalogue, separately.
     *
     * Two pools rather than one, because the two line sets name rows in two different tables. This
     * used to resolve packaging prices against the *ingredient* pool — which found nothing once
     * packaging moved to `packaging_items`, so every packaging line priced at zero and the
     * packaging half of the cascade quietly read 0.00. A miss returns zero either way, so nothing
     * failed; the figure was simply wrong.
     */
    readonly packagingItems: readonly PickerEntry[];
    readonly yieldQuantity: number;
    readonly productionWaste: number;
    readonly packagingWaste: number;
}): Cascade {
    const uncosted = new Set<string>();
    const currencies = new Set<CurrencyCode>();

    const sum = (rows: readonly LineDraft[], pool: readonly PickerEntry[]): number => {
        let total = 0;
        for (const row of rows) {
            const quantity = parseQuantity(row.quantity);
            const entry =
                row.ingredientId === null
                    ? undefined
                    : pool.find((candidate) => candidate.id === row.ingredientId);
            // Nothing picked, or a half-typed quantity: an unfinished row, not an uncosted one.
            if (entry === undefined || quantity === null) continue;

            if (entry.unitPrice !== null) currencies.add(entry.unitPrice.currency);
            const cost = lineCost(quantity, row.unit, entry.unitPrice, entry.unit);
            if (cost === null) uncosted.add(entry.id);
            else total += cost;
        }
        return total;
    };

    // A yield of nothing is not a large cost per unit, it is an unanswerable question — so the
    // divisor floors at one and the figure reads as the batch cost until a yield is stated.
    const divisor = yieldQuantity > 0 ? yieldQuantity : 1;

    const productionCost = sum(lines, ingredients);
    const packagingCost = sum(packaging, packagingItems);
    const productionPerUnit = productionCost / divisor;
    const packagingPerUnit = packagingCost / divisor;
    const productionWithWaste = productionPerUnit * (1 + productionWaste / 100);
    const packagingWithWaste = packagingPerUnit * (1 + packagingWaste / 100);

    return {
        productionCost,
        productionPerUnit,
        productionWithWaste,
        packagingCost,
        packagingPerUnit,
        packagingWithWaste,
        total: productionWithWaste + packagingWithWaste,
        uncostedIds: [...uncosted],
        displayCurrency: currencies.size === 1 ? ([...currencies][0] ?? null) : null,
    };
}

/**
 * Three cards on the field grid — Production, Packaging, and the tinted total.
 *
 * `CardGrid` is not the container: these are the width of a *field*, not of a content card, and the
 * design puts them on the same three-column 280px track as the Coefficients section directly below
 * so the two sections line up down the page. `FormGrid` is that track.
 *
 * The total card takes the brand-subtle fill, which is the one place on this screen a panel is
 * filled at all — it is the figure the whole tab exists to produce.
 */
function CostCascade({
    costs,
    currency,
    yieldQuantity,
    yieldUnit,
    productionWaste,
    packagingWaste,
    withoutPackaging,
    t,
    formatter,
    testID,
}: {
    readonly costs: Cascade;
    /** The currency every figure here is stated in, or `null` for bare numbers. */
    readonly currency: CurrencyCode | null;
    readonly yieldQuantity: string;
    readonly yieldUnit: string;
    readonly productionWaste: string;
    readonly packagingWaste: string;
    /**
     * Draw the production card alone.
     *
     * A route with no Packaging tab has no packaging lines, so its packaging cost is zero by
     * construction and its total is the production figure restated. Two cards saying `0.0000` and
     * one repeating the card beside it is three tiles of furniture over the one number the tab is
     * for — and worse, a zero in a costing panel reads as a measurement rather than an absence.
     */
    readonly withoutPackaging: boolean;
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly testID: string;
}) {
    const money = (value: number, digits: Intl.NumberFormatOptions): string =>
        formatMoney(formatter, value, currency, digits);

    const cards = [
        {
            key: 'production',
            title: t('kitchen:recipes.costProduction'),
            tone: 'raised' as const,
            rows: [
                {
                    label: t('kitchen:recipes.costTotal'),
                    value: money(costs.productionCost, CASCADE_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPerBatch', {
                        quantity: yieldQuantity,
                        unit: yieldUnit,
                    }),
                    value: money(costs.productionPerUnit, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costWithWaste', { percent: productionWaste }),
                    value: money(costs.productionWithWaste, PER_UNIT_DIGITS),
                    lead: true,
                },
            ],
        },
    ];

    /** Both of these are about packaging: one states its cost, the other adds it to production. */
    const packagingCards = [
        {
            key: 'packaging',
            title: t('kitchen:recipes.costPackaging'),
            tone: 'raised' as const,
            rows: [
                {
                    label: t('kitchen:recipes.costTotal'),
                    value: money(costs.packagingCost, CASCADE_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPerUnit', { unit: yieldUnit }),
                    value: money(costs.packagingPerUnit, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costWithWaste', { percent: packagingWaste }),
                    value: money(costs.packagingWithWaste, PER_UNIT_DIGITS),
                    lead: true,
                },
            ],
        },
        {
            key: 'total',
            title: t('kitchen:recipes.costTotalCard'),
            tone: 'brand' as const,
            rows: [
                {
                    label: t('kitchen:recipes.costProduction'),
                    value: money(costs.productionWithWaste, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPackaging'),
                    value: money(costs.packagingWithWaste, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPerUnit', { unit: yieldUnit }),
                    value: money(costs.total, PER_UNIT_DIGITS),
                    lead: true,
                },
            ],
        },
    ];

    const drawn = withoutPackaging ? cards : [...cards, ...packagingCards];

    return (
        <FormGrid testID={testID}>
            {drawn.map((card) => (
                <CostCard
                    key={card.key}
                    testID={`${testID}-${card.key}`}
                    title={card.title}
                    tone={card.tone}
                    rows={card.rows}
                />
            ))}
        </FormGrid>
    );
}

/** One row of a {@link CostCard} — a label, the figure it names, and whether it is the conclusion. */
interface CostCardRow {
    readonly label: string;
    /** Empty where the label is the whole statement, as the package cards' two context rows are. */
    readonly value: string;
    readonly lead: boolean;
}

/**
 * One tile on the field grid: a `micro` title over a short ledger.
 *
 * Extracted from {@link CostCascade}'s own map so the per-package tiles below are the same object
 * rather than a second drawing of it — two copies of a card is two chances for one of them to keep
 * the old row rhythm after the other is adjusted.
 */
function CostCard({
    title,
    tone,
    rows,
    testID,
}: {
    readonly title: string;
    readonly tone: CardTone;
    readonly rows: readonly CostCardRow[];
    readonly testID: string;
}) {
    return (
        <Card testID={testID} padding="sm" tone={tone}>
            <View className="flex-col gap-hair">
                <Text variant="micro" tone="secondary" numberOfLines={1}>
                    {title}
                </Text>
                {rows.map((row) => (
                    <View
                        key={row.label}
                        className="flex-row items-baseline justify-between gap-tight"
                    >
                        <Text variant="caption" tone="secondary" numberOfLines={1}>
                            {row.label}
                        </Text>
                        {/*
                         * The last row of each card is the one the card is for, so it takes the
                         * strong step; the ones above it are the working.
                         */}
                        <Text variant={row.lead ? 'bodyStrong' : 'mono'} numberOfLines={1}>
                            {row.value}
                        </Text>
                    </View>
                ))}
            </View>
        </Card>
    );
}

/**
 * What one filled package costs, one tile per packaging line that records a capacity.
 *
 * The cascade above states a cost per *yield unit*, which is the figure a formulation is priced on
 * and not the one anybody quotes: a kitchen sells a 300 cc bottle, not a kilogram. This is that
 * conversion, drawn per line — the product the container holds at the production cost above, plus the
 * container at its own waste rate. {@link costPerPackage} is the arithmetic.
 *
 * A line is skipped rather than shown at zero when its capacity will not convert to the yield unit
 * (a `piece` capacity against a kilogram yield answers nothing), and the whole section says so in one
 * sentence when no line records a capacity at all — a grid of dashes would not.
 */
function PackageCosts({
    rows,
    packagingItems,
    productionPerYieldUnit,
    yieldUnit,
    packagingWastePercent,
    yieldInvalid,
    currency,
    locale,
    t,
    formatter,
    testID,
}: {
    readonly rows: readonly LineDraft[];
    readonly packagingItems: readonly PickerEntry[];
    /** `costs.productionWithWaste` — the cost of one yield unit of product, waste included. */
    readonly productionPerYieldUnit: number;
    readonly yieldUnit: MeasureUnit;
    readonly packagingWastePercent: number;
    /** No usable yield means no cost per yield unit, so there is nothing to multiply a capacity by. */
    readonly yieldInvalid: boolean;
    readonly currency: CurrencyCode | null;
    readonly locale: string;
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly testID: string;
}) {
    if (yieldInvalid) {
        return (
            <Text testID={`${testID}-no-yield`} variant="caption" tone="secondary">
                {t('kitchen:recipes.packageCostsNoYield')}
            </Text>
        );
    }

    const cards = rows.flatMap((row) => {
        const entry =
            row.ingredientId === null
                ? undefined
                : packagingItems.find((candidate) => candidate.id === row.ingredientId);
        const capacity = entry?.capacity ?? null;
        if (entry === undefined || capacity === null) return [];

        const cost = costPerPackage({
            productionPerYieldUnit,
            capacity,
            yieldUnit,
            containerPrice: entry.unitPrice?.amount ?? null,
            packagingWastePercent,
        });
        if (cost === null) return [];

        return [
            {
                key: row.key,
                title: displayName(entry.name, locale).value,
                rows: [
                    {
                        label: t('kitchen:recipes.packageInBatch', { quantity: row.quantity }),
                        value: '',
                        lead: false,
                    },
                    {
                        label: t('kitchen:recipes.packageHolds', {
                            quantity: formatter.formatNumber(capacity.quantity, YIELD_DIGITS),
                            unit: t(unitShortKey(capacity.unit)),
                        }),
                        value: '',
                        lead: false,
                    },
                    {
                        label: t('kitchen:recipes.packageCostLabel'),
                        value: formatMoney(formatter, cost, currency, COST_DIGITS),
                        lead: true,
                    },
                ],
            },
        ];
    });

    if (cards.length === 0) {
        return (
            <Text testID={`${testID}-none`} variant="caption" tone="secondary">
                {t('kitchen:recipes.packageCostsNone')}
            </Text>
        );
    }

    return (
        <FormGrid testID={`${testID}-grid`}>
            {cards.map((card) => (
                <CostCard
                    key={card.key}
                    testID={`kitchen-recipe-package-cost-${card.key}`}
                    title={card.title}
                    tone="raised"
                    rows={card.rows}
                />
            ))}
        </FormGrid>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Composition
 * ---------------------------------------------------------------------------------------------- */

/**
 * The four tiles the design draws, always four, whether or not the roll-up has facts behind them.
 *
 * Same set and the same reasoning as the ingredient editor's panel: a figure the version has not got
 * comes back `null` and the panel draws an em dash, never a zero, and the row does not collapse.
 * `per100g` is the basis because that is the one the design labels and the one a label is written
 * in; it is `null` until the total mass is known, which is what the dashes mean before then.
 */
const PANEL_NUTRIENTS: readonly { readonly id: string; readonly labelKey: string }[] = [
    { id: 'energy', labelKey: 'nutrition:nutrients.energy' },
    { id: 'fat', labelKey: 'nutrition:nutrients.fat' },
    { id: 'carbohydrate', labelKey: 'nutrition:nutrients.carbohydrate' },
    { id: 'protein', labelKey: 'nutrition:nutrients.protein' },
];

function nutrientFigures(
    facts: NutritionFacts | null,
    t: TFunction,
    formatter: Formatter,
): readonly DerivedFigure[] {
    return PANEL_NUTRIENTS.flatMap((nutrient) => {
        const definition = coreNutrientDefinition(nutrient.id);
        if (definition === null) return [];

        const amount = facts === null ? null : findAmount(facts, nutrient.id);

        return [
            {
                key: nutrient.id,
                label: t(nutrient.labelKey),
                value:
                    amount === null
                        ? null
                        : formatter.formatNumber(amount.value, {
                              minimumFractionDigits: definition.precision,
                              maximumFractionDigits: definition.precision,
                          }),
                unit: t('kitchen:composition.per100g', {
                    unit: amount?.unit ?? definition.unit,
                }),
            },
        ];
    });
}
