import {
    Button,
    Callout,
    Cascade,
    Checkbox,
    DatePickerButton,
    EmptyState,
    ErrorState,
    FormGrid,
    FormSection,
    Icon,
    InfoTip,
    Inline,
    QuantityInput,
    TableSkeleton,
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
import { CatalogueList } from '../../kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { CataloguePageHeader } from '../../kitchen-admin/catalogue/catalogue-page-header.tsx';
import { focusField } from '../../kitchen-admin/field-focus.ts';
import { serverFieldErrors } from '../../kitchen-admin/server-field-errors.ts';
import type { ServerFieldTarget } from '../../kitchen-admin/server-field-errors.ts';
import { formatMoney } from '../../marketplace/format.ts';
import {
    CORPORATE_HOME_HREF,
    CORPORATE_QUOTATIONS_HREF,
    corporateCatalogueHref,
} from '../corporate-chrome.tsx';
import { EMPTY_CONTACT, draftLines, draftValues, validateDraft } from '../draft.ts';
import type { DraftContact, DraftQuantities } from '../draft.ts';
import { contractPriceTestId, isMixedCurrency, lineValue, totalsByCurrency } from '../format.ts';

/**
 * `/corporate/quotations/new` — compose a quotation from a programme's negotiated lines.
 *
 * Drawn as an admin editor (`kitchen-admin/screens/ingredient-edit-screen.tsx`): the title with
 * Cancel and Submit beside it, then one card per concern — the lines as a table with a quantity
 * cell each, the reply details in a two-up grid — and the indicative value at the foot of the
 * lines. The trail reads `Overview › Quotations › New quotation`.
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
    // The items the last submit sent, in order: the server names a refused line by its position.
    const [sentItemIds, setSentItemIds] = useState<readonly string[]>([]);

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

    /*
     * What the server refused, put on the fields it named (BUG-06). A line is refused by its place
     * in what was sent, and either half of it lands on the row's quantity. The page has no issue
     * banner, so the callout stays and carries what the fields cannot.
     */
    const lineTargets: Record<string, ServerFieldTarget> = {};
    sentItemIds.forEach((itemId, index) => {
        const name = items.find((item) => item.id === itemId)?.name ?? '';
        const target = {
            label: t('business:builder.quantityLabel', { name }),
            fieldId: `quotation-line-${itemId}-quantity`,
        };
        lineTargets[`lines.${String(index)}.quantity`] = target;
        lineTargets[`lines.${String(index)}.catalogue_item_id`] = target;
    });
    const server = serverFieldErrors(failure, {
        notes: { label: t('business:builder.note'), fieldId: 'quotation-builder-note' },
        ...lineTargets,
    });
    const serverLineError = (itemId: string): string | undefined => {
        const index = sentItemIds.indexOf(itemId);
        if (index === -1) return undefined;
        return (
            server.errorFor(`lines.${String(index)}.quantity`) ??
            server.errorFor(`lines.${String(index)}.catalogue_item_id`)
        );
    };
    const lines = draftLines(items, quantities);
    const values = draftValues(items, quantities);
    const totals = totalsByCurrency(values);

    const toCatalogue = () => {
        router.push(
            (parsed === null
                ? CORPORATE_HOME_HREF
                : corporateCatalogueHref(String(parsed))) as never,
        );
    };

    if (parsed === null) {
        return (
            <Cascade space="md" testID="quotation-builder-screen">
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
                            size="sm"
                            variant="secondary"
                            label={t('business:builder.home')}
                            onPress={() => {
                                router.push(CORPORATE_HOME_HREF as never);
                            }}
                        />
                    }
                />
            </Cascade>
        );
    }

    if (submitted !== null) {
        return (
            <Cascade space="md" testID="quotation-builder-screen">
                <Callout
                    testID="quotation-builder-success"
                    role="status"
                    tone="success"
                    icon="check"
                    title={t('business:builder.successTitle')}
                    body={t('business:builder.successBody', { reference: submitted.reference })}
                    actions={
                        <Inline space="xs" wrap>
                            <Button
                                testID="quotation-builder-open-list"
                                size="sm"
                                label={t('business:builder.openList')}
                                onPress={() => {
                                    router.push(CORPORATE_QUOTATIONS_HREF as never);
                                }}
                            />
                            <Button
                                testID="quotation-builder-back"
                                size="sm"
                                variant="secondary"
                                label={t('business:builder.back')}
                                onPress={toCatalogue}
                            />
                        </Inline>
                    }
                />
            </Cascade>
        );
    }

    const setQuantity = (itemId: string, text: string) => {
        const trimmed = text.trim();
        if (trimmed === '') {
            setEdits((current) => ({ ...current, [itemId]: null }));
            return;
        }
        const next = Number(trimmed);
        // Whole units only: a part-case is not something an account manager can price.
        if (!Number.isInteger(next) || next < 0) return;
        setEdits((current) => ({ ...current, [itemId]: next }));
    };

    const lineColumns: readonly CatalogueColumn<CatalogueItem>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('business:catalogue.columnItem'),
            width: 220,
            min: 160,
            grow: true,
            priority: 100,
            value: (item) => item.name,
            render: (item) => (
                <Text variant="bodyStrong" numberOfLines={1}>
                    {item.name}
                </Text>
            ),
        },
        {
            key: 'minimum',
            role: 'meta',
            label: t('business:catalogue.columnMinimum'),
            width: 90,
            align: 'end',
            priority: 80,
            value: (item) => formatter.formatNumber(item.minimumOrderQuantity),
        },
        {
            key: 'quantity',
            role: 'metric',
            label: t('business:builder.columnQuantity'),
            width: 130,
            align: 'end',
            priority: 95,
            value: (item) => {
                const quantity = quantities[item.id] ?? null;
                return quantity === null ? '' : formatter.formatNumber(quantity);
            },
            render: (item) => {
                const quantity = quantities[item.id] ?? null;
                const belowMinimum =
                    quantity !== null && quantity > 0 && quantity < item.minimumOrderQuantity;
                const refused = serverLineError(item.id);
                return (
                    <QuantityInput
                        testID={`quotation-line-${item.id}-quantity`}
                        id={`quotation-line-${item.id}-quantity`}
                        label={t('business:builder.quantityLabel', { name: item.name })}
                        labelHidden
                        size="sm"
                        value={quantity === null ? '' : String(quantity)}
                        placeholder="0"
                        onChangeText={(next) => {
                            setQuantity(item.id, next);
                        }}
                        {...(belowMinimum
                            ? {
                                  error: t('business:builder.lineBelowMinimum', {
                                      count: item.minimumOrderQuantity,
                                  }),
                              }
                            : refused === undefined
                              ? {}
                              : { error: refused })}
                    />
                );
            },
        },
        {
            key: 'value',
            role: 'meta',
            label: t('business:builder.columnValue'),
            width: 150,
            align: 'end',
            priority: 90,
            value: (item) => {
                const value = lineValue(item, quantities[item.id] ?? 0);
                return value === null ? '' : formatMoney(formatter, value);
            },
            render: (item) => {
                const quantity = quantities[item.id] ?? null;
                const value = lineValue(item, quantity ?? 0);
                if (value === null) {
                    return (
                        <Text tone="secondary" testID={`quotation-line-${item.id}-no-value`}>
                            {quantity === null || quantity === 0
                                ? '—'
                                : t('business:builder.noTierShort')}
                        </Text>
                    );
                }
                return (
                    <Text variant="mono" testID={contractPriceTestId(`line-${item.id}`)}>
                        {formatMoney(formatter, value)}
                    </Text>
                );
            },
        },
    ];

    const catalogueFailure = toFailure(catalogue.error);

    const submit = () => {
        if (Object.keys(errors).length > 0) {
            setShowErrors(true);
            // The contact fields sit below a long list of lines, so their errors render out of
            // sight and the button looked like it did nothing. Take the reader to the first one;
            // a lines error is the callout at the top, already in view.
            if (errors.lines === undefined) {
                focusField(
                    errors.name === undefined
                        ? 'quotation-builder-contact-email'
                        : 'quotation-builder-contact-name',
                );
            }
            return;
        }
        setSentItemIds(lines.map((line) => line.catalogueItemId));
        request.mutate(
            {
                programmeId: parsed,
                lines,
                contactName: contact.name.trim(),
                contactEmail: contact.email.trim(),
                recurring: contact.recurring,
                ...(contact.note.trim() === '' ? {} : { note: contact.note.trim() }),
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
    };

    return (
        <Cascade space="md" testID="quotation-builder-screen">
            <CataloguePageHeader
                testID="quotation-builder-header"
                titleTestID="quotation-builder-title"
                title={t('business:builder.title')}
                titleAside={
                    <Text tone="secondary" testID="quotation-builder-programme">
                        {programme.data === undefined
                            ? t('business:catalogue.programmeLoading')
                            : programme.data.name}
                    </Text>
                }
                primaryAction={
                    <Inline space="xs" align="center">
                        <Button
                            testID="quotation-builder-back"
                            variant="secondary"
                            label={t('business:builder.cancel')}
                            onPress={toCatalogue}
                        />
                        <Button
                            testID="quotation-builder-submit"
                            label={t('business:builder.submit')}
                            iconStart={<Icon name="send" size="sm" />}
                            loading={request.isPending}
                            onPress={submit}
                        />
                    </Inline>
                }
            />

            {failure === null ? null : (
                <Callout
                    testID="quotation-builder-failure"
                    role="alert"
                    tone="danger"
                    icon="warning"
                    title={t('business:builder.rejectedTitle')}
                    body={server.unplaced ?? failure.message}
                />
            )}

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

            <FormSection
                variant="card"
                first
                testID="quotation-builder-lines-section"
                title={t('business:builder.linesTitle')}
                description={t('business:builder.scopeBody')}
            >
                {catalogue.isPending ? (
                    <TableSkeleton testID="quotation-builder-catalogue-loading" />
                ) : catalogueFailure !== null ? (
                    <ErrorState
                        testID="quotation-builder-catalogue-error"
                        title={t('business:builder.loadErrorTitle')}
                        failure={catalogueFailure}
                        onRetry={() => {
                            void catalogue.refetch();
                        }}
                        retrying={catalogue.isFetching}
                    />
                ) : items.length === 0 ? (
                    <EmptyState
                        testID="quotation-builder-catalogue-empty"
                        title={t('business:builder.emptyTitle')}
                        body={t('business:builder.emptyBody')}
                    />
                ) : (
                    <CatalogueList<CatalogueItem>
                        testID="quotation-builder-lines"
                        label={t('business:builder.linesTitle')}
                        columns={lineColumns}
                        rows={items}
                        rowKey={(item) => item.id}
                        // Rows carry no padding of their own, so a 28px quantity box in a 28px row
                        // touches the boxes above and below it. The 36px row leaves 8px between them.
                        density="lg"
                        rowActionsLabel={t('business:catalogue.rowActions')}
                        rowEntrance={false}
                    />
                )}

                <Inline
                    space="sm"
                    align="center"
                    justify="between"
                    wrap
                    testID="quotation-builder-value"
                >
                    <Inline space="xs" align="center">
                        <Text variant="label">{t('business:builder.valueTitle')}</Text>
                        <InfoTip
                            testID="quotation-builder-value-tip"
                            label={t('business:builder.valueTitle')}
                            text={t('business:builder.valueNote')}
                        />
                        {isMixedCurrency(values) ? (
                            <Text
                                tone="warning"
                                variant="caption"
                                testID="quotation-builder-value-note"
                            >
                                {t('business:builder.valueMixedNote')}
                            </Text>
                        ) : null}
                    </Inline>
                    <Inline space="sm" align="center">
                        {totals.length === 0 ? (
                            <Text testID="quotation-builder-value-none" tone="secondary">
                                {t('business:builder.valueNone')}
                            </Text>
                        ) : (
                            totals.map((total) => (
                                <Text
                                    key={total.currency}
                                    variant="strong"
                                    testID={contractPriceTestId(`draft-total-${total.currency}`)}
                                >
                                    {formatMoney(formatter, total)}
                                </Text>
                            ))
                        )}
                    </Inline>
                </Inline>
            </FormSection>

            <FormSection
                variant="card"
                testID="quotation-builder-contact"
                title={t('business:builder.contactTitle')}
            >
                {/*
                 * The 280px field track, as on every desk editor: three fields to a row from `lg`,
                 * the checkbox under them, and the note across the grid.
                 */}
                <FormGrid testID="quotation-builder-contact-grid">
                    <TextInputField
                        testID="quotation-builder-contact-name"
                        id="quotation-builder-contact-name"
                        size="sm"
                        label={t('business:builder.contactName')}
                        placeholder={t('business:builder.contactNamePlaceholder')}
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
                        size="sm"
                        label={t('business:builder.contactEmail')}
                        placeholder={t('business:builder.contactEmailPlaceholder')}
                        value={contact.email}
                        required
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="email-address"
                        onChangeText={(next: string) => {
                            setContact((current) => ({ ...current, email: next }));
                        }}
                        {...(showErrors && errors.email !== undefined
                            ? { error: errors.email }
                            : {})}
                    />

                    {/* Picked from a month, as every date on the desk is; clearable, since it is optional. */}
                    <DatePickerButton
                        testID="quotation-builder-delivery-date"
                        label={t('business:builder.deliveryDate')}
                        labelVisible
                        placeholder={t('business:builder.deliveryDatePlaceholder')}
                        value={contact.requestedDeliveryDate ?? ''}
                        min={earliestStartDate()}
                        onChange={(next) => {
                            setContact((current) => ({
                                ...current,
                                requestedDeliveryDate: next === '' ? null : next,
                            }));
                        }}
                        onClear={() => {
                            setContact((current) => ({ ...current, requestedDeliveryDate: null }));
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
                        size="sm"
                        fullWidth
                        label={t('business:builder.note')}
                        placeholder={t('business:builder.notePlaceholder')}
                        hint={t('business:builder.noteHint')}
                        {...server.flag('notes')}
                        value={contact.note}
                        multiline
                        onChangeText={(next: string) => {
                            setContact((current) => ({ ...current, note: next }));
                        }}
                    />
                </FormGrid>
            </FormSection>
        </Cascade>
    );
}
