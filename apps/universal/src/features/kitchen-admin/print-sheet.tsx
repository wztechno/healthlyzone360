import type {
    PurchaseOrder,
    PurchaseOrderLine,
    RecipientSnapshotContact,
} from '@healthy360/api-client/contracts';
import { Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useFormatter, useLocale } from '@healthy360/i18n';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Platform, View } from 'react-native';

import { prefersArabic } from './format.ts';
import { printSheetTestId, purchaseOrderStatusKey } from './ops-format.ts';

/**
 * The printed purchase order, and the control that puts it on paper (SUP7, §7).
 *
 * ## This module is the server-PDF swap seam
 *
 * §10 defers server-generated PDFs to a later phase, and this file is where that phase lands.
 * `usePrintSheet()` publishes a *capability* — "can this device produce a document?" — rather than a
 * function called `print`, so the day a `POST /procurement/purchase-orders/print` endpoint exists,
 * the hook gains a third mode and starts returning a downloader while every caller keeps its
 * existing shape: a toolbar asks the hook what it can do and renders accordingly. Nothing else in
 * the workspace touches `window.print` — the grep for it returns this file and the print CSS block,
 * which is what makes the swap a one-file change rather than an audit.
 *
 * `PrintSheet` is deliberately ignorant of *why* it is being rendered. It takes one order and lays
 * it out; the screen decides how many of them there are and what surrounds them. A server renderer
 * would keep the same component and the same markup — only the transport changes.
 *
 * ## Why `mode` is decided by `Platform.OS` alone
 *
 * Not by `typeof window`, and the difference is load-bearing. The web app is statically exported
 * and hydrated, so any value that differs between the Node render and the browser render produces a
 * hydration mismatch — React #418, which strands the page un-hydrated (the same trap documented on
 * `Heading`'s display face). `Platform.OS` is a build-time constant per bundle and is `'web'` in
 * both halves of a web render, so the toolbar it decides is the same on the server and in the
 * browser. The `window` check lives inside `print()`, where it runs on a real click and can never
 * be part of a rendered tree.
 *
 * ## Nothing here ever prints on mount
 *
 * §7 is explicit: the browser's print dialog is opened by a person pressing a button. A dialog that
 * appears by itself when a route loads is one a person dismisses without reading, and the route is
 * reachable by back button, by refresh and by a pasted link.
 *
 * ## The sheet carries no money, and cannot
 *
 * There is no price, amount, currency or total anywhere on a purchase order's wire shape — not on
 * the order, not on a line, not inside the recipient snapshot — so this component has nothing to
 * render even if somebody asked it to. That is the point of §3.5's structural boundary rather than
 * a rule this file remembers to follow.
 */

/* ── the capability ──────────────────────────────────────────────────────────────────────────── */

export type PrintSheetMode = 'browser' | 'unavailable';

export interface PrintSheetControl {
    /**
     * `browser` when this device can produce a document, `unavailable` otherwise.
     *
     * A caller renders the print control **only** under `browser`. §7: on iOS and Android, render
     * the preview and explain where printing lives — never a button that does nothing.
     */
    readonly mode: PrintSheetMode;
    /** Opens the browser's print/save-PDF dialog. A no-op under `unavailable`. */
    readonly print: () => void;
}

export function usePrintSheet(): PrintSheetControl {
    const print = useCallback(() => {
        // Guarded at call time rather than at render time — see the hydration note above. The
        // second half of the guard is not paranoia: a web bundle also runs under jsdom and under
        // the static exporter, and neither is guaranteed to publish `print`.
        if (Platform.OS !== 'web') return;
        if (typeof window === 'undefined' || typeof window.print !== 'function') return;
        window.print();
    }, []);

    return { mode: Platform.OS === 'web' ? 'browser' : 'unavailable', print };
}

/* ── the document ────────────────────────────────────────────────────────────────────────────── */

export interface PrintSheetProps {
    readonly order: PurchaseOrder;
}

/** The proportions of the item grid. One place, so the header row and the body rows cannot drift. */
const COLUMN_FLEX = {
    index: 0.5,
    item: 3,
    quantity: 1.4,
    ref: 1.2,
    notes: 2.4,
} as const;

/**
 * One purchase order, laid out as the sheet a supplier receives.
 *
 * ## The item grid is hand-built, and that is deliberate
 *
 * The design system's `Table` is responsive: below the tablet breakpoint it abandons rows and
 * renders one card per record. That is right for a screen somebody scrolls and wrong for a page
 * somebody prints — a printed A4 page is never a phone, but the component decides by *viewport*,
 * so a person printing from a narrow window would get a stack of cards where the supplier expects
 * a column of quantities. The grid below is five flex cells and a bottom rule: it renders the same
 * shape at every width, which is the only property that matters here.
 *
 * It keeps real table semantics (`role="table"`/`row`/`columnheader`/`cell`) so the on-screen
 * preview is still navigable by a screen reader — ARIA roles cost nothing in print and are what
 * stops a document turning into an undifferentiated pile of text for the person checking it.
 *
 * ## Long orders continue rather than shrink
 *
 * §7: continuation pages are allowed. Nothing here scales, clamps or truncates — the rows flow, and
 * the print CSS breaks *after* each sheet rather than trying to keep one inside a page.
 */
export function PrintSheet({ order }: PrintSheetProps) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();

    const arabicFirst = prefersArabic(locale);
    const snapshot = order.recipientSnapshot;
    const isDraft = order.status === 'draft';

    /*
     * §3.5, and the whole reason the wire carries two suppliers: a **draft** preview reads the live
     * record, an **issued** reprint reads the snapshot frozen at the instant the document was
     * addressed. A supplier that moved premises in March must not silently rewrite the February
     * order they are holding a copy of.
     */
    const nameEn = snapshot?.nameEn ?? order.supplier?.nameEn ?? '';
    const nameAr = snapshot?.nameAr ?? order.supplier?.nameAr ?? null;

    /** The reader's own script first, the other beneath it — §7's bilingual rule. */
    const primaryName = (arabicFirst ? nameAr : nameEn) ?? '';
    const secondaryName = arabicFirst ? nameEn : nameAr;

    const contacts: readonly RecipientSnapshotContact[] = snapshot?.contacts ?? [];
    const generalPhone = snapshot?.contactPhone ?? null;
    const generalEmail = snapshot?.contactEmail ?? null;

    const date = order.issuedAt ?? order.createdAt;

    return (
        <View
            testID={printSheetTestId(String(order.id))}
            // A4 at 96dpi is 794px wide; the sheet is capped there on screen so the preview is the
            // page rather than a stretched approximation of it. The border and the raised surface
            // are screen-only — the print block strips both, because a supplier's copy does not
            // need a card drawn around it.
            className="mx-auto w-full max-w-[794px] gap-5 rounded-lg border border-stroke-subtle bg-surface-raised p-6"
        >
            {/* ── header ──────────────────────────────────────────────────────────────────────── */}

            <Stack space="sm">
                <Inline space="sm" align="start" justify="between" wrap>
                    <Heading level={2} testID={`${printSheetTestId(String(order.id))}-title`}>
                        {t('kitchen:ops.supplyOrders.print.documentTitle')}
                    </Heading>

                    {isDraft ? (
                        /*
                         * §3.5 asks for a "clear Draft marker" on a preview. An outlined tag beside
                         * the title rather than a diagonal watermark: a watermark needs a rotated
                         * absolutely-positioned overlay, which browsers print inconsistently and
                         * which a screen reader reads in the middle of the address block. A word in
                         * a box survives a monochrome laser printer and a fax, which is the bar.
                         */
                        <View
                            testID={`${printSheetTestId(String(order.id))}-draft`}
                            className="rounded-md border-2 border-stroke-strong px-3 py-1"
                        >
                            <Text variant="bodyStrong">
                                {t('kitchen:ops.supplyOrders.print.draftMarker')}
                            </Text>
                        </View>
                    ) : null}
                </Inline>

                {/* §7's header: branch, order number, date and status — the four facts both sides
                    quote at each other on the phone. */}
                <Inline
                    space="lg"
                    align="start"
                    wrap
                    testID={`${printSheetTestId(String(order.id))}-meta`}
                >
                    <Field
                        label={t('kitchen:ops.supplyOrders.print.branch')}
                        value={order.branch?.name ?? EM_DASH}
                        testID={`${printSheetTestId(String(order.id))}-branch`}
                    />
                    <Field
                        label={t('kitchen:ops.supplyOrders.print.orderNumber')}
                        value={order.number}
                        testID={`${printSheetTestId(String(order.id))}-number`}
                    />
                    <Field
                        label={t('kitchen:ops.supplyOrders.print.orderDate')}
                        value={
                            date === null
                                ? EM_DASH
                                : formatter.formatDate(date, { dateStyle: 'medium' })
                        }
                        testID={`${printSheetTestId(String(order.id))}-date`}
                    />
                    <Field
                        label={t('kitchen:ops.supplyOrders.print.status')}
                        value={t(purchaseOrderStatusKey(order.status))}
                        testID={`${printSheetTestId(String(order.id))}-status`}
                    />
                </Inline>
            </Stack>

            {/* ── who it is addressed to ──────────────────────────────────────────────────────── */}

            <Stack space="xs" testID={`${printSheetTestId(String(order.id))}-supplier`}>
                <Heading level={3}>{t('kitchen:ops.supplyOrders.print.supplierHeading')}</Heading>

                <Text
                    variant="bodyStrong"
                    testID={`${printSheetTestId(String(order.id))}-supplier-name`}
                >
                    {primaryName === '' ? (secondaryName ?? EM_DASH) : primaryName}
                </Text>
                {secondaryName === null || secondaryName === '' || primaryName === '' ? null : (
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID={`${printSheetTestId(String(order.id))}-supplier-name-alt`}
                    >
                        {secondaryName}
                    </Text>
                )}

                {snapshot === null ? (
                    /*
                     * A draft has been addressed to nobody yet: the recipient block is *captured on
                     * issue* (§3.5), so there is no address or contact set to reproduce here. The
                     * note says exactly that rather than printing a live address the document does
                     * not yet carry — a preview that showed one would be claiming a document detail
                     * that does not exist until Issue is pressed.
                     */
                    <Text
                        variant="caption"
                        tone="secondary"
                        testID={`${printSheetTestId(String(order.id))}-supplier-live`}
                    >
                        {t('kitchen:ops.supplyOrders.print.draftSupplierNote')}
                    </Text>
                ) : (
                    <>
                        {snapshot.address === null ? null : (
                            /*
                             * Printed verbatim, newlines and all — §3.1 calls the address free text
                             * a supplier gives ("gate 4, behind the cold store") and it is never
                             * geocoded, so nothing here reformats it into one line.
                             */
                            <Text testID={`${printSheetTestId(String(order.id))}-supplier-address`}>
                                {snapshot.address}
                            </Text>
                        )}
                        {snapshot.paymentTerms === null ? null : (
                            <Field
                                label={t('kitchen:ops.supplyOrders.print.paymentTerms')}
                                value={snapshot.paymentTerms}
                                testID={`${printSheetTestId(String(order.id))}-payment-terms`}
                            />
                        )}
                        {generalPhone === null && generalEmail === null ? null : (
                            <Text testID={`${printSheetTestId(String(order.id))}-supplier-general`}>
                                {[
                                    t('kitchen:ops.supplyOrders.print.generalContact'),
                                    generalPhone,
                                    generalEmail,
                                ]
                                    .filter((part) => part !== null && part !== '')
                                    .join(' · ')}
                            </Text>
                        )}

                        {contacts.length === 0 ? (
                            /*
                             * §3.1: the general office email and telephone are the documented
                             * fallback when a supplier has no named people on file. Saying so
                             * beats an empty Contacts heading, and an empty heading beats nothing
                             * at all only if there is something under it.
                             */
                            generalPhone === null && generalEmail === null ? (
                                <Text
                                    tone="secondary"
                                    testID={`${printSheetTestId(String(order.id))}-no-contacts`}
                                >
                                    {t('kitchen:ops.supplyOrders.print.noContacts')}
                                </Text>
                            ) : null
                        ) : (
                            <Stack
                                space="none"
                                testID={`${printSheetTestId(String(order.id))}-contacts`}
                            >
                                <Text variant="label">
                                    {t('kitchen:ops.supplyOrders.print.contactsHeading')}
                                </Text>
                                {/*
                                 * Rendered in the order the snapshot gives them, which the server
                                 * froze primary-first (§7). Nothing re-sorts it: the person who is
                                 * meant to be called first is the first line on the page.
                                 */}
                                {contacts.map((contact, index) => (
                                    <Text
                                        key={`${contact.name}-${String(index)}`}
                                        testID={`${printSheetTestId(String(order.id))}-contact-${String(index)}`}
                                    >
                                        {contactLine(contact, (phone) =>
                                            t('kitchen:ops.supplyOrders.print.phoneWhatsapp', {
                                                phone,
                                            }),
                                        )}
                                    </Text>
                                ))}
                            </Stack>
                        )}
                    </>
                )}
            </Stack>

            {/* ── what is being asked for ─────────────────────────────────────────────────────── */}

            <Stack space="xs">
                <Heading level={3}>{t('kitchen:ops.supplyOrders.print.itemsHeading')}</Heading>

                <View
                    testID={`${printSheetTestId(String(order.id))}-items`}
                    role="table"
                    aria-label={t('kitchen:ops.supplyOrders.print.itemsCaption', {
                        number: order.number,
                    })}
                    className="w-full"
                >
                    <View
                        role="row"
                        className="flex-row items-end gap-3 border-b-2 border-stroke-strong pb-1"
                    >
                        <HeaderCell
                            flex={COLUMN_FLEX.index}
                            label={t('kitchen:ops.supplyOrders.print.columnIndex')}
                        />
                        <HeaderCell
                            flex={COLUMN_FLEX.item}
                            label={t('kitchen:ops.supplyOrders.print.columnItem')}
                        />
                        <HeaderCell
                            flex={COLUMN_FLEX.quantity}
                            label={t('kitchen:ops.supplyOrders.print.columnQuantity')}
                        />
                        <HeaderCell
                            flex={COLUMN_FLEX.ref}
                            label={t('kitchen:ops.supplyOrders.print.columnRef')}
                        />
                        <HeaderCell
                            flex={COLUMN_FLEX.notes}
                            label={t('kitchen:ops.supplyOrders.print.columnNotes')}
                        />
                    </View>

                    {order.lines.map((line, index) => (
                        <ItemRow
                            key={line.id}
                            line={line}
                            ordinal={index + 1}
                            arabicFirst={arabicFirst}
                            sheetTestId={printSheetTestId(String(order.id))}
                            quantity={`${formatter.formatNumber(Number(line.quantity))} ${line.unitCode}`}
                        />
                    ))}
                </View>

                <Text
                    variant="caption"
                    tone="secondary"
                    testID={`${printSheetTestId(String(order.id))}-item-count`}
                >
                    {t('kitchen:ops.supplyOrders.print.itemCount', { count: order.lines.length })}
                </Text>
            </Stack>

            {/*
             * The order's own note, when there is one. §7 enumerates the minimum a sheet carries and
             * does not mention it, but a note typed onto a purchase order is a message *to the
             * supplier* — "deliver before 07:00, gate 4" — and a note that never reaches the paper
             * handed over is a note that was never written.
             */}
            {order.notes === null || order.notes.trim() === '' ? null : (
                <Stack space="none" testID={`${printSheetTestId(String(order.id))}-notes`}>
                    <Text variant="label">
                        {t('kitchen:ops.supplyOrders.print.orderNotesHeading')}
                    </Text>
                    <Text>{order.notes}</Text>
                </Stack>
            )}

            {/* ── who handed it over, and who took it ─────────────────────────────────────────── */}

            <Inline
                space="lg"
                align="start"
                wrap
                testID={`${printSheetTestId(String(order.id))}-signatures`}
            >
                <SignatureBlock label={t('kitchen:ops.supplyOrders.print.orderedBy')} />
                <SignatureBlock label={t('kitchen:ops.supplyOrders.print.receivedBy')} />
            </Inline>
        </View>
    );
}

/* ── the pieces ──────────────────────────────────────────────────────────────────────────────── */

const EM_DASH = '—';

/** A labelled fact in the header or the address block. Two lines, so neither wraps into the other. */
function Field({
    label,
    value,
    testID,
}: {
    readonly label: string;
    readonly value: string;
    readonly testID?: string | undefined;
}) {
    return (
        <Stack space="none">
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
            <Text variant="bodyStrong" testID={testID}>
                {value}
            </Text>
        </Stack>
    );
}

function HeaderCell({ flex, label }: { readonly flex: number; readonly label: string }) {
    return (
        <View role="columnheader" style={{ flex }}>
            <Text variant="caption" tone="secondary">
                {label}
            </Text>
        </View>
    );
}

/**
 * One requested shelf.
 *
 * The Notes cell is deliberately **empty** and ruled: §7 asks for "a blank notes column", which is
 * where a driver writes what actually came off the van before anybody types it in. A column with a
 * placeholder in it is a column somebody has to cross out first.
 */
function ItemRow({
    line,
    ordinal,
    arabicFirst,
    sheetTestId,
    quantity,
}: {
    readonly line: PurchaseOrderLine;
    readonly ordinal: number;
    readonly arabicFirst: boolean;
    readonly sheetTestId: string;
    readonly quantity: string;
}) {
    const testID = `${sheetTestId}-line-${String(line.stockItemId)}`;

    // The reader's script first where the server had one to snapshot; `itemNameAr` is null when
    // neither the ingredient nor the catalogue item carries an Arabic name, and an honest blank
    // beats English text printed under an Arabic heading.
    const primary = (arabicFirst ? line.itemNameAr : line.itemNameEn) ?? line.itemNameEn;
    const secondary = arabicFirst ? line.itemNameEn : line.itemNameAr;

    return (
        <View
            role="row"
            testID={testID}
            className="flex-row items-start gap-3 border-b border-stroke-subtle py-2"
        >
            <View role="cell" style={{ flex: COLUMN_FLEX.index }}>
                <Text>{String(ordinal)}</Text>
            </View>
            <View role="cell" style={{ flex: COLUMN_FLEX.item }}>
                <Text variant="bodyStrong" testID={`${testID}-name`}>
                    {primary}
                </Text>
                {secondary === null || secondary === '' || secondary === primary ? null : (
                    <Text variant="caption" testID={`${testID}-name-alt`}>
                        {secondary}
                    </Text>
                )}
                <Text variant="caption" tone="secondary" testID={`${testID}-code`}>
                    {line.itemCode}
                </Text>
            </View>
            <View role="cell" style={{ flex: COLUMN_FLEX.quantity }}>
                <Text variant="bodyStrong" testID={`${testID}-quantity`}>
                    {quantity}
                </Text>
            </View>
            <View role="cell" style={{ flex: COLUMN_FLEX.ref }}>
                <Text testID={`${testID}-ref`}>{line.supplierItemRef ?? EM_DASH}</Text>
            </View>
            {/* Blank by design — the rule under the row is the line somebody writes on. */}
            <View role="cell" style={{ flex: COLUMN_FLEX.notes }} testID={`${testID}-notes`} />
        </View>
    );
}

/** A ruled line and a date beside it — §7's prepared/received signature block. */
function SignatureBlock({ label }: { readonly label: string }) {
    const { t } = useTranslation();

    return (
        <Stack space="xs" className="min-w-[220px] grow">
            <Stack space="none">
                <View className="mt-6 border-b border-stroke-strong" />
                <Text variant="caption" tone="secondary">
                    {label}
                </Text>
            </Stack>
            <Stack space="none">
                <View className="mt-6 border-b border-stroke-strong" />
                <Text variant="caption" tone="secondary">
                    {t('kitchen:ops.supplyOrders.print.signatureDate')}
                </Text>
            </Stack>
        </Stack>
    );
}

/**
 * One named contact as one line: name · role · phone · email.
 *
 * A number a supplier only answers on WhatsApp is still a number to call, so it stands in when
 * there is no telephone — labelled, because a person dialling it from paper needs to know why it
 * did not ring. §3.2 keeps the two as separate fields precisely so this distinction survives.
 */
function contactLine(
    contact: RecipientSnapshotContact,
    whatsappLabel: (phone: string) => string,
): string {
    const phone =
        contact.phone !== null && contact.phone !== ''
            ? contact.phone
            : contact.whatsappPhone !== null && contact.whatsappPhone !== ''
              ? whatsappLabel(contact.whatsappPhone)
              : null;

    return [contact.name, contact.roleTitle, phone, contact.email]
        .filter((part) => part !== null && part !== '')
        .join(' · ');
}
