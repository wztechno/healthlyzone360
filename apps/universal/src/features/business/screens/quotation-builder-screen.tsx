import {
    Badge,
    Button,
    Callout,
    Cascade,
    Checkbox,
    DatePickerButton,
    EmptyState,
    ErrorState,
    FormSection,
    Icon,
    IconButton,
    InfoTip,
    Inline,
    QuantityInput,
    Skeleton,
    Text,
    TextInputField,
} from '@healthy360/design-system';
import type { CatalogueItem, Quotation } from '@healthy360/api-client/contracts';
import { CorporateProgrammeId } from '@healthy360/domain-types';
import { useFormatter } from '@healthy360/i18n';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import {
    toFailure,
    useCorporateCatalogueQuery,
    useCorporateProgrammeQuery,
    useRequestQuotationMutation,
} from '../../../data/business-hooks.ts';
import { EntityImage } from '../../../media/entity-image.tsx';
import { useValidationTranslate } from '../../../screens/form-helpers.ts';
import { useSession } from '../../../session/session-provider.tsx';
import { earliestStartDate } from '../../commerce/dates.ts';
import { useCataloguePort } from '../../kitchen-admin/catalogue/catalogue-nav.tsx';
import { CataloguePageHeader } from '../../kitchen-admin/catalogue/catalogue-page-header.tsx';
import { CatalogueToolbar } from '../../kitchen-admin/catalogue/catalogue-toolbar.tsx';
import { focusField } from '../../kitchen-admin/field-focus.ts';
import { serverFieldErrors } from '../../kitchen-admin/server-field-errors.ts';
import type { ServerFieldTarget } from '../../kitchen-admin/server-field-errors.ts';
import { formatMoney, formatPackSize } from '../../marketplace/format.ts';
import {
    CORPORATE_HOME_HREF,
    CORPORATE_QUOTATIONS_HREF,
    corporateCatalogueHref,
} from '../corporate-chrome.tsx';
import { EMPTY_CONTACT, draftLines, draftValues, validateDraft } from '../draft.ts';
import type { DraftContact, DraftQuantities } from '../draft.ts';
import { contractPriceTestId, isMixedCurrency, lineValue, totalsByCurrency } from '../format.ts';

/**
 * `/corporate/quotations/new` — compose a quotation by picking from the programme's menu.
 *
 * Drawn as the kitchen's order desk draws a sale (`kitchen-admin/screens/order-desk-sale-screen.tsx`):
 * the menu as photographed tiles on the leading side, and the request beside it as a sticky panel —
 * the lines with a stepper each, the indicative value, the delivery and the reply details, and Send
 * at its foot. Below the width where two tiles still fit beside the panel, the panel drops under the
 * menu. A tile's Add puts the item on the request at its minimum order, so the request is never
 * opened already invalid; stepping a line below that minimum takes it off again.
 *
 * Submission is a real mutation: the server files a `submitted` quotation carrying no price, because
 * pricing is the kitchen's act. The indicative value is per currency and labelled indicative — the
 * rates agreed so far, never a quote.
 *
 * The reply contact starts as the signed-in buyer, since they are who the kitchen answers nine times
 * in ten; both fields stay editable.
 */

export interface QuotationBuilderScreenProps {
    readonly programmeId: string | undefined;
    /** A line to start from, arriving from the catalogue's "request a quotation" control. */
    readonly initialItemId?: string | undefined;
}

/** The request panel's narrowest width beside the menu. */
const PANEL_MIN_WIDTH = 360;
/** A tile beside the panel: a 4:3 photograph over two lines of name and the price. */
const TILE_WIDTH = 188;
/** Under the panel the tiles stretch to fill the row, never below this. */
const TILE_MIN_WIDTH = 156;
const TILE_GAP = 12;
const BODY_GAP = 16;
const THUMB_SIZE = 44;

type KindFilter = 'all' | CatalogueItem['kind'];

const KIND_ORDER: readonly CatalogueItem['kind'][] = ['meal', 'bulk_package', 'meal_plan'];

export function QuotationBuilderScreen({
    programmeId,
    initialItemId,
}: QuotationBuilderScreenProps) {
    const { t } = useTranslation();
    const router = useRouter();
    const formatter = useFormatter();
    const validationTranslate = useValidationTranslate();
    const { me } = useSession();
    const port = useCataloguePort();

    const parsed = programmeId === undefined ? null : CorporateProgrammeId.safeParse(programmeId);

    const programme = useCorporateProgrammeQuery(parsed);
    const catalogue = useCorporateCatalogueQuery(parsed === null ? null : { programmeId: parsed });
    /**
     * Memoised so the draft below has a stable dependency: `data?.items ?? []` is a fresh array
     * literal on every render while the page is still loading.
     */
    const items = useMemo<readonly CatalogueItem[]>(
        () => catalogue.data?.items ?? [],
        [catalogue.data],
    );

    const [edits, setEdits] = useState<DraftQuantities>({});
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
    const [query, setQuery] = useState('');
    // The items the last submit sent, in order: the server names a refused line by its position.
    const [sentItemIds, setSentItemIds] = useState<readonly string[]>([]);
    const [kind, setKind] = useState<KindFilter>('all');

    const request = useRequestQuotationMutation();
    const failure = toFailure(request.error);

    /**
     * The draft, with the catalogue's chosen line seeded at its minimum order quantity. Derived
     * rather than copied into state on arrival, and `id in edits` rather than `??` so a seeded line
     * the buyer removes stays removed.
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
    const chosen = items.filter((item) => (quantities[item.id] ?? 0) > 0);

    const kinds = KIND_ORDER.filter((candidate) => items.some((item) => item.kind === candidate));
    const needle = query.trim().toLocaleLowerCase();
    const shown = items.filter(
        (item) =>
            (kind === 'all' || item.kind === kind) &&
            (needle === '' || item.name.toLocaleLowerCase().includes(needle)),
    );

    /*
     * Beside or under, as the desk decides it: the panel sits beside the menu wherever two tiles
     * still fit next to it, and the menu then takes whole tiles only, so its toolbar is the tiles'
     * width and the panel takes the rest.
     */
    const bodyWidth = port.width;
    const besideColumns = Math.floor(
        (bodyWidth - BODY_GAP - PANEL_MIN_WIDTH + TILE_GAP) / (TILE_WIDTH + TILE_GAP),
    );
    const beside = besideColumns >= 2;
    const stackedColumns = Math.max(
        1,
        Math.floor((bodyWidth + TILE_GAP) / (TILE_MIN_WIDTH + TILE_GAP)),
    );
    const tileWidth = beside
        ? TILE_WIDTH
        : bodyWidth === 0
          ? TILE_MIN_WIDTH
          : (bodyWidth - TILE_GAP * (stackedColumns - 1)) / stackedColumns;
    const menuWidth = beside ? besideColumns * TILE_WIDTH + (besideColumns - 1) * TILE_GAP : null;

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

    const setQuantity = (itemId: string, next: number | null) => {
        setEdits((current) => ({ ...current, [itemId]: next }));
    };

    /** Add puts an item on at its minimum; a step below the minimum takes it off again. */
    const step = (item: CatalogueItem, delta: 1 | -1) => {
        // Read inside the updater, so two quick presses step twice rather than once.
        setEdits((current) => {
            const now =
                item.id in current
                    ? (current[item.id] ?? 0)
                    : item.id === initialItemId
                      ? item.minimumOrderQuantity
                      : 0;
            const next =
                delta === 1
                    ? now === 0
                        ? item.minimumOrderQuantity
                        : now + 1
                    : now - 1 < item.minimumOrderQuantity
                      ? null
                      : now - 1;
            return { ...current, [item.id]: next };
        });
    };

    /** A typed quantity lands once it is a whole number above zero; 0 takes the line off. */
    const typeQuantity = (itemId: string, next: number) => {
        // Whole units only: a part-case is not something an account manager can price.
        if (!Number.isInteger(next) || next < 0) return;
        setQuantity(itemId, next === 0 ? null : next);
    };

    const priceText = (item: CatalogueItem): string | null => {
        if (item.contractPrice === null) return null;
        const price = formatMoney(formatter, item.contractPrice);
        return item.pack === null
            ? t('business:builder.priceEach', { price })
            : t('business:catalogue.pricePerPack', {
                  price,
                  size: formatPackSize(t, formatter, item.pack),
              });
    };

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

    const menu = (
        <View
            testID="quotation-builder-menu"
            className="z-auto min-w-0 flex-col gap-snug"
            style={menuWidth === null ? { alignSelf: 'stretch' } : { width: menuWidth }}
        >
            <CatalogueToolbar<KindFilter>
                testID="quotation-builder-toolbar"
                search={query}
                onSearchChange={setQuery}
                searchLabel={t('business:catalogue.searchLabel')}
                searchPlaceholder={t('business:catalogue.searchPlaceholder')}
                statusLabel={t('business:catalogue.kindLabel')}
                statusSegments={[
                    { value: 'all', label: t('business:catalogue.kindAll') },
                    ...kinds.map((candidate) => ({
                        value: candidate,
                        label: t(`business:builder.kindPlural.${candidate}`),
                    })),
                ]}
                status={kind}
                onStatusChange={setKind}
            />

            {catalogue.isPending ? (
                <Skeleton testID="quotation-builder-catalogue-loading" heightClassName="h-48" />
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
            ) : shown.length === 0 ? (
                <EmptyState
                    testID="quotation-builder-search-empty"
                    title={t('business:builder.searchEmptyTitle')}
                    body={t('business:builder.searchEmptyBody')}
                    actions={
                        <Button
                            testID="quotation-builder-search-clear"
                            size="sm"
                            variant="secondary"
                            label={t('business:builder.searchClear')}
                            onPress={() => {
                                setQuery('');
                                setKind('all');
                            }}
                        />
                    }
                />
            ) : (
                <View testID="quotation-builder-tiles" className="flex-row flex-wrap gap-snug">
                    {shown.map((item) => (
                        <MenuTile
                            key={item.id}
                            item={item}
                            width={tileWidth}
                            price={priceText(item)}
                            quantity={quantities[item.id] ?? 0}
                            onStep={(delta) => {
                                step(item, delta);
                            }}
                        />
                    ))}
                </View>
            )}
        </View>
    );

    const panel = (
        <View
            testID="quotation-builder-panel"
            role="complementary"
            aria-label={t('business:builder.requestTitle')}
            style={beside ? { minWidth: PANEL_MIN_WIDTH } : undefined}
            className={
                beside
                    ? 'z-auto min-w-0 flex-1 self-start web:sticky web:top-0'
                    : 'z-auto self-stretch'
            }
        >
            <FormSection
                variant="card"
                first
                testID="quotation-builder-lines-section"
                title={t('business:builder.requestTitle')}
                description={t('business:builder.scopeBody')}
                aside={
                    <Text variant="caption" tone="secondary" testID="quotation-builder-count">
                        {t('business:builder.lineCount', { count: chosen.length })}
                    </Text>
                }
            >
                <View className="flex-col gap-base">
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
                            className="flex-col items-center gap-tight rounded border border-dashed border-stroke px-base py-base"
                        >
                            <Icon
                                name="shoppingBasket"
                                size="lg"
                                className="text-content-secondary"
                            />
                            <Text variant="body" tone="secondary" align="center">
                                {t('business:builder.requestEmpty')}
                            </Text>
                        </View>
                    ) : (
                        <View testID="quotation-builder-request-lines" className="flex-col">
                            {chosen.map((item) => (
                                <RequestLine
                                    key={item.id}
                                    item={item}
                                    quantity={quantities[item.id] ?? 0}
                                    onStep={(delta) => {
                                        step(item, delta);
                                    }}
                                    onType={(next) => {
                                        typeQuantity(item.id, next);
                                    }}
                                    onRemove={() => {
                                        setQuantity(item.id, null);
                                    }}
                                    refused={serverLineError(item.id)}
                                />
                            ))}
                        </View>
                    )}

                    <View
                        testID="quotation-builder-value"
                        className="flex-col gap-hair rounded bg-surface-sunken px-tight py-tight"
                    >
                        <View className="flex-row items-center justify-between gap-tight">
                            <Inline space="xs" align="center">
                                <Text variant="label">{t('business:builder.valueTitle')}</Text>
                                <InfoTip
                                    testID="quotation-builder-value-tip"
                                    label={t('business:builder.valueTitle')}
                                    text={t('business:builder.valueNote')}
                                />
                            </Inline>
                            <View className="flex-col items-end">
                                {totals.length === 0 ? (
                                    <Text testID="quotation-builder-value-none" tone="secondary">
                                        {t('business:builder.valueNone')}
                                    </Text>
                                ) : (
                                    totals.map((total) => (
                                        <Text
                                            key={total.currency}
                                            variant="section"
                                            className="tabular-nums"
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
                        {isMixedCurrency(values) ? (
                            <Text
                                tone="warning"
                                variant="caption"
                                testID="quotation-builder-value-note"
                            >
                                {t('business:builder.valueMixedNote')}
                            </Text>
                        ) : null}
                    </View>

                    <View testID="quotation-builder-delivery" className="z-auto flex-col gap-tight">
                        <Text variant="label">{t('business:builder.deliveryTitle')}</Text>
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
                                setContact((current) => ({
                                    ...current,
                                    requestedDeliveryDate: null,
                                }));
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
                    </View>

                    <View testID="quotation-builder-contact" className="flex-col gap-tight">
                        <Text variant="label">{t('business:builder.contactTitle')}</Text>
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
                                ? { error: errors.name }
                                : {})}
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
                                setEmailEdited(true);
                                setContact((current) => ({ ...current, email: next }));
                            }}
                            {...(showErrors && errors.email !== undefined
                                ? { error: errors.email }
                                : {})}
                        />
                        <TextInputField
                            testID="quotation-builder-note"
                            id="quotation-builder-note"
                            size="sm"
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
                    </View>

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

                    <View className="flex-col gap-hair">
                        <Button
                            testID="quotation-builder-submit"
                            block
                            label={t('business:builder.submit')}
                            iconStart={<Icon name="send" size="sm" />}
                            loading={request.isPending}
                            onPress={submit}
                        />
                        <Text variant="caption" tone="secondary" align="center">
                            {t('business:builder.submitHint')}
                        </Text>
                    </View>
                </View>
            </FormSection>
        </View>
    );

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
                    <Button
                        testID="quotation-builder-cancel"
                        variant="secondary"
                        label={t('business:builder.cancel')}
                        onPress={toCatalogue}
                    />
                }
            />

            <View
                // Both measurement paths, each inert on the other's platform — as the desk's sale.
                ref={Platform.OS === 'web' ? port.ref : undefined}
                onLayout={Platform.OS === 'web' ? undefined : port.onLayout}
                className={
                    beside ? 'z-auto flex-row items-start gap-base' : 'z-auto flex-col gap-base'
                }
            >
                {menu}
                {panel}
            </View>
        </Cascade>
    );
}

/* ------------------------------------------------------------------------------------------------
 * The menu tile
 * ---------------------------------------------------------------------------------------------- */

/**
 * One item on the menu: its photograph, its name over its agreed price and minimum, and Add — which
 * becomes a stepper once the item is on the request, with the tile outlined in the brand colour.
 */
function MenuTile({
    item,
    width,
    price,
    quantity,
    onStep,
}: {
    readonly item: CatalogueItem;
    readonly width: number;
    readonly price: string | null;
    readonly quantity: number;
    readonly onStep: (delta: 1 | -1) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    const selected = quantity > 0;

    return (
        <View
            testID={`quotation-builder-tile-${item.id}`}
            role="group"
            aria-label={item.name}
            style={{ width }}
            className={
                selected
                    ? 'relative flex-col overflow-hidden rounded border border-surface-brand bg-surface-raised shadow-elevation-card'
                    : 'relative flex-col overflow-hidden rounded border border-stroke-subtle bg-surface-raised shadow-elevation-card web:hover:border-stroke'
            }
        >
            <EntityImage
                testID={`quotation-builder-tile-${item.id}-image`}
                assetId={item.imagePlaceholderId}
                seed={item.id}
                label={item.name}
                aspect="card"
                decorative
                flush
            />
            {selected ? (
                <View className="absolute end-1.5 top-1.5" aria-hidden>
                    <Badge
                        testID={`quotation-builder-tile-${item.id}-count`}
                        tone="brand"
                        icon={null}
                        label={formatter.formatNumber(quantity)}
                    />
                </View>
            ) : null}
            <View className="flex-1 flex-col gap-hair px-tight pt-tight">
                <Text variant="strong" numberOfLines={2}>
                    {item.name}
                </Text>
                <Text variant="mono" tone={price === null ? 'secondary' : 'brand'}>
                    {price ?? t('business:catalogue.unpricedShort')}
                </Text>
                {item.minimumOrderQuantity > 1 ? (
                    <Text variant="caption" tone="secondary">
                        {t('business:builder.minimumShort', {
                            count: item.minimumOrderQuantity,
                        })}
                    </Text>
                ) : null}
            </View>
            <View className="px-tight pb-tight pt-tight">
                {selected ? (
                    <Stepper
                        testIDPrefix={`quotation-builder-tile-${item.id}`}
                        name={item.name}
                        quantity={quantity}
                        onStep={onStep}
                    />
                ) : (
                    <Button
                        testID={`quotation-builder-tile-${item.id}-add`}
                        size="sm"
                        variant="secondary"
                        block
                        label={t('business:builder.add')}
                        accessibilityLabel={t('business:builder.addNamed', { name: item.name })}
                        iconStart={<Icon name="plus" size="sm" />}
                        onPress={() => {
                            onStep(1);
                        }}
                    />
                )}
            </View>
        </View>
    );
}

/** − count +, the desk ticket's stepper, centred in a tile's footer. */
function Stepper({
    testIDPrefix,
    name,
    quantity,
    onStep,
}: {
    readonly testIDPrefix: string;
    readonly name: string;
    readonly quantity: number;
    readonly onStep: (delta: 1 | -1) => void;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    return (
        <View className="flex-row items-center justify-between gap-hair">
            <IconButton
                testID={`${testIDPrefix}-decrement`}
                icon={<Icon name="minus" size="sm" />}
                variant="secondary"
                size="sm"
                label={t('designSystem:numberStepper.decrease', { label: name })}
                onPress={() => {
                    onStep(-1);
                }}
            />
            <Text
                variant="mono"
                align="center"
                aria-live="polite"
                testID={`${testIDPrefix}-quantity`}
            >
                {formatter.formatNumber(quantity)}
            </Text>
            <IconButton
                testID={`${testIDPrefix}-increment`}
                icon={<Icon name="plus" size="sm" />}
                variant="secondary"
                size="sm"
                label={t('designSystem:numberStepper.increase', { label: name })}
                onPress={() => {
                    onStep(1);
                }}
            />
        </View>
    );
}

/* ------------------------------------------------------------------------------------------------
 * A line on the request
 * ---------------------------------------------------------------------------------------------- */

/**
 * A chosen item: its thumbnail and name, the quantity as a stepper around a typed field — a buyer
 * asking for 240 trays types it rather than pressing + 239 times — the line's indicative value and
 * a remove control.
 */
function RequestLine({
    item,
    quantity,
    onStep,
    onType,
    onRemove,
    refused,
}: {
    readonly item: CatalogueItem;
    readonly quantity: number;
    readonly onStep: (delta: 1 | -1) => void;
    readonly onType: (quantity: number) => void;
    readonly onRemove: () => void;
    /** The server's refusal of this line, when the last submit was refused for it. */
    readonly refused?: string | undefined;
}) {
    const { t } = useTranslation();
    const formatter = useFormatter();
    /*
     * The text while the field is being typed in. Held here rather than written straight through,
     * so clearing the field to type a new number does not take the line off under the caret; the
     * line follows each whole number typed, and blur puts the field back to the line's quantity.
     */
    const [draft, setDraft] = useState<string | null>(null);
    const value = lineValue(item, quantity);
    const belowMinimum = quantity > 0 && quantity < item.minimumOrderQuantity;

    return (
        <View
            testID={`quotation-builder-line-${item.id}`}
            role="group"
            aria-label={item.name}
            className="flex-col gap-hair border-b border-stroke-subtle py-tight"
        >
            <View className="flex-row items-center gap-tight">
                <View style={{ width: THUMB_SIZE }} className="overflow-hidden rounded-sm">
                    <EntityImage
                        assetId={item.imagePlaceholderId}
                        seed={item.id}
                        label={item.name}
                        aspect="square"
                        decorative
                        flush
                    />
                </View>
                <View className="min-w-0 flex-1 flex-col">
                    <Text variant="label" numberOfLines={2}>
                        {item.name}
                    </Text>
                    {value === null ? (
                        <Text
                            variant="caption"
                            tone="secondary"
                            testID={`quotation-line-${item.id}-no-value`}
                        >
                            {t('business:builder.noTierShort')}
                        </Text>
                    ) : (
                        <Text
                            variant="caption"
                            tone="secondary"
                            className="tabular-nums"
                            testID={contractPriceTestId(`line-${item.id}`)}
                        >
                            {formatMoney(formatter, value)}
                        </Text>
                    )}
                </View>
                <IconButton
                    testID={`quotation-builder-line-${item.id}-remove`}
                    icon={<Icon name="close" size="sm" />}
                    variant="ghost"
                    size="sm"
                    label={t('business:builder.removeNamed', { name: item.name })}
                    onPress={onRemove}
                />
            </View>
            <View className="flex-row items-center gap-hair">
                <IconButton
                    testID={`quotation-builder-line-${item.id}-decrement`}
                    icon={<Icon name="minus" size="sm" />}
                    variant="secondary"
                    size="sm"
                    label={t('designSystem:numberStepper.decrease', { label: item.name })}
                    onPress={() => {
                        onStep(-1);
                    }}
                />
                <View style={{ width: 88 }}>
                    <QuantityInput
                        testID={`quotation-line-${item.id}-quantity`}
                        id={`quotation-line-${item.id}-quantity`}
                        label={t('business:builder.quantityLabel', { name: item.name })}
                        labelHidden
                        size="sm"
                        value={draft ?? String(quantity)}
                        onChangeText={(text) => {
                            setDraft(text);
                            const trimmed = text.trim();
                            if (trimmed !== '' && /^\d+$/.test(trimmed)) onType(Number(trimmed));
                        }}
                        onCommit={() => {
                            setDraft(null);
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
                </View>
                <IconButton
                    testID={`quotation-builder-line-${item.id}-increment`}
                    icon={<Icon name="plus" size="sm" />}
                    variant="secondary"
                    size="sm"
                    label={t('designSystem:numberStepper.increase', { label: item.name })}
                    onPress={() => {
                        onStep(1);
                    }}
                />
            </View>
        </View>
    );
}
