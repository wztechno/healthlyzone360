import { Icon, Menu, Text, cx } from '@healthy360/design-system';
import type { DataListColumn, MenuSection } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Pressable, View } from 'react-native';

/**
 * One column header, with its sort-and-filter menu — §4.3, drawn so the affordance is visible
 * before it is pressed.
 *
 * ```
 * CATEGORY ↑        sorts, and is not the column currently sorted — grey arrow
 * CATEGORY ↑        sorted ascending — black arrow, black label
 * CATEGORY ↓        sorted descending
 * STATUS ↓         filters only, a value applied — the arrow is the menu's mark
 * CATEGORY ▽  ↑     filters and sorts: the label opens the values, the arrow sorts
 * ```
 *
 * ## One arrow, always drawn, ascending until told otherwise
 *
 * Every one of these headers already opened a menu; none of them said so. A reader met a row of
 * plain labels, identical to the ones that genuinely do nothing (`Allergens`, the action
 * column), and the only way to learn which were live was to click each in turn.
 *
 * The mark that says so is the **sort arrow itself**, drawn on every column that can sort rather
 * than only on the one currently sorting. It points up by default, because ascending is where a
 * fresh sort starts and an arrow pointing nowhere in particular would be a worse guess than the one
 * the column will actually make when pressed. A short-lived earlier version paired this with a
 * separate `⌄` meaning "there is a menu here"; two marks on a 10px label is one more than the row
 * can carry, and the arrow was already saying it.
 *
 * Weight, not presence, separates the active column from the rest: grey on every sortable header,
 * black on the one the list is actually ordered by, beside a label that goes black with it. That is
 * a redundant pair — ink *and* the label's own promotion — rather than colour carrying it alone.
 *
 * ## And the applied state has to be there after it
 *
 * Filtering worked and showed nothing for it. Choosing a category narrowed the list correctly, then
 * left the page indistinguishable from an unfiltered one — no mark on the column that was doing the
 * narrowing, so clearing it meant remembering which header you had pressed and hoping the menu
 * still held a `Clear`. That is the bug this component exists to close.
 *
 * A filtered column gains the filter mark `▽`, absent until something is applied. A glyph that
 * *arrives* is the strongest signal available here and the only one that survives the package's
 * standing rule that meaning is never colour alone — a reader who cannot separate
 * `content-secondary` from `content-primary` at 10px, which is most readers at that size, still
 * sees a shape appear. For the same reason it takes an accessible `label` in that state and only in
 * that state: `Icon` is decorative by default because meaning normally lives in the text beside it,
 * and this is the one case where it does not.
 *
 * It is a *second* mark rather than a replacement for the arrow, because sorting and filtering are
 * independent — a column can be sorted, filtered, both or neither, and one glyph made to mean four
 * things would mean none of them.
 *
 * **A column that filters but cannot sort therefore carries no idle mark**, the arrow being what
 * announces the menu. Only `status` on the packaging list is in that position today.
 */

export interface CatalogueColumnHeaderProps {
    /** The column's translated label, and its alignment — the two fields of the spec this needs. */
    readonly label: string;
    readonly align?: DataListColumn<unknown>['align'];
    /** The sections the entity's screen builds — the sort pair, the value list, the `Clear`. */
    readonly sections: readonly MenuSection[];
    /**
     * `'asc'` / `'desc'` when this is the column the list is ordered by, `null` when the column can
     * sort but is not the active one, and `undefined` when it cannot sort at all. Three states
     * rather than a boolean, because the arrow draws all three.
     */
    readonly sortDirection?: 'asc' | 'desc' | null | undefined;
    /** Whether a filter *on this column* is currently narrowing the list. */
    readonly filtered?: boolean | undefined;
    /**
     * Sorts on a plain press instead of opening a menu.
     *
     * A menu earns itself when it holds a choice. On a column that can only sort, it held two items
     * that between them said "ascending or descending" - a second click to express what the first
     * click already meant, on every column of the list except the two or three that filter. Passed
     * by a column with no value list, and it flips the direction the way a table header has flipped
     * it since tables had headers.
     *
     * Passed together with `sections`, the head splits in two: the label opens the values and the
     * arrow — a target of its own, `-sort` — flips the order.
     */
    readonly onToggleSort?: (() => void) | undefined;
    /** `kitchen-ingredients-column-category` — the trigger takes `-trigger`, the arrow
     * `-sorted` on the ordered column and `-affordance` on every other. */
    readonly testID: string;
}

const JUSTIFY_CLASS = {
    start: 'justify-start',
    center: 'justify-center',
    end: 'justify-end',
} as const;

export function CatalogueColumnHeader({
    label,
    align,
    sections,
    // No default. Omitting it has to keep meaning "this column does not sort", which is the one
    // reading a `= null` here would quietly convert into a grey arrow on a header that has none.
    sortDirection,
    filtered = false,
    onToggleSort,
    testID,
}: CatalogueColumnHeaderProps) {
    const { t } = useTranslation();
    const active = sortDirection === 'asc' || sortDirection === 'desc';
    const filters = sections.length > 0;
    const sorts = onToggleSort !== undefined;
    // A column that both filters and sorts splits its head: the label opens the values, the arrow
    // sorts. Only there does the arrow stop standing in for the filter state, because only there
    // is it a sort control of its own — the filter mark carries that state instead.
    const split = filters && sorts;

    /*
     * One arrow on every header, drawn at `title` size so it reads as a control rather than as
     * punctuation after the label, and set a `tight` gap away from it.
     *
     * On a sorting column it shows the direction — black on the column the list is ordered by,
     * grey on every other. On a column that only filters it is the menu's mark, and turns down
     * while a value is narrowing the list: `↑` nothing applied, `↓` narrowed.
     */
    const arrowDown = sortDirection === 'desc' || (!split && filtered);
    const arrowInk = active || (!split && filtered);
    const arrow = (
        <Text
            variant="title"
            tone={arrowInk ? 'primary' : 'disabled'}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={active ? `${testID}-sorted` : `${testID}-affordance`}
        >
            {arrowDown ? '↓' : '↑'}
        </Text>
    );

    // `strong`: 13px at 600 — a column's name, set heavier and larger than the 12px cells under it.
    const labelText = (
        <Text variant="strong" tone={active || filtered ? 'primary' : 'secondary'}>
            {label}
        </Text>
    );

    const className = cx('flex-row items-center gap-tight', JUSTIFY_CLASS[align ?? 'start']);

    const menu = (content: ReactNode, accessibilityLabel: string) => (
        <Menu
            label={accessibilityLabel}
            align="start"
            // The header cell is inside the list's own stacking context and the rows paint
            // after it, so a panel hanging from the header lands *under* the first rows.
            className="z-sticky"
            sections={sections}
            trigger={({ triggerProps, toggle }) => (
                <Pressable
                    {...triggerProps}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={accessibilityLabel}
                    onPress={toggle}
                    testID={`${testID}-trigger`}
                    className={className}
                >
                    {content}
                </Pressable>
            )}
            testID={testID}
        />
    );

    /*
     * Filters and sorts — Category on a server-sorted list, say. Two targets side by side: the
     * label opens the value list, the arrow flips the order. The filter state keeps a mark of its
     * own, `▽` beside the label, because the arrow now means the sort and cannot also mean that.
     */
    if (split) {
        return (
            <View className={className}>
                {menu(
                    <>
                        {labelText}
                        {filtered ? (
                            <Icon
                                name="filter"
                                size="sm"
                                label={t('kitchen:catalogue.columnFiltered')}
                                className="text-content-primary"
                                testID={`${testID}-filtered`}
                            />
                        ) : null}
                    </>,
                    t('kitchen:catalogue.columnFilter', { column: label }),
                )}
                <Pressable
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('kitchen:catalogue.columnSort', { column: label })}
                    aria-sort={active ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'}
                    onPress={onToggleSort}
                    testID={`${testID}-sort`}
                    className="items-center justify-center"
                >
                    {arrow}
                </Pressable>
            </View>
        );
    }

    /*
     * A column that only filters is one target, and it filters. The arrow sits inside the trigger
     * as the menu's mark; `sortDirection` is `undefined` here, so it never claims an order.
     */
    if (filters) {
        return menu(
            <>
                {labelText}
                {arrow}
            </>,
            t('kitchen:catalogue.columnMenu', { column: label }),
        );
    }

    return (
        <Pressable
            role="button"
            accessibilityRole="button"
            accessibilityLabel={t('kitchen:catalogue.columnSort', { column: label })}
            aria-sort={active ? (sortDirection === 'desc' ? 'descending' : 'ascending') : 'none'}
            onPress={onToggleSort}
            testID={`${testID}-trigger`}
            className={className}
        >
            {labelText}
            {arrow}
        </Pressable>
    );
}
