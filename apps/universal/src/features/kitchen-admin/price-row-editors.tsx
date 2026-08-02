import { PRICE_STATUSES } from '@healthy360/api-client/contracts';
import type { CatalogueItemRef, PriceStatus } from '@healthy360/api-client/contracts';
import {
    Badge,
    Callout,
    DateField,
    Inline,
    SegmentedControl,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { SelectOption } from '@healthy360/design-system';
import type { CurrencyCode } from '@healthy360/domain-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    minorAmountToInput,
    moveInList,
    parseMinorAmount,
    priceItemBaseKey,
    priceItemKey,
    priceItemKindKey,
    priceStatusBadgeKey,
    priceStatusCarriesAmount,
    priceStatusKey,
    priceStatusTone,
} from './format.ts';
import { RowAnnouncer, RowShell, UndoBar } from './row-editor-shell.tsx';

/**
 * The price-list entry editor (K1.5).
 *
 * Its own module rather than a fourth section of `./catalogue-row-editors.tsx`, because it is the
 * one repeated-row editor in this workspace whose rows enforce a *database constraint* while they
 * are being typed, and that logic wants to be readable next to the control it governs rather than
 * buried under three unrelated editors.
 *
 * ## The rule this editor exists to make un-breakable
 *
 * `price_list_items` carries a `CHECK`: **a confirmed price has an amount, and nothing else does**.
 * The contract states it once as {@link isPriceEntryConsistent}, the mock store refuses a write that
 * violates it, and this editor enforces it *live* — which is a different job from validating on
 * save. Switching a row to `placeholder` clears the amount and disables the field in the same
 * gesture; switching back to `confirmed` re-enables it and marks the row incomplete until a number
 * is typed. A person therefore cannot compose an inconsistent row at all, rather than composing one
 * and being told about it afterwards.
 *
 * That matters more here than anywhere else in K1 because of what a placeholder *is* (plan §2.4):
 * the source material has plans with no numbers, the programme's rule is that a fabricated price
 * never reaches a public surface, and `amountMinor: null` is the mechanism. An editor that let a
 * stale figure survive a switch to `placeholder` would be the exact defect the NULL exists to
 * prevent.
 *
 * ## Amounts are edited in major units and stored in minor ones
 *
 * The field holds `5.50`; the request carries `550`. The conversion is string arithmetic in
 * `./format.ts` — never `value * 100`, which is not reliably an integer — and the currency comes
 * from the list rather than from the row, because one list is one currency (plan §4.4) and a row
 * that could name its own would be a cross-currency sum waiting to happen.
 */

/* ------------------------------------------------------------------------------------------------
 * Working copy
 * ---------------------------------------------------------------------------------------------- */

/**
 * An entry as the editor holds it.
 *
 * `amount` is the **major-unit string** the field shows, kept as a string for the reason every other
 * numeric draft in this workspace is: `5.` is a number half-typed, not the number five, and a draft
 * that parsed on every keystroke would fight the person typing.
 */
export interface PriceEntryDraft {
    /** Stable across moves, removals and undo. Never the array index. */
    readonly key: string;
    readonly item: CatalogueItemRef | null;
    readonly priceStatus: PriceStatus;
    readonly amount: string;
    readonly effectiveFrom: string;
    readonly effectiveUntil: string | null;
    readonly note: string;
}

/** A blank entry row. `confirmed` is the default because it is the only status that sells anything. */
export function emptyPriceEntry(key: string, effectiveFrom: string): PriceEntryDraft {
    return {
        key,
        item: null,
        priceStatus: 'confirmed',
        amount: '',
        effectiveFrom,
        effectiveUntil: null,
        note: '',
    };
}

/**
 * Applies a status change to a row, clearing or keeping the amount as the constraint requires.
 *
 * Pure and exported so the rule can be asserted without rendering anything — it is the single most
 * important line of behaviour in this slice. Moving *to* a non-confirmed status empties the amount;
 * moving to `confirmed` leaves whatever is there (usually nothing) for the person to fill in.
 */
export function withPriceStatus(row: PriceEntryDraft, priceStatus: PriceStatus): PriceEntryDraft {
    return {
        ...row,
        priceStatus,
        amount: priceStatusCarriesAmount(priceStatus) ? row.amount : '',
    };
}

/* ------------------------------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------------------------------- */

export interface PriceEntryMessages {
    readonly itemRequired: string;
    readonly itemDuplicate: string;
    readonly amountRequired: string;
    readonly amountInvalid: string;
    readonly datesReversed: string;
}

/**
 * What is wrong with each row, keyed by row.
 *
 * Four rules, each of which the server would otherwise refuse the whole write for:
 *
 * 1. **An entry must point at something.** A row with no item is a price for nothing.
 * 2. **No two rows may price the same item.** `CatalogueItemRef` has no identifier of its own, so
 *    "the same item" means the same product *and pack*, the same meal, or the same plan *and
 *    variant* — see `priceItemKey`. Two rows pricing one thing is not untidy, it is ambiguous.
 * 3. **A confirmed row needs a valid amount, and only a confirmed row may have one.** The `CHECK`.
 *    The editor's live clearing makes the second half unreachable through the controls, and the rule
 *    is checked anyway, because a draft can also arrive from the server.
 * 4. **`effectiveUntil` may not precede `effectiveFrom`.** ISO dates sort lexicographically, which
 *    is what makes this a string comparison.
 */
export function priceEntryErrors(
    rows: readonly PriceEntryDraft[],
    currency: CurrencyCode,
    messages: PriceEntryMessages,
): ReadonlyMap<string, string> {
    const errors = new Map<string, string>();
    const seen = new Set<string>();

    for (const row of rows) {
        if (row.item === null) {
            errors.set(row.key, messages.itemRequired);
            continue;
        }

        const identity = priceItemKey(row.item);
        if (seen.has(identity)) {
            errors.set(row.key, messages.itemDuplicate);
            continue;
        }
        seen.add(identity);

        if (priceStatusCarriesAmount(row.priceStatus)) {
            if (row.amount.trim() === '') {
                errors.set(row.key, messages.amountRequired);
                continue;
            }
            if (parseMinorAmount(row.amount, currency) === null) {
                errors.set(row.key, messages.amountInvalid);
                continue;
            }
        } else if (row.amount.trim() !== '') {
            errors.set(row.key, messages.amountInvalid);
            continue;
        }

        if (row.effectiveUntil !== null && row.effectiveUntil < row.effectiveFrom) {
            errors.set(row.key, messages.datesReversed);
        }
    }

    return errors;
}

/* ------------------------------------------------------------------------------------------------
 * The editor
 * ---------------------------------------------------------------------------------------------- */

/** One priceable *thing* — a product, a meal or a plan — and the variants of it a price can name. */
export interface PriceItemOption {
    /** {@link priceItemBaseKey} of the item, ignoring its variant. The first picker's value. */
    readonly key: string;
    readonly kind: CatalogueItemRef['kind'];
    readonly label: string;
    /** What the row points at when the item is chosen and no variant has been picked yet. */
    readonly defaultItem: CatalogueItemRef;
    /**
     * The narrower choices, if the kind has any: a product's packs, a plan's variants (plus the
     * plan itself). **Empty for a meal**, which has nothing below it — and an empty list is why the
     * second picker does not render at all rather than rendering with one disabled option.
     */
    readonly variants: readonly PriceItemVariantOption[];
}

export interface PriceItemVariantOption {
    /** {@link priceItemKey} of `item` — the second picker's value. */
    readonly key: string;
    readonly label: string;
    readonly item: CatalogueItemRef;
}

export interface PriceEntryEditorProps {
    readonly rows: readonly PriceEntryDraft[];
    readonly onChange: (rows: readonly PriceEntryDraft[]) => void;
    readonly errors: ReadonlyMap<string, string>;
    /** Everything this kitchen sells, flattened to one option per priceable thing. */
    readonly options: readonly PriceItemOption[];
    readonly currency: CurrencyCode;
    readonly canManage: boolean;
    readonly testID: string;
}

export function PriceEntryEditor({
    rows,
    onChange,
    errors,
    options,
    currency,
    canManage,
    testID,
}: PriceEntryEditorProps) {
    const { t } = useTranslation();
    const [announcement, setAnnouncement] = useState('');
    const [removed, setRemoved] = useState<{ row: PriceEntryDraft; index: number } | null>(null);

    const byKey = new Map(options.map((option) => [option.key, option]));

    const optionFor = (row: PriceEntryDraft): PriceItemOption | undefined =>
        row.item === null ? undefined : byKey.get(priceItemBaseKey(row.item));

    const nameOf = (row: PriceEntryDraft): string =>
        optionFor(row)?.label ?? t('kitchen:priceLists.unnamedEntry');

    /*
     * The kind travels as the option's `description` rather than as an option group: `Select` has no
     * grouping affordance, and the kind is a fact a reader needs *beside* the name anyway — two
     * catalogue rows can share a name across kinds, and "Balanced Week" the plan is not "Balanced
     * Week" the meal.
     */
    const itemOptions: readonly SelectOption[] = options.map((option) => ({
        value: option.key,
        label: option.label,
        description: t(priceItemKindKey(option.kind)),
    }));

    return (
        <Stack space="md" testID={testID}>
            {rows.length === 0 ? (
                <Text testID={`${testID}-empty`} tone="secondary">
                    {t('kitchen:priceLists.entriesEmpty')}
                </Text>
            ) : (
                rows.map((row, index) => {
                    const rowTestId = `${testID}-row-${row.key}`;
                    const position = index + 1;
                    const error = errors.get(row.key);
                    const amountEnabled = priceStatusCarriesAmount(row.priceStatus);
                    const option = optionFor(row);
                    const patch = (next: Partial<PriceEntryDraft>) => {
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
                            title={t('kitchen:priceLists.entryNumber', { number: position })}
                            position={position}
                            total={rows.length}
                            canManage={canManage}
                            badge={
                                <Badge
                                    testID={`${rowTestId}-badge`}
                                    tone={priceStatusTone(row.priceStatus)}
                                    label={t(priceStatusBadgeKey(row.priceStatus))}
                                />
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
                                <Select
                                    testID={`${rowTestId}-item`}
                                    id={`${rowTestId}-item`}
                                    label={t('kitchen:priceLists.itemLabel')}
                                    hint={t('kitchen:priceLists.itemHint')}
                                    searchable
                                    required
                                    disabled={!canManage}
                                    options={itemOptions}
                                    value={row.item === null ? null : priceItemBaseKey(row.item)}
                                    placeholder={t('kitchen:priceLists.itemPlaceholder')}
                                    onChange={(next) => {
                                        const chosen = byKey.get(next);
                                        if (chosen === undefined) return;
                                        patch({ item: chosen.defaultItem });
                                    }}
                                />

                                {/*
                                 * The variant picker is *derived* from the item rather than being a
                                 * second independent list: `CatalogueItemRef` makes a pack code a
                                 * member of the product arm and a variant identifier a member of
                                 * the plan arm, so offering a pack that belongs to another product
                                 * would be an unconstructable value. A meal has no arm member below
                                 * itself, so the control is absent rather than empty.
                                 */}
                                {option === undefined || option.variants.length === 0 ? null : (
                                    <Select
                                        testID={`${rowTestId}-variant`}
                                        id={`${rowTestId}-variant`}
                                        label={
                                            option.kind === 'product'
                                                ? t('kitchen:priceLists.packLabel')
                                                : t('kitchen:priceLists.variantLabel')
                                        }
                                        hint={
                                            option.kind === 'product'
                                                ? t('kitchen:priceLists.packHint')
                                                : t('kitchen:priceLists.variantHint')
                                        }
                                        searchable
                                        disabled={!canManage}
                                        options={option.variants.map((variant) => ({
                                            value: variant.key,
                                            label: variant.label,
                                        }))}
                                        value={row.item === null ? null : priceItemKey(row.item)}
                                        placeholder={t('kitchen:priceLists.variantPlaceholder')}
                                        onChange={(next) => {
                                            const chosen = option.variants.find(
                                                (variant) => variant.key === next,
                                            );
                                            if (chosen === undefined) return;
                                            patch({ item: chosen.item });
                                        }}
                                    />
                                )}

                                {/*
                                 * The status is a segmented control rather than a select: three
                                 * mutually exclusive values, all of which have to be *visible* at
                                 * once, because "why does this row have no price?" is answered by
                                 * seeing that `placeholder` and `market_priced` both exist.
                                 */}
                                <Stack space="xs">
                                    <Text variant="label" testID={`${rowTestId}-status-label`}>
                                        {t('kitchen:priceLists.statusLabel')}
                                    </Text>
                                    <SegmentedControl<PriceStatus>
                                        testID={`${rowTestId}-status`}
                                        label={t('kitchen:priceLists.statusLabel')}
                                        block
                                        value={row.priceStatus}
                                        onChange={(next) => {
                                            onChange(
                                                rows.map((entry) =>
                                                    entry.key === row.key
                                                        ? withPriceStatus(entry, next)
                                                        : entry,
                                                ),
                                            );
                                        }}
                                        items={PRICE_STATUSES.map((status) => ({
                                            value: status,
                                            label: t(priceStatusKey(status)),
                                            disabled: !canManage,
                                            testID: `${rowTestId}-status-${status}`,
                                        }))}
                                    />
                                </Stack>

                                {/*
                                 * The amount field exists only for the one status that may carry an
                                 * amount. It is **removed** rather than disabled, for two reasons
                                 * that point the same way. A greyed-out box invites the reading
                                 * "you cannot type here *yet*", and the truth is stronger than
                                 * that: this row has no amount and cannot acquire one without
                                 * changing what kind of price it is. And a `TextInput` rendered
                                 * `readOnly` at the design system's disabled opacity measures 4.07:1
                                 * against the sunken surface — below the 4.5:1 axe holds every
                                 * *active* control to, and `readonly` is active. The callout below
                                 * says what is there instead, in words rather than in grey.
                                 */}
                                {amountEnabled ? (
                                    <TextInputField
                                        testID={`${rowTestId}-amount`}
                                        id={`${rowTestId}-amount`}
                                        label={t('kitchen:priceLists.amountLabel', { currency })}
                                        hint={t('kitchen:priceLists.amountHint', { currency })}
                                        value={row.amount}
                                        inputMode="decimal"
                                        autoCorrect={false}
                                        required
                                        disabled={!canManage}
                                        {...(error === undefined ? {} : { error })}
                                        onChangeText={(next) => {
                                            patch({ amount: next });
                                        }}
                                    />
                                ) : (
                                    <Stack space="none" testID={`${rowTestId}-amount-absent`}>
                                        <Text variant="label">
                                            {t('kitchen:priceLists.amountLabel', { currency })}
                                        </Text>
                                        <Text tone="secondary" variant="caption">
                                            {t('kitchen:priceLists.amountDisabledHint')}
                                        </Text>
                                    </Stack>
                                )}

                                {/*
                                 * Effective dating is on the entry because the contract puts it
                                 * there. What it cannot offer is a *history*: `setPriceListEntries`
                                 * replaces the set, so a superseded row is not readable afterwards,
                                 * and no affordance here pretends one can be opened.
                                 */}
                                <Inline space="sm" wrap>
                                    <DateField
                                        testID={`${rowTestId}-effective-from`}
                                        id={`${rowTestId}-effective-from`}
                                        label={t('kitchen:priceLists.effectiveFromLabel')}
                                        required
                                        disabled={!canManage}
                                        value={row.effectiveFrom}
                                        onChange={(next) => {
                                            patch({ effectiveFrom: next ?? row.effectiveFrom });
                                        }}
                                    />
                                    <DateField
                                        testID={`${rowTestId}-effective-until`}
                                        id={`${rowTestId}-effective-until`}
                                        label={t('kitchen:priceLists.effectiveUntilLabel')}
                                        hint={t('kitchen:priceLists.effectiveUntilHint')}
                                        disabled={!canManage}
                                        value={row.effectiveUntil}
                                        onChange={(next) => {
                                            patch({ effectiveUntil: next });
                                        }}
                                    />
                                </Inline>

                                <TextInputField
                                    testID={`${rowTestId}-note`}
                                    id={`${rowTestId}-note`}
                                    label={t('kitchen:priceLists.noteLabel')}
                                    hint={t('kitchen:priceLists.noteHint')}
                                    value={row.note}
                                    disabled={!canManage}
                                    onChangeText={(next) => {
                                        patch({ note: next });
                                    }}
                                />

                                {amountEnabled ? null : (
                                    <Callout
                                        testID={`${rowTestId}-no-amount`}
                                        role="note"
                                        tone={
                                            row.priceStatus === 'placeholder' ? 'warning' : 'info'
                                        }
                                        title={t(priceStatusBadgeKey(row.priceStatus))}
                                        body={
                                            row.priceStatus === 'placeholder'
                                                ? t('kitchen:priceLists.placeholderExplainer')
                                                : t('kitchen:priceLists.marketPricedExplainer')
                                        }
                                    />
                                )}

                                {/*
                                 * A row can be wrong for reasons that have nothing to do with the
                                 * amount — no item, a duplicate item, reversed dates — and on a row
                                 * with no amount field there is no control left to hang the message
                                 * on. So it is stated once, at the foot of the row it belongs to,
                                 * as an alert.
                                 */}
                                {error === undefined || amountEnabled ? null : (
                                    <Text
                                        testID={`${rowTestId}-error`}
                                        role="alert"
                                        tone="danger"
                                        variant="caption"
                                    >
                                        {error}
                                    </Text>
                                )}
                            </Stack>
                        </RowShell>
                    );
                })
            )}

            {removed === null ? null : (
                <UndoBar
                    testID={`${testID}-removed-bar`}
                    label={t('kitchen:priceLists.entryRemoved', { name: nameOf(removed.row) })}
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

/**
 * The editor's rows as the contract's payload.
 *
 * Called only once {@link priceEntryErrors} is empty, so the `item` narrowing and the amount parse
 * cannot fail — but neither is asserted away: a row that somehow arrives here without an item is
 * dropped rather than sent as a price for nothing, and `amountMinor` falls to `null`, which is the
 * only value the `CHECK` accepts for a status that carries no amount.
 */
export function priceEntryRequest(
    rows: readonly PriceEntryDraft[],
    currency: CurrencyCode,
): readonly {
    item: CatalogueItemRef;
    priceStatus: PriceStatus;
    amountMinor: number | null;
    effectiveFrom: string;
    effectiveUntil: string | null;
    note: string | null;
}[] {
    return rows.flatMap((row) => {
        if (row.item === null) return [];
        const amountMinor = priceStatusCarriesAmount(row.priceStatus)
            ? parseMinorAmount(row.amount, currency)
            : null;
        return [
            {
                item: row.item,
                priceStatus: row.priceStatus,
                amountMinor,
                effectiveFrom: row.effectiveFrom,
                effectiveUntil: row.effectiveUntil,
                note: row.note.trim() === '' ? null : row.note.trim(),
            },
        ];
    });
}

/** A server entry as the editor holds it. The inverse of {@link priceEntryRequest}. */
export function priceEntryDraft(
    entry: {
        readonly item: CatalogueItemRef;
        readonly priceStatus: PriceStatus;
        readonly amountMinor: number | null;
        readonly effectiveFrom: string;
        readonly effectiveUntil: string | null;
        readonly note: string | null;
    },
    currency: CurrencyCode,
    index: number,
): PriceEntryDraft {
    return {
        key: `seed-${String(index)}-${priceItemKey(entry.item)}`,
        item: entry.item,
        priceStatus: entry.priceStatus,
        amount: entry.amountMinor === null ? '' : minorAmountToInput(entry.amountMinor, currency),
        effectiveFrom: entry.effectiveFrom,
        effectiveUntil: entry.effectiveUntil,
        note: entry.note ?? '',
    };
}
