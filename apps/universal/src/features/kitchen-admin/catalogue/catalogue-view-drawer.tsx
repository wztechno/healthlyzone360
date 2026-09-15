import { DerivedChipPanel, RecordWindow, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';

/**
 * The read-only record panel behind a row's View action — handoff §4.1.
 *
 * **Now a centred `RecordWindow`, not a drawer** (Workbench handoff §0). The side drawer was retired
 * for every kitchen-admin "view a record" surface, and this file is re-pointed rather than each
 * Catalogue screen, so the Catalogue and the workbench cannot diverge. The props did not change;
 * the diagram below still names the parts, now laid out as the window's title bar, field grid and
 * footer.
 *
 * ```
 * INGREDIENT                                    ✕
 * ING-044  Olive Oil
 * [ Live ]
 * ─────────────────────────────────────────────────
 * FIELDS
 * Reference        ING-044
 * Category         Oils
 * Unit             L
 * …
 * ALLERGENS  [ From database ]
 * ( Milk )  ( Sesame )
 * ─────────────────────────────────────────────────
 *                              [ Close ]  [ Edit ]
 * ```
 *
 * ## Why View exists at all when the row already opens the editor
 *
 * A catalogue is browsed far more often than it is changed, and the row body opening a form means
 * every "what is in this?" costs a form load, a dirty-state guard on the way out, and the standing
 * risk of a stray keystroke landing in a field. This is the cheap answer to the common question,
 * and its footer is the way into the expensive one — so deciding to edit *after* looking is one
 * press, not a return trip through the list.
 *
 * The handoff records the open question honestly: click-to-inspect with an explicit Edit may be the
 * safer default for the row body too. That is a conversation with the kitchen, not a decision to
 * take here, and until it happens the row keeps the behaviour it shipped with.
 *
 * ## Entity-agnostic on purpose
 *
 * Ingredients, Recipes and Sauces differ by their `fields` array, exactly as their lists differ by a
 * column spec. Nothing here knows what an allergen is — `chips` is a slot with a caption, and the
 * ingredient screen is what decides that the caption says the allergens came from the database and
 * cannot be edited on this record.
 */

export interface CatalogueViewField {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    /** Already formatted — the caller owns the numbering system and the locale. */
    readonly value: string;
    /** Sets the value in the mono role. References, quantities, costs, versions. */
    readonly mono?: boolean | undefined;
}

export interface CatalogueViewDrawerProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** Translated. The eyebrow above the title — "Ingredient". */
    readonly kindLabel: string;
    /** The record's own reference, mono, beside the title. Omit where there is none. */
    readonly reference?: string | undefined;
    readonly title: string;
    /** The record's status, as the list's own badge. */
    readonly status?: ReactNode | undefined;
    readonly fields: readonly CatalogueViewField[];
    /** Translated heading for the chip run — "Allergens". Omit and no chip section is drawn. */
    readonly chipsLabel?: string | undefined;
    /** Translated provenance badge beside that heading — "From database". */
    readonly chipsSource?: string | undefined;
    /** One line under the heading saying why the chips are not editable here. */
    readonly chipsCaption?: string | undefined;
    readonly chips?: ReactNode | undefined;
    /** Translated. The footer's second button opens the editor. Omit to draw Close alone. */
    readonly editLabel?: string | undefined;
    readonly onEdit?: (() => void) | undefined;
    /** Unused since the window: its Close carries `common:action.close`. Kept so callers compile. */
    readonly closeLabel: string;
    /** Unused since the window: its field grid has no heading. Kept so callers compile. */
    readonly fieldsLabel: string;
    readonly testID: string;
}

export function CatalogueViewDrawer({
    open,
    onClose,
    kindLabel,
    reference,
    title,
    status,
    fields,
    chipsLabel,
    chipsSource,
    chipsCaption,
    chips,
    editLabel,
    onEdit,
    fieldsLabel: _fieldsLabel,
    closeLabel: _closeLabel,
    testID,
}: CatalogueViewDrawerProps) {
    return (
        <RecordWindow
            open={open}
            onClose={onClose}
            title={title}
            kind={kindLabel}
            // The reference and the list's own status badge sit in the title bar, beside the kind:
            // they are the record's identity, and the field grid below is its facts.
            titleAside={
                <>
                    {reference === undefined ? null : (
                        <Text variant="mono" tone="secondary" testID={`${testID}-reference`}>
                            {reference}
                        </Text>
                    )}
                    {status}
                </>
            }
            fields={fields}
            lines={
                chipsLabel === undefined || chips === undefined ? undefined : (
                    <DerivedChipPanel
                        testID={`${testID}-chips`}
                        label={chipsLabel}
                        badge={chipsSource}
                        caption={chipsCaption}
                    >
                        {chips}
                    </DerivedChipPanel>
                )
            }
            primaryAction={
                editLabel === undefined || onEdit === undefined
                    ? undefined
                    : { label: editLabel, onPress: onEdit, testID: `${testID}-edit` }
            }
            testID={testID}
        />
    );
}
