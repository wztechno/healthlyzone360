import { PACKAGING_CATEGORY_CODE, isValidationFailure } from '@healthy360/api-client/contracts';
import type {
    CostAmount,
    IngredientAdmin,
    LocalisedText,
    RecipeAdmin,
    RecipeComputedCost,
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
    FormIssueBanner,
    FormSection,
    FormSkeleton,
    Icon,
    Inline,
    QuantityInput,
    Select,
    Stack,
    Tabs,
    Tag,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import type { CardTone, FormIssueItem, SelectOption, TagTone } from '@healthy360/design-system';
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
import type { ReactNode } from 'react';
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
import { TabStepNavigation } from '../editor-steps.tsx';
import {
    RECIPE_MANAGE_PERMISSION,
    RECIPE_VIEW_COSTS_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { focusField } from '../field-focus.ts';
import {
    amountToInput,
    currencySymbol,
    displayName,
    formatMoney,
    isTranslationIncomplete,
    marginPercent,
    parseAmount,
    parseQuantity,
    rollupWarningKey,
    statusKey,
    statusShortKey,
    statusTone,
    unitShortKey,
} from '../format.ts';
import { ImageSlot } from '../image-slot.tsx';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import {
    RecipeLineTable,
    ingredientEntry,
    isSendableLine,
    packagingEntry,
} from '../recipe-line-table.tsx';
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
 * hands it here. The same tabs, because it is the same component rather than a copy of it — a
 * sauce's bottles are packaging lines exactly as a meal's box is.
 *
 * ```
 * Kitchen workspace › Recipes › Thousand Islands   <- the shell's trail
 * Thousand Islands  DRAFT  RC-0104  RESTRICTED    [ Cancel ] [ Save draft ] [ Publish ]
 * ⚠ 1 at zero  [ Sleeve label ]                   <- once there is something to say
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │(1) Description │(2) Production 9 │(3) Packaging 3 ① │(4) Costing │(5) Sheet │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * `Catalogue Forms.dc.html` (`isRecipe`) redraws the opening: the handle beside the title instead of
 * a summary line under it, and the tabs as numbered steps on a sunken track, each carrying its count
 * and — when something on it needs attention — a solid pill with the number of problems. The
 * banner under the header names each of those problems and takes the reader to it, switching tab
 * on the way; the pills are what tells a reader *which* tab to open without opening all five. The
 * row is how a reader jumps; the Previous/Next footer (`TabStepNavigation`) is how they walk it.
 *
 * The yield moved from Description to Production, where it sits with the production waste as
 * "Yield & waste" above the lines it divides; the packaging waste sits above the packaging lines
 * the same way. Each coefficient is on the tab whose table it applies to.
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
 * ## Two of the design's fields this contract cannot store
 *
 * The photo on Description and the expiry period on Packaging exist in the prototype's own state
 * and nowhere on `KitchenAdminRepository`. They are drawn, at the kitchen's request, and held in
 * this screen's state only — never sent, never marking the record dirty, and never blocking a save,
 * which is why the expiry period carries no required mark although the design's shelf life does.
 * It is on Packaging rather than Description because how long a batch keeps is a property of what
 * it is packed in as much as of the formulation. A required field whose value
 * is thrown away is a gate with nothing behind it. Storage and the Restricted switch belong to the
 * Method section below and are not drawn, for the reason that section gives.
 *
 * **Everything on Packaging and Costing persists.** `setRecipePackaging` is a real endpoint
 * (`PUT …/versions/{version}/packaging`) and the save below calls it on create and on update alike;
 * the two list prices and the packaging waste rate are version fields, so they live in `DetailsDraft`
 * with everything else `updateRecipe` writes. The waste rate used to be session-only, defaulting to
 * `5` while the column defaulted to `0.00` — so this screen priced packaging about five per cent
 * above the saved technical sheet for the same lines. It reads the stored rate now.
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
 * ## Costs are confidential, and every one of them is the server's
 *
 * `CostAmount` exists on this contract and on no other (plan §4.8). Every figure derived from it is
 * labelled, and the header carries the design's `RESTRICTED` badge on every recipe rather than on
 * the ones somebody remembered to mark.
 *
 * Nothing here prices anything. The roll-up preview returns `computedCost` — the technical sheet's
 * own arithmetic, run over the draft as it stands — and the Costing tab, both line tables and the
 * header all draw from it. This screen used to run a second cascade in JavaScript, priced from each
 * ingredient's *list* price while the server priced from its *purchase* price, so the editor and the
 * saved sheet could disagree about the same recipe. A member without
 * `recipe.view_costs_organisation` is sent no figures at all, and the Costing tab says so.
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
    /** Packaging loss, a separate rate from `wastePercent`. Edited on the Packaging tab. */
    readonly packagingWastePercent: string;
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
    // The column's own default. The editor used to start at `5`, but that figure was never saved, so
    // `0` is what every version written so far actually carries.
    packagingWastePercent: '0',
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
        packagingWastePercent: String(version.packagingWastePercent),
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

/**
 * The lines that are complete enough to send. Incomplete rows block the save instead.
 *
 * {@link isSendableLine} decides, because the server numbers what it is sent and the line table
 * matches its figures back to rows by that number.
 */
function lineInputsFrom(rows: readonly LineDraft[]): readonly RecipeLineInput[] {
    return rows.filter(isSendableLine).map((row) => {
        const note = row.note.trim();
        return {
            ingredientId: IngredientId.unsafe(row.ingredientId),
            // Sendable means it parses.
            quantity: parseQuantity(row.quantity)!,
            unit: row.unit,
            ...(note === '' ? {} : { sourceDesignation: note }),
            isOptional: row.isOptional,
        };
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
 * So the *structure* of the line set (which ingredients and which packaging, in which order, in
 * which units) is compared on every change: different structure runs at once, same structure
 * waits. The policy lives here rather than in the query hook because only the editor knows which
 * edit just happened.
 */
function useDebouncedRollupDraft(draft: RecipeRollupDraft | null): RecipeRollupDraft | null {
    const structure =
        draft === null
            ? 'none'
            : JSON.stringify([
                  draft.lines.map((line) => [String(line.ingredientId), line.unit]),
                  (draft.packaging ?? []).map((line) => String(line.ingredientId)),
              ]);

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
 * The design's five, in its order, and a sixth — Selling — when the recipe is sold as an item. A
 * union rather than an array — nothing iterates them; the tab row is built by hand so each entry can
 * carry its own count and testID.
 */
type RecipeTab = 'description' | 'production' | 'packaging' | 'costing' | 'selling' | 'sheet';

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface RecipeEditScreenProps {
    /** The route parameter. `'new'` or absent creates. */
    readonly recipe?: string | undefined;
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
     *
     * A host that passes it is creating something sold, so the create form also asks for the
     * description a customer reads — drawn only then, and handed over here in both languages. It is
     * the *item's* description (`description_en` / `description_ar`); the recipe itself stores one
     * language of notes at most, which is why it is not read back off `recipe`.
     */
    readonly onCreated?:
        | ((recipe: RecipeAdmin, listing: { readonly description: LocalisedText }) => void)
        | undefined;
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
    /**
     * The catalogue item this formulation is sold as, drawn as a tab of its own.
     *
     * A sauce, a dressing or a meal is one thing to a kitchen and two records to the API: the recipe
     * it is made from and the item it is sold as. This editor owns the recipe; the host that resolved
     * the item owns the item, and hands its listing over as `content` so the two read as one page.
     * They still save separately — different records, different lock versions, different permissions
     * — so nothing on this screen's Save draft writes the item, and nothing in the tab writes the
     * recipe.
     *
     * `isDirty` is the listing's unsaved state, so leaving this page asks first whichever half holds
     * the edit.
     */
    readonly sellsAs?:
        | { readonly label: string; readonly content: ReactNode; readonly isDirty?: boolean }
        | undefined;
}

export function RecipeEditScreen({ recipe, ...rest }: RecipeEditScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [RECIPE_VIEW_PERMISSION] }}
            testID="kitchen-recipe-editor"
        >
            <RecipeEditor recipe={recipe} {...rest} />
        </Gate>
    );
}

function RecipeEditor({
    recipe,
    backTo = '/kitchen/recipes',
    classification,
    onCreated,
    referenceSeries = 'RC-',
    sellsAs,
}: RecipeEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    const canManage = useCan(RECIPE_MANAGE_PERMISSION);
    const canViewCosts = useCan(RECIPE_VIEW_COSTS_PERMISSION);

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
    /** Whether a save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);
    /** The design's photo and the packed batch's expiry period. Not saved: see the docblock. */
    const [image, setImage] = useState<string | null>(null);
    const [expiryDays, setExpiryDays] = useState('');

    const [details, setDetails] = useState<DetailsDraft>(EMPTY_DETAILS);
    const [lines, setLinesDraft] = useState<readonly LineDraft[]>([]);

    /*
     * Outside `DetailsDraft` because `updateRecipe` does not write it: `packaging` has an endpoint of
     * its own — `setRecipePackaging`, keyed on the *version* rather than the recipe — so it is drafted
     * here and posted separately once the lines have settled the lock version.
     *
     * The list prices and the packaging waste rate used to sit here too. They no longer do: all three
     * are version fields `updateRecipe` writes, so they belong in the draft the save reads.
     */
    const [packaging, setPackaging] = useState<readonly LineDraft[]>([]);

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
            packaging.filter(isSendableLine).map((row) => ({
                ingredientId: IngredientId.unsafe(row.ingredientId),
                basis: 'per_batch' as const,
                // Sendable means it parses.
                quantity: parseQuantity(row.quantity)!,
                ...(row.note.trim() === '' ? {} : { comment: row.note.trim() }),
            })),
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

    /*
     * The listing's unsaved edits are this page's too.
     *
     * The Selling tab is another record with drafts of its own, and leaving from here — Discard, the
     * trail — would drop them without a word unless this page's guard knew. So a dirty listing arms
     * the guard, and it is disarmed only once neither half holds an edit.
     */
    const listingDirty = sellsAs?.isDirty === true;
    const { markDirty: armGuard, markClean: disarmGuard } = guard;
    useEffect(() => {
        if (listingDirty) armGuard();
        else if (!anyDirty) disarmGuard();
    }, [listingDirty, anyDirty, armGuard, disarmGuard]);

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

    /*
     * The two yield fields, read honestly rather than through `servings`.
     *
     * `servings` above defaults a blank yield to `1` because six other places on this screen divide
     * by it and a division by nothing is worse than a division by one. The roll-up cannot afford
     * that default: a `1` sent as the yield mass would make `per_100g` divide by one gram, and a `1`
     * sent as the portion count would label a twelve-portion batch as a single serving. So both are
     * parsed again here, and a blank one is sent as *absent* — the server's own refusal to invent a
     * figure is only useful if the client stops inventing one first.
     *
     * The piece count is what `servings` means on the wire: one sold unit is one yield piece.
     */
    const yieldMass = parseQuantity(details.yieldQuantity);
    const yieldPieces = parseQuantity(details.yieldPieces);
    const packagingWastePercent = parseQuantity(details.packagingWastePercent) ?? 0;

    const rollupDraft: RecipeRollupDraft | null = useMemo(
        () =>
            lineInputs.length === 0
                ? null
                : {
                      recipeId: data?.id ?? null,
                      servings: yieldPieces !== null && yieldPieces > 0 ? yieldPieces : null,
                      wastePercent,
                      lines: lineInputs,
                      ...(yieldMass !== null && yieldMass > 0
                          ? { yieldQuantity: yieldMass, yieldUnit: details.yieldUnit }
                          : {}),
                      ...(yieldPieces !== null && yieldPieces > 0
                          ? { yieldPieceCount: yieldPieces }
                          : {}),
                      /*
                       * The same rows the Packaging tab holds, sent with the draft.
                       *
                       * Without them the preview costed a batch that ships in nothing, while the
                       * tab one click away listed three consumables.
                       */
                      ...(packagingInputs.length === 0 ? {} : { packaging: packagingInputs }),
                      packagingWastePercent,
                  },
        [
            data?.id,
            yieldMass,
            yieldPieces,
            details.yieldUnit,
            wastePercent,
            lineInputs,
            packagingInputs,
            packagingWastePercent,
        ],
    );

    // Debounced, so a quantity being typed is one request rather than four — the policy is on
    // `useDebouncedRollupDraft`, and it is what keeps the Technical sheet's figures from flickering
    // through three intermediate values on the way to the one that was meant.
    const previewDraft = useDebouncedRollupDraft(rollupDraft);
    const rollup = useRecipeRollupQuery(previewDraft);

    /*
     * Every cost figure on this screen, as the server computed it over the draft.
     *
     * Null while there is nothing to cost (no lines — and a query kept on its previous data must not
     * go on showing the last recipe's figures once the lines are gone), nothing to divide by (no
     * yield), nothing answered yet, or nothing this member may see.
     */
    const computed: RecipeComputedCost | null =
        previewDraft === null ? null : (rollup.data?.computedCost ?? null);
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

    /* ── what the server could not cost ──────────────────────────────────────────────────────── */

    /*
     * The uncosted lines by name, across both halves.
     *
     * Both, because a row is uncosted for the same two reasons on either tab — no recorded price, or
     * a unit that will not convert — and the reader wants the designation either way. The server
     * says *which* lines by number; its line figures say which ingredient each number is. Empty when
     * everything could be costed.
     */
    const uncostedNames = useMemo(() => {
        if (computed === null) return '';
        const names = new Set<string>();
        for (const [half, pool] of [
            [computed.production, libraryEntries],
            [computed.packaging, packagingLibrary],
        ] as const) {
            for (const lineNumber of half.uncostedLineNumbers) {
                const id = half.lines.find((line) => line.lineNumber === lineNumber)?.ingredientId;
                const entry = pool.find((candidate) => candidate.id === String(id));
                if (entry !== undefined) names.add(displayName(entry.name, locale).value);
            }
        }
        return [...names].join(', ');
    }, [computed, libraryEntries, packagingLibrary, locale]);

    // Derived rather than read off the record, so the Technical sheet tab answers from the draft.
    const allergenSources = rollup.data?.allergenSources ?? [];
    const rollupWarnings = rollup.data?.warnings ?? [];

    /**
     * Each warning as one sentence, with the ingredients it is about named.
     *
     * The whole reason the server sends `ingredientIds` beside the code. "Some ingredients carry no
     * reference facts" sends somebody down a list of forty lines; "no reference facts for Sumac"
     * sends them to one row. An id nobody can resolve prints as itself rather than disappearing —
     * the line is still the one at fault — and a code this screen has no copy for falls back to the
     * server's own sentence, which is the order `rollupWarningKey` exists to express.
     */
    const warningNotices = rollupWarnings.map((warning) => {
        const key = rollupWarningKey(warning.code);
        const names = warning.ingredientIds
            .map((id) => {
                const entry = libraryEntries.find(
                    (candidate) => String(candidate.id) === String(id),
                );
                return entry === undefined ? String(id) : displayName(entry.name, locale).value;
            })
            .join(t('kitchen:common.listSeparator'));

        return { code: warning.code, text: key === null ? warning.message : t(key, { names }) };
    });

    /** Every ingredient any warning names, so the rows at fault carry a mark of their own. */
    const flaggedIngredientIds = rollupWarnings.flatMap((warning) =>
        warning.ingredientIds.map(String),
    );

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
     * The margin is read against the server's total per yield unit — the cost of one yield unit
     * *after* both waste coefficients — and not against the raw line sum. That is the figure the
     * cascade's tinted card states directly above these fields, so the two answer the same question;
     * a margin against the batch total would be a percentage of a different denominator sitting
     * inches from the one it looks like it used.
     *
     * No margin across two currencies, and none on an incomplete formulation: the server withholds
     * the total for one, and a percentage of a cost missing a line is a flattering fiction.
     *
     * The trade price is the numerator, matching the ingredient editor: the B2C margin is a
     * different conversation (it carries delivery, packaging on the plate, and a channel fee this
     * screen knows nothing about), and stating it here as though it were the same sum would be the
     * confident kind of wrong.
     */
    const totalPerUnit = computed?.totalCostPerYieldUnit ?? null;
    const margin = marginPercent(
        b2bPriceValue,
        totalPerUnit !== null && (currency === null || totalPerUnit.currency === currency)
            ? totalPerUnit.amount
            : null,
    );

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

    /*
     * Everything that stops the save, in tab order, each naming the tab it lives on and the field
     * that fixes it. The banner, the tab pills and the fields all read this one list, so the three
     * cannot disagree about what is wrong.
     *
     * `required` separates a blank that only matters once Save is pressed from a value already
     * typed that does not parse — flagged as it is typed, because it is about something the reader
     * has just done.
     */
    const blockers: readonly {
        readonly key: string;
        readonly label: string;
        readonly tab: RecipeTab;
        readonly fieldId: string | null;
        readonly required: boolean;
    }[] = [
        ...(nameMissing
            ? [
                  {
                      key: 'name',
                      label: t('kitchen:bilingual.englishShort', {
                          field: t('kitchen:recipes.columnName'),
                      }),
                      tab: 'description' as const,
                      fieldId: 'kitchen-recipe-name-en',
                      required: true,
                  },
              ]
            : []),
        ...(yieldInvalid
            ? [
                  {
                      key: 'yield',
                      label: t('kitchen:recipes.yieldQuantity'),
                      tab: 'production' as const,
                      fieldId: 'kitchen-recipe-yield-quantity',
                      required: details.yieldQuantity.trim() === '',
                  },
              ]
            : []),
        ...(incompleteLines.length > 0
            ? [
                  {
                      key: 'lines',
                      label: t('kitchen:forms.incompleteLines', {
                          count: incompleteLines.length,
                      }),
                      tab: 'production' as const,
                      fieldId: null,
                      required: false,
                  },
              ]
            : []),
        ...(b2bPriceValue === undefined
            ? [
                  {
                      key: 'b2b-price',
                      label: t('kitchen:recipes.b2bPricePerUnit', {
                          unit: t(unitShortKey(details.yieldUnit)),
                      }),
                      tab: 'costing' as const,
                      fieldId: 'kitchen-recipe-b2b-price',
                      required: false,
                  },
              ]
            : []),
        ...(b2cPriceValue === undefined
            ? [
                  {
                      key: 'b2c-price',
                      label: t('kitchen:recipes.b2cPricePerUnit', {
                          unit: t(unitShortKey(details.yieldUnit)),
                      }),
                      tab: 'costing' as const,
                      fieldId: 'kitchen-recipe-b2c-price',
                      required: false,
                  },
              ]
            : []),
    ];

    const shownBlockers = attempted ? blockers : blockers.filter((entry) => !entry.required);
    const shows = (key: string) => shownBlockers.some((entry) => entry.key === key);

    /*
     * The two cautions the design draws. Neither blocks: a label at zero and a thin margin are both
     * legal, and both are almost always a mistake somebody wants pointed out.
     *
     * A packaging line at zero ships nothing and costs nothing — a sleeve label the count was never
     * typed for. A margin under the floor is priced below what the kitchen treats as viable, and one
     * under zero is priced below cost, which is the one this screen raises as an error rather than a
     * warning even though it still saves: it is a loss on every unit sold.
     */
    const zeroPackaging = packaging.filter((row) => parseQuantity(row.quantity) === 0);
    const marginLow = margin !== null && margin < MARGIN_WARNING_PERCENT;
    const marginNegative = margin !== null && margin < 0;

    const goTo = (target: RecipeTab, fieldId: string | null) => {
        setTab(target);
        if (fieldId !== null) focusField(fieldId);
    };

    const blockerItems: readonly FormIssueItem[] = shownBlockers.map((entry) => ({
        key: entry.key,
        label: entry.label,
        onPress: () => {
            goTo(entry.tab, entry.fieldId);
        },
    }));

    const zeroItems: readonly FormIssueItem[] = zeroPackaging.map((row) => {
        const entry = packagingLibrary.find((candidate) => candidate.id === row.ingredientId);
        return {
            key: `zero-${row.key}`,
            label:
                entry === undefined
                    ? t('kitchen:recipes.unnamedLine')
                    : displayName(entry.name, locale).value,
            onPress: () => {
                goTo('packaging', null);
            },
        };
    });

    /** What each tab's pill says: the blockers on it, or failing those its cautions. */
    const tabIssues = (target: RecipeTab) => {
        const errors = shownBlockers.filter((entry) => entry.tab === target).length;
        if (errors > 0) {
            return {
                count: errors,
                tone: 'danger' as const,
                label: t('kitchen:forms.toFixCount', { count: errors }),
            };
        }
        const cautions =
            target === 'packaging'
                ? zeroPackaging.length
                : target === 'costing' && marginLow
                  ? 1
                  : 0;
        if (cautions === 0) return undefined;
        return {
            count: cautions,
            tone:
                target === 'costing' && marginNegative ? ('danger' as const) : ('warning' as const),
            label: t('kitchen:forms.warningCount', { count: cautions }),
        };
    };

    /*
     * Save draft is pressable over an incomplete form. The press marks the form attempted — the
     * blank required fields say so, the banner names each — and takes the reader to the first,
     * switching tab on the way. Only a clean draft reaches `saveAll`.
     */
    const attemptSave = () => {
        setAttempted(true);
        const first = blockers[0];
        if (first !== undefined) {
            goTo(first.tab, first.fieldId);
            return;
        }
        saveAll();
    };

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

    const saveAll = (onDone?: () => void) => {
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
                    packagingWastePercent,
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
                        onCreated(created, { description: details.description });
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
                        packagingWastePercent,
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
                if (onDone !== undefined) onDone();
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

    /*
     * Publish writes the form first.
     *
     * The dialog reads the *saved* version — its allergen declarations, its blocked reasons — so
     * opening it over unsaved edits describes one recipe and publishes another. Saving first costs
     * a request nobody asked for and is the only order in which the dialog tells the truth.
     */
    const savePublish = () => {
        if (anyDirty && !saveBlocked) {
            saveAll(() => {
                setShowPublish(true);
            });
            return;
        }
        setShowPublish(true);
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
            <FormSkeleton
                testID="kitchen-recipe-editor-loading"
                partTestID="kitchen-recipe"
                sections={3}
            />
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

    /*
     * The handle beside the title — the record's own `RC-0104`, or while creating the one the save
     * is about to take. It replaces the summary line that stood under the title: the design keeps
     * the opening to one row, and every figure that line carried is now on the tab that owns it.
     */
    const headerReference = isCreating ? (nextReference.data ?? '') : (data?.reference ?? '');

    /* ── the technical sheet's own reading, and what still stands between it and a label ─────── */

    const noValue = t('kitchen:list.noValue');
    const yieldUnitLabel = t(unitShortKey(details.yieldUnit));
    const sheetMoney = (amount: CostAmount | null | undefined, digits: Intl.NumberFormatOptions) =>
        amount == null ? noValue : formatMoney(formatter, amount.amount, amount.currency, digits);

    /*
     * The sheet's figures, off the draft rather than the saved version, so the reading answers
     * while the recipe is still being written. The money rows are the server's cascade and are
     * left off for a reader who may not see costs at all, exactly as the header's line is.
     */
    const sheetRows: readonly {
        readonly key: string;
        readonly label: string;
        readonly value: string;
        readonly mono: boolean;
    }[] = [
        {
            key: 'designation',
            label: t('kitchen:recipes.sheetDesignation'),
            value:
                details.name.en.trim() === '' ? noValue : displayName(details.name, locale).value,
            mono: false,
        },
        {
            key: 'reference',
            label: t('kitchen:list.columnReference'),
            value: (isCreating ? nextReference.data : data?.reference) ?? noValue,
            mono: true,
        },
        {
            key: 'yield',
            label: t('kitchen:recipes.sheetQuantityProduced'),
            value: yieldInvalid
                ? noValue
                : yieldPieces !== null && yieldPieces > 0
                  ? t('kitchen:recipes.sheetYieldWithPortions', {
                        quantity: formatter.formatNumber(servings, YIELD_DIGITS),
                        unit: yieldUnitLabel,
                        pieces: formatter.formatNumber(yieldPieces, YIELD_DIGITS),
                    })
                  : t('kitchen:recipes.checkYieldOk', {
                        quantity: formatter.formatNumber(servings, YIELD_DIGITS),
                        unit: yieldUnitLabel,
                    }),
            mono: true,
        },
        ...(!canViewCosts
            ? []
            : [
                  {
                      key: 'production-cost',
                      label: t('kitchen:recipes.sheetCostTotal'),
                      value: sheetMoney(computed?.production.total, CASCADE_DIGITS),
                      mono: true,
                  },
                  {
                      key: 'production-per-unit',
                      label: t('kitchen:recipes.sheetProductionAfterWaste', {
                          unit: yieldUnitLabel,
                      }),
                      value: sheetMoney(
                          computed?.production.costPerYieldUnitWithWaste,
                          PER_UNIT_DIGITS,
                      ),
                      mono: true,
                  },
                  {
                      key: 'packaging-per-unit',
                      label: t('kitchen:recipes.sheetPackagingAfterWaste', {
                          unit: yieldUnitLabel,
                      }),
                      value: sheetMoney(
                          computed?.packaging.costPerYieldUnitWithWaste,
                          PER_UNIT_DIGITS,
                      ),
                      mono: true,
                  },
                  {
                      key: 'total-per-unit',
                      label: t('kitchen:recipes.cascadeTotal', { unit: yieldUnitLabel }),
                      value: sheetMoney(computed?.totalCostPerYieldUnit, PER_UNIT_DIGITS),
                      mono: true,
                  },
              ]),
        {
            key: 'allergens',
            label: t('kitchen:recipes.sheetAllergensDerived'),
            value:
                allergenSources.length === 0
                    ? t('kitchen:recipes.noAllergens')
                    : allergenSources
                          .map((source) => String(source.allergenCode))
                          .join(t('kitchen:common.listSeparator')),
            mono: false,
        },
        {
            key: 'restricted',
            label: t('kitchen:recipes.restricted'),
            // Every recipe, for the reason the header's badge gives.
            value: t('kitchen:recipes.sheetRestrictedValue'),
            mono: false,
        },
    ];

    /*
     * The draft's raw materials with no allergen mapping, by name.
     *
     * Read off the *draft* lines rather than the saved version the publish dialog reads, so the
     * check moves as lines are added. Unmapped is a warning rather than a failure for the reason
     * the dialog's own note gives: this contract cannot tell "free of all fourteen" from "never
     * checked".
     */
    const unmappedDraftNames = uniqueIngredientIds(lines)
        .map((id) => library.find((entry) => String(entry.id) === String(id)))
        .filter(
            (entry): entry is IngredientAdmin =>
                entry !== undefined && entry.allergens.length === 0,
        )
        .map((entry) => displayName(entry.name, locale).value)
        .join(t('kitchen:common.listSeparator'));

    const publishChecks: readonly {
        readonly key: string;
        readonly ok: boolean;
        readonly label: string;
        readonly note: string;
    }[] = [
        {
            key: 'languages',
            ok: !isTranslationIncomplete(details.name),
            label: t('kitchen:recipes.checkLanguages'),
            note: isTranslationIncomplete(details.name)
                ? t('kitchen:recipes.checkLanguagesMissing')
                : t('kitchen:recipes.checkLanguagesOk'),
        },
        {
            key: 'costed',
            ok: lines.length > 0 && uncostedNames === '',
            label: t('kitchen:recipes.checkCosted'),
            note:
                lines.length === 0
                    ? t('kitchen:recipes.checkNoLines')
                    : uncostedNames === ''
                      ? t('kitchen:recipes.checkCostedOk', {
                            count: lines.length + packaging.length,
                        })
                      : t('kitchen:recipes.uncostedLines', { names: uncostedNames }),
        },
        {
            key: 'yield',
            ok: !yieldInvalid,
            label: t('kitchen:recipes.checkYield'),
            note: yieldInvalid
                ? t('kitchen:recipes.checkYieldMissing')
                : t('kitchen:recipes.checkYieldOk', {
                      quantity: formatter.formatNumber(servings, YIELD_DIGITS),
                      unit: yieldUnitLabel,
                  }),
        },
        {
            key: 'allergens',
            ok: lines.length > 0 && unmappedDraftNames === '',
            label: t('kitchen:recipes.checkAllergens'),
            note:
                lines.length === 0
                    ? t('kitchen:recipes.checkNoLines')
                    : unmappedDraftNames === ''
                      ? t('kitchen:recipes.checkAllergensOk', { count: lines.length })
                      : t('kitchen:recipes.checkAllergensUnmapped', { names: unmappedDraftNames }),
        },
    ];

    const tabItems = [
        {
            value: 'description' as const,
            label: t('kitchen:recipes.tabDescription'),
            issues: tabIssues('description'),
            testID: 'kitchen-recipe-tab-description',
        },
        {
            value: 'production' as const,
            label: t('kitchen:recipes.tabProduction'),
            count: lines.length,
            issues: tabIssues('production'),
            testID: 'kitchen-recipe-tab-production',
        },
        {
            value: 'packaging' as const,
            label: t('kitchen:recipes.tabPackaging'),
            count: packaging.length,
            issues: tabIssues('packaging'),
            testID: 'kitchen-recipe-tab-packaging',
        },
        {
            value: 'costing' as const,
            label: t('kitchen:recipes.tabCosting'),
            issues: tabIssues('costing'),
            testID: 'kitchen-recipe-tab-costing',
        },
        // After the cost and before the sheet: what it costs, what it sells as, what it is.
        ...(sellsAs === undefined
            ? []
            : [
                  {
                      value: 'selling' as const,
                      label: sellsAs.label,
                      testID: 'kitchen-recipe-tab-selling',
                  },
              ]),
        {
            value: 'sheet' as const,
            label: t('kitchen:recipes.tabSheet'),
            testID: 'kitchen-recipe-tab-sheet',
        },
    ];

    return (
        <Stack space="md" testID="kitchen-recipe-editor-screen">
            {/*
             * The opening — title, badges, actions, the meta line and the tab row — is one 4px block
             * inside the page's 16px rhythm, exactly as the ingredient editor and the two lists
             * tighten theirs. No trail here: `KitchenOpsShell` draws it and this screen names its
             * last crumb through `useKitchenTrailLeaf`.
             */}
            <Stack space="sm">
                <CataloguePageHeader
                    testID="kitchen-recipe-editor-screen-header"
                    titleTestID="kitchen-recipe-editor-screen-title"
                    title={title}
                    titleAside={
                        <Inline space="xs" align="center" wrap>
                            <Badge
                                variant="caps"
                                testID="kitchen-recipe-editor-screen-status"
                                tone={data === undefined ? 'warning' : statusTone(data.meta.status)}
                                icon={null}
                                label={
                                    data === undefined
                                        ? t('kitchen:statusShort.draft')
                                        : t(statusShortKey(data.meta.status))
                                }
                            />
                            {headerReference === '' ? null : (
                                <Text
                                    testID="kitchen-recipe-editor-screen-reference"
                                    variant="mono"
                                    tone="secondary"
                                >
                                    {headerReference}
                                </Text>
                            )}
                            {/*
                             * On every recipe, not on the ones somebody remembered to mark. A
                             * formulation and its costs are confidential by their nature (plan
                             * §4.8), and a badge that appears only sometimes teaches the reader
                             * that its absence means "safe to share".
                             */}
                            <Badge
                                variant="caps"
                                testID="kitchen-recipe-editor-screen-restricted"
                                tone="danger"
                                label={t('kitchen:recipes.restricted')}
                            />
                            {guard.isDirty ? (
                                <Badge
                                    variant="label"
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
                            {/*
                             * The design's Cancel · Save draft · Publish, at the header's one `md`.
                             * While creating there is nothing to publish yet, so Save draft — which
                             * creates the record — takes the primary's weight: it is the commit that
                             * used to wait at the end of the step footer, now where every tab can
                             * reach it.
                             */}
                            <Button
                                testID="kitchen-recipe-editor-screen-discard"
                                variant="secondary"
                                label={t('kitchen:editor.cancel')}
                                onPress={() => {
                                    guard.intercept(goBack);
                                }}
                            />
                            <Button
                                testID="kitchen-recipe-editor-screen-save"
                                variant={isCreating ? 'primary' : 'secondary'}
                                label={t('kitchen:common.saveDraft')}
                                loading={create.isPending || update.isPending || setLines.isPending}
                                disabled={!canManage || !isEditable}
                                onPress={attemptSave}
                            />
                            {isCreating || !canManage ? null : (
                                <Button
                                    testID="kitchen-recipe-publish"
                                    label={t('kitchen:publish.action')}
                                    disabled={!isEditable}
                                    onPress={savePublish}
                                />
                            )}
                        </Inline>
                    }
                />

                {blockerItems.length === 0 && zeroItems.length === 0 && !marginLow ? null : (
                    <Inline space="xs" wrap testID="kitchen-recipe-issues">
                        {blockerItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-recipe-issues-errors"
                                tone="danger"
                                summary={t(
                                    shownBlockers.every((entry) => entry.required)
                                        ? 'kitchen:forms.requiredCount'
                                        : 'kitchen:forms.toFixCount',
                                    { count: blockerItems.length },
                                )}
                                items={blockerItems}
                            />
                        )}
                        {zeroItems.length === 0 ? null : (
                            <FormIssueBanner
                                testID="kitchen-recipe-issues-zero"
                                tone="warning"
                                summary={t('kitchen:forms.atZeroCount', {
                                    count: zeroItems.length,
                                })}
                                items={zeroItems}
                            />
                        )}
                        {!marginLow ? null : (
                            <FormIssueBanner
                                testID="kitchen-recipe-issues-margin"
                                tone={marginNegative ? 'danger' : 'warning'}
                                summary={t(
                                    marginNegative
                                        ? 'kitchen:forms.marginBelowCost'
                                        : 'kitchen:forms.marginLow',
                                    { percent: MARGIN_WARNING_PERCENT },
                                )}
                                items={[
                                    {
                                        key: 'margin',
                                        label: t('kitchen:recipes.grossMargin'),
                                        onPress: () => {
                                            goTo('costing', 'kitchen-recipe-margin');
                                        },
                                    },
                                ]}
                            />
                        )}
                    </Inline>
                )}

                <Tabs<RecipeTab>
                    testID="kitchen-recipe-tabs"
                    label={t('kitchen:recipes.tabsLabel')}
                    items={tabItems}
                    value={tab}
                    onChange={setTab}
                    variant="steps"
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
                <View className="relative z-raised flex-col gap-loose">
                    {/*
                     * Every tab body is one raised layer, and the same is true of the four below.
                     *
                     * react-native-web gives every `View` `position: relative; z-index: 0`, so a
                     * subtree paints as one layer, in source order among its siblings, whatever its
                     * descendants set on themselves. The Previous/Next row is drawn *after* the tab
                     * body, so without this raise it painted over anything that hung out of the
                     * body — the ingredient picker, the packaging picker, the sub-category select —
                     * exactly where a panel opens downward into it. Raising the body above the row
                     * is what orders the two; the panels' own z-indexes keep ordering the body's
                     * insides.
                     */}
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-recipe-identity"
                        title={t('kitchen:recipes.sectionIdentity')}
                    >
                        <View className="z-auto flex-row flex-wrap items-start gap-base">
                            <ImageSlot
                                testID="kitchen-recipe-image"
                                uri={image}
                                disabled={!editable}
                                onChange={setImage}
                            />
                            {/*
                             * Four half tracks beside the photo — two 280px fields: the designation
                             * pair on the first row, the filing and the handle under it.
                             *
                             * The classification cells are two children of the grid, never one
                             * wrapper around both: `FormGrid` gives each *element* child its own
                             * cell, and a fragment is one child. Drawn only where the route knows
                             * the vocabulary — the category is stated, not asked, because a form
                             * reached through Sauces & marinades cannot be filed anywhere else.
                             */}
                            <FormGrid
                                track="half"
                                maxColumns={4}
                                testID="kitchen-recipe-identity-grid"
                            >
                                <BilingualField
                                    span={4}
                                    layout="row"
                                    testID="kitchen-recipe-name"
                                    fieldLabel={t('kitchen:recipes.columnName')}
                                    placeholder={{
                                        en: t('kitchen:fields.recipeNamePlaceholderEn'),
                                        ar: t('kitchen:fields.recipeNamePlaceholderAr'),
                                    }}
                                    value={details.name}
                                    requiredEnglish
                                    disabled={!editable}
                                    {...(shows('name')
                                        ? { englishError: t('kitchen:forms.required') }
                                        : {})}
                                    onChange={(next) => {
                                        setDetails({ ...details, name: next });
                                        markDirty('details');
                                    }}
                                />
                                {/*
                                 * Only when creating something sold — a sauce, a dressing, a
                                 * frozen meal, a meal: the description is its catalogue item's, and
                                 * once it exists it is edited on the Selling tab with the rest of
                                 * the listing. A library recipe sells nothing and draws none.
                                 */}
                                {!isCreating || onCreated === undefined ? null : (
                                    <BilingualField
                                        span={4}
                                        layout="row"
                                        multiline
                                        testID="kitchen-recipe-description"
                                        fieldLabel={t('kitchen:products.descriptionLabel')}
                                        placeholder={{
                                            en: t('kitchen:fields.descriptionPlaceholderEn'),
                                            ar: t('kitchen:fields.descriptionPlaceholderAr'),
                                        }}
                                        value={details.description}
                                        disabled={!editable}
                                        onChange={(next) => {
                                            setDetails({ ...details, description: next });
                                            markDirty('details');
                                        }}
                                    />
                                )}
                                {classification === undefined ? null : (
                                    <TextInputField
                                        span={2}
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
                                 * Dressings pass no options: the sheets file all fourteen alike,
                                 * and a picker with one option is a label wearing a chevron.
                                 */}
                                {classification === undefined ||
                                classification.options.length === 0 ? null : (
                                    <Select
                                        span={2}
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
                                {/*
                                 * Read, never written: the series is the server's to issue — and
                                 * not drawn on a new record, where it could only preview a number
                                 * the save has not taken yet. The preview stays beside the title.
                                 * The record's own `RC-0001`, not its slug: a slug follows the name.
                                 */}
                                {isCreating ? null : (
                                    <TextInputField
                                        span={2}
                                        testID="kitchen-recipe-reference"
                                        id="kitchen-recipe-reference"
                                        label={t('kitchen:list.columnReference')}
                                        size="sm"
                                        placeholder={t('kitchen:fields.referencePlaceholder')}
                                        value={headerReference}
                                        disabled
                                        onChangeText={() => undefined}
                                    />
                                )}
                            </FormGrid>
                        </View>
                    </FormSection>

                    {isCreating ? null : (
                        <FormSection
                            variant="underlined"
                            testID="kitchen-recipe-versions"
                            title={t('kitchen:recipes.sectionVersions')}
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
                </View>
            )}

            {/* ── Production ───────────────────────────────────────────────────────────────── */}
            {tab !== 'production' ? null : (
                <View className="relative z-raised flex-col gap-loose">
                    {/*
                     * Yield & waste above the formulation, as one reading: a yield is only
                     * meaningful beside the lines it is divided into — "1.7 kg from these nine
                     * rows" — and the production loss is a property of the same pan. The packaging
                     * loss sits above the packaging lines the same way.
                     */}
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-recipe-yield"
                        title={t('kitchen:forms.yieldAndWaste')}
                    >
                        <FormGrid track="half" testID="kitchen-recipe-yield-grid">
                            {/*
                             * The unit rides on the field as a suffix rather than sitting in a
                             * picker beside it. Every recipe in this kitchen yields a mass, the cost
                             * cascade divides by kilograms, and a unit selector whose other options
                             * all produce a cost per portion the costing tab cannot read is a choice
                             * offered only to be wrong. `kg` is stated, not chosen.
                             */}
                            <QuantityInput
                                testID="kitchen-recipe-yield-quantity"
                                id="kitchen-recipe-yield-quantity"
                                label={t('kitchen:recipes.yieldQuantity')}
                                placeholder={t('kitchen:fields.quantityPlaceholder')}
                                size="sm"
                                required
                                unit={t(unitShortKey('kg'))}
                                value={details.yieldQuantity}
                                disabled={!editable}
                                {...(shows('yield')
                                    ? {
                                          error:
                                              details.yieldQuantity.trim() === ''
                                                  ? t('kitchen:forms.required')
                                                  : t('kitchen:recipes.yieldRequired'),
                                      }
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
                                placeholder={t('kitchen:fields.quantityPlaceholder')}
                                size="sm"
                                value={details.yieldPieces}
                                disabled={!editable}
                                onChangeText={(next) => {
                                    setDetails({ ...details, yieldPieces: next });
                                    markDirty('details');
                                }}
                            />
                            <QuantityInput
                                testID="kitchen-recipe-waste"
                                id="kitchen-recipe-waste"
                                label={t('kitchen:recipes.productionWastePercent')}
                                placeholder={t('kitchen:fields.percentPlaceholder')}
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
                        variant="underlined"
                        testID="kitchen-recipe-lines"
                        title={t('kitchen:recipes.sectionRawMaterials')}
                    >
                        <RecipeLineTable
                            testID="kitchen-recipe-lines-table"
                            rows={lines}
                            ingredients={libraryEntries}
                            flaggedIngredientIds={flaggedIngredientIds}
                            costs={computed?.production ?? null}
                            canManage={editable}
                            nextKey={nextKey}
                            pickerPlaceholder={t('kitchen:recipes.addIngredientPlaceholder')}
                            onChange={(next) => {
                                setLinesDraft(next);
                                markDirty('lines');
                            }}
                        />
                    </FormSection>
                </View>
            )}

            {/* ── Packaging ────────────────────────────────────────────────────────────────── */}
            {tab !== 'packaging' ? null : (
                <View className="relative z-raised flex-col gap-loose">
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-recipe-packaging-coefficients"
                        title={t('kitchen:forms.expiryAndWaste')}
                    >
                        <FormGrid track="half" testID="kitchen-recipe-packaging-waste-grid">
                            {/*
                             * How long a packed batch keeps — a property of the pack as much as of
                             * the formulation, so it sits with the packaging. Not saved: see the
                             * docblock.
                             */}
                            <QuantityInput
                                testID="kitchen-recipe-expiry"
                                id="kitchen-recipe-expiry"
                                size="sm"
                                label={t('kitchen:forms.expiryPeriod')}
                                placeholder={t('kitchen:fields.daysPlaceholder')}
                                unit={t('kitchen:forms.days')}
                                value={expiryDays}
                                disabled={!editable}
                                onChangeText={setExpiryDays}
                            />
                            <QuantityInput
                                testID="kitchen-recipe-packaging-waste"
                                id="kitchen-recipe-packaging-waste"
                                label={t('kitchen:recipes.packagingWastePercent')}
                                placeholder={t('kitchen:fields.percentPlaceholder')}
                                size="sm"
                                unit="%"
                                value={details.packagingWastePercent}
                                disabled={!editable}
                                onChangeText={(next) => {
                                    setDetails({ ...details, packagingWastePercent: next });
                                    markDirty('details');
                                }}
                            />
                        </FormGrid>
                    </FormSection>

                    {/*
                     * The picker's panel opens downward into whatever is drawn after the table, so
                     * the section it hangs from is raised: a z-index orders an element against its
                     * siblings in one stacking context, and this subtree has to paint above the
                     * next one whatever the views in between do with their own.
                     */}
                    <View className="relative z-sticky">
                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-recipe-packaging"
                            title={t('kitchen:recipes.sectionPackaging')}
                        >
                            <RecipeLineTable
                                testID="kitchen-recipe-packaging-table"
                                rows={packaging}
                                ingredients={packagingLibrary}
                                source="packaging"
                                warnZeroQuantity
                                costs={computed?.packaging ?? null}
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
                </View>
            )}

            {/* ── Costing ──────────────────────────────────────────────────────────────────── */}
            {tab !== 'costing' ? null : (
                <View className="relative z-raised flex-col gap-loose">
                    <FormSection
                        first
                        variant="underlined"
                        testID="kitchen-recipe-cost-cascade"
                        title={t('kitchen:recipes.sectionCostCascade')}
                        // Kept where the design drops its subtitles: it says which price the
                        // figures are built on, so a number that moves tomorrow can be traced.
                        description={t('kitchen:recipes.costCascadeHint')}
                        aside={
                            <Badge
                                variant="label"
                                tone="danger"
                                icon="eyeOff"
                                label={t('kitchen:recipes.confidential')}
                            />
                        }
                    >
                        {canViewCosts ? (
                            <Stack space="sm">
                                <CostCascade
                                    testID="kitchen-recipe-cost-cards"
                                    computed={computed}
                                    yieldUnit={t(unitShortKey(details.yieldUnit))}
                                    productionWaste={details.wastePercent}
                                    packagingWaste={details.packagingWastePercent}
                                    t={t}
                                    formatter={formatter}
                                />

                                {/*
                                 * What makes the figures above less than the whole story, said under
                                 * them rather than left for somebody to notice.
                                 *
                                 * A line with no price is *excluded* from the sums and withholds the
                                 * total, so without this the cascade reads as the cost of a
                                 * formulation it has only partly costed — and it names the lines,
                                 * because "some lines" is not something a person can act on.
                                 */}
                                {uncostedNames === '' ? null : (
                                    <Text
                                        testID="kitchen-recipe-uncosted"
                                        variant="caption"
                                        tone="warning"
                                    >
                                        {t('kitchen:recipes.uncostedLines', {
                                            names: uncostedNames,
                                        })}
                                    </Text>
                                )}
                            </Stack>
                        ) : (
                            // Said, rather than drawn as a grid of dashes nobody can explain.
                            <Text
                                testID="kitchen-recipe-costs-hidden"
                                variant="caption"
                                tone="secondary"
                            >
                                {t('kitchen:recipes.sheetCostHidden')}
                            </Text>
                        )}
                    </FormSection>

                    {/*
                     * Between the cascade and the prices, because that is the order the question is
                     * asked in: what does a kilogram cost, what does one of the things we actually
                     * sell cost, what do we charge for it.
                     */}
                    {!canViewCosts ? null : (
                        <FormSection
                            variant="underlined"
                            testID="kitchen-recipe-package-costs"
                            title={t('kitchen:recipes.sectionPackageCosts')}
                        >
                            <PackageCosts
                                testID="kitchen-recipe-package-costs"
                                computed={computed}
                                rows={packaging}
                                packagingItems={packagingLibrary}
                                yieldInvalid={yieldInvalid}
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
                        variant="underlined"
                        testID="kitchen-recipe-coefficients"
                        title={t('kitchen:forms.price')}
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

                            <FormGrid track="half" testID="kitchen-recipe-coefficients-grid">
                                <QuantityInput
                                    testID="kitchen-recipe-b2b-price"
                                    id="kitchen-recipe-b2b-price"
                                    size="sm"
                                    label={t('kitchen:recipes.b2bPricePerUnit', {
                                        unit: t(unitShortKey(details.yieldUnit)),
                                    })}
                                    placeholder={t('kitchen:fields.unitPricePlaceholder')}
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
                                    {...(shows('b2b-price')
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
                                    placeholder={t('kitchen:fields.unitPricePlaceholder')}
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
                                    {...(shows('b2c-price')
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
                                    {...(marginNegative
                                        ? { error: t('kitchen:forms.marginBelowCost') }
                                        : marginLow
                                          ? {
                                                warning: t('kitchen:forms.marginLow', {
                                                    percent: MARGIN_WARNING_PERCENT,
                                                }),
                                            }
                                          : {})}
                                    value={
                                        margin === null
                                            ? ''
                                            : formatter.formatNumber(margin, {
                                                  minimumFractionDigits: 1,
                                                  maximumFractionDigits: 1,
                                                  signDisplay: 'exceptZero',
                                              })
                                    }
                                    onChangeText={() => undefined}
                                />
                            </FormGrid>
                        </Stack>
                    </FormSection>
                </View>
            )}

            {/* ── Selling ──────────────────────────────────────────────────────────────────── */}
            {/*
             * Mounted whenever there is a listing, and hidden rather than unmounted on the other tabs.
             * Its drafts live inside it, so unmounting it on a tab switch would throw away a pack
             * somebody had half typed — the recipe's own drafts survive a switch because they live on
             * this screen, and the listing's have to as well.
             */}
            {sellsAs === undefined ? null : (
                <View
                    className={tab === 'selling' ? 'relative z-raised' : 'hidden'}
                    testID="kitchen-recipe-selling"
                >
                    {sellsAs.content}
                </View>
            )}

            {/* ── Technical sheet ──────────────────────────────────────────────────────────── */}
            {tab !== 'sheet' ? null : (
                <View className="relative z-raised flex-col gap-loose lg:flex-row lg:items-start">
                    <View className="min-w-0 flex-1 flex-col gap-loose">
                        {/*
                         * The sheet as a reader checks it before publishing: one ledger of the figures
                         * the other steps produced, from the draft rather than the saved version, so it
                         * answers while a recipe is still being written.
                         */}
                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-recipe-sheet-summary"
                            title={t('kitchen:recipes.sheetTitle')}
                        >
                            <View className="flex-col">
                                {sheetRows.map((row) => (
                                    <View
                                        key={row.key}
                                        testID={`kitchen-recipe-sheet-summary-${row.key}`}
                                        className="min-h-8 flex-row items-baseline gap-snug border-b border-stroke-subtle py-hair"
                                    >
                                        <View className="w-44 shrink-0">
                                            <Text variant="caption" tone="secondary">
                                                {row.label}
                                            </Text>
                                        </View>
                                        <Text
                                            testID={`kitchen-recipe-sheet-summary-${row.key}-value`}
                                            variant={row.mono ? 'mono' : 'label'}
                                        >
                                            {row.value}
                                        </Text>
                                    </View>
                                ))}
                            </View>
                        </FormSection>

                        <FormSection
                            first
                            variant="underlined"
                            testID="kitchen-recipe-composition"
                            title={t('kitchen:forms.nutritionTitle')}
                            aside={
                                <Badge
                                    variant="label"
                                    tone="info"
                                    label={t('kitchen:composition.fromDatabase')}
                                />
                            }
                        >
                            <DerivedPanel
                                testID="kitchen-recipe-composition-panel"
                                variant="outline"
                                figures={nutrientFigures(
                                    rollup.data?.per100g ?? null,
                                    t,
                                    formatter,
                                )}
                                emptyValue={t('kitchen:list.noValue')}
                            />

                            {/*
                             * Why the tiles are dashes, in the reader's language and naming the row.
                             * The panel above withholds every figure the moment one line cannot be
                             * resolved, and a panel of dashes with no reason beside it is the version
                             * of this screen a kitchen files a bug against.
                             */}
                            {warningNotices.length === 0 ? null : (
                                <Stack space="sm" testID="kitchen-recipe-composition-warnings">
                                    {warningNotices.map((notice) => (
                                        <Callout
                                            key={notice.code}
                                            testID={`kitchen-recipe-composition-warnings-warning-${notice.code}`}
                                            tone="warning"
                                            role="status"
                                            title={notice.text}
                                        />
                                    ))}
                                </Stack>
                            )}
                        </FormSection>

                        {/*
                         * The chips come from the *roll-up*, not from the saved version, which is what
                         * lets this tab answer while a recipe is still being written: the roll-up is
                         * computed from the draft lines. `origin` is not on `AllergenSource` — it is a
                         * derivation by definition — so nothing here claims a hand-declared entry.
                         */}
                        <FormSection
                            variant="underlined"
                            testID="kitchen-recipe-allergens"
                            title={t('kitchen:forms.allergensTitle')}
                            aside={
                                <Badge
                                    variant="label"
                                    tone="info"
                                    label={t('kitchen:composition.fromDatabase')}
                                />
                            }
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
                                            source.containment === 'contains'
                                                ? 'danger'
                                                : 'warning';
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
                            variant="underlined"
                            testID="kitchen-recipe-sheet"
                            title={t('kitchen:recipes.sheetPrintTitle')}
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
                    </View>

                    {/*
                     * The rail: what stands between this draft and a published label, live. The
                     * publish dialog re-reads the saved version and is the gate; this is the reading
                     * a person works from while there is still something to fix.
                     */}
                    <View
                        testID="kitchen-recipe-publish-checks"
                        className="flex-col lg:w-72 lg:shrink-0"
                    >
                        <FormSection
                            first
                            variant="underlined"
                            title={t('kitchen:recipes.publishChecksTitle')}
                        >
                            <View className="flex-col">
                                {publishChecks.map((check) => (
                                    <View
                                        key={check.key}
                                        testID={`kitchen-recipe-check-${check.key}`}
                                        accessibilityLabel={`${check.label}: ${check.note}`}
                                        className="flex-row items-start gap-tight border-b border-stroke-subtle py-tight"
                                    >
                                        <Icon
                                            name={check.ok ? 'check' : 'warning'}
                                            size="sm"
                                            className={
                                                check.ok
                                                    ? 'text-success-strong'
                                                    : 'text-warning-strong'
                                            }
                                        />
                                        <View className="min-w-0 flex-1 flex-col">
                                            <Text variant="label">{check.label}</Text>
                                            <Text
                                                testID={`kitchen-recipe-check-${check.key}-note`}
                                                variant="caption"
                                                tone="secondary"
                                            >
                                                {check.note}
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        </FormSection>
                    </View>
                </View>
            )}

            {/* ── Previous / Next — walks the tab row one step at a time ─────────────────────── */}
            <TabStepNavigation<RecipeTab>
                testID="kitchen-recipe-steps-nav"
                items={tabItems}
                value={tab}
                onChange={setTab}
            />

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

/**
 * Below this gross margin a price is flagged — the design's amber field. A warning and not a
 * refusal: a loss-leader is a decision a kitchen is allowed to make, and the flag is there so it is
 * made on purpose. Below zero the same field turns to an error, because that price loses money on
 * every unit sold — it still saves, for the same reason.
 */
const MARGIN_WARNING_PERCENT = 30;

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
    computed,
    yieldUnit,
    productionWaste,
    packagingWaste,
    t,
    formatter,
    testID,
}: {
    /** `null` draws every figure as a dash — see `computed` in the editor for when that is. */
    readonly computed: RecipeComputedCost | null;
    readonly yieldUnit: string;
    /** The rates as typed, for the labels. The figures carry the rates the server applied. */
    readonly productionWaste: string;
    readonly packagingWaste: string;
    readonly t: TFunction;
    readonly formatter: Formatter;
    readonly testID: string;
}) {
    /** Each figure in its own currency, or the dash — never a zero, which would be a measurement. */
    const money = (amount: CostAmount | null | undefined, digits: Intl.NumberFormatOptions) =>
        amount == null
            ? t('kitchen:list.noValue')
            : formatMoney(formatter, amount.amount, amount.currency, digits);

    const production = computed?.production;
    const packaging = computed?.packaging;

    const cards = [
        {
            key: 'production',
            title: t('kitchen:recipes.costProduction'),
            tone: 'raised' as const,
            rows: [
                {
                    label: t('kitchen:recipes.costTotal'),
                    value: money(production?.total, CASCADE_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPerUnit', { unit: yieldUnit }),
                    value: money(production?.costPerYieldUnit, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costWithWaste', { percent: productionWaste }),
                    value: money(production?.costPerYieldUnitWithWaste, PER_UNIT_DIGITS),
                    lead: true,
                },
                /*
                 * Per piece, where the yield counts pieces as well as weighing them. The figure a
                 * portioned item is priced against, and absent rather than a dash when the version
                 * never said how many pieces a batch makes.
                 */
                ...(production?.costPerPieceWithWaste == null
                    ? []
                    : [
                          {
                              label: t('kitchen:recipes.costPerPieceWithWaste', {
                                  percent: productionWaste,
                              }),
                              value: money(production.costPerPieceWithWaste, PER_UNIT_DIGITS),
                              lead: true,
                          },
                      ]),
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
                    value: money(packaging?.total, CASCADE_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPerUnit', { unit: yieldUnit }),
                    value: money(packaging?.costPerYieldUnit, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costWithWaste', { percent: packagingWaste }),
                    value: money(packaging?.costPerYieldUnitWithWaste, PER_UNIT_DIGITS),
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
                    value: money(production?.costPerYieldUnitWithWaste, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    label: t('kitchen:recipes.costPackaging'),
                    value: money(packaging?.costPerYieldUnitWithWaste, PER_UNIT_DIGITS),
                    lead: false,
                },
                {
                    // Null unless both halves are whole: a total short by an unpriced line reads
                    // exactly like a complete one.
                    label: t('kitchen:recipes.costPerUnit', { unit: yieldUnit }),
                    value: money(computed?.totalCostPerYieldUnit, PER_UNIT_DIGITS),
                    lead: true,
                },
            ],
        },
    ];

    const drawn = [...cards, ...packagingCards];

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
 * What one filled package costs, one tile per packaging line the server could cost.
 *
 * The cascade above states a cost per *yield unit*, which is the figure a formulation is priced on
 * and not the one anybody quotes: a kitchen sells a 300 cc bottle, not a kilogram. The server
 * converts it — the product the container holds at the production cost with waste, plus the
 * container at its own waste rate (`RecipeCostingService::costPerPackage`) — and this draws one tile
 * per line it answered.
 *
 * A line it could not answer is named rather than drawn at zero: an item that records no capacity (a
 * lid holds nothing) or a capacity the yield unit cannot express. Until every raw material is priced
 * the server answers for none of them, and the section says that instead — a package cost built on
 * a formulation missing a line reads exactly like a complete one.
 */
function PackageCosts({
    computed,
    rows,
    packagingItems,
    yieldInvalid,
    locale,
    t,
    formatter,
    testID,
}: {
    readonly computed: RecipeComputedCost | null;
    readonly rows: readonly LineDraft[];
    readonly packagingItems: readonly PickerEntry[];
    /** No usable yield means no cost per yield unit, so there is nothing to multiply a capacity by. */
    readonly yieldInvalid: boolean;
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

    // The rows as sent, so the server's line numbers index them (see `isSendableLine`).
    const sent = rows.filter(isSendableLine);

    if (computed !== null && sent.length > 0 && !computed.production.isComplete) {
        return (
            <Text testID={`${testID}-incomplete`} variant="caption" tone="secondary">
                {t('kitchen:recipes.packageCostsIncomplete')}
            </Text>
        );
    }

    /*
     * A line the section cannot cost is named rather than dropped.
     *
     * The fix is on the packaging record either way, and a reader who sees the caption "none" under
     * two lines of boxes cannot tell which record to open — so the names go on the caption.
     */
    const skipped: string[] = [];

    const cards = (computed?.packages ?? []).flatMap((pack) => {
        const row = sent[pack.lineNumber - 1];
        const entry = packagingItems.find(
            (candidate) => candidate.id === String(pack.ingredientId),
        );
        // Still resolving, or an answer to a draft the rows have since moved past — the refetch is
        // already on its way, and a tile under the wrong box would be worse than a moment without.
        if (
            row === undefined ||
            row.ingredientId !== String(pack.ingredientId) ||
            entry === undefined
        ) {
            return [];
        }

        const title = displayName(entry.name, locale).value;
        if (pack.cost === null) {
            skipped.push(title);
            return [];
        }

        return [
            {
                key: row.key,
                title,
                rows: [
                    {
                        label: t('kitchen:recipes.packageInBatch', { quantity: row.quantity }),
                        value: '',
                        lead: false,
                    },
                    ...(entry.capacity === null
                        ? []
                        : [
                              {
                                  label: t('kitchen:recipes.packageHolds', {
                                      quantity: formatter.formatNumber(
                                          entry.capacity.quantity,
                                          YIELD_DIGITS,
                                      ),
                                      unit: t(unitShortKey(entry.capacity.unit)),
                                  }),
                                  value: '',
                                  lead: false,
                              },
                          ]),
                    {
                        label: t('kitchen:recipes.packageCostLabel'),
                        value: formatMoney(
                            formatter,
                            pack.cost.amount,
                            pack.cost.currency,
                            COST_DIGITS,
                        ),
                        lead: true,
                    },
                ],
            },
        ];
    });

    const names = skipped.join(', ');

    if (cards.length === 0) {
        // Nothing to name is "no packaging yet" (or an answer still on its way); something to name
        // is a list of records to open.
        return skipped.length === 0 ? (
            <Text testID={`${testID}-no-lines`} variant="caption" tone="secondary">
                {t('kitchen:recipes.packageCostsNoLines')}
            </Text>
        ) : (
            <Text testID={`${testID}-none`} variant="caption" tone="secondary">
                {t('kitchen:recipes.packageCostsNone', { names })}
            </Text>
        );
    }

    return (
        <Stack space="sm">
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
            {skipped.length === 0 ? null : (
                <Text testID={`${testID}-skipped`} variant="caption" tone="secondary">
                    {t('kitchen:recipes.packageCostsSkipped', { names })}
                </Text>
            )}
        </Stack>
    );
}

/* ------------------------------------------------------------------------------------------------
 * Composition
 * ---------------------------------------------------------------------------------------------- */

/**
 * The eight tiles the design draws, always eight, whether or not the roll-up has facts behind them.
 *
 * The same set, in the same order, as the ingredient editor's inputs: a figure the version has not
 * got comes back `null` and the panel draws an em dash, never a zero, and the row does not collapse.
 * `per100g` is the basis because that is the one the section title states and the one a label is
 * written in — which is why each tile carries its bare unit and not `/ 100 g` again. It is `null`
 * until the total mass is known, which is what the dashes mean before then.
 *
 * Both keys are written out rather than assembled from the id: an interpolated key that does not
 * exist is an English string appearing in Arabic at run time instead of a compile error.
 */
const PANEL_NUTRIENTS: readonly {
    readonly id: string;
    readonly labelKey: string;
    readonly unitKey: string;
}[] = [
    {
        id: 'energy',
        labelKey: 'nutrition:nutrients.energy',
        unitKey: 'kitchen:nutritionFacts.unitKcal',
    },
    {
        id: 'protein',
        labelKey: 'nutrition:nutrients.protein',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'carbohydrate',
        labelKey: 'nutrition:nutrients.carbohydrate',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'fat',
        labelKey: 'nutrition:nutrients.fat',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'fibre',
        labelKey: 'nutrition:nutrients.fibre',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'sugars',
        labelKey: 'nutrition:nutrients.sugars',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
    {
        id: 'sodium',
        labelKey: 'nutrition:nutrients.sodium',
        unitKey: 'kitchen:nutritionFacts.unitMilligrams',
    },
    {
        id: 'saturated_fat',
        labelKey: 'nutrition:nutrients.saturatedFat',
        unitKey: 'kitchen:nutritionFacts.unitGrams',
    },
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
                unit: t(nutrient.unitKey),
            },
        ];
    });
}
