import type { ApiFailure } from '@healthy360/api-client';
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
    Cascade,
    CascadeItem,
    Dialog,
    ErrorState,
    FormGrid,
    FormSection,
    FormSkeleton,
    Icon,
    Inline,
    IssueRevealScope,
    IssueTrayFrame,
    QuantityInput,
    Select,
    Stack,
    Tabs,
    Tag,
    Text,
    TextInputField,
    useIssueTrayController,
    useToast,
} from '@healthy360/design-system';
import type {
    CardTone,
    FormIssueItem,
    IssueCardItem,
    IssueGroup,
    IssueTrayContent,
    SelectOption,
    TagTone,
} from '@healthy360/design-system';
import { RecipeId } from '@healthy360/domain-types';
import { IngredientId } from '@healthy360/domain-types';
import type { RecipeVersionId } from '@healthy360/domain-types';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { Formatter } from '@healthy360/i18n';
import { coreNutrientDefinition, findAmount } from '@healthy360/nutrition';
import type { MeasureUnit, NutritionFacts } from '@healthy360/nutrition';
import { useRouter } from 'expo-router';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate, useCan } from '../../../access/gate.tsx';
import { toFailure } from '../../../data/hooks.ts';
import {
    endProcess,
    endProcessSavedOn,
    readActiveProcess,
    startProcess,
    useProcessStep,
} from '../../../navigation/active-process.ts';
import { pathnameOf, withQuery, withReturnTo } from '../../../navigation/return-to.ts';
import { createSessionDraftStore } from '../../../navigation/session-draft.ts';
import { useReturnTo } from '../../../navigation/use-return-to.ts';
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
    useSaveRecordPhotoMutation,
    useSetRecipeLinesMutation,
    useSetRecipePackagingMutation,
    useUpdateRecipeMutation,
} from '../../../data/kitchen-admin-hooks.ts';
import { BilingualField } from '../bilingual-field.tsx';
import { returnCrumbLabel } from '../came-from.ts';
import { CataloguePageHeader } from '../catalogue/catalogue-page-header.tsx';
import { DerivedPanel } from '../catalogue/derived-panel.tsx';
import type { DerivedFigure } from '../catalogue/derived-panel.tsx';
import {
    RECIPE_MANAGE_PERMISSION,
    RECIPE_VIEW_COSTS_PERMISSION,
    RECIPE_VIEW_PERMISSION,
} from '../entity-registry.ts';
import { focusField, focusSection } from '../field-focus.ts';
import {
    displayName,
    formatMoney,
    isTranslationIncomplete,
    parseQuantity,
    rollupWarningKey,
    statusKey,
    unitShortKey,
    withoutMinus,
} from '../format.ts';
import { ImageSlot } from '../image-slot.tsx';
import { ingredientFixHref, ingredientNeedsById } from '../ingredient-fix.ts';
import type { HostArchive } from '../host-save.ts';
import type { IngredientNeed } from '../ingredient-fix.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';
import {
    RecipeLineTable,
    ingredientEntry,
    isSendableLine,
    lineCellId,
    packagingEntry,
} from '../recipe-line-table.tsx';
import type { LineColumn, PickerEntry } from '../recipe-line-table.tsx';
import type { LineDraft } from '../recipe-line-table.tsx';
import { isLineReason, stockGapFieldId, stockGapFieldMessageKey } from '../recipe-stock-gap-fix.ts';
import { KitchenOnlyMark, RecipeVersionMenu } from '../recipe-version-menu.tsx';
import type { StockGapFix } from '../recipe-stock-gap-fix.ts';
import { serverFieldErrors } from '../server-field-errors.ts';
import { TechnicalSheetPanel } from '../technical-sheet-panel.tsx';
import { useOptimisticConcurrency } from '../use-optimistic-concurrency.ts';
import { useUnsavedGuard } from '../use-unsaved-guard.ts';

/**
 * `/kitchen/recipes/{recipe}` — the recipe editor, as `Catalogue.dc.html` draws it (`isRecipeEdit`,
 * around line 313).
 *
 * It is every kind in the recipe book — a meal, a sauce, a dressing, a frozen meal, a preparation.
 * A sauce is cooked and owns a recipe of its own — the import writes one per SC-/DR- row — so the
 * questions asked of one are these questions, and `RecipeBookEditScreen` hands the recipe here with
 * whatever sells it on a tab. The same tabs, because it is the same component rather than a copy of
 * it — a sauce's bottles are packaging lines exactly as a meal's box is.
 *
 * ```
 * Kitchen workspace › Recipes › Thousand Islands   <- the shell's trail
 * Thousand Islands  DRAFT  RC-0104  RESTRICTED      [ Cancel ] [ Save draft ] [ Publish ]
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │(1) Description │(2) Production 9 │(3) Packaging 3 ① │(4) Costing │(5) Sheet │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * ⊗ That save was refused.                          <- one line, only when a save fails
 * ```
 *
 * `Catalogue Forms.dc.html` (`isRecipe`) redraws the opening: the handle beside the title instead of
 * a summary line under it, and the tabs as numbered steps on a sunken track, each carrying its count
 * and — when something on it needs attention — a solid pill with the number of problems.
 *
 * ## Every problem is at its field, and the tab that holds it says so
 *
 * There is no list of problems under the header. Each one is said under the control it is about —
 * a blank name, a yield that does not parse, a raw material with no quantity, a field the server
 * refused — and counted on the pill of the tab that control is on, so a reader knows which tab to
 * open without opening all five. Save draft is in the header, on every tab, and a press that cannot
 * be sent opens the first tab with a problem and puts the cursor in the field; a refusal from the
 * server does the same with the first field it named. Publish over a blocked form does exactly
 * what Save does, rather than opening a dialog about a draft that cannot be written.
 *
 * ## Opened from a stock gap
 *
 * Stock gaps sends a gap the kitchen closes in a recipe here with `?fix=` (the reason), `?ingredient=`
 * (the line, when it is about one) and `?returnTo=` (the exact view it came from). The page opens on
 * Production with the field at fault focused and saying what is wrong, the line marked, and one strip
 * above the tabs naming the gap with the next step — Publish, or a new draft when the version is
 * locked — and the way back. Once published the strip says so, and its way back tells Stock gaps the
 * gap was fixed, so the list there can offer the retry.
 *
 * ## A raw material with a problem is a link to where it is fixed
 *
 * What an ingredient still owes the recipe — no allergen determination, unconfirmed nutrition, a
 * unit the roll-up cannot convert, no price (`ingredient-fix.ts`) — is said under its row, and the
 * row opens the ingredient's form with `?needs=` and a `?returnTo=` that comes back to this tab.
 * Unsaved work here is kept for the trip in a session draft (`recipeDrafts`) and put back on the
 * way in, so nothing is typed twice. The publish dialog's ingredient blockers open the same way.
 *
 * ## One Save for every tab
 *
 * Save draft writes everything unsaved on the page — Description, Production and Packaging, and
 * the Selling tab's listing too, which hands its save over (`host-save.ts`) — and then says once
 * that all of it saved; the header keeps saying so until the next edit. A listing that refuses
 * opens the Selling tab on its problem, and the toast says the recipe itself did save.
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
 * ## The photo is written after the recipe
 *
 * The photo on Description has an endpoint of its own, keyed on the recipe rather than a version,
 * so it is written once the recipe's own writes have answered — and a refused upload leaves the
 * recipe saved and says so in the save callout (BUG-14). Storage and the Restricted switch belong
 * to the Method section below and are not drawn, for the reason that section gives.
 *
 * ## The expiry period is the recipe's, and it saves on a published recipe too
 *
 * `shelfLifeDays` on Packaging is how many days a batch keeps; completing a batch adds it to the
 * production date to give the batch its use-by date. It is on Packaging rather than Description
 * because how long a batch keeps is a property of what it is packed in as much as of the
 * formulation. It is not required — a recipe without one leaves the cook to enter the date — so it
 * carries no required mark although the design's shelf life does.
 *
 * It is stored on the **recipe**, not the version: correcting how long food keeps must not put the
 * formulation back through review. So it is the one field that stays editable while the current
 * version is published, and a save there sends it alone — the version half of `updateRecipe` would
 * be refused with `catalogue.version_immutable`.
 *
 * **Everything on Packaging and Costing persists.** `setRecipePackaging` is a real endpoint
 * (`PUT …/versions/{version}/packaging`) and the save below calls it on create and on update alike;
 * the packaging waste rate is a version field, so it lives in `DetailsDraft` with everything else
 * `updateRecipe` writes.
 *
 * ## No prices on Costing
 *
 * Costing used to carry a B2B and a B2C price per yield unit, and a gross margin read off them. They
 * were a copy of the catalogue's prices that `kitchen:price-recipes-from-catalogue` wrote back onto
 * the version, so the kitchen kept the same price in two places and only the Selling tab's was ever
 * charged. The card is gone at the kitchen's request; the version columns are left as they are, and
 * a save no longer sends them, so nothing already stored is cleared. The waste rate used to be session-only, defaulting to
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
 * A published version cannot be edited — the server refuses the write with
 * `catalogue.version_immutable` (plan §4.7), and the change is a new draft copied from it. So this
 * screen never presents one as editable. The version list on Description renders it read-only with
 * the one control that can actually happen next.
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
     * The kitchen's own filing word for this formulation — `cooking_sauce`, `marinade_prep`.
     *
     * Edited only where the host supplies the vocabulary for it: a meal, a preparation or a plain
     * recipe files nothing, because the book has no one list of words to offer them, while a sauce
     * is always one of four. The column is free text with no CHECK, so whatever is already stored
     * survives a save from a form that would not have offered it.
     */
    readonly recipeCategory: string;
    /**
     * Days a batch keeps — the recipe's, not the version's (see the module note). Blank is "nobody
     * has said", which the save sends as `null`.
     */
    readonly shelfLifeDays: string;
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
    recipeCategory: '',
    shelfLifeDays: '',
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
        recipeCategory: recipe.recipeCategory ?? '',
        shelfLifeDays: recipe.shelfLifeDays === null ? '' : String(recipe.shelfLifeDays),
    };
}

/**
 * The shelf life as the save sends it: blank is `null` (nobody has said), a whole number of days
 * the column takes (0–3650) is itself, and anything else is `undefined` — a value that blocks the
 * save, the way an unparsable price does.
 */
function parseShelfLife(value: string): number | null | undefined {
    if (value.trim() === '') return null;
    const days = parseQuantity(value);
    return days !== null && Number.isInteger(days) && days <= 3650 ? days : undefined;
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

/**
 * The page's unsaved drafts, kept while the reader is on an ingredient's form fixing a raw material
 * (see the module note). Keyed by recipe — or `new:<series>` for one not created yet — and by the
 * lock version they were drafted on: drafts written against a recipe that has since moved are
 * dropped rather than laid over somebody else's save.
 */
interface RecipeDetour {
    readonly serverKey: string | null;
    readonly details: DetailsDraft;
    readonly lines: readonly LineDraft[];
    readonly packaging: readonly LineDraft[];
    readonly rowOrdinal: number;
    readonly dirty: {
        readonly details: boolean;
        readonly lines: boolean;
        readonly packaging: boolean;
    };
}

const recipeDrafts = createSessionDraftStore<RecipeDetour>({
    namespace: 'recipeEditor',
    // An afternoon: a detour longer than that is not one the reader is coming back from.
    maxAgeMs: 2 * 60 * 60 * 1000,
    parse: (raw) => {
        if (typeof raw !== 'object' || raw === null) return null;
        const value = raw as Partial<RecipeDetour>;
        return typeof value.details === 'object' &&
            Array.isArray(value.lines) &&
            Array.isArray(value.packaging) &&
            typeof value.rowOrdinal === 'number' &&
            typeof value.dirty === 'object'
            ? (value as RecipeDetour)
            : null;
    },
});

/** A create stopped by the listing, which has already said why on its own tab. */
const LISTING_REFUSED = Symbol('listing-refused');

/** The tab a `?tab=` names, or `null` for anything that is not one. */
function recipeTabOf(value: string | undefined): RecipeTab | null {
    return (TAB_ORDER as readonly (string | undefined)[]).includes(value)
        ? (value as RecipeTab)
        : null;
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

/** A field the server can refuse, and where it is on this screen. */
interface ServerTarget {
    readonly label: string;
    readonly fieldId: string;
    readonly tab: RecipeTab;
}

/* ------------------------------------------------------------------------------------------------
 * Screen
 * ---------------------------------------------------------------------------------------------- */

export interface RecipeEditScreenProps {
    /** The route parameter. `'new'` or absent creates. */
    readonly recipe?: string | undefined;
    /**
     * Where Discard and the not-found notice return to. `/kitchen/recipes` unless the host says
     * otherwise — a sauce goes back to the book's Sauces tab, `/kitchen/recipes?kind=sauce`, the
     * list it came from.
     */
    readonly backTo?: string | undefined;
    /**
     * The filing the host already knows, and the words it offers for the rest of it.
     *
     * A recipe filed as a sauce knows its category is Sauces & marinations before the form is drawn
     * — its kind is what files it — so the category is stated rather than asked, and what is left to
     * choose is the sub-category. Omitted for a meal, a preparation and a plain recipe, where there
     * is no one list to offer.
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
     * The recipe book uses it to write the catalogue item that sells a new meal, sauce, dressing or
     * frozen meal before it lands on the recipe, so what was created here is sold as the kind it was
     * created as.
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
     * It drives the Ref. box on the create form. For a new sauce or dressing the handle it shows is
     * the *item's* — `SAC-044` — because that is the sauce's own handle, the one the list prints and
     * a cook quotes; the recipe behind it keeps a library `RC-` handle of its own.
     */
    readonly referenceSeries?: ReferenceSeries | undefined;
    /**
     * The catalogue item this formulation is sold as, drawn as a tab of its own.
     *
     * A sauce, a dressing or a meal is one thing to a kitchen and two records to the API: the recipe
     * it is made from and the item it is sold as. This editor owns the recipe; the host that read
     * what sells it owns the item, and hands its listing over as `content` so the two read as one
     * page.
     * They are still different records — different lock versions, different permissions — but one
     * Save draft writes both: the recipe's writes first, then `save`, the listing's own writes
     * (`host-save.ts`), which answers whether they went through.
     *
     * `isDirty` is the listing's unsaved state, so leaving this page asks first whichever half holds
     * the edit.
     */
    readonly sellsAs?:
        | {
              readonly label: string;
              readonly content: ReactNode;
              readonly isDirty?: boolean;
              readonly save?: (() => Promise<boolean>) | undefined;
              /** The listing's Archive, drawn in the header's action row while Selling is open. */
              readonly archive?: HostArchive | null | undefined;
          }
        | undefined;
    /** `?tab=` — the tab to open on. A stock gap's fix still opens on Production. */
    readonly initialTab?: string | undefined;
    /** `?kind=` of a new recipe, so a detour from the create form comes back to the same form. */
    readonly kind?: string | undefined;
    /**
     * This page's own address when it is not the recipe book's — an item with no recipe yet,
     * `/kitchen/recipes/item/{item}?kind=…` — so a detour to an ingredient comes back here.
     */
    readonly selfHref?: string | undefined;
    /** The name a new recipe starts with — the item it is being written for already has one. */
    readonly initialName?: LocalisedText | undefined;
    /**
     * `?swapFrom=&swapTo=` — a library ingredient the reader took into this kitchen while fixing it.
     * The server leaves existing recipes on the library row, so a draft's lines naming it move to
     * the copy here, unsaved, for the reader to Save.
     */
    readonly swapFrom?: string | undefined;
    readonly swapTo?: string | undefined;
    /**
     * `?returnTo=` — the page that sent the reader here, as written. Cancel, the trail's parent crumb
     * and a stock gap's "Back to stock gaps" return to it; without one, Cancel steps back through
     * history and only falls back to `backTo` after a refresh or a deep link.
     */
    readonly returnTo?: string | undefined;
    /** The stock gap this page was opened to fix — `parseStockGapFix` over `?fix=&ingredient=`. */
    readonly stockGapFix?: StockGapFix | null | undefined;
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

/**
 * An imported recipe's reference is its source file and its row — `v6-recipes.json#bbq-sauce-dip`.
 * The row is the id a person recognises; the file is where it came from, kept one (i) away.
 */
function splitReference(reference: string): {
    readonly id: string;
    readonly source: string | null;
} {
    const hash = reference.lastIndexOf('#');
    if (hash <= 0 || hash === reference.length - 1) return { id: reference, source: null };
    return { id: reference.slice(hash + 1), source: reference.slice(0, hash) };
}

/** The two line tables' roots — every row and cell id hangs off them (`lineCellId`). */
const LINES_TABLE = 'kitchen-recipe-lines-table';
const PACKAGING_TABLE = 'kitchen-recipe-packaging-table';

/** The tabs in the order a reader meets them, so a refused save opens the first one at fault. */
const TAB_ORDER: readonly RecipeTab[] = [
    'description',
    'production',
    'packaging',
    'costing',
    'selling',
    'sheet',
];

function RecipeEditor({
    recipe,
    backTo = '/kitchen/recipes',
    classification,
    onCreated,
    referenceSeries = 'RC-',
    sellsAs,
    returnTo,
    stockGapFix,
    initialTab,
    kind,
    selfHref,
    initialName,
    swapFrom,
    swapTo,
}: RecipeEditScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const toast = useToast();
    /*
     * The page's issue tray. Taken here rather than inside the frame so a refused save can open it
     * (`nudge`) — the tray is where the reader is sent instead of a strip under the tabs.
     */
    const issueTray = useIssueTrayController();
    const { nudge: nudgeTray } = issueTray;
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
    const photoSave = useSaveRecordPhotoMutation();

    /*
     * Leaving through the sidebar keeps this recipe's unsaved work as a draft (see `recipeDrafts`
     * below), so the guard lets the reader go — except while the listing or the photo is unsaved,
     * which no draft carries. Read when the reader navigates, from the line that knows both.
     */
    const draftKeepable = useRef(true);
    const guard = useUnsavedGuard({
        message: t('kitchen:unsaved.browserPrompt'),
        keepsDraft: () => draftKeepable.current,
    });
    // Cancel and the not-found notice step back the way the reader came; see `useReturnTo`.
    const back = useReturnTo(returnTo, backTo);

    /*
     * The stock gap this page was opened to fix, if any. Every reason this page can fix lives on
     * Production — the yield's piece count, a line, or the header's Publish — so that is the tab
     * it opens on.
     */
    const fix = stockGapFix ?? null;
    /** Set once the fix is published: the strip turns to "done" and its way back says so. */
    const [fixPublished, setFixPublished] = useState(false);
    const fixActive = fix !== null && !fixPublished;

    const [tab, setTab] = useState<RecipeTab>(
        fix === null ? (recipeTabOf(initialTab) ?? 'description') : 'production',
    );
    // What a Selling card's Fix does first: the listing's fields are on that tab.
    const revealSelling = useCallback(() => {
        setTab('selling');
    }, []);
    /** Set by a save that wrote everything; the header says so until the next edit. */
    const [allSaved, setAllSaved] = useState(false);
    const [listingSaving, setListingSaving] = useState(false);
    /** Whether a save has been pressed — what lets an empty required field call itself out. */
    const [attempted, setAttempted] = useState(false);
    /*
     * The design's photo, the link it was last filled from (`undefined` until the record arrives),
     * and whether it has been changed since. Rehydrated on its own key: the photo endpoint moves the
     * link and not the lock version.
     */
    const [photo, setPhoto] = useState<string | null>(null);
    const [photoKey, setPhotoKey] = useState<string | null | undefined>(undefined);
    const [photoDirty, setPhotoDirty] = useState(false);

    const [details, setDetails] = useState<DetailsDraft>(
        initialName === undefined ? EMPTY_DETAILS : { ...EMPTY_DETAILS, name: initialName },
    );
    const [lines, setLinesDraft] = useState<readonly LineDraft[]>([]);
    /*
     * A kind with one sub-category — a dressing's `salad_dressing` — is filed under it whatever the
     * draft holds: the picker shows it fixed, and both saves write it, so a record imported or
     * created without one is filed the next time it is saved.
     */
    const fixedSubcategory =
        classification?.options.length === 1 ? (classification.options[0]?.value ?? null) : null;
    const recipeCategory = fixedSubcategory ?? details.recipeCategory;

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
    // The failure itself, not its message: a validation refusal is put back on its fields.
    const [saveError, setSaveError] = useState<{ readonly failure: ApiFailure | null } | null>(
        null,
    );
    /**
     * A create in flight, from the press until the page has moved on.
     *
     * The mutations' own `isPending` drops between the recipe's writes and the host's `onCreated`
     * (which creates the meal listing before it navigates), and a second press in that gap made a
     * second recipe and a second listing. The ref blocks a press in the same tick; the state keeps
     * the button busy. Released only on failure — on success the page leaves.
     */
    // Holds the route parameter the create was started for, so a changed parameter releases it.
    const creatingRef = useRef<string | undefined | null>(null);
    const [creatingNow, setCreatingNow] = useState(false);
    // The router may keep this instance when `new` becomes the created id; start clean either way —
    // adjusted during render, React's pattern for state that follows a prop.
    const [creatingFor, setCreatingFor] = useState(recipe);
    if (creatingFor !== recipe) {
        setCreatingFor(recipe);
        setCreatingNow(false);
    }

    const data = record.data;
    const serverKey =
        data === undefined ? null : `${String(data.id)}:${String(data.meta.lockVersion)}`;
    const anyDirty = detailsDirty || linesDirty || packagingDirty || photoDirty;

    /*
     * One rehydration key for the whole record rather than one per section: every write answers with
     * the whole `RecipeAdmin`, and rebasing the untouched sections together is the only reading that
     * stays true.
     *
     * The key is the *recipe's* lock version, which opening a draft does not move — a new version
     * row is not a write to this one. The drafts keep what they were hydrated from, which is right
     * only because New draft copies exactly the version on screen.
     */
    if (data !== undefined && serverKey !== hydratedKey && !anyDirty) {
        setHydratedKey(serverKey);
        setDetails(detailsFrom(data));
        setLinesDraft(linesFrom(data.currentVersion));
        setPackaging(packagingFrom(data.currentVersion));
    }
    if (data !== undefined && (data.photoUrl ?? null) !== photoKey && !photoDirty) {
        setPhotoKey(data.photoUrl ?? null);
        setPhoto(data.photoUrl ?? null);
    }

    /*
     * Back from fixing an ingredient: the drafts this page held when the reader left are put back
     * over the record, once it has been hydrated, and only if the record has not moved since.
     * Adjusted during render, as the hydration above is; the guard and the word to the reader
     * follow in an effect.
     */
    const detourKey = isCreating ? `new:${selfHref ?? referenceSeries}` : String(recipe);
    const [detourChecked, setDetourChecked] = useState(false);
    const [detourRestored, setDetourRestored] = useState(false);
    const [swapped, setSwapped] = useState(false);
    if (!detourChecked && (isCreating || (serverKey !== null && hydratedKey === serverKey))) {
        setDetourChecked(true);
        const stored = recipeDrafts.read(detourKey);
        const kept = stored !== null && stored.serverKey === serverKey ? stored : null;
        if (kept !== null) {
            setDetails(kept.details);
            setRowOrdinal(kept.rowOrdinal);
            setDetailsDirty(kept.dirty.details);
            setDetourRestored(true);
        }
        /*
         * The library row's lines move to this kitchen's copy — on a draft only: a published
         * version is immutable, and its next draft is where the change belongs.
         */
        const draftOpen =
            canManage &&
            (data === undefined ||
                data.currentVersion.status === 'draft' ||
                data.currentVersion.status === 'review_required');
        const swap = (rows: readonly LineDraft[]) =>
            swapFrom === undefined || swapTo === undefined || !draftOpen
                ? rows
                : rows.map((row) =>
                      row.ingredientId === swapFrom ? { ...row, ingredientId: swapTo } : row,
                  );
        const nextLines = swap(kept?.lines ?? lines);
        const nextPackaging = swap(kept?.packaging ?? packaging);
        const linesMoved = nextLines.some((row, index) => row !== (kept?.lines ?? lines)[index]);
        const packagingMoved = nextPackaging.some(
            (row, index) => row !== (kept?.packaging ?? packaging)[index],
        );
        setLinesDraft(nextLines);
        setPackaging(nextPackaging);
        setLinesDirty((kept?.dirty.lines ?? false) || linesMoved);
        setPackagingDirty((kept?.dirty.packaging ?? false) || packagingMoved);
        if (linesMoved || packagingMoved) setSwapped(true);
    }
    // Once per arrival: a ref, so a re-render with a new toast or guard never says it twice.
    const detourAnnounced = useRef(false);
    useEffect(() => {
        if (!detourChecked || detourAnnounced.current) return;
        detourAnnounced.current = true;
        recipeDrafts.clear(detourKey);
        if (!detourRestored && !swapped) return;
        guard.markDirty();
        toast.show({
            testID: 'kitchen-recipe-detour-restored-toast',
            tone: 'info',
            message: t(
                swapped
                    ? 'kitchen:recipes.swappedToCopyToast'
                    : 'kitchen:recipes.detourRestoredToast',
            ),
        });
    }, [detourChecked, detourRestored, swapped, detourKey, guard, toast, t]);

    /*
     * The unsaved work, kept as the detour's draft for as long as there is any — so leaving by the
     * sidebar, the page search or a crumb keeps it, and opening this recipe again puts it back with
     * "Back on your recipe". Written after the arrival above has read and cleared the last one;
     * cleared once everything is saved, and by a deliberate discard (`leaveWithoutKeeping`).
     */
    useEffect(() => {
        if (!detourChecked || !detourAnnounced.current) return;
        if (detailsDirty || linesDirty || packagingDirty) {
            recipeDrafts.write(detourKey, {
                serverKey,
                details,
                lines,
                packaging,
                rowOrdinal,
                dirty: { details: detailsDirty, lines: linesDirty, packaging: packagingDirty },
            });
        } else if (recipeDrafts.read(detourKey) !== null) {
            recipeDrafts.clear(detourKey);
        }
    }, [
        detourChecked,
        detourKey,
        serverKey,
        details,
        lines,
        packaging,
        rowOrdinal,
        detailsDirty,
        linesDirty,
        packagingDirty,
    ]);

    /** A leave the reader chose to make without saving — Cancel's discard: nothing is kept. */
    const leaveWithoutKeeping = (go: () => void) =>
        guard.intercept(() => {
            recipeDrafts.clear(detourKey);
            go();
        });

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
        setAllSaved(false);
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
        setPackagingDirty(false);
        setHydratedKey(null);
        setPhotoDirty(false);
        setPhotoKey(undefined);
        setSaveError(null);
        setAllSaved(false);
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
    useEffect(() => {
        draftKeepable.current = !listingDirty && !photoDirty;
    }, [listingDirty, photoDirty]);
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
        ? initialName === undefined
            ? t('kitchen:recipes.createTitle')
            : displayName(initialName, locale).value
        : displayName(data?.name ?? { en: '', ar: '' }, locale).value;

    /*
     * Opened from elsewhere — Stock gaps, Review — the crumb above the recipe is that page, named
     * as the sidebar names it, and it returns to the exact view they left, through the unsaved
     * guard. Otherwise the trail is the book's, exactly as every other editor's.
     */
    /*
     * This page's own address, on a tab — built from what the page was opened with (its kind while
     * new, a stock gap's fix and way back) rather than read off the router: what the ingredient
     * detour returns to, and what the top bar's Continue resumes.
     */
    const hrefOnTab = (onTab: RecipeTab): string =>
        withReturnTo(
            withQuery(selfHref ?? `/kitchen/recipes/${isCreating ? 'new' : String(recipe)}`, {
                kind: isCreating && selfHref === undefined ? kind : null,
                fix: fix?.reason,
                ingredient: fix?.ingredientId,
                tab: onTab,
            }),
            back.returnTo,
        );

    const cameBack = back.returnTo !== null;
    useKitchenTrailLeaf(
        isCreating || data !== undefined ? title : null,
        cameBack
            ? () => {
                  leaveWithoutKeeping(back.leave);
              }
            : undefined,
        cameBack ? returnCrumbLabel(back.returnTo, t) : undefined,
    );

    /*
     * Part of a process — a stock gap being fixed: this page, on its open tab, is where the top
     * bar's Continue leads back to if the reader steps out of it. Back on a recipe an ingredient
     * detour left, that detour is over.
     */
    useProcessStep(hrefOnTab(tab), back.returnTo);
    const ownPath = pathnameOf(hrefOnTab(tab));
    useEffect(() => {
        const process = readActiveProcess();
        if (process?.kind === 'recipeDetour' && process.originPath === ownPath) endProcess();
    }, [ownPath]);

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
    /*
     * A meal's sale takes stock off per piece: one portion sold is the recipe divided by its pieces
     * produced (`MealExplosion`). A recipe sold as a meal with no count turns every order for it into
     * a stock gap, so the count is owed before it is published — and said from the moment it is
     * missing, not after the first order fails.
     */
    const soldAsMeal =
        data?.soldAs?.some((seller) => seller.itemType === 'meal') === true ||
        (isCreating && kind === 'meal');
    const piecesOwed = soldAsMeal && !(yieldPieces !== null && yieldPieces > 0);

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
     * The ingredient a stock gap names, resolved by id, so the strip can name it even when no line
     * on this version names it any more.
     */
    const fixIngredientId = fix?.ingredientId ?? null;
    const fixIngredientIds = useMemo(
        (): readonly IngredientId[] =>
            fixIngredientId === null ? [] : [IngredientId.unsafe(fixIngredientId)],
        [fixIngredientId],
    );
    const fixIngredients = useIngredientsByIds(fixIngredientIds);

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

    /** The first uncosted line's ingredient — where the tray's card sends the reader to fix it. */
    const firstUncosted = useMemo(() => {
        if (computed === null) return null;
        const found = (
            [
                [computed.production, 'ingredients'],
                [computed.packaging, 'packaging'],
            ] as const
        )
            .flatMap(([half, family]) =>
                half.uncostedLineNumbers.map((lineNumber) => ({
                    id: half.lines.find((line) => line.lineNumber === lineNumber)?.ingredientId,
                    family,
                })),
            )
            .find((entry) => entry.id !== undefined);
        return found === undefined ? null : { id: String(found.id), family: found.family };
    }, [computed]);

    /*
     * How many lines the server could not cost — by number, so it is known before the names of the
     * ingredients resolve. Zero while the rollup has not answered: unknown is not "all costed".
     */
    const uncostedCount =
        computed === null
            ? 0
            : computed.production.uncostedLineNumbers.length +
              computed.packaging.uncostedLineNumbers.length;

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

    /*
     * Every ingredient any warning names, so the rows at fault carry a mark of their own — and the
     * line a stock gap is about, until the fix is published.
     */
    const flaggedIngredientIds = [
        ...rollupWarnings.flatMap((warning) => warning.ingredientIds.map(String)),
        ...(fix !== null && fixActive && isLineReason(fix.reason) && fix.ingredientId !== null
            ? [fix.ingredientId]
            : []),
    ];

    /* ── what each raw material still owes, and the way to it ────────────────────────────────── */

    /*
     * Every ingredient the two tables name, with what it still owes this recipe — one list, read by
     * the rows, the publish dialog and (through `?needs=`) the ingredient's own form.
     */
    const settledWarnings = rollup.data?.warnings;
    const needsById = useMemo(
        () =>
            ingredientNeedsById({
                warnings: settledWarnings ?? [],
                costs: [computed?.production, computed?.packaging],
                ingredients: [...library, ...Object.values(packagingIngredients)],
                named: new Set(
                    [...lines, ...packaging]
                        .map((row) => row.ingredientId)
                        .filter((id): id is string => id !== null),
                ),
            }),
        [settledWarnings, computed, library, packagingIngredients, lines, packaging],
    );

    /** A row's needs as one short line — "Allergens not checked · No price yet". */
    const needsText = (needs: readonly IngredientNeed[] | undefined): string | undefined =>
        needs === undefined || needs.length === 0
            ? undefined
            : needs
                  .map((need) => t(`kitchen:ingredientNeeds.${need}`))
                  .join(t('kitchen:ingredientNeeds.separator'));

    /*
     * The ingredient's form, opened to fix what it owes and come back to this tab. Unsaved drafts
     * go into a session draft for the trip, so the reader comes back to exactly what they left —
     * except a dirty listing, which keeps its drafts inside itself and so is asked about first.
     */
    const openIngredient = (
        ingredientId: string,
        family: 'ingredients' | 'packaging',
        needs: readonly IngredientNeed[] = needsById.get(ingredientId) ?? [],
    ) => {
        // This page's own address, on the tab the row is on.
        const here = hrefOnTab(family === 'packaging' ? 'packaging' : tab);
        const href = ingredientFixHref(ingredientId, needs, here, family);
        const go = () => {
            router.push(href as never);
        };
        // A photo is not carried in a session draft — it can be megabytes — so it is asked about.
        if (listingDirty || photoDirty) {
            guard.intercept(go);
            return;
        }
        /*
         * The unsaved work is already the draft — the effect above keeps it current, which is also
         * why a quick-added line is no longer missing from it. Not in a process yet: this detour is
         * one, so stepping out of the ingredient by the sidebar still leads back here.
         */
        if (readActiveProcess() === null) {
            startProcess({
                kind: 'recipeDetour',
                subject: title,
                resumeHref: href,
                originPath: pathnameOf(here),
                stepPaths: [],
            });
        }
        go();
    };

    /* ── the stock gap's field ───────────────────────────────────────────────────────────────── */

    /*
     * The line the gap is about, as it stood when the record arrived: its key, so the mark stays on
     * that row, and its unit, which is what a unit mismatch is about. Taken once, on the render the
     * drafts have been hydrated from the record — adjusted during render, as that hydration is.
     */
    const [fixLanding, setFixLanding] = useState<
        { readonly key: string; readonly unit: MeasureUnit } | null | undefined
    >(undefined);
    if (
        fix !== null &&
        serverKey !== null &&
        hydratedKey === serverKey &&
        fixLanding === undefined
    ) {
        const row =
            fix.ingredientId === null || !isLineReason(fix.reason)
                ? undefined
                : lines.find((entry) => entry.ingredientId === fix.ingredientId);
        setFixLanding(row === undefined ? null : { key: row.key, unit: row.unit });
    }

    /** The field the fix lives in — the piece count, the line's quantity, or Publish. */
    const fixFieldId =
        fix === null
            ? null
            : stockGapFieldId(fix, (ingredientId) => {
                  const row = lines.find((entry) => entry.ingredientId === ingredientId);
                  return row === undefined ? null : lineCellId(LINES_TABLE, row.key, 'qty');
              });

    /*
     * Into that field, once the record is on screen. Once: a ref, so typing in the field — which
     * changes the lines, and with them nothing about where the fix is — never pulls focus back.
     */
    const fixFocused = useRef(false);
    useEffect(() => {
        if (fixLanding === undefined || fixFocused.current) return;
        fixFocused.current = true;
        if (fixFieldId !== null) focusField(fixFieldId);
    }, [fixLanding, fixFieldId]);

    const fixMessageKey = fix === null ? null : stockGapFieldMessageKey(fix.reason);

    /** The piece count's own message, while it is still not a count. */
    const piecesFixMessage =
        fix !== null &&
        fixActive &&
        fix.reason === 'no_yield_piece_count' &&
        fixMessageKey !== null &&
        !(yieldPieces !== null && yieldPieces > 0)
            ? t(fixMessageKey)
            : undefined;

    /**
     * The flagged line's own message: a quantity until one is typed, a unit until the line is in
     * another one. Only on the row the gap named.
     */
    const fixLineMessage = (row: LineDraft): string | undefined => {
        if (fix === null || !fixActive || fixMessageKey === null || fixLanding == null) {
            return undefined;
        }
        if (row.key !== fixLanding.key) return undefined;
        if (fix.reason === 'unquantified_recipe_line') {
            const quantity = parseQuantity(row.quantity);
            return quantity !== null && quantity > 0 ? undefined : t(fixMessageKey);
        }
        if (fix.reason === 'unit_conversion_unsupported') {
            return row.unit === fixLanding.unit ? t(fixMessageKey) : undefined;
        }
        return undefined;
    };

    const shelfLife = parseShelfLife(details.shelfLifeDays);
    const shelfLifeInvalid = shelfLife === undefined;
    /*
     * What makes Save live on a published recipe: the shelf life is the one field there that can be
     * written (see the module note), so it is the only change that should light the button.
     */
    const shelfLifeChanged =
        data !== undefined && shelfLife !== undefined && shelfLife !== data.shelfLifeDays;

    /* ── readiness ───────────────────────────────────────────────────────────────────────────── */

    const incompleteLines = lines.filter(
        (row) => row.ingredientId === null || parseQuantity(row.quantity) === null,
    );
    const nameMissing = details.name.en.trim() === '';
    const yieldInvalid = parseQuantity(details.yieldQuantity) === null || servings <= 0;

    const saveBlocked =
        !canManage || nameMissing || yieldInvalid || shelfLifeInvalid || incompleteLines.length > 0;

    /*
     * Everything that stops the save, in tab order, each naming the tab it lives on and the field
     * that fixes it. The tab pills, the fields and the jump a blocked Save makes all read this one
     * list, so they cannot disagree about what is wrong.
     *
     * `required` separates a blank that only matters once Save is pressed from a value already
     * typed that does not parse — flagged as it is typed, because it is about something the reader
     * has just done.
     *
     * An unfinished raw material is one entry per row, keyed by the row, pointing at its own Qty
     * cell: the cell says what is missing, and the count on Production is how many rows say it.
     */
    const blockers: readonly {
        readonly key: string;
        readonly tab: RecipeTab;
        readonly fieldId: string;
        readonly required: boolean;
    }[] = [
        ...(nameMissing
            ? [
                  {
                      key: 'name',
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
                      tab: 'production' as const,
                      fieldId: 'kitchen-recipe-yield-quantity',
                      required: details.yieldQuantity.trim() === '',
                  },
              ]
            : []),
        ...incompleteLines.map((row) => ({
            key: `line-${row.key}`,
            tab: 'production' as const,
            fieldId: lineCellId(LINES_TABLE, row.key, 'qty'),
            required: row.quantity.trim() === '',
        })),
        ...(shelfLifeInvalid
            ? [
                  {
                      key: 'shelf-life',
                      tab: 'packaging' as const,
                      fieldId: 'kitchen-recipe-expiry',
                      required: false,
                  },
              ]
            : []),
    ];

    const shownBlockers = attempted ? blockers : blockers.filter((entry) => !entry.required);
    const shows = (key: string) => shownBlockers.some((entry) => entry.key === key);

    /** An unfinished raw material's own message, under its Qty cell. */
    const incompleteLineMessage = (row: LineDraft): string | undefined =>
        shows(`line-${row.key}`) ? t('kitchen:forms.lineQuantityMissing') : undefined;

    /*
     * The caution the design draws. It does not block: a packaging line at zero ships nothing and
     * costs nothing — a sleeve label the count was never typed for — which is legal and almost always
     * a mistake somebody wants pointed out.
     */
    const zeroPackaging = packaging.filter((row) => parseQuantity(row.quantity) === 0);

    const goTo = (target: RecipeTab, fieldId: string | null) => {
        setTab(target);
        if (fieldId !== null) focusField(fieldId);
    };
    /** A problem that is a whole section, not one field in it: its tab, then the section lit. */
    const goToSection = (target: RecipeTab, sectionId: string) => {
        setTab(target);
        focusSection(sectionId);
    };

    /*
     * What the server refused, put on the fields it named (BUG-06). One save is up to four writes —
     * the recipe, its version, the lines, the packaging — whose field names do not overlap, so one
     * table describes all four. Each names the tab its field is on, so its chip can switch to it.
     * A field this route does not draw is left out, and its refusal stays in the save callout.
     */
    const saveFailure = saveError?.failure ?? null;
    const linesTarget = {
        label: t('kitchen:recipes.sectionRawMaterials'),
        fieldId: 'kitchen-recipe-lines-table-refusals',
        tab: 'production' as const,
    };
    const packagingTarget = {
        label: t('kitchen:recipes.sectionPackaging'),
        fieldId: 'kitchen-recipe-packaging-table-refusals',
        tab: 'packaging' as const,
    };
    const serverTargets: Readonly<Record<string, ServerTarget>> = {
        name_en: {
            label: t('kitchen:bilingual.englishShort', { field: t('kitchen:recipes.columnName') }),
            fieldId: 'kitchen-recipe-name-en',
            tab: 'description',
        },
        name_ar: {
            label: t('kitchen:bilingual.arabicShort', { field: t('kitchen:recipes.columnName') }),
            fieldId: 'kitchen-recipe-name-ar',
            tab: 'description',
        },
        ...(isCreating && onCreated !== undefined
            ? {
                  notes: {
                      label: t('kitchen:bilingual.englishShort', {
                          field: t('kitchen:products.descriptionLabel'),
                      }),
                      fieldId: 'kitchen-recipe-description-en',
                      tab: 'description' as const,
                  },
              }
            : {}),
        ...(classification === undefined || classification.options.length === 0
            ? {}
            : {
                  recipe_category: {
                      label: classification.subcategoryLabel,
                      fieldId: 'kitchen-recipe-subcategory',
                      tab: 'description' as const,
                  },
              }),
        // The unit rides on the yield field as its suffix, so a refused unit is that field's.
        yield_quantity: {
            label: t('kitchen:recipes.yieldQuantity'),
            fieldId: 'kitchen-recipe-yield-quantity',
            tab: 'production',
        },
        yield_unit_id: {
            label: t('kitchen:recipes.yieldQuantity'),
            fieldId: 'kitchen-recipe-yield-quantity',
            tab: 'production',
        },
        yield_piece_count: {
            label: t('kitchen:recipes.yieldPieces'),
            fieldId: 'kitchen-recipe-yield-pieces',
            tab: 'production',
        },
        waste_coefficient_percent: {
            label: t('kitchen:recipes.productionWastePercent'),
            fieldId: 'kitchen-recipe-waste',
            tab: 'production',
        },
        'lines.*.ingredient_id': linesTarget,
        'lines.*.quantity': linesTarget,
        'lines.*.unit_id': linesTarget,
        'lines.*.source_designation': linesTarget,
        shelf_life_days: {
            label: t('kitchen:forms.expiryPeriod'),
            fieldId: 'kitchen-recipe-expiry',
            tab: 'packaging',
        },
        packaging_waste_percent: {
            label: t('kitchen:recipes.packagingWastePercent'),
            fieldId: 'kitchen-recipe-packaging-waste',
            tab: 'packaging',
        },
        'packaging.*.ingredient_id': packagingTarget,
        'packaging.*.basis': packagingTarget,
        'packaging.*.quantity': packagingTarget,
        'packaging.*.comment': packagingTarget,
    };
    const server = serverFieldErrors(saveFailure, serverTargets);
    /*
     * The fields the server refused, as the targets that describe them — one per pattern, which is
     * what the helper keys each of its items by (`server-<pattern>`). Each is one problem on the
     * pill of the tab its field is on.
     */
    const refusedTargets = (refusal: typeof server): readonly ServerTarget[] =>
        refusal.items
            .map((item) => serverTargets[item.key.slice('server-'.length)])
            .filter((target): target is ServerTarget => target !== undefined);
    const refusedTabs = refusedTargets(server).map((target) => target.tab);

    /**
     * Where a refused save takes the reader: the first field the server named, in the order the
     * tabs are read. A refused row lands on its own Qty or Comments cell — found by the position
     * it was sent at, see `isSendableLine` — and anything else about a row on the list of refusals
     * under its table. `rows` are the drafts the refused save sent.
     */
    const refusalTarget = (
        failure: ApiFailure | null,
    ): { readonly tab: RecipeTab; readonly fieldId: string } | null => {
        if (failure === null || !isValidationFailure(failure)) return null;
        const first = [...refusedTargets(serverFieldErrors(failure, serverTargets))].sort(
            (a, b) => TAB_ORDER.indexOf(a.tab) - TAB_ORDER.indexOf(b.tab),
        )[0];
        if (first === undefined) return null;

        const section =
            first === linesTarget ? 'lines' : first === packagingTarget ? 'packaging' : null;
        if (section === null) return first;
        const sent = (section === 'lines' ? lines : packaging).filter(isSendableLine);
        for (const [field, messages] of Object.entries(failure.fields)) {
            const [head, position, column] = field.split('.');
            if (head !== section || messages.length === 0 || position === undefined) continue;
            const row = sent[Number(position)];
            const cell =
                column === 'quantity'
                    ? 'qty'
                    : column === 'source_designation' || column === 'comment'
                      ? 'comment'
                      : null;
            if (row === undefined || cell === null) continue;
            return {
                tab: first.tab,
                fieldId: lineCellId(
                    section === 'lines' ? LINES_TABLE : PACKAGING_TABLE,
                    row.key,
                    cell,
                ),
            };
        }
        return first;
    };

    /** After a refusal: the first field it named, on its tab, with the cursor in it. */
    const leadToRefusal = (failure: ApiFailure | null) => {
        const target = refusalTarget(failure);
        if (target !== null) goTo(target.tab, target.fieldId);
    };

    /** A line table's refusal, by the sendable row it was sent as — see `isSendableLine`. */
    const lineFieldError =
        (section: 'lines' | 'packaging', rows: readonly LineDraft[]) =>
        (row: LineDraft, column: LineColumn): string | undefined => {
            const index = rows.filter(isSendableLine).findIndex((entry) => entry.key === row.key);
            if (index < 0) return undefined;
            const at = `${section}.${String(index)}`;
            if (column === 'quantity') return server.errorFor(`${at}.quantity`);
            if (column === 'comment') {
                return server.errorFor(
                    `${at}.${section === 'lines' ? 'source_designation' : 'comment'}`,
                );
            }
            return (
                server.errorFor(`${at}.ingredient_id`) ??
                server.errorFor(`${at}.${section === 'lines' ? 'unit_id' : 'basis'}`)
            );
        };

    /*
     * The stock gap's fields still saying what is wrong with them, counted on Production with
     * everything else there. Not twice: a piece count the server also refused, or a flagged line
     * that is also unfinished, is one problem on the pill.
     */
    const fixRow = fixLanding == null ? undefined : lines.find((row) => row.key === fixLanding.key);
    const fixFlags =
        (piecesFixMessage !== undefined && server.errorFor('yield_piece_count') === undefined
            ? 1
            : 0) +
        (fixRow !== undefined &&
        fixLineMessage(fixRow) !== undefined &&
        !shows(`line-${fixRow.key}`)
            ? 1
            : 0);

    /** What each tab's pill says: the problems on it, or failing those its cautions. */
    const tabIssues = (target: RecipeTab) => {
        const errors =
            shownBlockers.filter((entry) => entry.tab === target).length +
            refusedTabs.filter((refused) => refused === target).length +
            (target === 'production' ? fixFlags : 0);
        if (errors > 0) {
            return {
                count: errors,
                tone: 'danger' as const,
                label: t('kitchen:forms.toFixCount', { count: errors }),
            };
        }
        // A zero packaging line, and what this tab still owes before the draft can be published.
        const cautions =
            (target === 'packaging' ? zeroPackaging.length : 0) +
            publishItems.filter((item) => item.tab === target).length;
        if (cautions === 0) return undefined;
        return {
            count: cautions,
            tone: 'warning' as const,
            label: t('kitchen:forms.warningCount', { count: cautions }),
        };
    };

    /*
     * Save draft is pressable over an incomplete form. The press marks the form attempted — every
     * blank required field says so under itself, and each tab counts its own — and takes the reader
     * to the first, switching tab on the way. Only a clean draft reaches `saveAll`.
     */
    const attemptSave = () => {
        setAttempted(true);
        const first = blockers[0];
        if (first !== undefined) {
            goTo(first.tab, first.fieldId);
            nudgeTray();
            return;
        }
        saveAll();
    };

    // A save the server refused, or that never reached it, is said in the tray: open it.
    useEffect(() => {
        if (saveError !== null) nudgeTray();
    }, [saveError, nudgeTray]);

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
    /*
     * Each reason is a sentence and, when an ingredient is what has to change, that ingredient and
     * what it owes — so the dialog can offer the way to it rather than only naming it.
     */
    const publishBlockers = useMemo(() => {
        type Blocker = {
            readonly text: string;
            readonly fix?:
                | { readonly id: string; readonly need: IngredientNeed; readonly name: string }
                | undefined;
        };
        if (data === null || data === undefined) return [] as readonly Blocker[];
        const reasons: Blocker[] = [];
        if (data.currentVersion.lines.length === 0) {
            reasons.push({ text: t('kitchen:publish.blockNoLines') });
        }
        if (isTranslationIncomplete(data.name))
            reasons.push({ text: t('kitchen:publish.blockName') });
        // Read off the saved version, which is what Publish publishes — see `soldAsMeal`.
        const savedPieces = data.currentVersion.yieldPieces;
        if (soldAsMeal && !(savedPieces !== null && savedPieces > 0)) {
            reasons.push({ text: t('kitchen:publish.blockNoPieces') });
        }
        // The description is no longer edited here (see the docblock), so it is no longer gated on:
        // a blocker with no control on the screen to clear it is a recipe that can never publish.
        if (anyDirty) reasons.push({ text: t('kitchen:publish.blockUnsaved') });

        const unsafe = data.currentVersion.lines
            .map((line) => ingredients.find((entry) => entry.id === line.ingredientId))
            .filter(
                (entry): entry is IngredientAdmin =>
                    entry !== undefined &&
                    (entry.meta.status === 'review_required' || entry.meta.status === 'retired'),
            );
        for (const entry of unsafe) {
            reasons.push({
                text: t('kitchen:publish.blockIngredientState', {
                    name: displayName(entry.name, locale).value,
                    status: t(statusKey(entry.meta.status)),
                }),
                fix: {
                    id: String(entry.id),
                    need: 'allergens',
                    name: displayName(entry.name, locale).value,
                },
            });
        }
        // The server's `ingredient_nutrition_pending`, said before the press rather than after.
        // From `library`, which resolves every line by id: a quick-added row is rarely on page one.
        const owed = new Set(
            data.currentVersion.lines
                .map((line) => library.find((entry) => entry.id === line.ingredientId))
                .filter((entry): entry is IngredientAdmin => entry?.pendingNutrition != null),
        );
        for (const entry of owed) {
            reasons.push({
                text: t('kitchen:publish.blockNutritionPending', {
                    name: displayName(entry.name, locale).value,
                }),
                fix: {
                    id: String(entry.id),
                    need: 'nutrition',
                    name: displayName(entry.name, locale).value,
                },
            });
        }
        return reasons;
    }, [data, anyDirty, soldAsMeal, ingredients, library, locale, t]);

    const unmappedIngredients = useMemo(() => {
        if (data === null || data === undefined) return [] as readonly IngredientAdmin[];
        const seen = new Set<string>();
        const rows: IngredientAdmin[] = [];
        for (const line of data.currentVersion.lines) {
            const entry = ingredients.find((candidate) => candidate.id === line.ingredientId);
            // Confirmed clear is a determination too — the one an empty mapping cannot state.
            if (
                entry === undefined ||
                entry.allergens.length > 0 ||
                entry.allergensAssessedClear === true
            ) {
                continue;
            }
            if (seen.has(String(entry.id))) continue;
            seen.add(String(entry.id));
            rows.push(entry);
        }
        return rows;
    }, [data, ingredients]);

    const quarantined = data?.meta.status === 'review_required';

    /* ── saving ──────────────────────────────────────────────────────────────────────────────── */

    /**
     * The photo, written once the recipe's own writes have answered: it needs the recipe's id, and
     * a refused upload must not undo a recipe that is already saved. Answers the failure, or null.
     * An untouched slot is a no-op, so every save calls it.
     */
    const writePhoto = async (
        recipeId: RecipeId,
        saved: string | null | undefined,
    ): Promise<unknown> => {
        try {
            await photoSave.mutateAsync({
                subject: 'recipe',
                recordId: String(recipeId),
                chosen: photo,
                saved,
            });
            setPhotoDirty(false);
            return null;
        } catch (error) {
            return error;
        }
    };

    /**
     * The Selling tab's writes, after the recipe's — the second half of the one Save. Answers
     * whether they went through; a refusal opens that tab, where the listing says what it needs.
     */
    const saveListing = async (): Promise<boolean> => {
        if (!listingDirty || sellsAs?.save === undefined) return true;
        setListingSaving(true);
        const saved = await sellsAs.save();
        setListingSaving(false);
        if (saved) return true;
        setTab('selling');
        toast.show({
            testID: 'kitchen-recipe-listing-unsaved-toast',
            tone: 'warning',
            message: t('kitchen:recipes.listingNotSavedToast'),
        });
        return false;
    };

    const saveAll = (onDone?: () => void) => {
        if (saveBlocked) return;
        setSaveError(null);

        if (isCreating) {
            if (creatingRef.current === recipe) return;
            creatingRef.current = recipe;
            setCreatingNow(true);
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
                // The listing first: it is a record already, and a refusal there should stop the
                // press before a recipe exists — on the Selling tab, where it says what it needs.
                if (!(await saveListing())) throw LISTING_REFUSED;
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
                    ...(recipeCategory === '' ? {} : { recipeCategory }),
                    ...(typeof shelfLife === 'number' ? { shelfLifeDays: shelfLife } : {}),
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
                async (created) => {
                    const photoError = await writePhoto(created.id, null);
                    settle();
                    endProcessSavedOn(ownPath);
                    toast.show({
                        testID: 'kitchen-recipe-created-toast',
                        tone: 'success',
                        message: t('kitchen:recipes.createdToast', {
                            name: displayName(created.name, locale).value,
                        }),
                    });
                    // The page is about to leave, so a refused photo is said in a toast rather than
                    // the save callout, which would go with it.
                    if (photoError !== null) {
                        toast.show({
                            tone: 'danger',
                            message:
                                toFailure(photoError)?.message ?? t('kitchen:recipes.saveFailed'),
                        });
                        photoSave.reset();
                    }
                    if (onCreated !== undefined) {
                        onCreated(created, { description: details.description });
                        return;
                    }
                    router.replace(`/kitchen/recipes/${String(created.id)}` as never);
                },
                (error: unknown) => {
                    creatingRef.current = null;
                    setCreatingNow(false);
                    if (error === LISTING_REFUSED) return;
                    const failure = toFailure(error);
                    setSaveError({ failure });
                    leadToRefusal(failure);
                },
            );
            return;
        }

        if (data === undefined) return;
        const recipeId = data.id;

        const run = async () => {
            /*
             * A published or retired version refuses every version write, so there the save is the
             * shelf life alone — the one field on this screen that belongs to the recipe (see the
             * module note). Nothing else can be dirty: every other field is disabled.
             */
            if (!isEditable) {
                // Nothing of the recipe's to write: the press was for the listing alone.
                if (shelfLife === undefined || !shelfLifeChanged) return;
                await update.mutateAsync({
                    recipeId,
                    request: { lockVersion: data.meta.lockVersion, shelfLifeDays: shelfLife },
                });
                return;
            }

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
                        // Only where the form offered it. A route that draws no picker must not
                        // clear a word it never showed the reader.
                        ...(classification === undefined
                            ? {}
                            : {
                                  recipeCategory: recipeCategory === '' ? null : recipeCategory,
                              }),
                        // `null` clears it, like the prices above.
                        ...(shelfLife === undefined ? {} : { shelfLifeDays: shelfLife }),
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

        const savedPhoto = data.photoUrl;

        void run().then(
            async () => {
                settle();
                // Saved: the draft the process was keeping is written, so Continue has nothing to keep.
                endProcessSavedOn(ownPath);
                const photoError = await writePhoto(recipeId, savedPhoto);
                if (photoError !== null) {
                    // The recipe is saved; only the photo is left to try again.
                    guard.markDirty();
                    setSaveError({ failure: toFailure(photoError) });
                    return;
                }
                if (!(await saveListing())) return;
                if (onDone !== undefined) onDone();
                setAllSaved(true);
                toast.show({
                    testID: 'kitchen-recipe-saved-toast',
                    tone: 'success',
                    message: t('kitchen:recipes.savedAllToast'),
                });
            },
            (error: unknown) => {
                if (concurrency.capture(error)) return;
                const failure = toFailure(error);
                setSaveError({ failure });
                leadToRefusal(failure);
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
        // A draft that cannot be written cannot be published either: lead to what stops it, the
        // way Save does, rather than open a dialog about a version that is not the one on screen.
        if (blockers.length > 0) {
            attemptSave();
            return;
        }
        if ((anyDirty || listingDirty) && !saveBlocked) {
            saveAll(() => {
                setShowPublish(true);
            });
            return;
        }
        setShowPublish(true);
    };

    /**
     * The successor draft of a published or retired version — `createRecipeVersion`, copying the
     * version on screen. The version list offers it, and so does a stock gap's strip.
     */
    const openNewDraft = () => {
        if (data === undefined) return;
        openDraft.mutate(
            { recipeId: data.id, copyFromVersion: data.currentVersion.versionNumber },
            {
                onSuccess: (updated) => {
                    setSelectedVersionId(null);
                    toast.show({
                        testID: 'kitchen-recipe-draft-opened-toast',
                        tone: 'success',
                        message: t('kitchen:recipes.draftOpenedToast', {
                            number: updated.currentVersion.versionNumber,
                        }),
                    });
                },
                onError: (error) => {
                    concurrency.capture(error);
                },
            },
        );
    };

    /** Back to Stock gaps once the fix is published, telling it the gap was fixed. */
    const finishFix = () => {
        guard.intercept(() => {
            back.finish({ fixed: '1' });
        });
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
                    actions={
                        <Button
                            testID="kitchen-recipe-not-found-back"
                            variant="quiet"
                            label={t('kitchen:recipes.backToList')}
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
    const referenceParts = splitReference(headerReference);

    /*
     * Which commit leads. Publish only once the draft on screen is the saved one, there is a draft
     * to publish, and this reader may: until then Save is the next thing to do.
     */
    const publishShown = !isCreating && canManage;
    const publishLeads = publishShown && isEditable && !anyDirty && !listingDirty;

    /*
     * What stops the save, as the red strip under the tabs: a chip per field, each taking the
     * reader there — the unfinished raw materials as one chip, since the table marks each row. The
     * fields keep their own messages; the strip is so a reader on another tab still sees them.
     */
    const lineBlockers = shownBlockers.filter((entry) => entry.key.startsWith('line-'));
    const saveItems: readonly FormIssueItem[] = [
        ...shownBlockers
            .filter((entry) => !entry.key.startsWith('line-'))
            .map((entry) => ({
                key: entry.key,
                label:
                    entry.key === 'name'
                        ? t('kitchen:bilingual.englishShort', {
                              field: t('kitchen:recipes.columnName'),
                          })
                        : entry.key === 'yield'
                          ? t('kitchen:recipes.yieldQuantity')
                          : t('kitchen:forms.expiryPeriod'),
                fieldId: entry.fieldId,
                onPress: () => {
                    goTo(entry.tab, entry.fieldId);
                },
            })),
        ...(lineBlockers[0] === undefined
            ? []
            : [
                  {
                      key: 'lines',
                      label: t('kitchen:recipes.sectionRawMaterials'),
                      fieldId: lineBlockers[0].fieldId,
                      onPress: () => {
                          if (lineBlockers[0] !== undefined)
                              goTo('production', lineBlockers[0].fieldId);
                      },
                  },
              ]),
        ...server.items,
    ];

    /*
     * What still stands between this draft and Publish, as one amber strip under the tabs: a chip
     * per thing to fix, each taking the reader to it — a field on this page, or the ingredient that
     * owes something. Read off the draft on screen, so a chip goes as soon as its field is filled;
     * the publish dialog re-reads the saved version and stays the gate. Only on a draft this
     * reader may publish, and only what can be fixed from here.
     */
    const publishItems: readonly (FormIssueItem & { readonly tab: RecipeTab | null })[] =
        !publishShown || !isEditable
            ? []
            : [
                  ...(details.name.en.trim() !== '' && isTranslationIncomplete(details.name)
                      ? [
                            {
                                key: 'name-ar',
                                tab: 'description' as const,
                                label: t('kitchen:bilingual.arabicShort', {
                                    field: t('kitchen:recipes.columnName'),
                                }),
                                fieldId: 'kitchen-recipe-name-ar',
                                onPress: () => {
                                    goTo('description', 'kitchen-recipe-name-ar');
                                },
                            },
                        ]
                      : []),
                  ...(lines.length === 0
                      ? [
                            {
                                key: 'lines',
                                tab: 'production' as const,
                                label: t('kitchen:recipes.sectionRawMaterials'),
                                onPress: () => {
                                    goToSection('production', 'kitchen-recipe-lines');
                                },
                            },
                        ]
                      : []),
                  ...(piecesOwed
                      ? [
                            {
                                key: 'pieces',
                                tab: 'production' as const,
                                label: t('kitchen:recipes.yieldPieces'),
                                fieldId: 'kitchen-recipe-yield-pieces',
                                onPress: () => {
                                    goTo('production', 'kitchen-recipe-yield-pieces');
                                },
                            },
                        ]
                      : []),
                  ...(lines.length > 0 && uncostedCount > 0
                      ? [
                            {
                                key: 'costs',
                                tab: 'costing' as const,
                                label: t('kitchen:recipes.tabCosting'),
                                // The price lives on the ingredient, so that is where the fix is.
                                onPress: () => {
                                    if (firstUncosted === null)
                                        goToSection('costing', 'kitchen-recipe-cost-cascade');
                                    else openIngredient(firstUncosted.id, firstUncosted.family);
                                },
                            },
                        ]
                      : []),
                  ...publishBlockers.flatMap((reason) =>
                      reason.fix === undefined
                          ? []
                          : [
                                {
                                    key: `ingredient-${reason.fix.id}-${reason.fix.need}`,
                                    tab: null,
                                    label: reason.fix.name,
                                    onPress: () => {
                                        if (reason.fix === undefined) return;
                                        openIngredient(reason.fix.id, 'ingredients', [
                                            reason.fix.need,
                                        ]);
                                    },
                                },
                            ],
                  ),
              ];

    /** The stock gap, named: its reason, and the ingredient when the gap is about one. */
    const fixIngredientName =
        fixIngredientId === null
            ? null
            : (libraryEntries.find((entry) => entry.id === fixIngredientId)?.name ??
              fixIngredients[fixIngredientId]?.name ??
              null);
    const fixTitle =
        fix === null
            ? ''
            : fixIngredientName === null
              ? t('kitchen:ops.exceptions.fix.title', {
                    reason: t(`kitchen:ops.exceptions.reasons.${fix.reason}`),
                })
              : t('kitchen:ops.exceptions.fix.titleIngredient', {
                    reason: t(`kitchen:ops.exceptions.reasons.${fix.reason}`),
                    ingredient: displayName(fixIngredientName, locale).value,
                });

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
    const unmappedDraftEntries = uniqueIngredientIds(lines)
        .map((id) => library.find((entry) => String(entry.id) === String(id)))
        .filter(
            (entry): entry is IngredientAdmin =>
                entry !== undefined &&
                entry.allergens.length === 0 &&
                entry.allergensAssessedClear !== true,
        );
    const unmappedDraftNames = unmappedDraftEntries
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
            // Only once the server has costed the draft: a check still waiting is not a pass.
            ok: lines.length > 0 && computed !== null && uncostedCount === 0,
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

    /* ── the issue tray: everything that stands between this draft and done, in one place ───── */

    const tabName = (target: RecipeTab | null): string | undefined => {
        if (target === 'description') return t('kitchen:recipes.tabDescription');
        if (target === 'production') return t('kitchen:recipes.tabProduction');
        if (target === 'packaging') return t('kitchen:recipes.tabPackaging');
        if (target === 'costing') return t('kitchen:recipes.tabCosting');
        if (target === 'selling') return sellsAs?.label;
        if (target === 'sheet') return t('kitchen:recipes.tabSheet');
        return undefined;
    };
    /** The tab a save chip's field is on — a blocker's own, or the refused field's target's. */
    const saveItemTab = (item: FormIssueItem): RecipeTab | null => {
        if (item.key === 'lines') return 'production';
        if (item.key.startsWith('server-')) {
            return serverTargets[item.key.slice('server-'.length)]?.tab ?? null;
        }
        return shownBlockers.find((entry) => entry.key === item.key)?.tab ?? null;
    };
    const fixCard = (item: FormIssueItem): IssueCardItem['action'] => ({
        onPress: item.onPress,
    });

    const saveCards: IssueCardItem[] = [
        ...saveItems.map((item) => ({
            key: item.key,
            tone: 'danger' as const,
            label: item.label,
            detail: tabName(saveItemTab(item)),
            action: fixCard(item),
            testID: `kitchen-recipe-issues-errors-${item.key}`,
        })),
        // What has no field to sit on: a network failure, a refused photo, an unplaced refusal.
        ...(saveError === null || (server.isValidation && server.unplaced === null)
            ? []
            : [
                  {
                      key: 'save-error',
                      tone: 'danger' as const,
                      label:
                          server.unplaced ??
                          saveFailure?.message ??
                          t('kitchen:recipes.saveFailed'),
                      testID: 'kitchen-recipe-save-error',
                  },
              ]),
    ];

    const publishCards: IssueCardItem[] = [
        ...(quarantined
            ? [
                  {
                      key: 'quarantine',
                      tone: 'warning' as const,
                      label: t('kitchen:publish.quarantineTitle'),
                      testID: 'kitchen-recipe-quarantine',
                  },
              ]
            : []),
        ...publishItems.map((item) => {
            const reason = item.key.startsWith('ingredient-')
                ? publishBlockers.find(
                      (entry) =>
                          entry.fix !== undefined &&
                          `ingredient-${entry.fix.id}-${entry.fix.need}` === item.key,
                  )
                : undefined;
            return {
                key: item.key,
                tone: 'warning' as const,
                label:
                    item.key === 'costs'
                        ? uncostedNames === ''
                            ? t('kitchen:recipes.tabCosting')
                            : t('kitchen:recipes.uncostedLines', { names: uncostedNames })
                        : (reason?.text ?? item.label),
                detail:
                    item.tab === null
                        ? t('kitchen:recipes.sectionRawMaterials')
                        : tabName(item.tab),
                action: fixCard(item),
                testID: `kitchen-recipe-issues-publish-${item.key}`,
            };
        }),
        // The yield the sheet's check reads, while Save has not yet been tried and said it.
        ...(yieldInvalid && publishShown && isEditable && !saveItems.some((i) => i.key === 'yield')
            ? [
                  {
                      key: 'yield',
                      tone: 'warning' as const,
                      label: t('kitchen:recipes.checkYieldMissing'),
                      detail: t('kitchen:recipes.tabProduction'),
                      action: {
                          onPress: () => {
                              goTo('production', 'kitchen-recipe-yield-quantity');
                          },
                      },
                      testID: 'kitchen-recipe-issues-publish-yield',
                  },
              ]
            : []),
    ];

    /*
     * A new recipe's failing publish checks, which nothing above says yet — there is no version to
     * publish until the first save. Said quietly, as heads-up rather than blocks, so a form nobody
     * has typed in yet is guidance, not an accusation. A cost still being worked out is the tray's
     * "Checking", not a failure.
     */
    const quietChecks: IssueCardItem[] = !isCreating
        ? []
        : publishChecks
              .filter(
                  (check) =>
                      !check.ok &&
                      check.key !== 'allergens' &&
                      !(check.key === 'costed' && lines.length > 0 && computed === null),
              )
              .map((check) => ({
                  key: `check-${check.key}`,
                  tone: 'info' as const,
                  label: check.note,
                  detail:
                      check.key === 'languages'
                          ? t('kitchen:recipes.tabDescription')
                          : t('kitchen:recipes.tabProduction'),
                  action: {
                      onPress: () => {
                          if (check.key === 'languages')
                              goTo('description', 'kitchen-recipe-name-ar');
                          else if (check.key === 'yield')
                              goTo('production', 'kitchen-recipe-yield-quantity');
                          else goToSection('production', 'kitchen-recipe-lines');
                      },
                  },
                  testID: `kitchen-recipe-check-${check.key}`,
              }));

    /*
     * An unpriced line on a version nobody is editing — a published one, or a reader who may not
     * publish. The publish strip only speaks on an editable draft, so without this the tray read
     * "All set" over a row marked "No price yet". Heads-up, not a block: the version is already out.
     */
    const uncostedNotice: IssueCardItem[] =
        publishItems.length > 0 || isCreating || uncostedNames === '' || firstUncosted === null
            ? []
            : [
                  {
                      key: 'uncosted',
                      tone: 'info',
                      label: t('kitchen:recipes.uncostedLines', { names: uncostedNames }),
                      detail: t('kitchen:recipes.sectionRawMaterials'),
                      action: {
                          onPress: () => {
                              openIngredient(firstUncosted.id, firstUncosted.family);
                          },
                      },
                      // The tray is no longer clear, so it cannot show its own way back.
                      secondaryAction:
                          fixPublished && cameBack
                              ? {
                                    label: t('kitchen:ops.exceptions.fix.back'),
                                    onPress: finishFix,
                                    testID: 'kitchen-recipe-uncosted-back',
                                }
                              : undefined,
                      testID: 'kitchen-recipe-issues-uncosted',
                  },
              ];

    const firstUnmapped = unmappedDraftEntries[0];
    const headsUpCards: IssueCardItem[] = [
        ...quietChecks,
        ...uncostedNotice,
        ...(firstUnmapped === undefined || lines.length === 0
            ? []
            : [
                  {
                      key: 'allergens',
                      // Stated, never blocking — see `unmappedDraftNames`.
                      tone: 'info' as const,
                      label: t('kitchen:recipes.checkAllergensUnmapped', {
                          names: unmappedDraftNames,
                      }),
                      detail: t('kitchen:recipes.sectionRawMaterials'),
                      action: {
                          onPress: () => {
                              openIngredient(String(firstUnmapped.id), 'ingredients', [
                                  'allergens',
                              ]);
                          },
                      },
                      testID: 'kitchen-recipe-issues-allergens',
                  },
              ]),
    ];

    const stockGapCards: IssueCardItem[] =
        fix === null || fixPublished
            ? []
            : [
                  {
                      key: 'stock-gap',
                      tone: 'warning',
                      label: fixTitle,
                      detail: t('kitchen:tray.fromStockGaps'),
                      testID: 'kitchen-recipe-stock-gap',
                      action: !canManage
                          ? undefined
                          : isEditable
                            ? {
                                  label: t('kitchen:publish.action'),
                                  onPress: savePublish,
                                  testID: 'kitchen-recipe-stock-gap-publish',
                              }
                            : isViewingCurrent
                              ? {
                                    label: t('kitchen:recipes.newDraft'),
                                    loading: openDraft.isPending,
                                    onPress: openNewDraft,
                                    testID: 'kitchen-recipe-stock-gap-new-draft',
                                }
                              : undefined,
                      secondaryAction: !cameBack
                          ? undefined
                          : {
                                label: t('kitchen:ops.exceptions.fix.back'),
                                onPress: () => {
                                    leaveWithoutKeeping(back.leave);
                                },
                                testID: 'kitchen-recipe-stock-gap-back',
                            },
                  },
              ];

    const trayGroups: IssueGroup[] = [
        {
            key: 'stock-gap',
            title: t('kitchen:tray.groupStockGap'),
            items: stockGapCards,
        },
        {
            key: 'save',
            title: t('kitchen:tray.groupSave'),
            items: saveCards,
            testID: 'kitchen-recipe-issues-errors',
        },
        {
            key: 'publish',
            title: t('kitchen:tray.groupPublish'),
            items: publishCards,
            testID: 'kitchen-recipe-issues-publish',
        },
        { key: 'heads-up', title: t('kitchen:tray.groupHeadsUp'), items: headsUpCards },
    ];

    const trayContent: IssueTrayContent = {
        title: t('kitchen:recipes.publishChecksTitle'),
        testID: 'kitchen-recipe-tray',
        groups: trayGroups,
        // The cost check while the server is still costing the draft: neither passed nor failed.
        checking:
            lines.length > 0 && canViewCosts && computed === null && rollup.isFetching
                ? [
                      {
                          key: 'costed',
                          label: t('kitchen:recipes.checkCosted'),
                          testID: 'kitchen-recipe-check-costed-pending',
                      },
                  ]
                : [],
        passed: publishChecks
            .filter((check) => check.ok)
            .map((check) => ({
                key: check.key,
                label: check.label,
                note: check.note,
                testID: `kitchen-recipe-check-${check.key}`,
            })),
        doneLabel: fixPublished
            ? t('kitchen:ops.exceptions.fix.doneTitle')
            : publishShown && isEditable
              ? t('kitchen:tray.readyToPublish')
              : isViewingCurrent && versionStatus === 'published'
                ? t('kitchen:tray.published')
                : undefined,
        // Opened from a stock gap and now published: the way back is the next step.
        doneAction:
            fixPublished && cameBack
                ? {
                      label: t('kitchen:ops.exceptions.fix.back'),
                      onPress: finishFix,
                      testID: 'kitchen-recipe-stock-gap-back',
                  }
                : undefined,
    };

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
        /*
         * No tray while an older version is on screen: its checks are about the version being
         * worked on, and switching away is not fixing anything — the cards must not tick off.
         */
        <IssueTrayFrame tray={isViewingCurrent ? trayContent : null} controller={issueTray}>
            <Cascade space="md" testID="kitchen-recipe-editor-screen">
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
                                {/*
                                 * The status, as one chip that opens the versions; then the lock that
                                 * says every recipe is kitchen-only. Each is a fact the old row spelled
                                 * out in capitals, with the import's file id beside them.
                                 */}
                                <RecipeVersionMenu
                                    versions={versions}
                                    selected={isCreating ? null : selected}
                                    onSelect={setSelectedVersionId}
                                    onRetire={
                                        data?.meta.status === 'published' && canManage
                                            ? () => {
                                                  setShowRetire(true);
                                              }
                                            : undefined
                                    }
                                />
                                <KitchenOnlyMark />
                                {/*
                                 * While creating, the handle the save is about to take. A saved
                                 * recipe's own is in its ID field, not up here.
                                 */}
                                {isCreating && headerReference !== '' ? (
                                    <Text
                                        testID="kitchen-recipe-editor-screen-reference"
                                        variant="mono"
                                        tone="secondary"
                                    >
                                        {headerReference}
                                    </Text>
                                ) : null}
                                {guard.isDirty ? (
                                    <Badge
                                        variant="label"
                                        testID="kitchen-recipe-editor-screen-dirty"
                                        tone="warning"
                                        icon="warning"
                                        label={t('kitchen:editor.unsaved')}
                                    />
                                ) : allSaved ? (
                                    // What the last Save did, said where the unsaved flag was, until
                                    // the next edit: every tab, the listing included, is on the server.
                                    <Badge
                                        variant="label"
                                        testID="kitchen-recipe-editor-screen-saved"
                                        tone="success"
                                        icon="check"
                                        label={t('kitchen:recipes.allSavedBadge')}
                                    />
                                ) : null}
                            </Inline>
                        }
                        primaryAction={
                            <Inline space="xs" align="center">
                                {/*
                                 * Cancel, Save draft and Publish, at the header's one `md` — Save on
                                 * every tab, so nobody has to find the last one to keep their work.
                                 * One of the two commits is filled, the one that comes next: Save while
                                 * there is something unsaved (or nothing to publish), Publish once the
                                 * draft on screen is the saved one.
                                 *
                                 * On Selling the listing's Archive leads the row, quiet, as it does on
                                 * a resale item's own page — not on a row of its own under the header.
                                 */}
                                {tab !== 'selling' ||
                                sellsAs?.archive === undefined ||
                                sellsAs.archive === null ? null : (
                                    <Button
                                        testID="kitchen-product-archive"
                                        variant="quiet"
                                        label={t('kitchen:list.archive')}
                                        disabled={sellsAs.archive.disabled}
                                        hint={sellsAs.archive.hint}
                                        onPress={sellsAs.archive.open}
                                    />
                                )}
                                {/*
                                 * A version that cannot be written says so once, here, instead of a
                                 * strip on the Description tab.
                                 */}
                                {isCreating || isEditable ? null : (
                                    <Inline space="xs" align="center">
                                        <Icon
                                            name="lock"
                                            size="sm"
                                            className="text-content-secondary"
                                        />
                                        <Text
                                            testID="kitchen-recipe-read-only"
                                            variant="caption"
                                            tone="secondary"
                                        >
                                            {t('kitchen:recipes.readOnly')}
                                        </Text>
                                    </Inline>
                                )}
                                <Button
                                    testID="kitchen-recipe-editor-screen-discard"
                                    variant="secondary"
                                    label={t('kitchen:editor.cancel')}
                                    onPress={() => {
                                        leaveWithoutKeeping(back.leave);
                                    }}
                                />
                                {/*
                                 * On a published version only the shelf life can be written (it is the
                                 * recipe's), so Save lights for that change alone and stops calling
                                 * the write a draft.
                                 */}
                                <Button
                                    testID="kitchen-recipe-editor-screen-save"
                                    variant={publishLeads || !isEditable ? 'secondary' : 'primary'}
                                    label={t(
                                        isEditable
                                            ? 'kitchen:common.saveDraft'
                                            : 'kitchen:common.save',
                                    )}
                                    loading={
                                        creatingNow ||
                                        create.isPending ||
                                        update.isPending ||
                                        setLines.isPending ||
                                        setPackagingLines.isPending ||
                                        photoSave.isPending ||
                                        listingSaving
                                    }
                                    disabled={
                                        creatingNow ||
                                        !canManage ||
                                        (!isEditable && !shelfLifeChanged && !listingDirty)
                                    }
                                    onPress={attemptSave}
                                />
                                {!publishShown || !isEditable ? null : (
                                    <Button
                                        testID="kitchen-recipe-publish"
                                        // What a stock gap's `no_recipe_version` focuses.
                                        nativeID="kitchen-recipe-publish"
                                        variant={publishLeads ? 'primary' : 'secondary'}
                                        label={t('kitchen:publish.action')}
                                        onPress={savePublish}
                                    />
                                )}
                                {/*
                                 * An older version on screen: the way back to the one being worked on.
                                 * The current one published or withdrawn: the successor draft, which
                                 * copies it — `createRecipeVersion`.
                                 */}
                                {isCreating ? null : !isViewingCurrent ? (
                                    <Button
                                        testID="kitchen-recipe-version-back-to-current"
                                        label={t('kitchen:recipes.backToCurrentVersion')}
                                        onPress={() => {
                                            setSelectedVersionId(null);
                                        }}
                                    />
                                ) : !isEditable && canManage ? (
                                    <Button
                                        testID="kitchen-recipe-new-draft"
                                        label={t('kitchen:recipes.newDraft')}
                                        loading={openDraft.isPending}
                                        onPress={openNewDraft}
                                    />
                                ) : null}
                            </Inline>
                        }
                    />

                    <Tabs<RecipeTab>
                        testID="kitchen-recipe-tabs"
                        label={t('kitchen:recipes.tabsLabel')}
                        items={tabItems}
                        value={tab}
                        onChange={setTab}
                        variant="steps"
                    />

                    {/*
                     * An older version, chosen from the status chip: `RecipeAdmin` carries only the
                     * current version in full, so what the tabs show is not it. Said once, here; the
                     * way back is the header's.
                     */}
                    {isViewingCurrent ? null : (
                        <Callout
                            testID="kitchen-recipe-version-unavailable"
                            role="note"
                            size="compact"
                            tone="info"
                            title={t('kitchen:recipes.versionUnavailableTitle')}
                        />
                    )}
                </Stack>

                {/* ── Description ──────────────────────────────────────────────────────────────── */}
                {tab !== 'description' ? null : (
                    <View className="relative z-raised flex-col gap-loose">
                        {/*
                         * Every tab body is one raised layer, and the same is true of the four below.
                         *
                         * react-native-web gives every `View` `position: relative; z-index: 0`, so a
                         * subtree paints as one layer, in source order among its siblings, whatever its
                         * descendants set on themselves. Anything drawn *after* the tab body would paint
                         * over whatever hangs out of it — the ingredient picker, the packaging picker,
                         * the sub-category select — exactly where a panel opens downward. Raising the
                         * body keeps those panels on top; their own z-indexes keep ordering its insides.
                         */}
                        <FormSection
                            first
                            variant="card"
                            testID="kitchen-recipe-identity"
                            title={t('kitchen:recipes.sectionIdentity')}
                        >
                            <View className="z-auto flex-row flex-wrap items-start gap-base">
                                <ImageSlot
                                    testID="kitchen-recipe-image"
                                    uri={photo}
                                    disabled={!editable}
                                    onChange={(next) => {
                                        setPhoto(next);
                                        const changed = next !== (photoKey ?? null);
                                        setPhotoDirty(changed);
                                        if (changed) guard.markDirty();
                                    }}
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
                                            : server.errorFor('name_en') === undefined
                                              ? {}
                                              : { englishError: server.errorFor('name_en') })}
                                        {...(server.errorFor('name_ar') === undefined
                                            ? {}
                                            : { arabicError: server.errorFor('name_ar') })}
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
                                    {!isCreating ||
                                    onCreated === undefined ||
                                    sellsAs !== undefined ? null : (
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
                                            {...(server.errorFor('notes') === undefined
                                                ? {}
                                                : { englishError: server.errorFor('notes') })}
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
                                     * Beside the category. A frozen meal passes no options, so it
                                     * draws none; a dressing's one option is drawn chosen and fixed.
                                     */}
                                    {classification === undefined ||
                                    classification.options.length === 0 ? null : (
                                        <Select
                                            span={2}
                                            testID="kitchen-recipe-subcategory"
                                            id="kitchen-recipe-subcategory"
                                            label={classification.subcategoryLabel}
                                            placeholder={classification.subcategoryPlaceholder}
                                            disabled={!editable || fixedSubcategory !== null}
                                            options={classification.options}
                                            value={recipeCategory === '' ? null : recipeCategory}
                                            {...server.flag('recipe_category')}
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
                                            value={referenceParts.id}
                                            {...(referenceParts.source === null
                                                ? {}
                                                : {
                                                      hint: t('kitchen:recipes.referenceSource', {
                                                          source: referenceParts.source,
                                                      }),
                                                  })}
                                            disabled
                                            onChangeText={() => undefined}
                                        />
                                    )}
                                </FormGrid>
                            </View>
                        </FormSection>
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
                            variant="card"
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
                                    {...server.flag('yield_quantity')}
                                    {...server.flag('yield_unit_id')}
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
                                    // What a stock gap opened this page for, until there is a count;
                                    // otherwise, on a meal, the count Publish is waiting for.
                                    {...(piecesFixMessage !== undefined
                                        ? { error: piecesFixMessage }
                                        : piecesOwed && publishShown && isEditable
                                          ? { warning: t('kitchen:publish.blockNoPieces') }
                                          : {})}
                                    {...server.flag('yield_piece_count')}
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
                                    {...server.flag('waste_coefficient_percent')}
                                    onChangeText={(next) => {
                                        setDetails({
                                            ...details,
                                            wastePercent: withoutMinus(next),
                                        });
                                        markDirty('details');
                                    }}
                                />
                            </FormGrid>
                        </FormSection>

                        <FormSection
                            variant="card"
                            testID="kitchen-recipe-lines"
                            nativeID="kitchen-recipe-lines"
                            title={t('kitchen:recipes.sectionRawMaterials')}
                        >
                            <RecipeLineTable
                                testID={LINES_TABLE}
                                rows={lines}
                                ingredients={libraryEntries}
                                flaggedIngredientIds={flaggedIngredientIds}
                                costs={computed?.production ?? null}
                                fieldError={lineFieldError('lines', lines)}
                                quantityMessage={(row) =>
                                    incompleteLineMessage(row) ?? fixLineMessage(row)
                                }
                                ingredientIssue={(row) =>
                                    row.ingredientId === null
                                        ? undefined
                                        : needsText(needsById.get(row.ingredientId))
                                }
                                onOpenIngredient={(row) => {
                                    if (row.ingredientId !== null) {
                                        openIngredient(row.ingredientId, 'ingredients');
                                    }
                                }}
                                canManage={editable}
                                nextKey={nextKey}
                                pickerPlaceholder={t('kitchen:recipes.addIngredientPlaceholder')}
                                onChange={(next) => {
                                    setLinesDraft(next);
                                    markDirty('lines');
                                }}
                                onIngredientCreated={(ingredient, needsDetails) => {
                                    const name = displayName(ingredient.name, locale).value;
                                    // Not blocking, and kept until dismissed: its link is the route to
                                    // the confirmation this recipe's publication now waits on, and a
                                    // timed toast was gone before a cook had read it.
                                    toast.show({
                                        testID: 'kitchen-recipe-quick-add-toast',
                                        tone: needsDetails ? 'warning' : 'info',
                                        durationMs: 0,
                                        message: t(
                                            needsDetails
                                                ? 'kitchen:recipes.quickAddNeedsDetailsToast'
                                                : 'kitchen:recipes.quickAddCreatedToast',
                                            { name },
                                        ),
                                        action: {
                                            testID: 'kitchen-recipe-quick-add-review',
                                            label: t('kitchen:recipes.quickAddReview'),
                                            // Opened to fix, with the way back to this tab — and
                                            // what is typed here kept for the trip.
                                            onPress: () => {
                                                openIngredient(
                                                    String(ingredient.id),
                                                    'ingredients',
                                                    needsDetails ? ['nutrition'] : [],
                                                );
                                            },
                                        },
                                    });
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
                            variant="card"
                            testID="kitchen-recipe-packaging-coefficients"
                            title={t('kitchen:forms.expiryAndWaste')}
                        >
                            <FormGrid track="half" testID="kitchen-recipe-packaging-waste-grid">
                                {/*
                                 * How long a packed batch keeps — a property of the pack as much as of
                                 * the formulation, so it sits with the packaging. The recipe's, so it
                                 * stays open on a published version (see the docblock).
                                 */}
                                <QuantityInput
                                    testID="kitchen-recipe-expiry"
                                    id="kitchen-recipe-expiry"
                                    size="sm"
                                    label={t('kitchen:forms.expiryPeriod')}
                                    placeholder={t('kitchen:fields.daysPlaceholder')}
                                    unit={t('kitchen:forms.days')}
                                    value={details.shelfLifeDays}
                                    disabled={!canManage}
                                    {...(shows('shelf-life')
                                        ? { error: t('kitchen:forms.shelfLifeInvalid') }
                                        : {})}
                                    {...server.flag('shelf_life_days')}
                                    onChangeText={(next) => {
                                        setDetails({ ...details, shelfLifeDays: next });
                                        markDirty('details');
                                    }}
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
                                    {...server.flag('packaging_waste_percent')}
                                    onChangeText={(next) => {
                                        setDetails({
                                            ...details,
                                            packagingWastePercent: withoutMinus(next),
                                        });
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
                                variant="card"
                                testID="kitchen-recipe-packaging"
                                title={t('kitchen:recipes.sectionPackaging')}
                            >
                                <RecipeLineTable
                                    testID={PACKAGING_TABLE}
                                    rows={packaging}
                                    ingredients={packagingLibrary}
                                    source="packaging"
                                    warnZeroQuantity
                                    costs={computed?.packaging ?? null}
                                    fieldError={lineFieldError('packaging', packaging)}
                                    ingredientIssue={(row) =>
                                        row.ingredientId === null
                                            ? undefined
                                            : needsText(needsById.get(row.ingredientId))
                                    }
                                    onOpenIngredient={(row) => {
                                        if (row.ingredientId !== null) {
                                            openIngredient(row.ingredientId, 'packaging');
                                        }
                                    }}
                                    // `editable`, as the lines table: a published version refuses
                                    // packaging writes, and rows typed here vanished on save (HA-36).
                                    canManage={editable}
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
                            variant="card"
                            testID="kitchen-recipe-cost-cascade"
                            nativeID="kitchen-recipe-cost-cascade"
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
                                variant="card"
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
                    </View>
                )}

                {/* ── Selling ──────────────────────────────────────────────────────────────────── */}
                {/*
                 * Mounted whenever there is a listing, and hidden rather than unmounted on the other tabs.
                 * Its drafts live inside it, so unmounting it on a tab switch would throw away a pack
                 * somebody had half typed — the recipe's own drafts survive a switch because they live on
                 * this screen, and the listing's have to as well.
                 *
                 * It is its own `CascadeItem` so that `hidden` lands on the band's box: hidden one level
                 * further in, the band would still stand in the page and take a gap on every other tab.
                 */}
                {/*
                 * The listing's problems are cards in this page's tray (`useIssueGroup`), under the
                 * tab's name and on every tab; each one's Fix switches here first.
                 */}
                {sellsAs === undefined ? null : (
                    <CascadeItem index={0} className={tab === 'selling' ? undefined : 'hidden'}>
                        <View className="relative z-raised" testID="kitchen-recipe-selling">
                            <IssueRevealScope reveal={revealSelling}>
                                {sellsAs.content}
                            </IssueRevealScope>
                        </View>
                    </CascadeItem>
                )}

                {/* ── Technical sheet ──────────────────────────────────────────────────────────── */}
                {tab !== 'sheet' ? null : (
                    <View className="relative z-raised flex-col gap-loose">
                        <View className="min-w-0 flex-1 flex-col gap-loose">
                            {/*
                             * The sheet as a reader checks it before publishing: one ledger of the figures
                             * the other steps produced, from the draft rather than the saved version, so it
                             * answers while a recipe is still being written.
                             */}
                            <FormSection
                                first
                                variant="card"
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
                                variant="card"
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
                                    <Stack space="xs" testID="kitchen-recipe-composition-warnings">
                                        {warningNotices.map((notice) => (
                                            <Text
                                                key={notice.code}
                                                testID={`kitchen-recipe-composition-warnings-warning-${notice.code}`}
                                                variant="caption"
                                                tone="warning"
                                            >
                                                {notice.text}
                                            </Text>
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
                                variant="card"
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
                                variant="card"
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
                    </View>
                )}

                {/* ── publish ──────────────────────────────────────────────────────────────────── */}
                <Dialog
                    testID="kitchen-recipe-publish-dialog"
                    open={showPublish}
                    onClose={() => {
                        setShowPublish(false);
                    }}
                    title={t('kitchen:publish.titleVersion', {
                        number: currentVersion?.versionNumber ?? 1,
                    })}
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
                                                if (fix !== null) setFixPublished(true);
                                                endProcessSavedOn(ownPath);
                                                toast.show({
                                                    testID: 'kitchen-recipe-published-toast',
                                                    tone: 'success',
                                                    message: t('kitchen:publish.publishedToast', {
                                                        number: published.currentVersion
                                                            .versionNumber,
                                                    }),
                                                    // Opened from a stock gap: the next step is back
                                                    // there, to retry it.
                                                    ...(fix !== null && cameBack
                                                        ? {
                                                              action: {
                                                                  testID: 'kitchen-recipe-published-back',
                                                                  label: t(
                                                                      'kitchen:ops.exceptions.fix.back',
                                                                  ),
                                                                  onPress: finishFix,
                                                              },
                                                          }
                                                        : {}),
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
                    {/*
                     * Short and in full ink: one sentence on what publishing does, the label as chips,
                     * then only what still stands in the way — each with the way to fix it. Grey caption
                     * text made the old dialog hard to read, and every paragraph it dropped was saying
                     * something the reader did not need in order to press Publish.
                     */}
                    <Stack space="md">
                        <Text testID="kitchen-recipe-publish-consequence">
                            {t('kitchen:publish.consequence')}
                        </Text>

                        <Stack space="xs" testID="kitchen-recipe-publish-allergens">
                            <Text variant="label">{t('kitchen:publish.allergenRowsTitle')}</Text>
                            {currentVersion === null || currentVersion.allergens.length === 0 ? (
                                <Text testID="kitchen-recipe-publish-allergens-none">
                                    {t('kitchen:publish.allergenRowsNone')}
                                </Text>
                            ) : (
                                <Inline space="xs" wrap>
                                    {currentVersion.allergens.map((declaration) => (
                                        <Tag
                                            key={declaration.allergenCode}
                                            testID={`kitchen-recipe-publish-allergen-${String(declaration.allergenCode)}`}
                                            // `contains` and `may contain` are two claims, never one
                                            // colour — and the words say which, not the colour alone.
                                            tone={
                                                declaration.containment === 'contains'
                                                    ? 'danger'
                                                    : 'warning'
                                            }
                                            label={t('kitchen:publish.allergenTag', {
                                                code: String(declaration.allergenCode),
                                                containment: t(
                                                    declaration.containment === 'contains'
                                                        ? 'kitchen:containment.contains'
                                                        : 'kitchen:containment.mayContain',
                                                ),
                                            })}
                                        />
                                    ))}
                                </Inline>
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
                                <Stack space="xs">
                                    {publishBlockers.map((reason) => (
                                        <Inline
                                            key={reason.text}
                                            space="sm"
                                            align="center"
                                            justify="between"
                                            wrap
                                        >
                                            <Text>{reason.text}</Text>
                                            {reason.fix === undefined ? null : (
                                                <Button
                                                    testID={`kitchen-recipe-publish-fix-${reason.fix.id}`}
                                                    size="sm"
                                                    variant="secondary"
                                                    label={t('kitchen:publish.fixIt')}
                                                    onPress={() => {
                                                        if (reason.fix === undefined) return;
                                                        setShowPublish(false);
                                                        openIngredient(
                                                            reason.fix.id,
                                                            'ingredients',
                                                            [reason.fix.need],
                                                        );
                                                    }}
                                                />
                                            )}
                                        </Inline>
                                    ))}
                                </Stack>
                            </Callout>
                        )}

                        {/*
                         * Each unchecked ingredient is its own button, opening its form on the allergen
                         * section with the way back to this recipe — the fix, not just the name.
                         */}
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
                                            variant="secondary"
                                            label={displayName(entry.name, locale).value}
                                            onPress={() => {
                                                setShowPublish(false);
                                                openIngredient(String(entry.id), 'ingredients', [
                                                    'allergens',
                                                ]);
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
                                    {/*
                                     * A catalogue refusal reaches the client as a validation failure
                                     * whose one field repeats the message; only lines that add
                                     * something are drawn, or the callout says it twice.
                                     */}
                                    {Object.entries(publishFields)
                                        .filter(
                                            ([, messages]) =>
                                                messages.join(' ') !== publishFailure.message,
                                        )
                                        .map(([field, messages]) => (
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
            </Cascade>
        </IssueTrayFrame>
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
