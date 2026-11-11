import type { Supplier } from '@healthy360/api-client/contracts';
import { Dialog, FormGrid, Stack, Text, TextInputField } from '@healthy360/design-system';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import { useCreateSupplierMutation } from '../../data/kitchen-ops-hooks.ts';
import { DeskButton } from './desk-kit/desk-button.tsx';
import { serverFieldErrors } from './server-field-errors.ts';

/** The only currency this system prices in, so it is the only honest answer. */
const SUPPLIER_CURRENCY = 'USD';

/**
 * A supplier made without leaving the page that needs one.
 *
 * Post receipt drew this first, and it is the pattern every "add a supplier" now follows: going to
 * the Suppliers page to make one unmounted the work in progress — the supply-order builder lost its
 * picks and quantities, and the new supplier was never chosen on the order it was made for. Here
 * the page keeps its state, and `onCreated` hands the supplier back to be chosen where it was
 * needed.
 *
 * No currency picker: the business books in {@link SUPPLIER_CURRENCY} regardless, and a picker
 * whose answer changes nothing is a question that should not be asked.
 *
 * `testID` prefixes every part — `kitchen-procurement-supplier` on Post receipt, whose ids its
 * suites already name.
 */
export function NewSupplierDialog({
    open,
    onClose,
    onCreated,
    testID,
}: {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly onCreated: (supplier: Supplier) => void;
    readonly testID: string;
}) {
    const { t } = useTranslation();
    const createSupplier = useCreateSupplierMutation();
    const [tried, setTried] = useState(false);
    const [name, setName] = useState('');
    const [code, setCode] = useState('');
    const [email, setEmail] = useState('');
    const [phone, setPhone] = useState('');

    const close = () => {
        setTried(false);
        setName('');
        setCode('');
        setEmail('');
        setPhone('');
        createSupplier.reset();
        onClose();
    };

    const submit = () => {
        setTried(true);
        if (name.trim() === '') return;
        createSupplier.mutate(
            {
                nameEn: name.trim(),
                code: code.trim() === '' ? null : code.trim(),
                currencyCode: SUPPLIER_CURRENCY,
                contactEmail: email.trim() === '' ? null : email.trim(),
                contactPhone: phone.trim() === '' ? null : phone.trim(),
            },
            {
                onSuccess: (supplier) => {
                    onCreated(supplier);
                    close();
                },
            },
        );
    };

    // The dialog has no issue banner, so its error line stays and the fields are marked.
    const failure = toFailure(createSupplier.error);
    const server = serverFieldErrors(failure, {
        name_en: {
            label: t('kitchen:ops.procurement.fieldSupplierName'),
            fieldId: `${testID}-name`,
        },
        code: {
            label: t('kitchen:ops.procurement.fieldSupplierCode'),
            fieldId: `${testID}-code`,
        },
        contact_email: {
            label: t('kitchen:ops.procurement.fieldSupplierEmail'),
            fieldId: `${testID}-email`,
        },
        contact_phone: {
            label: t('kitchen:ops.procurement.fieldSupplierPhone'),
            fieldId: `${testID}-phone`,
        },
    });

    return (
        <Dialog
            look="card"
            testID={`${testID}-dialog`}
            open={open}
            onClose={close}
            title={t('kitchen:ops.procurement.newSupplierTitle')}
            description={t('kitchen:ops.procurement.newSupplierBody')}
            actions={
                <>
                    <DeskButton
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={close}
                    />
                    <DeskButton
                        testID={`${testID}-confirm`}
                        label={t('kitchen:ops.procurement.newSupplierSave')}
                        loading={createSupplier.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="md">
                {createSupplier.error === null ? null : (
                    <Text testID={`${testID}-error`} tone="danger">
                        {server.unplaced ??
                            failure?.message ??
                            t('kitchen:ops.procurement.newSupplierFailed')}
                    </Text>
                )}
                <FormGrid maxColumns={2} testID={`${testID}-grid`}>
                    <TextInputField
                        testID={`${testID}-name`}
                        id={`${testID}-name`}
                        label={t('kitchen:ops.procurement.fieldSupplierName')}
                        placeholder={t('kitchen:ops.procurement.supplierNamePlaceholder')}
                        size="sm"
                        value={name}
                        onChangeText={setName}
                        {...(tried && name.trim() === ''
                            ? { error: t('kitchen:ops.procurement.supplierNameRequired') }
                            : {})}
                        {...server.flag('name_en')}
                    />
                    <TextInputField
                        testID={`${testID}-code`}
                        id={`${testID}-code`}
                        {...server.flag('code')}
                        label={t('kitchen:ops.procurement.fieldSupplierCode')}
                        placeholder={t('kitchen:ops.procurement.supplierCodePlaceholder')}
                        size="sm"
                        value={code}
                        onChangeText={setCode}
                    />
                    <TextInputField
                        testID={`${testID}-email`}
                        id={`${testID}-email`}
                        {...server.flag('contact_email')}
                        label={t('kitchen:ops.procurement.fieldSupplierEmail')}
                        placeholder={t('kitchen:ops.suppliers.emailPlaceholder')}
                        size="sm"
                        value={email}
                        onChangeText={setEmail}
                        keyboardType="email-address"
                    />
                    <TextInputField
                        testID={`${testID}-phone`}
                        id={`${testID}-phone`}
                        {...server.flag('contact_phone')}
                        label={t('kitchen:ops.procurement.fieldSupplierPhone')}
                        placeholder={t('kitchen:ops.suppliers.phonePlaceholder')}
                        size="sm"
                        value={phone}
                        onChangeText={setPhone}
                        keyboardType="phone-pad"
                    />
                </FormGrid>
            </Stack>
        </Dialog>
    );
}
