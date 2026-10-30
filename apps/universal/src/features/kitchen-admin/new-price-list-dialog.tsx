import type { LocalisedText, PriceListCustomerScope } from '@healthy360/api-client/contracts';
import {
    Button,
    Dialog,
    Select,
    Stack,
    Text,
    TextInputField,
    useToast,
} from '@healthy360/design-system';
import { useLocale } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCan } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import { useProcurementReferenceQuery } from '../../data/kitchen-ops-hooks.ts';
import { useCreatePriceListMutation } from '../../data/kitchen-wholesale-hooks.ts';
import { BilingualField } from './bilingual-field.tsx';
import { INVENTORY_VIEW_PERMISSION } from './entity-registry.ts';
import { displayName } from './format.ts';
import { serverFieldErrors } from './server-field-errors.ts';

const CURRENCY_PATTERN = /^[A-Za-z]{3}$/;

export interface NewPriceListDialogProps {
    readonly onClose: () => void;
    /** Fixed scope (the wholesale page asks only for agreement lists); omitted, the reader picks. */
    readonly scope?: PriceListCustomerScope | undefined;
    /** The currency of a list this kitchen already has, when there is one. */
    readonly knownCurrency?: string | null | undefined;
    /** `?returnTo=` for the editor the create opens. */
    readonly returnTo?: string | undefined;
    readonly testID: string;
}

/**
 * Creates a draft price list and opens it in the editor, where its prices are added and it is
 * published — the create has no entries to ask for, so the form is name, code, currency, scope.
 *
 * Mounted only while open, so every opening starts blank. The currency defaults to the kitchen's:
 * a list it already has, or the organisation's default from the procurement reference.
 */
export function NewPriceListDialog({
    onClose,
    scope: fixedScope,
    knownCurrency,
    returnTo,
    testID,
}: NewPriceListDialogProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const router = useRouter();
    const toast = useToast();
    const create = useCreatePriceListMutation();

    const canReadReference = useCan(INVENTORY_VIEW_PERMISSION);
    const known = knownCurrency ?? null;
    const reference = useProcurementReferenceQuery(known === null && canReadReference);
    const defaultCurrency = known ?? reference.data?.defaultCurrencyCode ?? '';

    const [name, setName] = useState<LocalisedText>({ en: '', ar: '' });
    const [code, setCode] = useState('');
    const [currency, setCurrency] = useState<string | null>(null);
    const [scope, setScope] = useState<PriceListCustomerScope>(fixedScope ?? 'public');
    const [attempted, setAttempted] = useState(false);

    // The default arrives after the dialog may already be open; it fills the field until typed over.
    const currencyValue = currency ?? defaultCurrency;

    const problems = {
        name: name.en.trim() === '' ? t('kitchen:priceLists.createNameRequired') : undefined,
        code: code.trim() === '' ? t('kitchen:priceLists.createCodeRequired') : undefined,
        currency: CURRENCY_PATTERN.test(currencyValue.trim())
            ? undefined
            : t('kitchen:priceLists.createCurrencyInvalid'),
    };
    const shown = attempted ? problems : { name: undefined, code: undefined, currency: undefined };
    const server = serverFieldErrors(toFailure(create.error));
    const unplaced =
        create.error === null
            ? null
            : server.isValidation
              ? server.unplaced
              : (toFailure(create.error)?.message ?? null);

    const submit = () => {
        setAttempted(true);
        if (problems.name !== undefined || problems.code !== undefined) return;
        if (problems.currency !== undefined) return;
        create.mutate(
            {
                code: code.trim(),
                name: { en: name.en.trim(), ar: name.ar.trim() },
                currency: currencyValue,
                customerScope: scope,
            },
            {
                onSuccess: (list) => {
                    toast.show({
                        testID: `${testID}-created-toast`,
                        tone: 'success',
                        message: t('kitchen:priceLists.createdToast', {
                            name: displayName(list.name, locale).value,
                        }),
                    });
                    onClose();
                    const editor = `/kitchen/price-lists/${String(list.id)}`;
                    router.push(
                        (returnTo === undefined
                            ? editor
                            : `${editor}?returnTo=${encodeURIComponent(returnTo)}`) as never,
                    );
                },
            },
        );
    };

    // Once something is typed, a stray press outside does not throw it away: Cancel does that.
    const typed = name.en.trim() !== '' || name.ar.trim() !== '' || code.trim() !== '';

    return (
        <Dialog
            testID={testID}
            open
            onClose={onClose}
            dismissOnBackdrop={!typed}
            title={
                fixedScope === 'agreement'
                    ? t('kitchen:priceLists.createAgreementTitle')
                    : t('kitchen:priceLists.createTitle')
            }
            description={t('kitchen:priceLists.createBody')}
            actions={
                <>
                    <Button
                        testID={`${testID}-cancel`}
                        variant="quiet"
                        label={t('kitchen:common.cancel')}
                        onPress={onClose}
                    />
                    <Button
                        testID={`${testID}-confirm`}
                        label={t('kitchen:priceLists.createConfirm')}
                        loading={create.isPending}
                        disabled={create.isPending}
                        onPress={submit}
                    />
                </>
            }
        >
            <Stack space="sm">
                <BilingualField
                    testID={`${testID}-name`}
                    fieldLabel={t('kitchen:priceLists.createNameLabel')}
                    value={name}
                    onChange={setName}
                    requiredEnglish
                    englishError={shown.name ?? server.errorFor('name_en')}
                    arabicError={server.errorFor('name_ar')}
                    layout="row"
                />
                <TextInputField
                    testID={`${testID}-code`}
                    id={`${testID}-code`}
                    label={t('kitchen:priceLists.createCodeLabel')}
                    hint={t('kitchen:priceLists.createCodeHint')}
                    required
                    value={code}
                    onChangeText={setCode}
                    autoCapitalize="none"
                    {...(shown.code === undefined ? server.flag('code') : { error: shown.code })}
                />
                <TextInputField
                    testID={`${testID}-currency`}
                    id={`${testID}-currency`}
                    label={t('kitchen:priceLists.createCurrencyLabel')}
                    hint={t('kitchen:priceLists.createCurrencyHint')}
                    required
                    value={currencyValue}
                    onChangeText={(next) => {
                        setCurrency(next.toUpperCase());
                    }}
                    autoCapitalize="characters"
                    maxLength={3}
                    {...(shown.currency === undefined
                        ? server.flag('currency_code')
                        : { error: shown.currency })}
                />
                {fixedScope === undefined ? (
                    <Select<PriceListCustomerScope>
                        testID={`${testID}-scope`}
                        label={t('kitchen:priceLists.createScopeLabel')}
                        value={scope}
                        onChange={setScope}
                        options={[
                            { value: 'public', label: t('kitchen:priceLists.scopePublic') },
                            { value: 'agreement', label: t('kitchen:priceLists.scopeAgreement') },
                        ]}
                        {...server.flag('customer_scope')}
                    />
                ) : null}
                {unplaced === null ? null : (
                    <Text testID={`${testID}-error`} tone="danger">
                        {unplaced}
                    </Text>
                )}
            </Stack>
        </Dialog>
    );
}
