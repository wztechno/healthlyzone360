import { Badge, Button, Drawer, Separator, Text } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { View } from 'react-native';

/**
 * The read-only record panel behind a row's View action — handoff §4.1.
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
    readonly closeLabel: string;
    /** Translated heading over the field list — "Fields". */
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
    closeLabel,
    fieldsLabel,
    testID,
}: CatalogueViewDrawerProps) {
    return (
        <Drawer
            open={open}
            onClose={onClose}
            // `Drawer` draws this as the panel's visible heading *and* its accessible name, so the
            // record's name lives there and the body opens with the two things the header has no
            // room for — what kind of record it is, and what state it is in.
            title={title}
            placement="end"
            testID={testID}
            footer={
                <View className="flex-row items-center justify-end gap-tight">
                    <Button
                        variant="secondary"
                        size="sm"
                        label={closeLabel}
                        onPress={onClose}
                        testID={`${testID}-close`}
                    />
                    {editLabel === undefined || onEdit === undefined ? null : (
                        <Button
                            size="sm"
                            label={editLabel}
                            onPress={onEdit}
                            testID={`${testID}-edit`}
                        />
                    )}
                </View>
            }
        >
            <View className="flex-col gap-snug">
                {/*
                 * The identity line — kind, reference, state. The *name* is deliberately not here:
                 * `Drawer` already prints it two lines up, and drawing it again put "Tahini paste"
                 * twice in the top 60px of a 372px panel.
                 */}
                <View className="flex-col gap-hair">
                    <View className="flex-row flex-wrap items-baseline gap-tight">
                        <Text variant="micro" tone="secondary">
                            {kindLabel}
                        </Text>
                        {reference === undefined ? null : (
                            <Text variant="mono" tone="secondary" testID={`${testID}-reference`}>
                                {reference}
                            </Text>
                        )}
                    </View>
                    {status === undefined ? null : (
                        <View className="flex-row items-center">{status}</View>
                    )}
                </View>

                <View className="flex-col">
                    <Text variant="micro" tone="secondary">
                        {fieldsLabel}
                    </Text>
                    <Separator />
                    {fields.map((field) => (
                        /*
                         * A two-track row rather than a `FormGrid`: this is a definition list, not a
                         * form, and the labels want a common start edge so the eye can run down them
                         * — which is the one thing the no-stretch field grid deliberately does not
                         * give you. The 118px label track is the design's.
                         */
                        <View
                            key={field.key}
                            testID={`${testID}-field-${field.key}`}
                            className="flex-row items-baseline gap-snug border-b border-stroke-subtle py-tight"
                        >
                            <View style={{ width: 118 }}>
                                <Text variant="caption" tone="secondary">
                                    {field.label}
                                </Text>
                            </View>
                            {/*
                             * `flex-1` on the value column is the row's own container — the case the
                             * no-stretch fence exempts — so a long value wraps inside its track
                             * instead of pushing the label off the panel.
                             */}
                            {/* eslint-disable-next-line no-restricted-syntax -- the value column *is* the row. */}
                            <View className="min-w-0 flex-1">
                                <Text variant={field.mono === true ? 'mono' : 'label'}>
                                    {field.value}
                                </Text>
                            </View>
                        </View>
                    ))}
                </View>

                {chipsLabel === undefined || chips === undefined ? null : (
                    <View className="flex-col gap-tight">
                        <View className="flex-row flex-wrap items-center gap-tight">
                            <Text variant="micro" tone="secondary">
                                {chipsLabel}
                            </Text>
                            {chipsSource === undefined ? null : (
                                <Badge tone="info" label={chipsSource} />
                            )}
                        </View>
                        <Separator />
                        {chipsCaption === undefined ? null : (
                            <Text variant="caption" tone="secondary">
                                {chipsCaption}
                            </Text>
                        )}
                        <View className="flex-row flex-wrap items-center gap-tight">{chips}</View>
                    </View>
                )}
            </View>
        </Drawer>
    );
}
