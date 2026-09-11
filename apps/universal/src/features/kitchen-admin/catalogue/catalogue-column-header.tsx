import { Menu, Text, cx } from '@healthy360/design-system';
import type { DataListColumn, MenuSection } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { Pressable } from 'react-native';

/**
 * One column header, with its sort-and-filter menu — §4.3, drawn so the affordance is visible
 * before it is pressed.
 *
 * ```
 * CATEGORY ↑        sorts, and is not the column currently sorted — grey arrow
 * CATEGORY ↑        sorted ascending — black arrow, black label
 * CATEGORY ↓        sorted descending
 * CATEGORY ↑ ▽      sorted, and filtered
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
     * The filtering columns keep the menu, because there the sort pair shares the panel with the
     * values and a press has to be able to mean either.
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
    const marked = active || filtered;

    /*
     * One glyph on every header, and it is always the arrow.
     *
     * The filtering columns briefly carried `⌄`, and a filtered one carried `▽` on top of it -
     * three different marks across a row of seven headers, which is what "don't mix them" was
     * about. So the arrow is the only mark there is: it shows the direction on the column the list
     * is ordered by, sits grey on every other column, and on a filtering column it is *also* the
     * thing you press to open the values.
     *
     * The filtered state turns the arrow **down**, and that is what gives it a shape of its own
     * again. `▽` used to carry it, and dropping that glyph left the state on ink and weight alone -
     * honest, since the label also promotes and the menu ticks the value in force, but weaker than
     * a mark that changes. A filtering column now reads at a glance: `↑` nothing applied, `↓`
     * narrowed. The direction is not a sort on these columns and never claims to be - they do not
     * sort at all - it is "this column is doing something to the list".
     */
    const arrow = (
        <Text
            variant="label"
            tone={marked ? 'primary' : 'disabled'}
            aria-hidden
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            testID={active ? `${testID}-sorted` : `${testID}-affordance`}
        >
            {sortDirection === 'desc' || filtered ? '↓' : '↑'}
        </Text>
    );

    const labelText = (
        <Text variant="label" tone={marked ? 'primary' : 'secondary'}>
            {label}
        </Text>
    );

    const className = cx('flex-row items-center gap-hair', JUSTIFY_CLASS[align ?? 'start']);

    /*
     * A filtering column is one target, and it filters.
     *
     * These three - Category, Status, Allergens - do not sort. Their menu is a value list and the
     * whole head opens it, so there is nothing to press that would order the list by them. The
     * arrow is still drawn, because a row where three headers out of seven carry no mark is the
     * mixture this component spent several passes removing; here it sits grey and inert, part of
     * the trigger rather than a control of its own.
     *
     * `sortDirection` is `undefined` on these columns, which is what keeps the mark honest: it is
     * never the primary ink an ordered column earns, and it never points down.
     */
    if (sections.length > 0) {
        return (
            <Menu
                label={t('kitchen:catalogue.columnMenu', { column: label })}
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
                        accessibilityLabel={t('kitchen:catalogue.columnMenu', { column: label })}
                        onPress={toggle}
                        testID={`${testID}-trigger`}
                        className={className}
                    >
                        {labelText}
                        {arrow}
                    </Pressable>
                )}
                testID={testID}
            />
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
