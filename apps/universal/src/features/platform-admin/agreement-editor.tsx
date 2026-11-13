import type {
    AgreementTermsInput,
    B2BAgreement,
    B2BPaymentTerms,
    PlatformB2bApplication,
} from '@healthy360/api-client/contracts';
import { B2B_PAYMENT_TERMS } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Checkbox,
    Drawer,
    Select,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toFailure } from '../../data/hooks.ts';
import { useUnsavedGuardFor } from '../../navigation/use-unsaved-guard.ts';
import { UnsavedChangesDialog } from '../../ui/unsaved-changes-dialog.tsx';
import {
    useDraftAgreementMutation,
    useSellerPriceListsQuery,
    useUpdateAgreementMutation,
} from '../../data/platform-b2b-hooks.ts';

/**
 * The reviewer's agreement form, in a drawer beside the application it is for.
 *
 * ## The seller is a price list
 *
 * An agreement prices from one kitchen's negotiated (`agreement`-scoped) list, so choosing the list
 * *is* choosing who the company buys from. The picker groups lists by kitchen, shows each one's
 * currency, and disables a list already behind another company's agreement — the server refuses
 * it too, because one list pricing two buyers is the leak the scope exists to prevent. The currency
 * follows the chosen list and is sent with it.
 *
 * Money is typed in major units and sent as minor units. Dates are `YYYY-MM-DD`; the server says
 * so if one is not.
 *
 * Mounted per version (the caller keys it), so the form starts from the version being edited
 * rather than re-seeding itself in an effect.
 */

interface Draft {
    readonly title: string;
    readonly priceListId: string | null;
    readonly paymentTerms: B2BPaymentTerms | null;
    readonly creditLimit: string;
    readonly minimumOrder: string;
    readonly leadTimeDays: string;
    readonly noticePeriodDays: string;
    readonly startsOn: string;
    readonly endsOn: string;
    readonly autoRenews: boolean;
    readonly termsSummary: string;
}

function majorUnits(minor: number | null): string {
    return minor === null ? '' : String(minor / 100);
}

function fromAgreement(agreement: B2BAgreement | null, fallbackTitle: string): Draft {
    return {
        title: agreement?.title ?? fallbackTitle,
        priceListId: agreement?.priceListId ?? null,
        paymentTerms: agreement?.terms.paymentTerms ?? null,
        creditLimit: majorUnits(agreement?.terms.creditLimitMinor ?? null),
        minimumOrder: majorUnits(agreement?.terms.minimumOrderMinor ?? null),
        leadTimeDays: agreement?.terms.deliveryLeadTimeDays?.toString() ?? '',
        noticePeriodDays: agreement?.terms.noticePeriodDays?.toString() ?? '',
        startsOn: agreement?.terms.startsOn ?? '',
        endsOn: agreement?.terms.endsOn ?? '',
        autoRenews: agreement?.terms.autoRenews ?? false,
        termsSummary: agreement?.termsSummary ?? '',
    };
}

/** `''` → null, a non-negative number → minor units, anything else → `undefined` (invalid). */
function minorOrNull(major: string): number | null | undefined {
    const trimmed = major.trim();
    if (trimmed === '') return null;
    const value = Number(trimmed);
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : undefined;
}

/** `''` → null, a whole non-negative number → itself, anything else → `undefined` (invalid). */
function intOrNull(value: string): number | null | undefined {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    const parsed = Number(trimmed);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

export function AgreementEditor({
    application,
    agreement,
    open,
    onClose,
}: {
    readonly application: PlatformB2bApplication;
    /** `null` drafts a new agreement. */
    readonly agreement: B2BAgreement | null;
    readonly open: boolean;
    readonly onClose: () => void;
}) {
    const { t, i18n } = useTranslation();
    const lists = useSellerPriceListsQuery(open);
    const draftMutation = useDraftAgreementMutation();
    const updateMutation = useUpdateAgreementMutation();

    const company = application.legalName ?? application.tradingName ?? application.reference;
    const [initial] = useState<Draft>(() =>
        fromAgreement(agreement, t('platformAdmin:b2b.editor.defaultTitle', { company })),
    );
    const [form, setForm] = useState<Draft>(initial);
    // Changed and not saved: closing the drawer — Cancel, Escape, the backdrop — asks first.
    const guard = useUnsavedGuardFor(JSON.stringify(form) !== JSON.stringify(initial), {
        message: t('common:unsaved.browserPrompt'),
        enabled: open,
    });
    const close = () => {
        guard.intercept(onClose);
    };

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
        setForm((current) => ({ ...current, [key]: value }));
    };

    const options = useMemo(
        () =>
            (lists.data ?? []).map((list) => {
                const name =
                    i18n.language === 'ar' && list.nameAr !== null ? list.nameAr : list.nameEn;
                const taken =
                    list.boundToApplicationId !== null &&
                    list.boundToApplicationId !== application.id;
                return {
                    value: list.id,
                    label: `${list.organisationName} — ${name} (${list.currencyCode})`,
                    ...(taken ? { description: t('platformAdmin:b2b.editor.listTaken') } : {}),
                    disabled: taken,
                };
            }),
        [application.id, i18n.language, lists.data, t],
    );

    const chosen = (lists.data ?? []).find((list) => list.id === form.priceListId) ?? null;
    const failure = toFailure(draftMutation.error) ?? toFailure(updateMutation.error);
    const fieldError = (field: string): string | undefined =>
        failure?.code === 'validation.failed' ? failure.fields[field]?.[0] : undefined;
    const saving = draftMutation.isPending || updateMutation.isPending;

    const numbers = {
        creditLimit: minorOrNull(form.creditLimit),
        minimumOrder: minorOrNull(form.minimumOrder),
        leadTimeDays: intOrNull(form.leadTimeDays),
        noticePeriodDays: intOrNull(form.noticePeriodDays),
    };
    const invalid = Object.values(numbers).some((value) => value === undefined);
    const numberError = (key: keyof typeof numbers, wire: string): string | undefined =>
        numbers[key] === undefined ? t('platformAdmin:b2b.editor.notANumber') : fieldError(wire);

    const terms: AgreementTermsInput = {
        priceListId: form.priceListId,
        currencyCode: chosen?.currencyCode ?? agreement?.terms.currencyCode ?? null,
        paymentTerms: form.paymentTerms,
        creditLimitMinor: numbers.creditLimit ?? null,
        minimumOrderMinor: numbers.minimumOrder ?? null,
        deliveryLeadTimeDays: numbers.leadTimeDays ?? null,
        noticePeriodDays: numbers.noticePeriodDays ?? null,
        startsOn: form.startsOn.trim() === '' ? null : form.startsOn.trim(),
        endsOn: form.endsOn.trim() === '' ? null : form.endsOn.trim(),
        autoRenews: form.autoRenews,
        termsSummary: form.termsSummary.trim() === '' ? null : form.termsSummary.trim(),
    };

    const save = () => {
        if (agreement === null) {
            draftMutation.mutate(
                { applicationId: application.id, title: form.title.trim(), terms },
                { onSuccess: onClose },
            );
        } else {
            updateMutation.mutate(
                {
                    agreementId: agreement.id,
                    lockVersion: agreement.lockVersion,
                    terms: { ...terms, title: form.title.trim() },
                },
                { onSuccess: onClose },
            );
        }
    };

    return (
        <>
            <Drawer
                testID="platform-b2b-agreement-editor"
                open={open}
                onClose={close}
                title={
                    agreement === null
                        ? t('platformAdmin:b2b.editor.newTitle')
                        : t('platformAdmin:b2b.editor.editTitle', { version: agreement.version })
                }
                footer={
                    <Stack space="sm">
                        <Button
                            testID="platform-b2b-agreement-save"
                            label={t('platformAdmin:b2b.editor.save')}
                            disabled={form.title.trim() === '' || invalid}
                            loading={saving}
                            onPress={save}
                        />
                        <Button
                            testID="platform-b2b-agreement-cancel"
                            variant="quiet"
                            label={t('platformAdmin:b2b.cancel')}
                            onPress={close}
                        />
                    </Stack>
                }
            >
                <Stack space="md">
                    <Text tone="secondary">{t('platformAdmin:b2b.editor.intro')}</Text>

                    {failure === null || failure.code === 'validation.failed' ? null : (
                        <Callout
                            testID="platform-b2b-agreement-error"
                            role="alert"
                            tone="danger"
                            title={failure.message}
                        />
                    )}

                    <TextInputField
                        testID="platform-b2b-agreement-title"
                        label={t('platformAdmin:b2b.editor.title')}
                        value={form.title}
                        onChangeText={(value) => {
                            set('title', value);
                        }}
                        error={fieldError('title')}
                        required
                    />

                    <Select<string>
                        testID="platform-b2b-agreement-price-list"
                        label={t('platformAdmin:b2b.editor.priceList')}
                        hint={t('platformAdmin:b2b.editor.priceListHint')}
                        placeholder={t('platformAdmin:b2b.editor.priceListPlaceholder')}
                        value={form.priceListId}
                        options={options}
                        loading={lists.isPending}
                        searchable
                        onChange={(value) => {
                            set('priceListId', value);
                        }}
                        error={fieldError('price_list_id') ?? fieldError('currency_code')}
                    />

                    {lists.isSuccess && options.length === 0 ? (
                        <Callout
                            testID="platform-b2b-agreement-no-lists"
                            tone="info"
                            title={t('platformAdmin:b2b.editor.noListsTitle')}
                            body={t('platformAdmin:b2b.editor.noListsBody')}
                        />
                    ) : null}

                    <Select<B2BPaymentTerms>
                        testID="platform-b2b-agreement-payment-terms"
                        label={t('platformAdmin:b2b.agreement.paymentTerms')}
                        value={form.paymentTerms}
                        options={B2B_PAYMENT_TERMS.map((value) => ({
                            value,
                            label: t(`b2bApplication:paymentTerms.${value}`),
                        }))}
                        onChange={(value) => {
                            set('paymentTerms', value);
                        }}
                        error={fieldError('payment_terms')}
                        {...(application.sections.trade_terms.requestedPaymentTerms === null
                            ? {}
                            : {
                                  hint: t('platformAdmin:b2b.editor.requested', {
                                      value: t(
                                          `b2bApplication:paymentTerms.${application.sections.trade_terms.requestedPaymentTerms}`,
                                      ),
                                  }),
                              })}
                    />

                    <TextInputField
                        testID="platform-b2b-agreement-credit-limit"
                        label={t('platformAdmin:b2b.agreement.creditLimit')}
                        hint={
                            chosen === null
                                ? undefined
                                : t('platformAdmin:b2b.editor.inCurrency', {
                                      currency: chosen.currencyCode,
                                  })
                        }
                        value={form.creditLimit}
                        onChangeText={(value) => {
                            set('creditLimit', value);
                        }}
                        keyboardType="decimal-pad"
                        error={numberError('creditLimit', 'credit_limit_minor')}
                    />
                    <TextInputField
                        testID="platform-b2b-agreement-minimum-order"
                        label={t('platformAdmin:b2b.agreement.minimumOrder')}
                        value={form.minimumOrder}
                        onChangeText={(value) => {
                            set('minimumOrder', value);
                        }}
                        keyboardType="decimal-pad"
                        error={numberError('minimumOrder', 'minimum_order_minor')}
                    />
                    <TextInputField
                        testID="platform-b2b-agreement-lead-time"
                        label={t('platformAdmin:b2b.editor.leadTime')}
                        value={form.leadTimeDays}
                        onChangeText={(value) => {
                            set('leadTimeDays', value);
                        }}
                        keyboardType="number-pad"
                        error={numberError('leadTimeDays', 'delivery_lead_time_days')}
                    />
                    <TextInputField
                        testID="platform-b2b-agreement-notice"
                        label={t('platformAdmin:b2b.editor.noticePeriod')}
                        value={form.noticePeriodDays}
                        onChangeText={(value) => {
                            set('noticePeriodDays', value);
                        }}
                        keyboardType="number-pad"
                        error={numberError('noticePeriodDays', 'notice_period_days')}
                    />
                    <TextInputField
                        testID="platform-b2b-agreement-starts-on"
                        label={t('platformAdmin:b2b.editor.startsOn')}
                        placeholder={t('platformAdmin:b2b.editor.datePlaceholder')}
                        value={form.startsOn}
                        onChangeText={(value) => {
                            set('startsOn', value);
                        }}
                        error={fieldError('starts_on')}
                    />
                    <TextInputField
                        testID="platform-b2b-agreement-ends-on"
                        label={t('platformAdmin:b2b.editor.endsOn')}
                        placeholder={t('platformAdmin:b2b.editor.datePlaceholder')}
                        value={form.endsOn}
                        onChangeText={(value) => {
                            set('endsOn', value);
                        }}
                        error={fieldError('ends_on')}
                    />
                    <Checkbox
                        testID="platform-b2b-agreement-auto-renews"
                        label={t('platformAdmin:b2b.editor.autoRenews')}
                        checked={form.autoRenews}
                        onChange={(checked) => {
                            set('autoRenews', checked);
                        }}
                    />
                    <TextInputField
                        testID="platform-b2b-agreement-summary"
                        label={t('platformAdmin:b2b.editor.summary')}
                        hint={t('platformAdmin:b2b.editor.summaryHint')}
                        value={form.termsSummary}
                        onChangeText={(value) => {
                            set('termsSummary', value);
                        }}
                        multiline
                        error={fieldError('terms_summary')}
                    />
                </Stack>
            </Drawer>
            <UnsavedChangesDialog guard={guard} testID="platform-b2b-agreement-unsaved" />
        </>
    );
}
