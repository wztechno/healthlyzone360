import { Button, Callout, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { useReturnTo } from '../../../navigation/use-return-to.ts';
import { useListPrint } from '../catalogue/list-print.ts';
import type { PrintResource } from '../catalogue/list-print.ts';
import { ListPrintSheet } from '../catalogue/list-print-sheet.tsx';
import { usePrintSheet } from '../print-sheet.tsx';

/**
 * `/kitchen/{ingredients|recipes|stock}/print` — the list the reader was looking at, as a page
 * (Export → PDF — table).
 *
 * It reads no data. The list screen froze its visible columns and sorted rows into a
 * `ListPrintJob` and opened this route; a refresh or a pasted link finds no job and says so,
 * with the way back, rather than printing a list nobody chose. A route rather than a dialog for the
 * reason `supply-order-print-screen.tsx` gives: `window.print()` prints the document.
 */
export interface ListPrintScreenProps {
    readonly resource: PrintResource;
}

export function ListPrintScreen({ resource }: ListPrintScreenProps) {
    const { t } = useTranslation();
    const back = useReturnTo(undefined, `/kitchen/${resource}`).leave;
    const sheet = usePrintSheet();
    const { read } = useListPrint();
    // Read once on mount: the job is what the list held when Export was pressed.
    const [job] = useState(() => read(resource));

    const backButton = (
        <Button
            testID="kitchen-list-print-back"
            variant="secondary"
            label={t('kitchen:common.back')}
            onPress={back}
        />
    );

    if (job === null) {
        return (
            <Stack space="lg" testID="kitchen-list-print-screen">
                <Callout
                    testID="kitchen-list-print-expired"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:transfer.print.expiredTitle')}
                    body={t('kitchen:transfer.print.expiredBody')}
                    actions={backButton}
                />
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID="kitchen-list-print-screen">
            {/* Screen-only: the print block hides it by test id. */}
            <Stack space="sm" testID="kitchen-list-print-toolbar">
                {/* The board's one bar: the title and its row count, then Back and Print. */}
                <View className="z-auto flex-row flex-wrap items-end justify-between gap-snug rounded-panel border border-stroke-subtle bg-surface-raised p-snug">
                    <View className="flex-col">
                        <Heading level={2} testID="kitchen-list-print-title">
                            {job.title}
                        </Heading>
                        <Text tone="secondary" testID="kitchen-list-print-count">
                            {t('kitchen:transfer.print.rowCount', { count: job.rows.length })}
                        </Text>
                    </View>

                    <Inline space="sm" align="center" wrap>
                        {backButton}
                        {sheet.mode === 'browser' ? (
                            <Button
                                testID="kitchen-list-print-action"
                                label={t('kitchen:transfer.print.action')}
                                onPress={sheet.print}
                            />
                        ) : null}
                    </Inline>
                </View>

                {sheet.mode === 'browser' ? null : (
                    <Callout
                        testID="kitchen-list-print-native-notice"
                        tone="info"
                        title={t('kitchen:transfer.print.nativeUnavailable')}
                    />
                )}
            </Stack>

            <View testID="kitchen-list-print-sheets">
                <ListPrintSheet job={job} />
            </View>
        </Stack>
    );
}
