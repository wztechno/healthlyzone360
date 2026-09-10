import type { AllergenClass } from '@healthy360/api-client/contracts';
import { Badge, Inline, Text } from '@healthy360/design-system';
import type { Formatter } from '@healthy360/i18n';
import type { TFunction } from 'i18next';

import { displayName } from '../format.ts';
import { CATALOGUE_PRIORITY } from './catalogue-column-spec.ts';
import type { CatalogueColumn } from './catalogue-column-spec.ts';

/**
 * The fourteen regulatory allergen classes, as a column spec.
 *
 * The last Catalogue list to be built this way, and the one that most needed it: it was drawing the
 * design system's `Table` — a different component with a different geometry, its own header ramp
 * and its own row height — inside a `KitchenPageHeader` with a 24px title and a subtitle. A kitchen
 * that had learnt to read six catalogue lists arrived here and met a seventh layout.
 *
 * | column     | track | floor | priority | note                                        |
 * | ---------- | ----: | ----: | -------: | ------------------------------------------- |
 * | Id         |    96 |    84 |       88 | mono; the class code                        |
 * | Class      |   200 |   150 |      100 | the title; never dropped                    |
 * | Regulation |   160 |   120 |       40 | secondary; the platform's own citation      |
 * | Markets    |   160 |   120 |       50 | badges, or "no market requires it"          |
 * | Threshold  |   120 |    88 |       85 | mono, centred — the figure the row is read for |
 * | Status     |   110 |    78 |       80 | badge                                       |
 *
 * The tracks are the ingredient spec's, moved across one position at a time rather than
 * re-derived — the argument the recipe spec already makes for doing that.
 *
 * ## Two things the row does not carry
 *
 * **The description.** It is a sentence — "cereals containing gluten, and products thereof" — and a
 * sentence in a 160px track is either an ellipsis or a row three lines tall. It is the first field
 * in the View panel instead, which is the same call every other Catalogue list makes about prose.
 *
 * **`severeByDefault`.** It is a property of the class, not a state of the record, and giving it a
 * track would have put a second badge column beside Status saying something a reader would
 * reasonably confuse with it. It rides on the Class cell as a `danger` badge, where it sits against
 * the name it qualifies.
 *
 * ## Status is Active / Inactive, and not the publishable vocabulary
 *
 * Every other Catalogue list maps `meta.status` through `statusShortKey` to Draft / Review /
 * Published / Archived. An allergen class has no `meta` and no lifecycle: the platform withdraws a
 * class by deactivating it, and historic labels still resolve to it (`isActive` on the contract).
 * So this column takes its own two words. Borrowing "Archived" for a withdrawn class would have
 * claimed a lifecycle this record does not have.
 */

export interface AllergenColumnDeps {
    readonly t: TFunction;
    /** The resolved locale, as `useLocale()` reports it. */
    readonly locale: string;
    readonly formatter: Formatter;
}

export function allergenRowTestId(code: string): string {
    return `kitchen-allergen-class-${code}`;
}

/** The threshold as one string — the figure with its unit, or the words for "any amount". */
export function thresholdLabel(entry: AllergenClass, t: TFunction, formatter: Formatter): string {
    return entry.declarationThreshold === null
        ? t('kitchen:classes.thresholdAny')
        : t('kitchen:classes.thresholdValue', {
              value: formatter.formatNumber(entry.declarationThreshold.value),
              unit: entry.declarationThreshold.unit,
          });
}

export function allergenColumns({
    t,
    locale,
    formatter,
}: AllergenColumnDeps): readonly CatalogueColumn<AllergenClass>[] {
    return [
        {
            key: 'code',
            label: t('kitchen:list.columnReference'),
            width: 96,
            min: 84,
            priority: CATALOGUE_PRIORITY.reference,
            role: 'meta',
            mono: true,
            sortable: true,
            sortType: 'text',
            // The code *is* the identifier here — `gluten`, `sulphites`. There is no separate
            // series, because the platform did not invent one: the regulatory name is the handle,
            // and a `ALG-004` beside it would be a second identity for the same thing.
            value: (entry) => String(entry.code),
            render: (entry) => (
                <Text testID={`${allergenRowTestId(String(entry.code))}-code`} variant="mono">
                    {String(entry.code)}
                </Text>
            ),
        },
        {
            key: 'name',
            label: t('kitchen:classes.columnClass'),
            width: 200,
            min: 150,
            priority: CATALOGUE_PRIORITY.designation,
            role: 'title',
            sortable: true,
            sortType: 'text',
            value: (entry) => displayName(entry.name, locale).value,
            render: (entry) => {
                const testID = allergenRowTestId(String(entry.code));
                return (
                    <Inline space="xs" align="center">
                        <Text variant="label" testID={`${testID}-name`}>
                            {displayName(entry.name, locale).value}
                        </Text>
                        {entry.severeByDefault ? (
                            <Badge
                                testID={`${testID}-severe`}
                                tone="danger"
                                // One word on the row. `classes.severe` is the sentence — "trace
                                // exposure can be dangerous" — and it is what the View panel says;
                                // a badge beside a name has room for the label, not the reason.
                                label={t('kitchen:classes.severeShort')}
                            />
                        ) : null}
                    </Inline>
                );
            },
        },
        {
            key: 'regulation',
            label: t('kitchen:classes.columnReference'),
            width: 160,
            min: 120,
            priority: CATALOGUE_PRIORITY.category,
            role: 'meta',
            sortable: true,
            sortType: 'text',
            value: (entry) => entry.regulatoryReference,
            render: (entry) => (
                <Text
                    testID={`${allergenRowTestId(String(entry.code))}-reference`}
                    tone="secondary"
                >
                    {entry.regulatoryReference}
                </Text>
            ),
        },
        {
            key: 'markets',
            label: t('kitchen:classes.columnMarkets'),
            width: 160,
            min: 120,
            priority: CATALOGUE_PRIORITY.unit,
            role: 'meta',
            // Badges here and a comma run in the ingredient list's Allergens column, which look
            // like the same decision made twice differently. They are not: a market code is two or
            // three characters from a closed set of four, so a row of them reads as a set at a
            // glance. An allergen label is a word from a set of fourteen, and eight rows of those
            // as pills is the column shouting.
            value: (entry) =>
                entry.markets.length === 0
                    ? t('kitchen:classes.noMarkets')
                    : entry.markets.join(', '),
            render: (entry) => {
                const testID = allergenRowTestId(String(entry.code));
                return entry.markets.length === 0 ? (
                    <Text testID={`${testID}-markets-none`} tone="secondary">
                        {t('kitchen:classes.noMarkets')}
                    </Text>
                ) : (
                    <Inline space="xs" wrap testID={`${testID}-markets`}>
                        {entry.markets.map((market) => (
                            <Badge
                                key={market}
                                testID={`${testID}-market-${market}`}
                                tone="info"
                                label={market}
                            />
                        ))}
                    </Inline>
                );
            },
        },
        {
            key: 'threshold',
            label: t('kitchen:classes.columnThreshold'),
            width: 120,
            min: 88,
            priority: CATALOGUE_PRIORITY.metric,
            // The row's headline figure: what a kitchen is actually looking up when it opens this
            // page is the amount at which a class becomes declarable.
            role: 'metric',
            align: 'center',
            mono: true,
            sortable: true,
            sortType: 'number',
            value: (entry) => thresholdLabel(entry, t, formatter),
            render: (entry) => (
                <Text testID={`${allergenRowTestId(String(entry.code))}-threshold`} variant="mono">
                    {thresholdLabel(entry, t, formatter)}
                </Text>
            ),
        },
        {
            key: 'status',
            label: t('kitchen:list.columnStatus'),
            width: 110,
            min: 78,
            priority: CATALOGUE_PRIORITY.status,
            role: 'status',
            badge: true,
            sortable: true,
            sortType: 'text',
            value: (entry) =>
                entry.isActive ? t('kitchen:classes.active') : t('kitchen:classes.inactive'),
            render: (entry) =>
                entry.isActive ? (
                    <Badge
                        testID={`${allergenRowTestId(String(entry.code))}-active`}
                        tone="brand"
                        // No mark on the settled state, the call every Catalogue status column
                        // makes about Published: the word needs no help, and a row of ticks down a
                        // fourteen-row page is noise. Inactive keeps its ⚠, because that is the one
                        // a reader is scanning for.
                        icon={null}
                        label={t('kitchen:classes.active')}
                    />
                ) : (
                    <Badge
                        testID={`${allergenRowTestId(String(entry.code))}-inactive`}
                        tone="warning"
                        label={t('kitchen:classes.inactive')}
                    />
                ),
        },
    ];
}
