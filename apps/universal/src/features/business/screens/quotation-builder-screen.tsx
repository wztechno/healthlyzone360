import {
    Button,
    Callout,
    Card,
    Checkbox,
    DateField,
    Heading,
    Inline,
    NumberStepper,
    Stack,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { CatalogueItem, Quotation } from '@healthy360/api-client/contracts';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
    toFailure,
    useCorporateCatalogueQuery,
    useCorporateProgrammeQuery,
    useRequestQuotationMutation,
} from '../../../data/business-hooks.ts';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import { earliestStartDate } from '../../commerce/dates.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { EMPTY_CONTACT, draftLines, draftValues, validateDraft } from '../draft.ts';
import type { DraftContact, DraftQuantities } from '../draft.ts';
import { contractPriceTestId, isMixedCurrency, lineValue, totalsByCurrency } from '../format.ts';

/**
 * `/corporate/quotations/new` — compose a quotation from a programme's negotiated lines.
 *
 * ## Submission is a real mutation, not a prototype notice
 *
 * `BusinessRepository.requestQuotation` exists and the prototype store honours it: it validates every
 * line against its minimum order quantity, allocates an `H360-Q` reference and files a `submitted`
 * quotation carrying **no price at all**, because pricing is the account manager's act and a
 * prototype that quotes a total back has invented a commercial commitment. `usePrototypeAction` is
 * reserved for capabilities that genuinely do not exist (`src/prototype/prototype-action.ts`), and
 * this is not one of them — so pressing submit really does change the world, and the quotation list
 * really does show the new reference.
 *
 * What *is* absent is everything around it: there is no way to save a half-composed draft and no
 * export. `quotationExport` in `src/features/availability.ts` records why, and neither the controls
 * nor the standing "prototype limitation" note that explained them is rendered — a screen that
 * composes and submits in one go does not need to apologise for the button it does not have.
 *
 * ## The indicative value is per currency, and it is labelled indicative
 *
 * The tier a quantity earns has a price, so the interface can say what the request is *worth at the
 * agreed rates* — but that is not a quotation, and the copy says so. It is reported per currency
 * ({@link totalsByCurrency}) because one fixture line is priced in SAR and adding riyals to dirhams
 * behind one plausible number is the exact failure that fixture exists to catch.
 */

export interface QuotationBuilderScreenProps {
    readonly programmeId: string | undefined;
    /** A line to start from, arriving from the catalogue's "request a quotation" control. */
    readonly initialItemId?: string | undefined;
}

export function QuotationBuilderScreen({
    programmeId,
    initialItemId,
}: QuotationBuilderScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const validationTranslate = useValidationTranslate();

    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);

    const programme = useCorporateProgrammeQuery(parsed);
    const catalogue = useCorporateCatalogueQuery(parsed === null ? null : { programmeId: parsed });
    /**
     * Memoised so the draft below has a stable dependency: `data?.items ?? []` is a fresh array
     * literal on every render while the page is still loading, which would rebuild the draft — and
     * therefore re-run validation — on every keystroke in the contact form.
     */
    const items = useMemo<readonly CatalogueItem[]>(
        () => catalogue.data?.items ?? [],
        [catalogue.data],
    );

    const [edits, setEdits] = useState<DraftQuantities>({});
    const [contact, setContact] = useState<DraftContact>(EMPTY_CONTACT);
    const [showErrors, setShowErrors] = useState(false);
    const [submitted, setSubmitted] = useState<Quotation | null>(null);

    const request = useRequestQuotationMutation();
    const failure = toFailure(request.error);

    /**
     * The draft, with the catalogue's chosen line seeded at its minimum order quantity.
     *
     * Derived rather than copied into state on arrival: the catalogue loads asynchronously, and
     * synchronising an incoming row into a state object is how a form ends up fighting its own
     * refetches. `id in edits` rather than a `??` so that clearing a seeded line back to nothing
     * stays cleared instead of springing back to the minimum.
     *
     * Seeded at the minimum rather than at one because a minimum order is the smallest thing the
     * buyer may ask for — starting below it would open the form already invalid.
     */
    const quantities: DraftQuantities = useMemo(() => {
        const resolved: Record<string, number | null> = {};
        for (const item of items) {
            resolved[item.id] =
                item.id in edits
                    ? (edits[item.id] ?? null)
                    : item.id === initialItemId
                      ? item.minimumOrderQuantity
                      : null;
        }
        return resolved;
    }, [edits, initialItemId, items]);

    const errors = validateDraft(items, quantities, contact, validationTranslate);
    const lines = draftLines(items, quantities);
    const values = draftValues(items, quantities);
    const totals = totalsByCurrency(values);

    const backAction = (
        <Button
            testID="quotation-builder-back"
            variant="quiet"
            label={t('business:builder.back')}
            onPress={() => {
                if (parsed === null) {
                    router.push('/corporate' as never);
                    return;
                }
                router.push(`/corporate/catalogue/${String(parsed)}` as never);
            }}
        />
    );

    if (parsed === null) {
        return (
            <Stack space="lg" testID="quotation-builder-screen">
                <Callout
                    testID="quotation-builder-not-found"
                    role="alert"
                    tone="warning"
                    icon="warning"
                    title={t('business:builder.notFoundTitle')}
                    body={t('business:builder.notFoundBody')}
                    actions={
                        <Button
                            testID="quotation-builder-home"
                            label={t('business:builder.home')}
                            onPress={() => {
                                router.push('/corporate' as never);
                            }}
                        />
                    }
                />
            </Stack>
        );
    }

    if (submitted !== null) {
        return (
            <Stack space="lg" testID="quotation-builder-screen">
                <Callout
                    testID="quotation-builder-success"
                    role="status"
                    tone="success"
                    icon="check"
                    title={t('business:builder.successTitle')}
                    body={t('business:builder.successBody', { reference: submitted.reference })}
                />
                <Text tone="secondary" testID="quotation-builder-success-note">
                    {t('business:builder.successNote')}
                </Text>
                <Inline space="sm" wrap>
                    <Button
                        testID="quotation-builder-open-list"
                        label={t('business:builder.openList')}
                        onPress={() => {
                            router.push('/corporate/quotations' as never);
                        }}
                    />
                    {backAction}
                </Inline>
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID="quotation-builder-screen">
            <Stack space="xs">
                <Heading level={1} testID="quotation-builder-title">
                    {t('business:builder.title')}
                </Heading>
                <Text tone="secondary" testID="quotation-builder-programme">
                    {programme.data === undefined
                        ? t('business:catalogue.programmeLoading')
                        : programme.data.name}
                </Text>
            </Stack>

            <Callout
                testID="quotation-builder-scope"
                role="note"
                tone="info"
                icon="info"
                title={t('business:builder.scopeTitle')}
                body={t('business:builder.scopeBody')}
            />

            <QueryStates
                query={catalogue}
                isEmpty={items.length === 0}
                emptyTitle={t('business:builder.emptyTitle')}
                emptyBody={t('business:builder.emptyBody')}
                emptyActions={backAction}
                skeletonCount={2}
                testID="quotation-builder-catalogue"
            >
                <Stack space="sm" testID="quotation-builder-lines">
                    {items.map((item) => {
                        const quantity = quantities[item.id] ?? null;
                        const value = lineValue(item, quantity ?? 0);
                        const belowMinimum =
                            quantity !== null &&
                            quantity > 0 &&
                            quantity < item.minimumOrderQuantity;

                        return (
                            <Card
                                key={item.id}
                                testID={`quotation-line-${item.id}`}
                                padding="md"
                                tone={belowMinimum ? 'danger' : 'default'}
                            >
                                <Stack space="sm">
                                    <Text variant="bodyStrong">{item.name}</Text>

                                    <NumberStepper
                                        testID={`quotation-line-${item.id}-quantity`}
                                        label={t('business:builder.quantityLabel', {
                                            name: item.name,
                                        })}
                                        hint={t('business:catalogue.minimum', {
                                            count: item.minimumOrderQuantity,
                                        })}
                                        value={quantity}
                                        min={0}
                                        step={1}
                                        onChange={(next) => {
                                            setEdits((current) => ({
                                                ...current,
                                                [item.id]: next,
                                            }));
                                        }}
                                        {...(belowMinimum
                                            ? {
                                                  error: t('business:builder.lineBelowMinimum', {
                                                      count: item.minimumOrderQuantity,
                                                  }),
                                              }
                                            : {})}
                                    />

                                    {value === null ? (
                                        <Text
                                            testID={`quotation-line-${item.id}-no-value`}
                                            tone="secondary"
                                            variant="caption"
                                        >
                                            {t('business:builder.noTier')}
                                        </Text>
                                    ) : (
                                        <Text
                                            testID={contractPriceTestId(`line-${item.id}`)}
                                            variant="caption"
                                        >
                                            {t('business:builder.lineValue', {
                                                value: formatMoney(formatter, value),
                                            })}
                                        </Text>
                                    )}
                                </Stack>
                            </Card>
                        );
                    })}
                </Stack>
            </QueryStates>

            <Stack space="xs" testID="quotation-builder-value">
                <Text variant="label">{t('business:builder.valueTitle')}</Text>
                {totals.length === 0 ? (
                    <Text testID="quotation-builder-value-none" tone="secondary">
                        {t('business:builder.valueNone')}
                    </Text>
                ) : (
                    totals.map((total) => (
                        <Text
                            key={total.currency}
                            testID={contractPriceTestId(`draft-total-${total.currency}`)}
                        >
                            {t('business:builder.valueTotal', {
                                value: formatMoney(formatter, total),
                            })}
                        </Text>
                    ))
                )}
                <Text tone="secondary" variant="caption" testID="quotation-builder-value-note">
                    {isMixedCurrency(values)
                        ? t('business:builder.valueMixedNote')
                        : t('business:builder.valueNote')}
                </Text>
            </Stack>

            {showErrors && errors.lines !== undefined ? (
                <Callout
                    testID="quotation-builder-lines-error"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('business:builder.errorTitle')}
                    body={errors.lines}
                />
            ) : null}

            <Stack space="sm" testID="quotation-builder-contact">
                <Text variant="label">{t('business:builder.contactTitle')}</Text>

                <TextInputField
                    testID="quotation-builder-contact-name"
                    id="quotation-builder-contact-name"
                    label={t('business:builder.contactName')}
                    value={contact.name}
                    required
                    onChangeText={(next: string) => {
                        setContact((current) => ({ ...current, name: next }));
                    }}
                    {...(showErrors && errors.name !== undefined ? { error: errors.name } : {})}
                />

                <TextInputField
                    testID="quotation-builder-contact-email"
                    id="quotation-builder-contact-email"
                    label={t('business:builder.contactEmail')}
                    value={contact.email}
                    required
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="email-address"
                    onChangeText={(next: string) => {
                        setContact((current) => ({ ...current, email: next }));
                    }}
                    {...(showErrors && errors.email !== undefined ? { error: errors.email } : {})}
                />

                <DateField
                    testID="quotation-builder-delivery-date"
                    label={t('business:builder.deliveryDate')}
                    hint={t('business:builder.deliveryDateHint')}
                    value={contact.requestedDeliveryDate}
                    min={earliestStartDate()}
                    onChange={(next) => {
                        setContact((current) => ({ ...current, requestedDeliveryDate: next }));
                    }}
                />

                <Checkbox
                    testID="quotation-builder-recurring"
                    label={t('business:builder.recurring')}
                    description={t('business:builder.recurringHint')}
                    checked={contact.recurring}
                    onChange={(next) => {
                        setContact((current) => ({ ...current, recurring: next }));
                    }}
                />

                <TextInputField
                    testID="quotation-builder-note"
                    id="quotation-builder-note"
                    label={t('business:builder.note')}
                    hint={t('business:builder.noteHint')}
                    value={contact.note}
                    multiline
                    onChangeText={(next: string) => {
                        setContact((current) => ({ ...current, note: next }));
                    }}
                />
            </Stack>

            {failure === null ? null : (
                <Callout
                    testID="quotation-builder-failure"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('business:builder.rejectedTitle')}
                    body={failure.message}
                />
            )}

            <Inline space="sm" wrap>
                {backAction}
                <Button
                    testID="quotation-builder-submit"
                    label={t('business:builder.submit')}
                    loading={request.isPending}
                    onPress={() => {
                        if (Object.keys(errors).length > 0) {
                            setShowErrors(true);
                            return;
                        }
                        request.mutate(
                            {
                                programmeId: parsed,
                                lines,
                                contactName: contact.name.trim(),
                                contactEmail: contact.email.trim(),
                                recurring: contact.recurring,
                                ...(contact.note.trim() === ''
                                    ? {}
                                    : { note: contact.note.trim() }),
                                ...(contact.requestedDeliveryDate === null
                                    ? {}
                                    : { requestedDeliveryDate: contact.requestedDeliveryDate }),
                            },
                            {
                                onSuccess: (quotation) => {
                                    setSubmitted(quotation);
                                },
                            },
                        );
                    }}
                />
            </Inline>
        </Stack>
    );
}
