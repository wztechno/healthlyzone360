import type { DataListColumn } from '@healthy360/design-system';

/**
 * The Catalogue's column spec — handoff §4.1.
 *
 * Ingredients, Recipes and Sauces differ by an array of these and nothing else. That is the whole
 * point of the shape: a fourth entity is a spec file, not a screen. It is deliberately the same
 * shape as today's `RecordColumn` so the existing definitions port with minimal edits, plus the
 * two fields `DataListColumn` does not carry.
 *
 * `min` is the numeric floor the fitting logic reads; `role` is what the narrow renderer reads.
 * Below `md` there is no column grid at all (§4.1) — the same record renders two-line — so a spec
 * that only described tracks would leave the narrow row with no way to know which column is the
 * title and which is the headline metric. Stating it here keeps the entity difference in the array
 * where it belongs, rather than in a second per-entity narrow-row component.
 */
export interface CatalogueColumn<Row> extends DataListColumn<Row> {
    /**
     * The width below which this column is not worth drawing. Distinct from `width`, which is the
     * track it gets when it is drawn: `min` is the floor `fitColumns` charges against the budget.
     * Defaults to `width` when omitted, which is the conservative reading.
     */
    readonly min?: number | undefined;
    /** Renders the cell through a status badge rather than as text. */
    readonly badge?: boolean | undefined;
    /** Drives `localeCompare` versus numeric ordering when the header sorts (§4.3). */
    readonly sortType?: 'text' | 'number' | undefined;
    /** What this column becomes in the two-line row below `md`. */
    readonly role?: CatalogueColumnRole | undefined;
}

export const CATALOGUE_COLUMN_ROLES = ['title', 'status', 'metric', 'meta', 'actions'] as const;
export type CatalogueColumnRole = (typeof CATALOGUE_COLUMN_ROLES)[number];

/**
 * The priority ladder, as `Catalogue.dc.html` states it.
 *
 * Named rather than written as bare numbers in each spec so the relative order is a decision made
 * once. `designation` and `actions` sit at or above `UNDROPPABLE_PRIORITY`, which is what keeps the
 * row's one control reachable at every width.
 *
 * The design's own numbers, not the handoff prose's: the handoff summarised the ladder as
 * "reference 70, category 50" and the file it summarises actually draws reference at 88 and
 * category at 40 — which is the more defensible pair. A kitchen reads down the reference column
 * ("IG-044"), so it should outlive `Category` and `Unit`, both of which are recoverable from the
 * record itself. Where the two disagree the drawn file wins, the same rule CLAUDE.md applies to
 * colour.
 *
 * `metric` has no ingredient consumer — there is no cost or yield on `IngredientAdmin` — and stays
 * for Recipes and Sauces, whose Cost / kg is the 85.
 */
export const CATALOGUE_PRIORITY = {
    designation: 100,
    actions: 95,
    reference: 88,
    metric: 85,
    status: 80,
    unitPrice: 75,
    unit: 50,
    category: 40,
    allergens: 30,
    updated: 20,
} as const;

/** The fitting floor for a column, falling back to its track width. */
export function columnFloor<Row>(column: CatalogueColumn<Row>): number {
    return column.min ?? column.width;
}

/** The first column carrying `role`, or undefined. Specs declare each role at most once. */
export function columnForRole<Row>(
    columns: readonly CatalogueColumn<Row>[],
    role: CatalogueColumnRole,
): CatalogueColumn<Row> | undefined {
    return columns.find((column) => column.role === role);
}
