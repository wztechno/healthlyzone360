import { formatGtin } from '@healthy360/api-client/contracts';
import {
    Checkbox,
    DateField,
    Inline,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';

import { lotCheckPending, lotIsReadable } from './receive-delivery-model.ts';
import type { ScanTrace } from './receive-delivery-model.ts';

/**
 * One delivery row's traceability (ingredient barcodes, plan §8): the supplier lot, the expiry and
 * the best-before, filled by a scan or typed off the pack, and the product a scan named.
 *
 * A lot read to the end of a scan with no separator is flagged here and held back from posting
 * until a person ticks **Lot checked** — or edits it, which is the same statement.
 */
export interface ReceiveLineTraceProps {
    readonly testID: string;
    readonly trace: ScanTrace;
    readonly onChange: (patch: Partial<ScanTrace>) => void;
    /** Names the row when the fields are not drawn inside it. */
    readonly title?: string | undefined;
}

export function ReceiveLineTrace({ testID, trace, onChange, title }: ReceiveLineTraceProps) {
    const { t } = useTranslation();
    const gtin = trace.gtin ?? null;

    return (
        <Stack space="xs" testID={testID}>
            {title === undefined ? null : <Text variant="bodyStrong">{title}</Text>}
            <Inline space="sm" align="start" wrap>
                <TextInputField
                    testID={`${testID}-lot`}
                    size="sm"
                    label={t('kitchen:barcodes.lotLabel')}
                    placeholder={t('kitchen:barcodes.lotPlaceholder')}
                    value={trace.supplierLot ?? ''}
                    maxLength={20}
                    className="min-w-[180px]"
                    autoCorrect={false}
                    autoCapitalize="none"
                    {...(lotIsReadable(trace.supplierLot)
                        ? {}
                        : { error: t('kitchen:barcodes.lotUnreadable') })}
                    {...(lotCheckPending(trace)
                        ? { warning: t('kitchen:barcodes.lotUnverified') }
                        : {})}
                    onChangeText={(next) => {
                        onChange({ supplierLot: next, lotUnverified: false });
                    }}
                />
                <DateField
                    testID={`${testID}-expires`}
                    label={t('kitchen:barcodes.expiresLabel')}
                    value={trace.expiresOn ?? ''}
                    onChange={(next) => {
                        onChange({ expiresOn: next ?? '' });
                    }}
                />
                <DateField
                    testID={`${testID}-best-before`}
                    label={t('kitchen:barcodes.bestBeforeLabel')}
                    value={trace.bestBeforeOn ?? ''}
                    onChange={(next) => {
                        onChange({ bestBeforeOn: next ?? '' });
                    }}
                />
            </Inline>
            {gtin === null ? null : (
                <Text testID={`${testID}-gtin`} variant="caption" tone="secondary">
                    {t('kitchen:barcodes.scannedProduct', { gtin: `⁦${formatGtin(gtin)}⁩` })}
                </Text>
            )}
            {trace.lotUnverified === true ? (
                <Checkbox
                    testID={`${testID}-lot-checked`}
                    id={`${testID}-lot-checked`}
                    checked={trace.lotConfirmed === true}
                    label={t('kitchen:barcodes.lotChecked')}
                    onChange={(checked) => {
                        onChange({ lotConfirmed: checked });
                    }}
                />
            ) : null}
        </Stack>
    );
}
