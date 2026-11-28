import type { CardTone } from '@healthy360/design-system';
import { Text as RNText, View } from 'react-native';

/** One row of a {@link CostCard} — a label, the figure it names, and whether it is the conclusion. */
export interface CostCardRow {
    readonly label: string;
    /** Empty where the label is the whole statement — a cost withheld, with its reason. */
    readonly value: string;
    readonly lead: boolean;
}

/**
 * One cost tile, as the recipe editor's board draws it: a sunken tile with a 14px corner and no
 * edge or cast — the brand's subtle fill for the card the page is for — read like a small bill.
 *
 * `md` (the Costing tab): a 15px bold title over a hairline, then the working at 15px — each label
 * in the secondary tone and its figure in the primary — and the row the card is for, bold over a
 * hairline of its own. `sm` (a pack's "Cost per pack", in a narrow column): a 12px label for a
 * title and 13px rows.
 *
 * Shared by the Costing tab and the Packs & prices tab, so the two are the same object rather than
 * two drawings of it.
 */
export function CostCard({
    title,
    tone,
    rows,
    size = 'md',
    className,
    testID,
}: {
    readonly title: string;
    readonly tone: CardTone;
    readonly rows: readonly CostCardRow[];
    readonly size?: 'sm' | 'md' | undefined;
    readonly className?: string | undefined;
    readonly testID: string;
}) {
    const sm = size === 'sm';
    const text = sm ? 'text-role-body' : 'text-role-section';
    return (
        <View
            testID={testID}
            className={[
                'flex-col rounded-[14px]',
                sm ? 'px-3 py-2.5' : 'px-4 pb-3 pt-[14px]',
                tone === 'brand' ? 'bg-surface-brand-subtle' : 'bg-surface-sunken',
                className ?? '',
            ].join(' ')}
        >
            <RNText
                numberOfLines={1}
                className={
                    sm
                        ? 'text-role-caption font-semibold text-content-secondary'
                        : 'mb-0.5 border-b border-stroke pb-2 text-role-section font-bold text-content-primary'
                }
            >
                {title}
            </RNText>
            {rows.map((row) => (
                <View
                    key={row.label}
                    className={
                        row.lead
                            ? `${sm ? 'mt-1.5 pt-1.5' : 'mt-2.5 pt-2'} flex-row items-baseline justify-between gap-tight border-t border-stroke`
                            : `${sm ? 'mt-1' : 'mt-1.5'} flex-row items-baseline justify-between gap-tight`
                    }
                >
                    <RNText
                        numberOfLines={1}
                        className={`shrink ${text} ${
                            row.lead
                                ? 'font-bold text-content-primary'
                                : row.value === ''
                                  ? 'font-semibold text-warning-on-subtle'
                                  : 'text-content-secondary'
                        }`}
                    >
                        {row.label}
                    </RNText>
                    <RNText
                        numberOfLines={1}
                        className={`${text} tabular-nums text-content-primary ${row.lead ? 'font-bold' : ''}`}
                    >
                        {row.value}
                    </RNText>
                </View>
            ))}
        </View>
    );
}
