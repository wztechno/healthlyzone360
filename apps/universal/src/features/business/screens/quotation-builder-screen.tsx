import {
    Button,
    Callout,
    Cascade,
    cx,
    DatePickerButton,
    FormSection,
    Heading,
    Icon,
    InfoTip,
    Select,
    Switch,
    Text,
    TextInputField,
    useContentWidth,
    useToast,
} from '@healthy360/design-system';
import type { CatalogueItem, Quotation } from '@healthy360/api-client/contracts';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import {
    toFailure,
    useCorporateCatalogueQuery,
    useCorporateProgrammesQuery,
    useRequestQuotationMutation,
} from '../../../data/business-hooks.ts';
import { useKitchenQuery } from '../../../data/marketplace-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { useUnsavedGuardFor } from '../../../navigation/use-unsaved-guard.ts';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { UnsavedChangesDialog } from '../../../ui/unsaved-changes-dialog.tsx';
import { earliestStartDate } from '../../commerce/dates.ts';
import { CatalogueList } from '../../kitchen-admin/catalogue/catalogue-list.tsx';
import type { CatalogueColumn } from '../../kitchen-admin/catalogue/catalogue-column-spec.ts';
import { CataloguePageHeader } from '../../kitchen-admin/catalogue/catalogue-page-header.tsx';
import { DeskChip } from '../../kitchen-admin/desk-kit/desk-chip.tsx';
import { focusField } from '../../kitchen-admin/field-focus.ts';
import { serverFieldErrors } from '../../kitchen-admin/server-field-errors.ts';
import type { ServerFieldTarget } from '../../kitchen-admin/server-field-errors.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { packText } from '../catalogue-columns.tsx';
import { CORPORATE_HOME_HREF, CORPORATE_QUOTATIONS_HREF } from '../corporate-chrome.tsx';
import { PackStepper, SendChecklist } from '../corporate-parts.tsx';
import type { SendCheck } from '../corporate-parts.tsx';
import { EMPTY_CONTACT, draftLines, draftValues, validateDraft } from '../draft.ts';
import type { DraftContact, DraftQuantities } from '../draft.ts';
import { contractPriceTestId, lineValue, totalsByCurrency } from '../format.ts';

/**
 * `/corporate/quotations/new` — ask for a price. From the corporate canvas's New quotation board
 * (2026-11-10), in the kitchen's editor look:
 *
 * - **The opening:** the title, "Not sent yet" while there is something to lose, the programme and
 *   kitchen under it, and Back to quotations and Send the request.
 * - **Lines:** a picker over the programme's catalogue, then a table — the line, its packs on a
 *   stepper, your rate, what it comes to, and ✕.
 * - **Delivery:** the preferred first delivery and whether it should repeat.
 * - **Who should we reply to?** A name and an email, both required, and a note.
 * - **The aside**, sticky beside the form: this request in a few facts, its indicative value,
 *   *Before you send* — ticked off as the request becomes sendable — and Send again.
 * - **Sent:** the green box with the reference and where the request goes next.
 *
 * Submission is a real mutation: the server files a `submitted` quotation carrying no price,
 * because pricing is the kitchen's act. The value is indicative — the rates agreed so far, per
 * currency, never a quote. The reply contact starts as the signed-in buyer.
 */

export interface QuotationBuilderScreenProps {
    /** The programme to ask under; the first one when absent. */
    readonly programmeId: string | undefined;
    /** Lines to start from, arriving from the catalogue's Ask for a price. */
    readonly initialItemIds?: readonly string[] | undefined;
    /** The packs each of them starts at — the line pop-up's stepper. */
    readonly initialQuantity?: number | undefined;
}

/** The aside's width beside the form, the board's 300px. */
const ASIDE_WIDTH = 300;
/** Below this the aside runs under the form. */
const BESIDE_MIN_WIDTH = 900;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function QuotationBuilderScreen({
    programmeId,
    initialItemIds = [],
    initialQuantity,
}: QuotationBuilderScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const validationTranslate = useValidationTranslate();
    const { me } = useSession();
    const toast = useToast();
    const { width: contentWidth } = useContentWidth();
    const beside = contentWidth >= BESIDE_MIN_WIDTH;

    const programmes = useCorporateProgrammesQuery();
    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);
    const invalid = programmeId !== undefined && programmeId !== '' && parsed === null;
    const programme =
        parsed === null
            ? (programmes.data ?? [])[0]
            : (programmes.data ?? []).find((candidate) => candidate.id === parsed);
    const programmeKey = parsed ?? programme?.id ?? null;
    const kitchen = useKitchenQuery(programme?.kitchenIds[0] ?? null);

    const catalogue = useCorporateCatalogueQuery(
        programmeKey === null ? null : { programmeId: programmeKey },
    );
    const items = useMemo<readonly CatalogueItem[]>(
        () => catalogue.data?.items ?? [],
        [catalogue.data],
    );

    /** Packs by line, and the order the lines were added in — seeded from the catalogue's pick. */
    const [edits, setEdits] = useState<DraftQuantities>({});
    const [added, setAdded] = useState<readonly string[]>([]);
    const seededQuantity = initialQuantity ?? 1;
    const quantities: DraftQuantities = useMemo(() => {
        const resolved: Record<string, number | null> = {};
        for (const item of items) {
            resolved[item.id] =
                item.id in edits
                    ? (edits[item.id] ?? null)
                    : initialItemIds.includes(item.id)
                      ? Math.max(seededQuantity, item.minimumOrderQuantity)
                      : null;
        }
        return resolved;
    }, [edits, initialItemIds, items, seededQuantity]);
    const order = [...initialItemIds, ...added.filter((id) => !initialItemIds.includes(id))];
    const chosen = order
        .map((id) => items.find((item) => item.id === id))
        .filter(
            (item): item is CatalogueItem => item !== undefined && (quantities[item.id] ?? 0) > 0,
        );

    const [contactEdits, setContact] = useState<DraftContact>(EMPTY_CONTACT);
    // Name and email follow the signed-in buyer until edited; the session can arrive after the
    // first render, so they are derived rather than seeded once.
    const [nameEdited, setNameEdited] = useState(false);
    const [emailEdited, setEmailEdited] = useState(false);
    const contact: DraftContact = {
        ...contactEdits,
        name: nameEdited ? contactEdits.name : (me?.user.profile.displayName ?? ''),
        email: emailEdited ? contactEdits.email : (me?.user.email ?? ''),
    };
    const [showErrors, setShowErrors] = useState(false);
    const [submitted, setSubmitted] = useState<Quotation | null>(null);
    // The items the last submit sent, in order: the server names a refused line by its position.
    const [sentItemIds, setSentItemIds] = useState<readonly string[]>([]);

    const dirty =
        submitted === null &&
        (chosen.length > 0 ||
            nameEdited ||
            emailEdited ||
            contactEdits.note.trim() !== '' ||
            contactEdits.requestedDeliveryDate !== null ||
            contactEdits.recurring);
    /* A request with something in it is work to lose: Back, the trail and the browser ask first. */
    const guard = useUnsavedGuardFor(dirty, { message: t('common:unsaved.browserPrompt') });

    const request = useRequestQuotationMutation();
    const failure = toFailure(request.error);
    const errors = validateDraft(items, quantities, contact, validationTranslate);

    /*
     * What the server refused, put on the fields it named (BUG-06). A line is refused by its place
     * in what was sent, and either half of it lands on the row's packs.
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

    const lines = draftLines(chosen, quantities);
    const totals = totalsByCurrency(draftValues(chosen, quantities));
    const packs = chosen.reduce((sum, item) => sum + (quantities[item.id] ?? 0), 0);
    const scheduleText = contact.recurring
        ? t('business:quotations.recurring')
        : t('business:quotations.oneOff');
    const deliveryText =
        contact.requestedDeliveryDate === null
            ? t('business:builder.deliveryNotGiven')
            : formatter.formatDate(`${contact.requestedDeliveryDate}T12:00:00Z`, {
                  dateStyle: 'medium',
              });
    const where = [programme?.name, kitchen.data?.name].filter(
        (part): part is string => part !== undefined && part !== '',
    );

    const toQuotations = () => {
        router.push(CORPORATE_QUOTATIONS_HREF as never);
    };

    if (invalid) {
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
                <CataloguePageHeader
                    titleLook="board"
                    testID="quotation-builder-header"
                    titleTestID="quotation-builder-title"
                    title={t('business:nav.newQuotation')}
                    titleAside={
                        <DeskChip
                            tone="info"
                            size="lg"
                            label={t('business:quotationStates.submitted')}
                        />
                    }
                    primaryAction={
                        <Button
                            testID="quotation-builder-back"
                            variant="secondary"
                            size="sm"
                            label={t('business:builder.backToQuotations')}
                            onPress={toQuotations}
                        />
                    }
                />
                <SentBox
                    reference={submitted.reference}
                    onList={toQuotations}
                    onAnother={() => {
                        setSubmitted(null);
                        setEdits({});
                        setAdded([]);
                        setContact(EMPTY_CONTACT);
                        setNameEdited(false);
                        setEmailEdited(false);
                        setShowErrors(false);
                        router.replace(
                            `/corporate/quotations/new${
                                programmeKey === null ? '' : `?programme=${String(programmeKey)}`
                            }` as never,
                        );
                    }}
                />
            </Cascade>
        );
    }

    const setQuantity = (itemId: string, next: number | null) => {
        setEdits((current) => ({ ...current, [itemId]: next }));
    };
    const addLine = (itemId: string) => {
        const item = items.find((candidate) => candidate.id === itemId);
        if (item === undefined) return;
        setQuantity(itemId, Math.max(1, item.minimumOrderQuantity));
        setAdded((current) => (current.includes(itemId) ? current : [...current, itemId]));
    };

    const submit = () => {
        if (Object.keys(errors).length > 0) {
            setShowErrors(true);
            if (errors.lines === undefined) {
                focusField(
                    errors.name === undefined
                        ? 'quotation-builder-contact-email'
                        : 'quotation-builder-contact-name',
                );
            }
            return;
        }
        if (programmeKey === null) return;
        setSentItemIds(lines.map((line) => line.catalogueItemId));
        request.mutate(
            {
                programmeId: programmeKey,
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
                    toast.show({
                        testID: 'quotation-builder-sent-toast',
                        tone: 'success',
                        message: t('business:builder.sentToast'),
                    });
                },
            },
        );
    };

    const replyOk = contact.name.trim() !== '' && EMAIL.test(contact.email.trim());
    const checks: readonly SendCheck[] = [
        errors.lines === undefined
            ? {
                  key: 'lines',
                  ok: true,
                  label: t('business:quotations.linesTitle'),
                  detail: t('business:builder.checkLines', { count: chosen.length }),
              }
            : { key: 'lines', ok: false, label: t('business:builder.checkNoLines') },
        replyOk
            ? {
                  key: 'reply',
                  ok: true,
                  label: t('business:sheet.replyTo'),
                  detail: contact.name.trim(),
              }
            : { key: 'reply', ok: false, label: t('business:builder.contactTitle') },
        {
            key: 'delivery',
            ok: true,
            label: t('business:quotations.columnDelivery'),
            detail: deliveryText,
        },
    ];

    const sendButton = (testID: string, block: boolean) => (
        <Button
            testID={testID}
            label={t('business:builder.submit')}
            block={block}
            {...(block ? { size: 'lg' as const } : {})}
            loading={request.isPending}
            onPress={submit}
        />
    );

    const lineColumns: readonly CatalogueColumn<CatalogueItem>[] = [
        {
            key: 'name',
            role: 'title',
            label: t('business:sheet.columnLine'),
            width: 240,
            grow: true,
            priority: 100,
            value: (item) => item.name,
            // The board's 30px rounded-square photo, as the catalogue draws it.
            render: (item) => (
                <View className="min-w-0 flex-row items-center gap-2">
                    <View className="h-[30px] w-[30px] shrink-0 overflow-hidden rounded-[9px]">
                        <EntityImage
                            assetId={
                                item.imagePlaceholderId === '' ? undefined : item.imagePlaceholderId
                            }
                            seed={item.id}
                            label={item.name}
                            aspect="square"
                            decorative
                            flush
                        />
                    </View>
                    <Text
                        variant="bodyStrong"
                        numberOfLines={1}
                        className="min-w-0 shrink"
                        testID={`quotation-builder-line-${item.id}`}
                    >
                        {item.name}
                    </Text>
                </View>
            ),
        },
        {
            key: 'quantity',
            role: 'meta',
            label: t('business:builder.columnPacks'),
            width: 140,
            priority: 95,
            value: (item) => String(quantities[item.id] ?? 0),
            render: (item) => (
                <PackStepper
                    testID={`quotation-line-${item.id}-quantity`}
                    label={t('business:builder.quantityLabel', { name: item.name })}
                    value={quantities[item.id] ?? 1}
                    min={Math.max(1, item.minimumOrderQuantity)}
                    onChange={(next) => {
                        setQuantity(item.id, next);
                    }}
                />
            ),
        },
        {
            key: 'rate',
            role: 'meta',
            label: t('business:item.rate'),
            width: 120,
            priority: 80,
            value: (item) =>
                item.contractPrice === null
                    ? t('business:catalogue.unpricedShort')
                    : formatMoney(formatter, item.contractPrice),
            render: (item) => (
                <Text
                    tone="secondary"
                    className="tabular-nums"
                    testID={contractPriceTestId(`line-${item.id}`)}
                >
                    {item.contractPrice === null
                        ? t('business:catalogue.unpricedShort')
                        : formatMoney(formatter, item.contractPrice)}
                </Text>
            ),
        },
        {
            key: 'value',
            role: 'metric',
            label: t('business:builder.columnIndicative'),
            width: 120,
            priority: 85,
            value: (item) => {
                const value = lineValue(item, quantities[item.id] ?? 0);
                return value === null ? '—' : formatMoney(formatter, value);
            },
            render: (item) => {
                const value = lineValue(item, quantities[item.id] ?? 0);
                return (
                    <Text variant="bodyStrong" className="tabular-nums">
                        {value === null ? '—' : formatMoney(formatter, value)}
                    </Text>
                );
            },
        },
        {
            key: 'remove',
            label: t('business:builder.removeColumn'),
            width: 44,
            priority: 99,
            grow: false,
            value: () => '',
            renderHeader: () => null,
            render: (item) => (
                <Pressable
                    testID={`quotation-builder-line-${item.id}-remove`}
                    role="button"
                    accessibilityRole="button"
                    accessibilityLabel={t('business:builder.removeNamed', { name: item.name })}
                    onPress={() => {
                        setQuantity(item.id, null);
                    }}
                    className="h-[30px] w-[30px] items-center justify-center rounded-lg hover:bg-danger-subtle"
                >
                    <Icon name="close" size="sm" className="text-danger-strong" />
                </Pressable>
            ),
        },
    ];

    const form = (
        <View className="z-auto min-w-0 flex-1 flex-col gap-3">
            <FormSection
                first
                variant="panel"
                testID="quotation-builder-lines-section"
                title={t('business:quotations.linesTitle')}
                aside={
                    <DeskChip
                        testID="quotation-builder-count"
                        tone="neutral"
                        label={formatter.formatNumber(chosen.length)}
                    />
                }
            >
                <View className="z-auto flex-col gap-3">
                    <Select
                        trigger="pill"
                        value={null}
                        testID="quotation-builder-picker"
                        label={t('business:builder.pickerLabel')}
                        placeholder={t('business:builder.pickerPlaceholder')}
                        loading={catalogue.isPending}
                        className="w-[320px] max-w-full"
                        options={items.map((item) => ({
                            value: item.id,
                            label: item.name,
                            disabled: chosen.some((line) => line.id === item.id),
                            ...(item.contractPrice === null
                                ? {}
                                : {
                                      description: t('business:catalogue.pricePerPack', {
                                          price: formatMoney(formatter, item.contractPrice),
                                          size: packText(t, formatter, item) ?? '1',
                                      }),
                                  }),
                        }))}
                        onChange={addLine}
                    />
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
                    {chosen.length === 0 ? (
                        <View
                            testID="quotation-builder-request-empty"
                            className="items-center rounded-[14px] border border-dashed border-stroke p-4"
                        >
                            <Text tone="secondary" variant="caption">
                                {t('business:builder.noLines')}
                            </Text>
                        </View>
                    ) : (
                        <CatalogueList<CatalogueItem>
                            testID="quotation-builder-request-lines"
                            label={t('business:quotations.linesTitle')}
                            columns={lineColumns}
                            rows={chosen}
                            rowKey={(item) => item.id}
                            density="sm"
                            rowActionsLabel={t('business:catalogue.rowActions')}
                            rowEntrance={false}
                        />
                    )}
                    {chosen
                        .map((item) => ({
                            item,
                            refused: server.errorFor(
                                `lines.${String(sentItemIds.indexOf(item.id))}.quantity`,
                            ),
                        }))
                        .filter((entry) => entry.refused !== undefined)
                        .map((entry) => (
                            <Text
                                key={entry.item.id}
                                tone="danger"
                                variant="caption"
                                testID={`quotation-line-${entry.item.id}-refused`}
                            >
                                {`${entry.item.name}: ${entry.refused ?? ''}`}
                            </Text>
                        ))}
                </View>
            </FormSection>

            <FormSection
                variant="panel"
                testID="quotation-builder-delivery"
                title={t('business:builder.deliveryTitle')}
            >
                <View className="z-auto flex-col gap-1.5">
                    <View className="z-auto w-full md:w-1/2">
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
                                setContact((current) => ({
                                    ...current,
                                    requestedDeliveryDate: null,
                                }));
                            }}
                        />
                    </View>
                    <View className="flex-row items-center gap-3 py-2.5">
                        <View className="min-w-0 flex-1 flex-row items-center gap-1.5">
                            <Text variant="bodyStrong">{t('business:builder.recurring')}</Text>
                            <InfoTip
                                testID="quotation-builder-recurring-info"
                                label={t('business:builder.recurring')}
                                text={t('business:builder.recurringHint')}
                            />
                        </View>
                        <Switch
                            testID="quotation-builder-recurring"
                            label={t('business:builder.recurring')}
                            labelHidden
                            checked={contact.recurring}
                            onChange={(next) => {
                                setContact((current) => ({ ...current, recurring: next }));
                            }}
                        />
                    </View>
                </View>
            </FormSection>

            <FormSection
                variant="panel"
                testID="quotation-builder-contact"
                title={t('business:builder.contactTitle')}
            >
                <View className="flex-row flex-wrap gap-x-3 gap-y-3.5">
                    <View className="w-full min-w-[220px] md:flex-1">
                        <TextInputField
                            testID="quotation-builder-contact-name"
                            id="quotation-builder-contact-name"
                            size="sm"
                            label={t('business:builder.contactName')}
                            placeholder={t('business:builder.contactNamePlaceholder')}
                            value={contact.name}
                            required
                            onChangeText={(next: string) => {
                                setNameEdited(true);
                                setContact((current) => ({ ...current, name: next }));
                            }}
                            {...(showErrors && errors.name !== undefined
                                ? { error: t('business:builder.errorContactName') }
                                : {})}
                        />
                    </View>
                    <View className="w-full min-w-[220px] md:flex-1">
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
                                setEmailEdited(true);
                                setContact((current) => ({ ...current, email: next }));
                            }}
                            {...(showErrors && errors.email !== undefined
                                ? { error: t('business:builder.errorContactEmail') }
                                : {})}
                        />
                    </View>
                    <View className="w-full">
                        <TextInputField
                            testID="quotation-builder-note"
                            id="quotation-builder-note"
                            size="sm"
                            label={t('business:builder.note')}
                            placeholder={t('business:builder.notePlaceholder')}
                            {...server.flag('notes')}
                            value={contact.note}
                            multiline
                            onChangeText={(next: string) => {
                                setContact((current) => ({ ...current, note: next }));
                            }}
                        />
                    </View>
                </View>
            </FormSection>

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
        </View>
    );

    const aside = (
        <View
            testID="quotation-builder-panel"
            role="complementary"
            aria-label={t('business:builder.asideTitle')}
            style={beside ? { width: ASIDE_WIDTH } : undefined}
            className="z-auto self-start web:sticky web:top-0"
        >
            <FormSection first variant="panel" title={t('business:builder.asideTitle')}>
                <View className="flex-col">
                    <Fact
                        label={t('business:quotations.columnProgramme')}
                        value={programme?.name ?? '—'}
                    />
                    <Fact
                        label={t('business:quotations.linesTitle')}
                        value={formatter.formatNumber(chosen.length)}
                    />
                    <Fact
                        label={t('business:builder.packs')}
                        value={formatter.formatNumber(packs)}
                    />
                    <Fact label={t('business:quotations.columnSchedule')} value={scheduleText} />
                    <View className="mt-2 flex-row items-baseline justify-between gap-2.5 border-t border-stroke-subtle pt-2.5">
                        <Text variant="caption" className="font-semibold">
                            {t('business:builder.valueTitle')}
                        </Text>
                        <View className="items-end">
                            {totals.length === 0 ? (
                                <Text testID="quotation-builder-value-none" tone="secondary">
                                    —
                                </Text>
                            ) : (
                                totals.map((total) => (
                                    <Text
                                        key={total.currency}
                                        className="font-display text-xl font-bold tabular-nums"
                                        testID={contractPriceTestId(
                                            `draft-total-${total.currency}`,
                                        )}
                                    >
                                        {formatMoney(formatter, total)}
                                    </Text>
                                ))
                            )}
                        </View>
                    </View>
                    <SendChecklist testID="quotation-builder-checks" checks={checks} />
                    <View className="mt-3">{sendButton('quotation-builder-submit', true)}</View>
                </View>
            </FormSection>
        </View>
    );

    return (
        <Cascade space="md" testID="quotation-builder-screen">
            <View className="flex-col gap-1">
                <CataloguePageHeader
                    titleLook="board"
                    testID="quotation-builder-header"
                    titleTestID="quotation-builder-title"
                    title={t('business:nav.newQuotation')}
                    titleAside={
                        dirty ? (
                            <View
                                testID="quotation-builder-dirty"
                                className="h-[26px] flex-row items-center gap-1.5 rounded-full bg-warning-subtle px-2.5"
                            >
                                <View
                                    aria-hidden
                                    className="h-2 w-2 rounded-full bg-warning-strong"
                                />
                                <Text
                                    variant="caption"
                                    className="font-bold text-warning-on-subtle"
                                >
                                    {t('business:builder.notSent')}
                                </Text>
                            </View>
                        ) : undefined
                    }
                    primaryAction={
                        <View className="flex-row flex-wrap items-center justify-end gap-2">
                            <Button
                                testID="quotation-builder-cancel"
                                variant="secondary"
                                size="sm"
                                label={t('business:builder.backToQuotations')}
                                onPress={() => {
                                    guard.intercept(toQuotations);
                                }}
                            />
                            {sendButton('quotation-builder-send', false)}
                        </View>
                    }
                />
                {where.length === 0 ? null : (
                    <Text tone="secondary" variant="caption" testID="quotation-builder-programme">
                        {where.join(' · ')}
                    </Text>
                )}
            </View>

            <View className={cx('z-auto gap-4', beside ? 'flex-row items-start' : 'flex-col')}>
                {form}
                {aside}
            </View>
            <UnsavedChangesDialog guard={guard} testID="quotation-builder-unsaved" />
        </Cascade>
    );
}

function Fact({ label, value }: { readonly label: string; readonly value: string }) {
    return (
        <View className="flex-row justify-between gap-2.5 py-1">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Text variant="caption" className="font-semibold tabular-nums">
                {value}
            </Text>
        </View>
    );
}

/**
 * `.sentbox` — the request is filed (the New quotation board's Request sent state, as redrawn):
 * centred on the page, a large brand tick in a soft ring, the title, the reference, the road the
 * request takes from here, and the two ways on.
 */
export function SentBox({
    reference,
    onList,
    onAnother,
}: {
    readonly reference: string;
    readonly onList: () => void;
    readonly onAnother: () => void;
}) {
    const { t } = useTranslation();
    const steps = [
        { key: 'sent', label: t('business:builder.journeySent'), tone: 'done' },
        { key: 'manager', label: t('business:quotationStates.submitted'), tone: 'now' },
        { key: 'priced', label: t('business:sheet.stepPriced'), tone: 'next' },
        { key: 'accept', label: t('business:builder.journeyAccept'), tone: 'next' },
        { key: 'order', label: t('business:builder.journeyOrder'), tone: 'next' },
    ] as const;
    return (
        <View
            testID="quotation-builder-success"
            aria-live="polite"
            className="mx-auto mt-[72px] w-full max-w-[640px] flex-col items-center"
        >
            <View
                aria-hidden
                className="h-[108px] w-[108px] items-center justify-center rounded-full bg-surface-brand-subtle"
            >
                <View className="h-[88px] w-[88px] items-center justify-center rounded-full bg-surface-brand shadow-elevation-brand-glow">
                    <Icon name="check" size="lg" className="text-content-on-brand" />
                </View>
            </View>
            <Heading level={2} align="center" className="mt-7 !text-[30px] !leading-9">
                {t('business:builder.successTitle')}
            </Heading>
            <View className="mt-2.5 h-8 flex-row items-center rounded-full bg-surface-sunken px-3">
                <RNText
                    testID="quotation-builder-reference"
                    className="text-sm font-bold tabular-nums text-content-secondary"
                >
                    {reference}
                </RNText>
            </View>
            <View className="mt-[22px] flex-row flex-wrap justify-center gap-1.5">
                {steps.map((step) => (
                    <View
                        key={step.key}
                        className={cx(
                            'h-[30px] flex-row items-center rounded-full px-3',
                            step.tone === 'done'
                                ? 'bg-surface-brand-subtle'
                                : step.tone === 'now'
                                  ? 'bg-warning-subtle'
                                  : 'bg-surface-sunken',
                        )}
                    >
                        <RNText
                            className={cx(
                                'text-xs font-semibold',
                                step.tone === 'done'
                                    ? 'text-content-on-brand-subtle'
                                    : step.tone === 'now'
                                      ? 'text-warning-on-subtle'
                                      : 'text-content-secondary',
                            )}
                        >
                            {step.label}
                        </RNText>
                    </View>
                ))}
            </View>
            <View className="mt-6 flex-row flex-wrap justify-center gap-2">
                <Button
                    testID="quotation-builder-open-list"
                    variant="secondary"
                    size="sm"
                    label={t('business:builder.openList')}
                    onPress={onList}
                />
                <Button
                    testID="quotation-builder-another"
                    size="sm"
                    label={t('business:builder.another')}
                    onPress={onAnother}
                />
            </View>
        </View>
    );
}
