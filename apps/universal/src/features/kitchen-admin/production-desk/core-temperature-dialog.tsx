import { Button, Dialog, Stack, Text, TextInputField, useToast } from '@healthy360/design-system';
import type { ProductionOrderId } from '@healthy360/domain-types';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../../data/hooks.ts';
import { useRecordCookingTemperatureMutation } from '../../../data/kitchen-ops-hooks.ts';

/**
 * A batch's core temperature, recorded from the batch itself.
 *
 * The temperature log's batch dialog without the batch picker: the page already names the batch.
 * The reading lands in the same log and on this batch's page.
 */
export function CoreTemperatureDialog({
    batchId,
    onClose,
}: {
    readonly batchId: ProductionOrderId;
    readonly onClose: () => void;
}) {
    const { t } = useTranslation();
    const toast = useToast();
    const record = useRecordCookingTemperatureMutation();
    const [celsius, setCelsius] = useState('');
    const failure = toFailure(record.error);
    const readable = celsius.trim() !== '' && Number.isFinite(Number(celsius));

    return (
        <Dialog
            testID="kitchen-production-batch-temperature-dialog"
            open
            onClose={onClose}
            title={t('kitchen:temperature.recordBatch')}
            actions={
                <Button
                    testID="kitchen-production-batch-temperature-save"
                    label={t('kitchen:temperature.save')}
                    loading={record.isPending}
                    disabled={record.isPending || !readable}
                    onPress={() => {
                        record.mutate(
                            { productionOrderId: String(batchId), celsius: celsius.trim() },
                            {
                                onSuccess: () => {
                                    onClose();
                                    toast.show({
                                        testID: 'kitchen-production-batch-toast',
                                        tone: 'success',
                                        message: t('kitchen:temperature.saved'),
                                    });
                                },
                            },
                        );
                    }}
                />
            }
        >
            <Stack space="sm">
                <TextInputField
                    testID="kitchen-production-batch-temperature-celsius"
                    id="kitchen-production-batch-temperature-celsius"
                    label={t('kitchen:temperature.columnCore')}
                    size="sm"
                    inputMode="decimal"
                    value={celsius}
                    onChangeText={setCelsius}
                />
                {failure === null ? null : (
                    <Text
                        variant="caption"
                        tone="danger"
                        testID="kitchen-production-batch-temperature-error"
                    >
                        {failure.message}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
