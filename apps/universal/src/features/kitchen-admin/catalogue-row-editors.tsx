import type { ChannelAvailability, LocalisedText } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    Card,
    Checkbox,
    DateField,
    Inline,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { SALES_CHANNELS } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { MEASURE_UNITS } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BilingualField } from './bilingual-field.tsx';
import {
    UNIT_DIMENSIONS,
    channelKey,
    moveInList,
    parseClockTime,
    parseQuantity,
    parseWholeNumber,
    unitDimension,
    unitDimensionKey,
    unitKey,
} from './format.ts';
import { RowAnnouncer, RowShell, UndoBar } from './row-editor-shell.tsx';

/**
 * The three repeated-row editors K1.4 adds: pack variants, channel availability, availability days.
 *
 * One module for the same reason the recipe editors share one: they are the same interaction with
 * three different payloads, and the chrome they hang on lives in `./row-editor-shell.tsx`. What each
 * one is *allowed to express* comes straight off `KitchenAdminRepository` and nowhere else — a field
 * the contract has no column for is not rendered here, however useful it might be.
 */

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
 * replaces the list wholesale and the server keeps the order it was given. So the move buttons are
 * real — moving a pack to the top is what makes it the default the list column reports — and no flag
 * is invented to say the same thing twice.
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
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: PackDraft; index: number } | null>(null);

    const nameOf = (row: PackDraft): string =>
        row.label.en.trim() === ''
            ? row.code.trim() === ''
                ? t('kitchen:products.unnamedPack')
                : row.code
            : row.label.en;

    return (
        <Stack space="md" testID={testID}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:products.packsEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const position = index + 1;
                    const error = errors.get(row.key);
                    const patch = (next: Partial<PackDraft>) => {
                        onChange(
                            rows.map((entry) =>
                                entry.key === row.key ? { ...entry, ...next } : entry,
                            ),
                        );
                    };

                    return (
                        <RowShell
                            key={row.key}
                            testID={rowTestId}
                            title={t('kitchen:products.packNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            badge={
                                index === 0 ? (
                                    <Badge
                                        testID={`${rowTestId}-default`}
                                        tone="success"
                                        icon="check"
                                        label={t('kitchen:products.defaultPack')}
                                    />
                                ) : undefined
                            }
                            onMove={(to) => {
                                const next = moveInList(rows, index, to);
                                if (next === rows) return;
                                onChange(next);
                                setAnnouncement(
                                    t('kitchen:rows.movedAnnouncement', {
                                        name: nameOf(row),
                                        position: to + 1,
                                        total: rows.length,
                                    }),
                                );
                            }}
                            onRemove={() => {
                                setRemoved({ row, index });
                                onChange(rows.filter((entry) => entry.key !== row.key));
                            }}
                        >
                            <Stack space="sm">
                                <TextInputField
                                    testID={`${rowTestId}-code`}
                                    id={`${rowTestId}-code`}
                                    label={t('kitchen:products.packCodeLabel')}
                                    hint={t('kitchen:products.packCodeHint')}
                                    value={row.code}
                                    autoCapitalize="characters"
                                    autoCorrect={false}
                                    disabled={!canManage}
                                    required
                                    {...(error === undefined ? {} : { error })}
                                    onChangeText={(next) => {
                                        patch({ code: next });
                                    }}
                                />

                                <BilingualField
                                    testID={`${rowTestId}-label`}
                                    fieldLabel={t('kitchen:products.packLabel')}
                                    value={row.label}
                                    onChange={(next) => {
                                        patch({ label: next });
                                    }}
                                />

                                <Inline space="sm" wrap>
                                    <TextInputField
                                        testID={`${rowTestId}-quantity`}
                                        id={`${rowTestId}-quantity`}
                                        label={t('kitchen:products.packQuantityLabel')}
                                        value={row.netQuantity}
                                        inputMode="decimal"
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ netQuantity: next });
                                        }}
                                    />
                                    <Select
                                        testID={`${rowTestId}-unit`}
                                        id={`${rowTestId}-unit`}
                                        label={t('kitchen:products.packUnitLabel')}
                                        searchable
                                        options={unitOptions}
                                        value={row.netUnit}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch({ netUnit: next as MeasureUnit });
                                        }}
                                    />
                                    <TextInputField
                                        testID={`${rowTestId}-units-per-pack`}
                                        id={`${rowTestId}-units-per-pack`}
                                        label={t('kitchen:products.unitsPerPackLabel')}
                                        hint={t('kitchen:products.unitsPerPackHint')}
                                        value={row.unitsPerPack}
                                        inputMode="numeric"
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ unitsPerPack: next });
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </RowShell>
                    );
                })
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

            <RowAnnouncer testID={`${testID}-announcer`} message={announcement} />
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

    return (
        <Stack space="sm" testID={testID}>
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
                    <Card key={channel} testID={rowTestId} padding="sm">
                        <Stack space="sm">
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

                            {row.isAvailable ? (
                                <Inline space="sm" wrap>
                                    <DateField
                                        testID={`${rowTestId}-from`}
                                        id={`${rowTestId}-from`}
                                        label={t('kitchen:channels.fromLabel')}
                                        hint={t('kitchen:channels.fromHint')}
                                        value={row.availableFrom}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch({ availableFrom: next });
                                        }}
                                    />
                                    <DateField
                                        testID={`${rowTestId}-until`}
                                        id={`${rowTestId}-until`}
                                        label={t('kitchen:channels.untilLabel')}
                                        hint={t('kitchen:channels.untilHint')}
                                        value={row.availableUntil}
                                        disabled={!canManage}
                                        {...(row.availableFrom === null
                                            ? {}
                                            : { min: row.availableFrom })}
                                        onChange={(next) => {
                                            patch({ availableUntil: next });
                                        }}
                                    />
                                </Inline>
                            ) : null}
                        </Stack>
                    </Card>
                );
            })}
        </Stack>
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
 * ## Rows are not reorderable, and the shell knows it
 *
 * Array order carries nothing here — the rows are keyed by the date they name — so {@link RowShell}
 * is used without `onMove` and renders no move buttons rather than two permanently useless ones.
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

    return (
        <Stack space="md" testID={testID}>
            <Callout
                testID={`${testID}-explainer`}
                role="note"
                tone="info"
                title={t('kitchen:availability.explainerTitle')}
                body={t('kitchen:availability.explainerBody')}
            />

            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:availability.empty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const error = errors.get(row.key);
                    const patch = (next: Partial<AvailabilityDraft>) => {
                        onChange(
                            rows.map((entry) =>
                                entry.key === row.key ? { ...entry, ...next } : entry,
                            ),
                        );
                    };

                    return (
                        <RowShell
                            key={row.key}
                            testID={rowTestId}
                            title={row.date ?? t('kitchen:availability.newDay')}
                            position={index + 1}
                            total={rows.length}
                            canManage={canManage}
                            badge={
                                row.isAvailable ? undefined : (
                                    <Badge
                                        testID={`${rowTestId}-closed`}
                                        tone="neutral"
                                        label={t('kitchen:availability.closed')}
                                    />
                                )
                            }
                            onRemove={() => {
                                setRemoved({ row, index });
                                onChange(rows.filter((entry) => entry.key !== row.key));
                            }}
                        >
                            <Stack space="sm">
                                <DateField
                                    testID={`${rowTestId}-date`}
                                    id={`${rowTestId}-date`}
                                    label={t('kitchen:availability.dateLabel')}
                                    value={row.date}
                                    required
                                    disabled={!canManage}
                                    {...(error === undefined ? {} : { error })}
                                    onChange={(next) => {
                                        patch({ date: next });
                                    }}
                                />

                                <Checkbox
                                    testID={`${rowTestId}-available`}
                                    id={`${rowTestId}-available`}
                                    label={t('kitchen:availability.availableLabel')}
                                    checked={row.isAvailable}
                                    disabled={!canManage}
                                    onChange={(checked) => {
                                        patch({ isAvailable: checked });
                                    }}
                                />

                                <Inline space="sm" wrap>
                                    <TextInputField
                                        testID={`${rowTestId}-remaining`}
                                        id={`${rowTestId}-remaining`}
                                        label={t('kitchen:availability.remainingLabel')}
                                        hint={t('kitchen:availability.remainingHint')}
                                        value={row.remaining}
                                        inputMode="numeric"
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ remaining: next });
                                        }}
                                    />
                                    <TextInputField
                                        testID={`${rowTestId}-cutoff`}
                                        id={`${rowTestId}-cutoff`}
                                        label={t('kitchen:availability.cutOffLabel')}
                                        hint={t('kitchen:availability.cutOffHint')}
                                        placeholder="18:00"
                                        value={row.orderCutOffAt}
                                        autoCorrect={false}
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ orderCutOffAt: next });
                                        }}
                                    />
                                </Inline>
                            </Stack>
                        </RowShell>
                    );
                })
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
