import type { TransferResource } from '@healthy360/api-client/contracts';

/**
 * What each import expects, as the Import dialog spells it out before anything is uploaded.
 *
 * `header` is the column's heading **verbatim, in English**: it is the string the server's template
 * writes and its importer matches, not copy. Translating it would tell an Arabic reader to type a
 * heading the importer does not recognise. The hint beside it is the translated part.
 */

export interface ImportColumn {
    readonly header: string;
    readonly required: boolean;
    readonly hintKey: string;
    readonly values?: readonly string[] | undefined;
}

export interface ImportGuide {
    readonly resource: TransferResource;
    readonly titleKey: string;
    readonly matchRuleKey: string;
    readonly rowCap: number;
    readonly columns: readonly ImportColumn[];
}

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const UNITS = [
    'g',
    'kg',
    'mg',
    'ml',
    'l',
    'tsp',
    'tbsp',
    'cup',
    'gallon',
    'piece',
    'serving',
    'bunch',
    'can',
    'bag',
    'bottle',
    'pack',
] as const;

function column(
    resource: TransferResource,
    header: string,
    hint: string,
    required = false,
    values?: readonly string[],
): ImportColumn {
    return { header, required, hintKey: `kitchen:transfer.columns.${resource}.${hint}`, values };
}

export function ingredientImportGuide(categoryCodes: readonly string[]): ImportGuide {
    const c = (header: string, hint: string, required = false, values?: readonly string[]) =>
        column('ingredients', header, hint, required, values);

    return {
        resource: 'ingredients',
        titleKey: 'kitchen:transfer.ingredients.importTitle',
        matchRuleKey: 'kitchen:transfer.guide.matchRule',
        rowCap: 2000,
        columns: [
            c('Reference', 'reference'),
            c('Name (EN)', 'nameEn', true),
            c('Name (AR)', 'nameAr'),
            c('Category', 'category', true, categoryCodes),
            c('Unit', 'unit', true, UNITS),
            c('Purchase unit', 'purchaseUnit', false, UNITS),
            c('Items per unit', 'itemsPerUnit'),
            c('Grams per unit', 'gramsPerUnit'),
            c('Yield factor', 'yieldFactor'),
            c('Unit price', 'unitPrice'),
            c('B2B price', 'b2bPrice'),
            c('B2C price', 'b2cPrice'),
            c('Price currency', 'priceCurrency'),
            c('Purchase price', 'purchasePrice'),
            c('Purchase currency', 'purchaseCurrency'),
            c('Waste %', 'wastePercent'),
            c('Capacity', 'capacity'),
            c('Capacity unit', 'capacityUnit', false, UNITS),
            c('Availability', 'availability', false, ['core', 'common', 'specialty_imported']),
            c('Sellable', 'sellable', false, ['yes', 'no']),
            c('Composition', 'composition'),
            c('Notes', 'notes'),
        ],
    };
}

const r = (header: string, hint: string, required = false, values?: readonly string[]) =>
    column('recipes', header, hint, required, values);

export const RECIPE_IMPORT_GUIDE: ImportGuide = {
    resource: 'recipes',
    titleKey: 'kitchen:transfer.recipes.importTitle',
    matchRuleKey: 'kitchen:transfer.guide.matchRuleRecipes',
    rowCap: 5000,
    columns: [
        r('Reference', 'reference'),
        r('Recipe name (EN)', 'nameEn', true),
        r('Recipe name (AR)', 'nameAr'),
        r('Category', 'category'),
        r('Yield quantity', 'yieldQuantity'),
        r('Yield unit', 'yieldUnit', false, UNITS),
        r('Yield pieces', 'yieldPieces'),
        r('Shelf life days', 'shelfLifeDays'),
        r('Notes', 'notes'),
        r('Ingredient ref', 'ingredientRef'),
        r('Ingredient', 'ingredient'),
        r('Quantity', 'quantity'),
        r('Unit', 'unit', false, UNITS),
        r('Comment', 'comment'),
    ],
};

const s = (header: string, hint: string, required = false) =>
    column('stock', header, hint, required);

export const STOCK_COUNT_IMPORT_GUIDE: ImportGuide = {
    resource: 'stock',
    titleKey: 'kitchen:transfer.stock.importTitle',
    matchRuleKey: 'kitchen:transfer.guide.matchRuleStock',
    rowCap: 2000,
    columns: [
        s('Code', 'code', true),
        s('Item', 'item'),
        s('Counted quantity', 'countedQuantity'),
        s('Reorder threshold', 'reorderThreshold'),
        s('Par level', 'parLevel'),
    ],
};
