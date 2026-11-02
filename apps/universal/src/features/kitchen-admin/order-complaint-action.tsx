import { COMPLAINT_CAUSES } from '@healthy360/api-client/contracts';
import type { ComplaintCause, KitchenOrder } from '@healthy360/api-client/contracts';
import {
    Button,
    Dialog,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { parseMinorAmount } from '@healthy360/domain-types';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { toFailure } from '../../data/hooks.ts';
import { useRecordComplaintMutation } from '../../data/kitchen-orders-hooks.ts';

/** The order page's way into a complaint: why, and what it has cost so far. */
export function OrderComplaintAction({ order }: { readonly order: KitchenOrder }) {
    const { t } = useTranslation();
    const toast = useToast();
    const router = useRouter();
    const record = useRecordComplaintMutation();
    const [open, setOpen] = useState(false);
    const [cause, setCause] = useState<ComplaintCause>('quality');
    const [description, setDescription] = useState('');
    const [cost, setCost] = useState('0');
    const costMinor = parseMinorAmount(cost, order.currencyCode);
    const failure = toFailure(record.error);

    return (
        <View className="flex-row">
            <Button
                testID="kitchen-orders-complaint-open"
                variant="secondary"
                size="sm"
                label={t('kitchen:complaints.record')}
                onPress={() => {
                    setOpen(true);
                }}
            />
            <Dialog
                testID="kitchen-orders-complaint-dialog"
                open={open}
                onClose={() => {
                    setOpen(false);
                }}
                title={t('kitchen:complaints.recordTitle', { number: order.orderNumber })}
                actions={
                    <Button
                        testID="kitchen-orders-complaint-save"
                        label={t('kitchen:complaints.recordConfirm')}
                        loading={record.isPending}
                        disabled={record.isPending || costMinor === null}
                        onPress={() => {
                            if (costMinor === null) return;
                            record.mutate(
                                {
                                    orderId: order.id,
                                    cause,
                                    description:
                                        description.trim() === '' ? null : description.trim(),
                                    costMinor,
                                },
                                {
                                    onSuccess: (complaint) => {
                                        setOpen(false);
                                        toast.show({
                                            testID: 'kitchen-orders-complaint-toast',
                                            tone: 'success',
                                            message: t('kitchen:complaints.recordedToast'),
                                            action: {
                                                label: t('kitchen:complaints.openRecord'),
                                                testID: 'kitchen-orders-complaint-toast-open',
                                                onPress: () => {
                                                    router.push(
                                                        `/kitchen/complaints?view=${encodeURIComponent(complaint.id)}` as never,
                                                    );
                                                },
                                            },
                                        });
                                    },
                                },
                            );
                        }}
                    />
                }
            >
                <Stack space="sm">
                    <Select
                        testID="kitchen-orders-complaint-cause"
                        label={t('kitchen:complaints.columnCause')}
                        size="sm"
                        value={cause}
                        options={COMPLAINT_CAUSES.map((value) => ({
                            value,
                            label: t(`kitchen:complaints.cause.${value}`),
                        }))}
                        onChange={setCause}
                    />
                    <TextInputField
                        testID="kitchen-orders-complaint-description"
                        id="kitchen-orders-complaint-description"
                        label={t('kitchen:complaints.fieldDescription')}
                        size="sm"
                        multiline
                        numberOfLines={3}
                        maxLength={500}
                        value={description}
                        onChangeText={setDescription}
                    />
                    <TextInputField
                        testID="kitchen-orders-complaint-cost"
                        id="kitchen-orders-complaint-cost"
                        label={t('kitchen:complaints.columnCost')}
                        hint={t('kitchen:complaints.costHint')}
                        size="sm"
                        inputMode="decimal"
                        value={cost}
                        onChangeText={setCost}
                    />
                    {failure === null ? null : (
                        <Text
                            variant="caption"
                            tone="danger"
                            testID="kitchen-orders-complaint-error"
                        >
                            {failure.message}
                        </Text>
                    )}
                </Stack>
            </Dialog>
        </View>
    );
}
