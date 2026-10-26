import { Heading, Stack, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import type { ListPrintJob } from './list-print.ts';

/**
 * One list on A4: its title, when it was printed, and the rows as a hand-built grid.
 *
 * Hand-built for the reason `PrintSheet` gives: the design system's `Table` turns into cards below
 * the tablet breakpoint, and a printed page must keep its columns whatever width the window was.
 * The grid keeps `role="table|row|columnheader|cell"` so the on-screen preview is still navigable.
 */
export function ListPrintSheet({ job }: { readonly job: ListPrintJob }) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    return (
        <View
            testID="kitchen-list-print-sheet"
            // A4 at 96dpi is 794px wide; the print block strips the card.
            // eslint-disable-next-line no-restricted-syntax -- the page, not a control: it is the row.
            className="mx-auto w-full max-w-[794px] gap-4 rounded-lg border border-stroke-subtle bg-surface-raised p-6"
        >
            <Stack space="xs">
                <Heading level={2} testID="kitchen-list-print-sheet-title">
                    {job.title}
                </Heading>
                <Text variant="caption" tone="secondary" testID="kitchen-list-print-sheet-printed">
                    {t('kitchen:transfer.print.printed', {
                        date: formatter.formatDate(job.printedAt, { dateStyle: 'medium' }),
                    })}
                </Text>
            </Stack>

            {/* eslint-disable-next-line no-restricted-syntax -- the table spans the page it is printed on. */}
            <View role="table" aria-label={job.title} className="w-full">
                <View
                    role="row"
                    className="flex-row items-end gap-2 border-b-2 border-stroke-strong pb-1"
                >
                    {job.columns.map((column) => (
                        <View
                            key={column.key}
                            role="columnheader"
                            style={{ flex: column.width }}
                            testID={`kitchen-list-print-header-${column.key}`}
                        >
                            <Text variant="caption" tone="secondary">
                                {column.label}
                            </Text>
                        </View>
                    ))}
                </View>

                {job.rows.map((row, rowIndex) => (
                    <View
                        // Rows are strings with no identity of their own; the order is the identity.
                        key={String(rowIndex)}
                        role="row"
                        testID={`kitchen-list-print-row-${String(rowIndex)}`}
                        className="flex-row items-start gap-2 border-b border-stroke-subtle py-1"
                    >
                        {job.columns.map((column, columnIndex) => (
                            <View key={column.key} role="cell" style={{ flex: column.width }}>
                                <Text variant="caption">{row[columnIndex] ?? ''}</Text>
                            </View>
                        ))}
                    </View>
                ))}
            </View>
        </View>
    );
}
