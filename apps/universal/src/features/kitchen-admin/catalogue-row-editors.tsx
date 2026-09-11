import type { ChannelAvailability, LocalisedText } from '@healthy360/api-client/contracts';
import {
    Checkbox,
    DateField,
    Icon,
    IconButton,
    Select,
    Stack,
    Switch,
    Text,
    TextInputField,
    cx,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import { SALES_CHANNELS } from '@healthy360/domain-types';
import type { SalesChannel } from '@healthy360/domain-types';
import { MEASURE_UNITS } from '@healthy360/nutrition';
import type { MeasureUnit } from '@healthy360/nutrition';
import { useMemo, useState } from 'react';
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
    const [removed, setRemoved] = useState<{ row: PackDraft; index: number } | null>(null);

    const nameOf = (row: PackDraft): string =>
        row.label.en.trim() === ''
            ? row.code.trim() === ''
                ? t('kitchen:products.unnamedPack')
                : row.code
            : row.label.en;

    /*
     * Column widths, stated once and shared by the header and every row — the same arrangement the
     * service-days table uses, and for the same reason: five short answers per pack repeated down a
     * list is a table, and a titled panel per row spent 300px of page on each of them.
     *
     * `code` and `label` take the leftover because a pack code and a retail name are the two that
     * vary in length; a quantity, a unit and a count do not.
     */
    const COL = {
        code: 'min-w-[112px] flex-1',
        label: 'min-w-[160px] flex-[2]',
        quantity: 'w-[92px]',
        unit: 'w-[104px]',
        perPack: 'w-[88px]',
        remove: 'w-8',
    } as const;

    const header = (label: string, width: string, align?: string) => (
        <Text
            key={label}
            variant="label"
            tone="secondary"
            className={cx(width, 'uppercase tracking-widest', align)}
        >
            {label}
        </Text>
    );

    return (
        <Stack space="sm" testID={testID}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:products.packsEmpty')}
                </Text>
            ) : (
                <>
                    {/*
                     * The labels live here, once — see `FormField`'s `labelHidden`. Hidden below
                     * `md`, where the row wraps and a header above a wrapped stack labels the wrong
                     * things.
                     */}
                    <View className="hidden flex-row items-end gap-base md:flex" aria-hidden>
                        {header(t('kitchen:products.packCodeHeader'), COL.code)}
                        {header(t('kitchen:products.packLabelHeader'), COL.label)}
                        {header(t('kitchen:products.packQtyHeader'), COL.quantity, 'text-end')}
                        {header(t('kitchen:products.packUnitHeader'), COL.unit)}
                        {header(t('kitchen:products.packPerPackHeader'), COL.perPack)}
                        <View className={COL.remove} />
                    </View>

                    {rows.map((row) => {
                        const rowTestId = `${testID}-row-${row.key}`;
                        const error = errors.get(row.key);
                        const patch = (next: Partial<PackDraft>) => {
                            onChange(
                                rows.map((entry) =>
                                    entry.key === row.key ? { ...entry, ...next } : entry,
                                ),
                            );
                        };

                        return (
                            <View
                                key={row.key}
                                testID={rowTestId}
                                // `z-auto` for the reason `FormField` states: the unit picker's
                                // panel would otherwise be trapped under the row below it.
                                className="z-auto flex-row flex-wrap items-start gap-base"
                            >
                                <View className={cx('z-auto', COL.code)}>
                                    <TextInputField
                                        testID={`${rowTestId}-code`}
                                        id={`${rowTestId}-code`}
                                        label={t('kitchen:products.packCodeLabel')}
                                        labelHidden
                                        placeholder="RSL-055"
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
                                </View>

                                {/*
                                 * The English label only. The Arabic half is not dropped — it is
                                 * simply not a column: a bilingual pair inside a five-column row
                                 * doubles the row's width for a field most packs leave empty, and
                                 * `BilingualField` has nowhere to put its second box. It is edited
                                 * where a pack is opened on its own.
                                 */}
                                <View className={cx('z-auto', COL.label)}>
                                    <TextInputField
                                        testID={`${rowTestId}-label`}
                                        id={`${rowTestId}-label`}
                                        label={t('kitchen:products.packLabel')}
                                        labelHidden
                                        placeholder={t('kitchen:products.packLabelPlaceholder')}
                                        value={row.label.en}
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ label: { ...row.label, en: next } });
                                        }}
                                    />
                                </View>

                                <View className={cx('z-auto', COL.quantity)}>
                                    <TextInputField
                                        testID={`${rowTestId}-quantity`}
                                        id={`${rowTestId}-quantity`}
                                        label={t('kitchen:products.packQuantityLabel')}
                                        labelHidden
                                        placeholder="0"
                                        value={row.netQuantity}
                                        inputMode="decimal"
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ netQuantity: next });
                                        }}
                                    />
                                </View>

                                <View className={cx('z-auto', COL.unit)}>
                                    <Select
                                        testID={`${rowTestId}-unit`}
                                        id={`${rowTestId}-unit`}
                                        label={t('kitchen:products.packUnitLabel')}
                                        labelHidden
                                        searchable
                                        options={unitOptions}
                                        value={row.netUnit}
                                        disabled={!canManage}
                                        onChange={(next) => {
                                            patch({ netUnit: next as MeasureUnit });
                                        }}
                                    />
                                </View>

                                <View className={cx('z-auto', COL.perPack)}>
                                    <TextInputField
                                        testID={`${rowTestId}-units-per-pack`}
                                        id={`${rowTestId}-units-per-pack`}
                                        label={t('kitchen:products.unitsPerPackLabel')}
                                        labelHidden
                                        value={row.unitsPerPack}
                                        inputMode="numeric"
                                        disabled={!canManage}
                                        onChangeText={(next) => {
                                            patch({ unitsPerPack: next });
                                        }}
                                    />
                                </View>

                                <View className={cx(COL.remove, 'items-center')}>
                                    {canManage ? (
                                        <IconButton
                                            testID={`${rowTestId}-remove`}
                                            variant="ghost"
                                            tone="danger"
                                            size="sm"
                                            label={t('kitchen:products.removePack')}
                                            icon={<Icon name="close" size="sm" />}
                                            onPress={() => {
                                                setRemoved({
                                                    row,
                                                    index: rows.findIndex(
                                                        (entry) => entry.key === row.key,
                                                    ),
                                                });
                                                onChange(
                                                    rows.filter((entry) => entry.key !== row.key),
                                                );
                                            }}
                                        />
                                    ) : null}
                                </View>
                            </View>
                        );
                    })}

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

    return (
        <View testID={testID} className="flex-row flex-wrap gap-tight">
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
                            'min-w-[220px] flex-1 flex-row items-center justify-between gap-tight rounded-sm px-control-md py-1',
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
                         * it; the other seven need no gloss.
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
 * The headers are what label the controls — see `FormField`'s `labelHidden`, which exists for this.
 * Below `md` the row wraps and the header hides, because a header above a wrapped stack labels the
 * wrong things.
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

    /*
     * Column widths, stated once and shared by the header and every row so the two cannot drift.
     *
     * The three answer columns are one shared fraction rather than three fixed widths: a date, a
     * count and a time are peers, and giving each its own measured width left the row bunched
     * against the inline start with a third of the panel empty beside it. This is a table filling
     * its container, which is the one shape `grid-shared.ts`'s no-stretch rule is not about — that
     * rule governs *fields in a form*, and it is why nothing above this section stretches.
     *
     * `serving` and the remove control stay fixed: a knob and an icon have an intrinsic size and
     * gain nothing from a share of the leftover space.
     */
    const COL = {
        answer: 'min-w-[124px] flex-1',
        serving: 'w-[76px]',
        remove: 'w-8',
    } as const;

    const header = (label: string, width: string) => (
        <Text
            key={label}
            variant="label"
            tone="secondary"
            className={cx(width, 'uppercase tracking-widest')}
        >
            {label}
        </Text>
    );

    return (
        <Stack space="sm" testID={testID}>
            {rows.length === 0 ? null : (
                /*
                 * The labels live here, once, instead of beside all four controls on every row —
                 * see `FormField`'s `labelHidden`. Hidden below `md`, where the row wraps and a
                 * header sitting above a wrapped stack would be labelling the wrong things.
                 */
                <View className="hidden flex-row items-end gap-base md:flex" aria-hidden>
                    {header(t('kitchen:availability.dateLabel'), COL.answer)}
                    {header(t('kitchen:availability.servingHeader'), COL.serving)}
                    {header(t('kitchen:availability.remainingHeader'), COL.answer)}
                    {header(t('kitchen:availability.cutOffHeader'), COL.answer)}
                    <View className={COL.remove} />
                </View>
            )}

            {rows.length === 0
                ? null
                : rows.map((row) => {
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
                          <View
                              key={row.key}
                              testID={rowTestId}
                              // `z-auto` for the reason `FormField` states: the date picker's own
                              // panel would otherwise be trapped under the row below it.
                              className="z-auto flex-row flex-wrap items-start gap-base"
                          >
                              <View className={cx('z-auto', COL.answer)}>
                                  <DateField
                                      testID={`${rowTestId}-date`}
                                      id={`${rowTestId}-date`}
                                      label={t('kitchen:availability.dateLabel')}
                                      labelHidden
                                      value={row.date}
                                      required
                                      disabled={!canManage}
                                      {...(error === undefined ? {} : { error })}
                                      onChange={(next) => {
                                          patch({ date: next });
                                      }}
                                  />
                              </View>

                              {/*
                               * `label` is the switch's accessible name and is never drawn;
                               * `stateLabel` is the word beside the knob. So the control reads as
                               * "Can be ordered on this day" to a screen reader while the row shows
                               * the two characters it has room for.
                               */}
                              <View className={cx('z-auto', COL.serving)}>
                                  <Switch
                                      testID={`${rowTestId}-available`}
                                      id={`${rowTestId}-available`}
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
                                          patch({ isAvailable: checked });
                                      }}
                                  />
                              </View>

                              <View className={cx('z-auto', COL.answer)}>
                                  <TextInputField
                                      testID={`${rowTestId}-remaining`}
                                      id={`${rowTestId}-remaining`}
                                      label={t('kitchen:availability.remainingLabel')}
                                      labelHidden
                                      // The empty box means "not counted", which is exactly what
                                      // this glyph says — and it says it without becoming a value.
                                      placeholder="∞"
                                      value={row.remaining}
                                      inputMode="numeric"
                                      disabled={!canManage}
                                      onChangeText={(next) => {
                                          patch({ remaining: next });
                                      }}
                                  />
                              </View>

                              <View className={cx('z-auto', COL.answer)}>
                                  <TextInputField
                                      testID={`${rowTestId}-cutoff`}
                                      id={`${rowTestId}-cutoff`}
                                      label={t('kitchen:availability.cutOffLabel')}
                                      labelHidden
                                      placeholder="18:00"
                                      value={row.orderCutOffAt}
                                      autoCorrect={false}
                                      disabled={!canManage}
                                      onChangeText={(next) => {
                                          patch({ orderCutOffAt: next });
                                      }}
                                  />
                              </View>

                              <View className={cx(COL.remove, 'items-center')}>
                                  {canManage ? (
                                      <IconButton
                                          testID={`${rowTestId}-remove`}
                                          variant="ghost"
                                          tone="danger"
                                          size="sm"
                                          label={t('kitchen:availability.removeDay')}
                                          icon={<Icon name="close" size="sm" />}
                                          onPress={() => {
                                              setRemoved({
                                                  row,
                                                  index: rows.findIndex(
                                                      (entry) => entry.key === row.key,
                                                  ),
                                              });
                                              onChange(
                                                  rows.filter((entry) => entry.key !== row.key),
                                              );
                                          }}
                                      />
                                  ) : null}
                              </View>
                          </View>
                      );
                  })}

            {rows.length === 0 ? null : (
                <Text testID={`${testID}-caption`} variant="caption" tone="secondary">
                    {t('kitchen:availability.rowCaption')}
                </Text>
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
