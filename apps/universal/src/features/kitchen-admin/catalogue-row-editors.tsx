import type { ChannelAvailability, LocalisedText } from '@healthy360/api-client/contracts';
import {
    Checkbox,
    DataList,
    DateField,
    Icon,
    IconButton,
    Select,
    Stack,
    Switch,
    Text,
    TextInputField,
    TimeField,
    UNDROPPABLE_PRIORITY,
    cx,
} from '@healthy360/design-system';
import type { DataListColumn, SelectOption } from '@healthy360/design-system';
import { SALES_CHANNELS } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { MEASURE_UNITS } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import {
    UNIT_DIMENSIONS,
    channelKey,
    parseClockTime,
    parseQuantity,
    parseWholeNumber,
    unitDimension,
    unitDimensionKey,
    unitKey,
} from './format.ts';
import { UndoBar } from './row-editor-shell.tsx';

/**
 * The three repeated-row editors K1.4 adds: pack variants, channel availability, availability days.
 *
 * One module for the same reason the recipe editors share one: they are the same interaction with
 * three different payloads, and the chrome they hang on lives in `./row-editor-shell.tsx`. What each
 * one is *allowed to express* comes straight off `KitchenAdminRepository` and nowhere else — a field
 * the contract has no column for is not rendered here, however useful it might be.
 */

/** The remove column's track: the 32px ✕ plus the cell's `px-control-sm` either side. */
const REMOVE_TRACK = 48;

/**
 * The row's ✕, as the last column of a row-editor table. Drawn only for somebody who may edit.
 *
 * No visible header: the ✕ says what it does, and the words would not fit the track. The column
 * is still named for a screen reader. Pinned, held at its width and anchored to the row's end.
 */
function removeColumn<Row>(label: string, render: (row: Row) => ReactNode): DataListColumn<Row> {
    return {
        key: 'remove',
        label,
        width: REMOVE_TRACK,
        priority: UNDROPPABLE_PRIORITY,
        grow: false,
        align: 'end',
        sortable: false,
        filterable: false,
        renderHeader: () => <View accessibilityLabel={label} />,
        render,
    };
}

/* ------------------------------------------------------------------------------------------------
 * Pack variants
 * ---------------------------------------------------------------------------------------------- */

/** A pack as the editor holds it. Quantities stay strings while they are being typed. */
export interface PackDraft {
    readonly key: string;
    readonly code: string;
    readonly label: LocalisedText;
    readonly netQuantity: string;
    readonly netUnit: MeasureUnit;
    readonly unitsPerPack: string;
}

export interface PackEditorProps {
    readonly rows: readonly PackDraft[];
    readonly onChange: (rows: readonly PackDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    readonly testID: string;
}

/** Every measure unit, annotated by the dimension it belongs to. Same grouping as the line editor. */
function useUnitOptions(): readonly SelectOption[] {
    const { t } = useTranslation();

    return useMemo(
        () =>
            UNIT_DIMENSIONS.flatMap((dimension) =>
                MEASURE_UNITS.filter((unit) => unitDimension(unit) === dimension).map((unit) => ({
                    value: unit,
                    label: t(unitKey(unit)),
                    description: t(unitDimensionKey(dimension)),
                })),
            ),
        [t],
    );
}

/**
 * The packs a product is sold in.
 *
 * ## Order is the only ordering there is
 *
 * `ProductPackVariant` carries no `position` and no `isDefault`; `UpdateProductRequest.packVariants`
 * replaces the list wholesale and the server keeps the order it was given. So the order the rows
 * stand in is the statement — the first pack is the default the list column reports — and no flag is
 * invented to say the same thing twice. Removal keeps that order: undo puts a pack back where it was.
 *
 * ## A `DataList`, like every other admin table
 *
 * Five short answers per pack repeated down a list is a table, so it is drawn as one: the design
 * system's list, with its header band naming each column once and each control `labelHidden` under
 * it. Every editable column is pinned (priority ≥ `UNDROPPABLE_PRIORITY`), because a dropped column
 * here would be a field nobody can reach; a narrow port scrolls instead. The label takes the slack,
 * since a retail name is the one answer whose length varies.
 *
 * ## The code is the identity a price points at
 *
 * `PriceListEntry` points at a product *and a pack code*, so renaming a code is not a cosmetic edit:
 * it orphans every price that quoted it. The field says so, and the editor refuses a duplicate
 * within the product, because two packs sharing a code make the reference ambiguous rather than
 * merely untidy.
 */
export function PackVariantEditor({ rows, onChange, errors, canManage, testID }: PackEditorProps) {
    const { t } = useTranslation();
    const unitOptions = useUnitOptions();
    const [removed, setRemoved] = useState<{ row: PackDraft; index: number } | null>(null);

    const nameOf = (row: PackDraft): string =>
        row.label.en.trim() === ''
            ? row.code.trim() === ''
                ? t('kitchen:products.unnamedPack')
                : row.code
            : row.label.en;

    const remove = (row: PackDraft) => {
        setRemoved({ row, index: rows.findIndex((entry) => entry.key === row.key) });
        onChange(rows.filter((entry) => entry.key !== row.key));
    };

    const patch = (row: PackDraft, next: Partial<PackDraft>) => {
        onChange(rows.map((entry) => (entry.key === row.key ? { ...entry, ...next } : entry)));
    };

    /** The id every control in a row hangs off — the same one the row itself carries. */
    const rowId = (row: PackDraft) => `${testID}-row-${row.key}`;

    /*
     * Tracks in dp, each the old column's content width plus the cell's `px-control-sm` either
     * side. A DataList cell has no vertical padding, so every control sits in a `py-tight` box off
     * the row's edges; `z-auto` on that box lets the unit picker's panel escape the row below.
     *
     * Every header sits at the start of its column, Net qty included: the quantity box is a plain
     * text field whose figure starts at the inline start, so an end-aligned header would sit over
     * the empty half of the box, away from the number it names.
     */
    const columns: readonly DataListColumn<PackDraft>[] = [
        {
            key: 'code',
            label: t('kitchen:products.packCodeHeader'),
            width: 128,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => {
                const error = errors.get(row.key);
                return (
                    <View className="z-auto w-full py-tight">
                        <TextInputField
                            testID={`${rowId(row)}-code`}
                            id={`${rowId(row)}-code`}
                            label={t('kitchen:products.packCodeLabel')}
                            labelHidden
                            placeholder={t('kitchen:products.packCodePlaceholder')}
                            value={row.code}
                            autoCapitalize="characters"
                            autoCorrect={false}
                            disabled={!canManage}
                            required
                            {...(error === undefined ? {} : { error })}
                            onChangeText={(next) => {
                                patch(row, { code: next });
                            }}
                        />
                    </View>
                );
            },
        },
        /*
         * The English label only. The Arabic half is not dropped — it is simply not a column: a
         * bilingual pair inside a five-column row doubles the row's width for a field most packs
         * leave empty, and `BilingualField` has nowhere to put its second box. It is edited where a
         * pack is opened on its own.
         */
        {
            key: 'label',
            label: t('kitchen:products.packLabelHeader'),
            width: 176,
            priority: UNDROPPABLE_PRIORITY,
            fill: true,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <TextInputField
                        testID={`${rowId(row)}-label`}
                        id={`${rowId(row)}-label`}
                        label={t('kitchen:products.packLabel')}
                        labelHidden
                        placeholder={t('kitchen:products.packLabelPlaceholder')}
                        value={row.label.en}
                        disabled={!canManage}
                        onChangeText={(next) => {
                            patch(row, { label: { ...row.label, en: next } });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'quantity',
            label: t('kitchen:products.packQtyHeader'),
            width: 108,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <TextInputField
                        testID={`${rowId(row)}-quantity`}
                        id={`${rowId(row)}-quantity`}
                        label={t('kitchen:products.packQuantityLabel')}
                        labelHidden
                        placeholder={t('kitchen:fields.quantityPlaceholder')}
                        value={row.netQuantity}
                        inputMode="decimal"
                        disabled={!canManage}
                        onChangeText={(next) => {
                            patch(row, { netQuantity: next });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'unit',
            label: t('kitchen:products.packUnitHeader'),
            width: 120,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <Select
                        testID={`${rowId(row)}-unit`}
                        id={`${rowId(row)}-unit`}
                        label={t('kitchen:products.packUnitLabel')}
                        placeholder={t('kitchen:fields.unitPlaceholder')}
                        labelHidden
                        searchable
                        options={unitOptions}
                        value={row.netUnit}
                        disabled={!canManage}
                        onChange={(next) => {
                            patch(row, { netUnit: next as MeasureUnit });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'units-per-pack',
            label: t('kitchen:products.packPerPackHeader'),
            width: 104,
            priority: UNDROPPABLE_PRIORITY,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <TextInputField
                        testID={`${rowId(row)}-units-per-pack`}
                        id={`${rowId(row)}-units-per-pack`}
                        label={t('kitchen:products.unitsPerPackLabel')}
                        placeholder={t('kitchen:fields.quantityPlaceholder')}
                        labelHidden
                        value={row.unitsPerPack}
                        inputMode="numeric"
                        disabled={!canManage}
                        onChangeText={(next) => {
                            patch(row, { unitsPerPack: next });
                        }}
                    />
                </View>
            ),
        },
        ...(canManage
            ? [
                  removeColumn<PackDraft>(t('kitchen:products.removePack'), (row) => (
                      <IconButton
                          testID={`${rowId(row)}-remove`}
                          variant="ghost"
                          tone="danger"
                          size="sm"
                          label={t('kitchen:products.removePack')}
                          icon={<Icon name="close" size="sm" />}
                          onPress={() => {
                              remove(row);
                          }}
                      />
                  )),
              ]
            : []),
    ];

    return (
        // The table carries the component's id once it is drawn; the wrapper holds it only while
        // there is nothing to draw, so the two never share one.
        <Stack space="sm" {...(rows.length === 0 ? { testID } : {})}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:products.packsEmpty')}
                </Text>
            ) : (
                <>
                    <DataList<PackDraft>
                        testID={testID}
                        label={t('kitchen:products.sectionPacks')}
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.key}
                        density="sm"
                    />

                    <Text testID={`${testID}-caption`} variant="caption" tone="secondary">
                        {t('kitchen:products.packsCaption')}
                    </Text>
                </>
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:products.packRemoved', { name: nameOf(removed.row) })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}
        </Stack>
    );
}

/** A blank pack row, ready to be filled in. */
export function emptyPack(key: string): PackDraft {
    return {
        key,
        code: '',
        label: { en: '', ar: '' },
        netQuantity: '',
        netUnit: 'g',
        unitsPerPack: '1',
    };
}

/**
 * What is wrong with each pack row, keyed by row.
 *
 * Codes must exist and be unique within the product — see the note on the editor. Quantities must be
 * a positive number and `unitsPerPack` a whole one, because a fraction of a bottle in a tray is a
 * typo rather than a smaller tray. Pure, so a test can assert the rules without a render.
 */
export function packErrors(
    rows: readonly PackDraft[],
    messages: {
        readonly codeRequired: string;
        readonly codeDuplicate: string;
        readonly quantityInvalid: string;
        readonly unitsInvalid: string;
    },
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    const seen = new Set<string>();

    for (const row of rows) {
        const code = row.code.trim().toUpperCase();
        if (code === '') {
            errors.set(row.key, messages.codeRequired);
            continue;
        }
        if (seen.has(code)) {
            errors.set(row.key, messages.codeDuplicate);
            continue;
        }
        seen.add(code);

        const quantity = parseQuantity(row.netQuantity);
        if (quantity === null || quantity <= 0) {
            errors.set(row.key, messages.quantityInvalid);
            continue;
        }

        const units = parseWholeNumber(row.unitsPerPack);
        if (units === null || units < 1) errors.set(row.key, messages.unitsInvalid);
    }

    return errors;
}

/* ------------------------------------------------------------------------------------------------
 * Channel availability
 * ---------------------------------------------------------------------------------------------- */

export interface ChannelDraft {
    readonly channel: SalesChannel;
    readonly isAvailable: boolean;
    readonly availableFrom: string | null;
    readonly availableUntil: string | null;
}

export interface ChannelEditorProps {
    readonly rows: readonly ChannelDraft[];
    readonly onChange: (rows: readonly ChannelDraft[]) => void;
    readonly canManage: boolean;
    readonly testID: string;
}

/**
 * Which routes to market a product is sold through, and between which dates.
 *
 * ## Every channel is a row, including the ones that are off
 *
 * The vocabulary is `SALES_CHANNELS` — the platform's own enum, eight values, closed — and the
 * editor renders all eight rather than only the ones a record already carries. "Not sold over the
 * counter" and "nobody has decided about the counter" look identical in a list that hides the
 * unticked ones, and the first is a decision while the second is an omission.
 *
 * ## The dates are optional and mean what the contract says
 *
 * `null` is "as soon as it is published" and "indefinitely", not "today" and not "forever". They are
 * only editable on a channel that is switched on, because a window on a channel a product is not
 * sold through describes nothing.
 */
export function ChannelAvailabilityEditor({
    rows,
    onChange,
    canManage,
    testID,
}: ChannelEditorProps) {
    const { t } = useTranslation();

    const byChannel = new Map(rows.map((row) => [row.channel, row]));

    /*
     * A grid of equal cells, four to a row at most — two rows of four on a desk screen, fewer
     * columns below it. The cells used to grow (`flex-1`) to fill whatever each row had left, so a
     * row of five and a row of three had different widths and nothing lined up down the page. A
     * fixed 220px cell and a container capped at four of them (4 × 220 + 3 × 8 = 904) make the
     * wraps land on the same columns every time.
     */
    return (
        <View testID={testID} className="max-w-[904px] flex-row flex-wrap gap-tight">
            {SALES_CHANNELS.map((channel) => {
                const row = byChannel.get(channel) ?? {
                    channel,
                    isAvailable: false,
                    availableFrom: null,
                    availableUntil: null,
                };
                const rowTestId = `${testID}-${channel}`;

                const patch = (next: Partial<ChannelDraft>) => {
                    const merged = { ...row, ...next };
                    const without = rows.filter((entry) => entry.channel !== channel);
                    onChange(
                        SALES_CHANNELS.flatMap((candidate) => {
                            if (candidate === channel) return [merged];
                            const existing = without.find((entry) => entry.channel === candidate);
                            return existing === undefined ? [] : [existing];
                        }),
                    );
                };

                return (
                    /*
                     * A tinted cell rather than a `Card` per channel.
                     *
                     * Eight bordered panels for eight checkboxes is eight rectangles carrying one
                     * bit each, and stacked one per row it was the tallest section on the page. The
                     * fill is the *selected* state — it reads at a glance which routes are live —
                     * and it is never the only signal: the checkbox itself is checked beside it.
                     */
                    <View
                        key={channel}
                        testID={rowTestId}
                        className={cx(
                            'w-[220px] flex-row items-center gap-tight rounded-sm px-control-md py-1',
                            row.isAvailable ? 'bg-surface-brand-subtle' : null,
                        )}
                    >
                        <Checkbox
                            testID={`${rowTestId}-toggle`}
                            id={`${rowTestId}-toggle`}
                            label={t(channelKey(channel))}
                            checked={row.isAvailable}
                            disabled={!canManage}
                            onChange={(checked) => {
                                patch({ isAvailable: checked });
                            }}
                        />

                        {/*
                         * The one channel that is a shopper rather than a business. Named because
                         * "B2C" is the contract's word and not everybody reading this form speaks
                         * it; the other seven need no gloss. It follows the label rather than
                         * sitting at the cell's far edge, where it read as a label of its own.
                         */}
                        {channel === 'b2c' ? (
                            <Text variant="caption" tone="secondary">
                                {t('kitchen:channels.consumerTag')}
                            </Text>
                        ) : null}
                    </View>
                );
            })}
        </View>
    );
}

/** The editor's rows as the contract's request payload. Off channels are kept, not dropped. */
export function channelRequest(rows: readonly ChannelDraft[]): readonly ChannelAvailability[] {
    return rows.map((row) => ({
        channel: row.channel,
        isAvailable: row.isAvailable,
        availableFrom: row.availableFrom,
        availableUntil: row.availableUntil,
    }));
}

/* ------------------------------------------------------------------------------------------------
 * Meal availability
 * ---------------------------------------------------------------------------------------------- */

/** One day as the editor holds it. Counts stay strings while they are being typed. */
export interface AvailabilityDraft {
    readonly key: string;
    readonly date: string | null;
    readonly isAvailable: boolean;
    /** Blank means "the kitchen does not track portions", which is `null` on the wire. */
    readonly remaining: string;
    /** Blank inherits the branch's cut-off for that weekday, which is also `null`. */
    readonly orderCutOffAt: string;
}

export interface AvailabilityEditorProps {
    readonly rows: readonly AvailabilityDraft[];
    readonly onChange: (rows: readonly AvailabilityDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    readonly canManage: boolean;
    readonly testID: string;
}

/**
 * A date, a count and a time each start from this track — a 124px box plus the cell's
 * `px-control-sm` either side — and share whatever the row has left equally.
 */
const ANSWER_TRACK = 140;

/**
 * When a meal can be ordered.
 *
 * ## Calendar dates, because that is what the contract models
 *
 * `MealAvailabilityDay` is `{ date, isAvailable, remaining, orderCutOffAt }` — a `YYYY-MM-DD`, not a
 * weekday, not a slot and not a recurrence rule. A "every Tuesday" control would be an interface
 * writing something the server has no column for, and the person using it would find out at the next
 * import. So the editor is a list of days, and the rule that generates them lives wherever the
 * kitchen's own planning does until a recurrence shape exists to write it into.
 *
 * ## A table, not a stack of panels
 *
 * Every day carries the same four short answers, so it is drawn as one line under one set of column
 * headers rather than as a titled card with four labelled fields inside it. The panel version cost
 * roughly 260px of page per day and put a `Date` label beside every date box; a kitchen setting a
 * fortnight of service could not see two days at once.
 *
 * It is the design system's `DataList`, so it carries the same header band as every other admin
 * table. The headers are what label the controls — see `FormField`'s `labelHidden`, which exists for
 * this. Every column is pinned (priority ≥ `UNDROPPABLE_PRIORITY`): a dropped column here would be a
 * field nobody can reach, so a narrow port scrolls rather than losing one.
 *
 * Array order carries nothing — the rows are keyed by the date they name — so there is no reorder
 * affordance, and removal keeps its {@link UndoBar} rather than a confirm.
 *
 * ## `remaining` blank is not zero
 *
 * `null` is "this kitchen does not count portions" and `0` is "sold out". Those are different
 * sentences and a field that turned an empty box into a zero would publish the second when somebody
 * meant the first.
 */
export function MealAvailabilityEditor({
    rows,
    onChange,
    errors,
    canManage,
    testID,
}: AvailabilityEditorProps) {
    const { t } = useTranslation();
    const [removed, setRemoved] = useState<{ row: AvailabilityDraft; index: number } | null>(null);

    const patch = (row: AvailabilityDraft, next: Partial<AvailabilityDraft>) => {
        onChange(rows.map((entry) => (entry.key === row.key ? { ...entry, ...next } : entry)));
    };

    /** The id every control in a row hangs off — the same one the row itself carries. */
    const rowId = (row: AvailabilityDraft) => `${testID}-row-${row.key}`;

    /*
     * Tracks in dp, each the old column's content width plus the cell's `px-control-sm` either
     * side. A DataList cell has no vertical padding, so every control sits in a `py-tight` box off
     * the row's edges; `z-auto` on that box lets the date picker's panel escape the row below.
     *
     * The three answer columns share the slack equally rather than holding three fixed widths: a
     * date, a count and a time are peers, and giving each its own measured width left the row
     * bunched against the inline start with a third of the panel empty beside it. This is a table
     * filling its container, which is the one shape `grid-shared.ts`'s no-stretch rule is not about —
     * that rule governs *fields in a form*, and it is why nothing above this section stretches.
     *
     * `serving` and the remove control hold their width: a knob and an icon have an intrinsic size
     * and gain nothing from a share of the leftover space.
     */
    const columns: readonly DataListColumn<AvailabilityDraft>[] = [
        {
            key: 'date',
            label: t('kitchen:availability.dateLabel'),
            width: ANSWER_TRACK,
            priority: UNDROPPABLE_PRIORITY,
            fill: true,
            render: (row) => {
                const error = errors.get(row.key);
                return (
                    <View className="z-auto w-full py-tight">
                        <DateField
                            testID={`${rowId(row)}-date`}
                            id={`${rowId(row)}-date`}
                            label={t('kitchen:availability.dateLabel')}
                            labelHidden
                            value={row.date}
                            required
                            disabled={!canManage}
                            {...(error === undefined ? {} : { error })}
                            onChange={(next) => {
                                patch(row, { date: next });
                            }}
                        />
                    </View>
                );
            },
        },
        /*
         * `label` is the switch's accessible name and is never drawn; `stateLabel` is the word
         * beside the knob. So the control reads as "Can be ordered on this day" to a screen reader
         * while the row shows the two characters it has room for.
         */
        {
            key: 'serving',
            label: t('kitchen:availability.servingHeader'),
            width: 92,
            priority: UNDROPPABLE_PRIORITY,
            grow: false,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <Switch
                        testID={`${rowId(row)}-available`}
                        id={`${rowId(row)}-available`}
                        label={t('kitchen:availability.availableLabel')}
                        labelHidden
                        stateLabel={
                            row.isAvailable
                                ? t('kitchen:availability.on')
                                : t('kitchen:availability.off')
                        }
                        checked={row.isAvailable}
                        disabled={!canManage}
                        onChange={(checked) => {
                            patch(row, { isAvailable: checked });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'remaining',
            label: t('kitchen:availability.remainingHeader'),
            width: ANSWER_TRACK,
            priority: UNDROPPABLE_PRIORITY,
            fill: true,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <TextInputField
                        testID={`${rowId(row)}-remaining`}
                        id={`${rowId(row)}-remaining`}
                        label={t('kitchen:availability.remainingLabel')}
                        labelHidden
                        // The empty box means "not counted", which is exactly what this glyph
                        // says — and it says it without becoming a value.
                        placeholder="∞"
                        value={row.remaining}
                        inputMode="numeric"
                        disabled={!canManage}
                        onChangeText={(next) => {
                            patch(row, { remaining: next });
                        }}
                    />
                </View>
            ),
        },
        {
            key: 'cutoff',
            label: t('kitchen:availability.cutOffHeader'),
            width: ANSWER_TRACK,
            priority: UNDROPPABLE_PRIORITY,
            fill: true,
            render: (row) => (
                <View className="z-auto w-full py-tight">
                    <TimeField
                        fullWidth
                        testID={`${rowId(row)}-cutoff`}
                        label={t('kitchen:availability.cutOffLabel')}
                        labelHidden
                        value={row.orderCutOffAt}
                        disabled={!canManage}
                        onChange={(next) => {
                            patch(row, { orderCutOffAt: next });
                        }}
                    />
                </View>
            ),
        },
        ...(canManage
            ? [
                  removeColumn<AvailabilityDraft>(t('kitchen:availability.removeDay'), (row) => (
                      <IconButton
                          testID={`${rowId(row)}-remove`}
                          variant="ghost"
                          tone="danger"
                          size="sm"
                          label={t('kitchen:availability.removeDay')}
                          icon={<Icon name="close" size="sm" />}
                          onPress={() => {
                              setRemoved({
                                  row,
                                  index: rows.findIndex((entry) => entry.key === row.key),
                              });
                              onChange(rows.filter((entry) => entry.key !== row.key));
                          }}
                      />
                  )),
              ]
            : []),
    ];

    return (
        // The table carries the component's id once it is drawn; the wrapper holds it only while
        // there is nothing to draw, so the two never share one.
        <Stack space="sm" {...(rows.length === 0 ? { testID } : {})}>
            {rows.length === 0 ? null : (
                <>
                    <DataList<AvailabilityDraft>
                        testID={testID}
                        label={t('kitchen:availability.sectionServiceDays')}
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.key}
                        density="sm"
                    />

                    <Text testID={`${testID}-caption`} variant="caption" tone="secondary">
                        {t('kitchen:availability.rowCaption')}
                    </Text>
                </>
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:availability.dayRemoved', {
                        date: removed.row.date ?? t('kitchen:availability.newDay'),
                    })}
                    onUndo={() => {
                        const next = [...rows];
                        next.splice(Math.min(removed.index, next.length), 0, removed.row);
                        onChange(next);
                        setRemoved(null);
                    }}
                />
            )}
        </Stack>
    );
}

/** A blank availability row. */
export function emptyAvailabilityDay(key: string): AvailabilityDraft {
    return { key, date: null, isAvailable: true, remaining: '', orderCutOffAt: '' };
}

/**
 * What is wrong with each availability row, keyed by row.
 *
 * A date is required and may appear once — two rows for the twelfth is two answers to one question,
 * and the server would keep whichever happened to be last. A blank count and a blank cut-off are
 * both legal and both mean `null`; a non-blank one has to parse.
 */
export function availabilityErrors(
    rows: readonly AvailabilityDraft[],
    messages: {
        readonly dateRequired: string;
        readonly dateDuplicate: string;
        readonly remainingInvalid: string;
        readonly cutOffInvalid: string;
    },
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    const seen = new Set<string>();

    for (const row of rows) {
        if (row.date === null) {
            errors.set(row.key, messages.dateRequired);
            continue;
        }
        if (seen.has(row.date)) {
            errors.set(row.key, messages.dateDuplicate);
            continue;
        }
        seen.add(row.date);

        if (row.remaining.trim() !== '' && parseWholeNumber(row.remaining) === null) {
            errors.set(row.key, messages.remainingInvalid);
            continue;
        }
        if (row.orderCutOffAt.trim() !== '' && parseClockTime(row.orderCutOffAt) === null) {
            errors.set(row.key, messages.cutOffInvalid);
        }
    }

    return errors;
}
