import type { KitchenOrder } from '@healthy360/api-client/contracts';
import {
    Button,
    Callout,
    Card,
    ErrorState,
    Heading,
    Inline,
    Skeleton,
    Stack,
    Text,
} from '@healthy360/design-system';
import { OrderId } from '@healthy360/domain-types';
import type { Formatter } from '@healthy360/i18n';
import { useFormatter, useLocale } from '@healthy360/i18n';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { Gate } from '../../access/gate.tsx';
import { toFailure } from '../../data/hooks.ts';
import { useKitchenDisplayQuery, useKitchenOrderQuery } from '../../data/kitchen-orders-hooks.ts';
import { useReturnTo } from '../../navigation/use-return-to.ts';
import { dishOptionsLine } from '../../ui/dish-choices.tsx';
import {
    ORDER_PREPARE_PERMISSION,
    ORDER_VIEW_PERMISSION,
} from '../kitchen-admin/entity-registry.ts';
import { displayName, humaniseCode } from '../kitchen-admin/format.ts';
import { allergenLabel, allergyBanner } from '../kitchen-admin/ops-format.ts';
import { usePrintSheet } from '../kitchen-admin/print-sheet.tsx';

/**
 * The printed kitchen ticket (T12b): `/kds/ticket?order=…` for the line, `/kitchen/orders/ticket?order=…`
 * for the order book.
 *
 * A route rather than a dialog for the reason `supply-order-print-screen.tsx` gives: `window.print`
 * prints the document, so the ticket has to be the only thing in it. Two routes because the two
 * areas read the order differently — the line reads the board it already polls (`getDisplay`), which
 * a cook without the order book's permission can reach; the order book reads the one order.
 *
 * The paper carries what the kitchen cooks from and nothing about money: the number, when it is due,
 * the allergy banner in words, and each line with its options and note.
 */

/** "For {date} · {window}" — the ticket's delivery line, shared with the board's ticket. */
export function ticketDeliveryLine(
    order: KitchenOrder,
    locale: string,
    t: TFunction,
    formatter: Formatter,
): string {
    const { requestedDate, windowCode } = order.delivery;
    if (requestedDate === null) return t('kitchen:kds.deliveryUnknown');
    const date = formatter.formatDate(requestedDate, { dateStyle: 'medium' });
    if (windowCode === null) return t('kitchen:kds.deliveryOn', { date });
    return t('kitchen:kds.deliveryOnAt', {
        date,
        window:
            (locale.toLowerCase().startsWith('ar')
                ? order.delivery.windowNameAr
                : order.delivery.windowNameEn) ??
            order.delivery.windowNameEn ??
            humaniseCode(windowCode),
    });
}

/** One ticket, laid out for paper. */
export function TicketPrintSheet({ order }: { readonly order: KitchenOrder }) {
    const { t } = useTranslation();
    const { locale } = useLocale();
    const formatter = useFormatter();
    const testID = 'kds-ticket-print-sheet';
    const dueAt = order.dueAt ?? null;
    const banner =
        order.allergy === null ? null : allergyBanner(order.allergy, order.lines, locale, t);

    return (
        <View
            testID={testID}
            // The supply-order sheet's frame; the print block strips the card.
            className="mx-auto w-full max-w-[794px] gap-5 rounded-lg border border-stroke-subtle bg-surface-raised p-6"
        >
            <Stack space="xs">
                <Heading level={2} testID={`${testID}-number`}>
                    {order.orderNumber}
                </Heading>
                {dueAt === null ? null : (
                    <Text variant="bodyStrong" testID={`${testID}-due`}>
                        {t('kitchen:kds.printDue', {
                            time: formatter.formatDate(dueAt, {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                            }),
                        })}
                    </Text>
                )}
                <Text testID={`${testID}-delivery`}>
                    {ticketDeliveryLine(order, locale, t, formatter)}
                </Text>
            </Stack>

            {banner === null ? null : (
                // A box and words, not a tint: it has to survive a monochrome printer.
                <View
                    testID={`${testID}-allergy`}
                    className="gap-1 rounded-md border-2 border-stroke-strong p-3"
                >
                    <Text variant="bodyStrong">{banner.title}</Text>
                    <Text>{banner.body}</Text>
                </View>
            )}

            <Stack space="sm" testID={`${testID}-lines`}>
                {order.lines.map((line) => {
                    const options = dishOptionsLine(line.options, locale, t);
                    return (
                        <Stack space="none" key={line.id} testID={`${testID}-line-${line.id}`}>
                            <Text variant="bodyStrong">
                                {t('kitchen:kds.lineSummary', {
                                    name: displayName({ en: line.nameEn, ar: line.nameAr }, locale)
                                        .value,
                                    quantity: formatter.formatNumber(Number(line.quantity)),
                                })}
                            </Text>
                            {options === null ? null : (
                                <Text testID={`${testID}-line-${line.id}-options`}>{options}</Text>
                            )}
                            {line.note == null ? null : (
                                <Text testID={`${testID}-line-${line.id}-note`}>
                                    {t('kitchen:dishOptions.lineNote', { note: line.note })}
                                </Text>
                            )}
                            {line.allergens.length === 0 ? null : (
                                <Text variant="caption">
                                    {line.allergens
                                        .map((allergen) =>
                                            allergen.containment === 'contains'
                                                ? allergenLabel(allergen.allergenCode, t)
                                                : t('kitchen:kds.mayContain', {
                                                      allergen: allergenLabel(
                                                          allergen.allergenCode,
                                                          t,
                                                      ),
                                                  }),
                                        )
                                        .join(t('kitchen:common.listSeparator'))}
                                </Text>
                            )}
                        </Stack>
                    );
                })}
            </Stack>
        </View>
    );
}

interface TicketPrintPageProps {
    readonly order: KitchenOrder | null;
    readonly pending: boolean;
    readonly error: unknown;
    readonly retrying: boolean;
    readonly onRetry: () => void;
    /** Where Back goes when the page was opened directly. */
    readonly fallback: string;
}

/** The toolbar and the states around one ticket — the supply-order print screen's shape. */
function TicketPrintPage({
    order,
    pending,
    error,
    retrying,
    onRetry,
    fallback,
}: TicketPrintPageProps) {
    const { t } = useTranslation();
    const back = useReturnTo(undefined, fallback).leave;
    const sheet = usePrintSheet();

    const backButton = (
        <Button
            testID="kds-ticket-print-back"
            variant="secondary"
            label={t('kitchen:common.back')}
            onPress={back}
        />
    );

    if (pending) {
        return (
            <Card padding="md" testID="kds-ticket-print-loading">
                <Skeleton heightClassName="h-5" />
            </Card>
        );
    }

    const failure = toFailure(error);
    if (failure !== null) {
        return (
            <Stack space="lg" testID="kds-ticket-print-screen">
                <ErrorState
                    testID="kds-ticket-print-error"
                    failure={failure}
                    onRetry={onRetry}
                    retrying={retrying}
                />
                {backButton}
            </Stack>
        );
    }

    if (order === null) {
        return (
            <Stack space="lg" testID="kds-ticket-print-screen">
                <Callout
                    testID="kds-ticket-print-missing"
                    tone="warning"
                    role="alert"
                    title={t('kitchen:kds.printMissing')}
                    actions={backButton}
                />
            </Stack>
        );
    }

    return (
        <Stack space="lg" testID="kds-ticket-print-screen">
            {/* Screen-only: the print block hides it by test id. */}
            <Stack space="sm" testID="kds-ticket-print-toolbar">
                <Inline space="sm" align="center" justify="between" wrap>
                    <Heading level={1}>{t('kitchen:kds.printTitle')}</Heading>
                    <Inline space="sm" align="center" wrap>
                        {backButton}
                        {sheet.mode === 'browser' ? (
                            <Button
                                testID="kds-ticket-print-action"
                                label={t('kitchen:transfer.print.action')}
                                onPress={sheet.print}
                            />
                        ) : null}
                    </Inline>
                </Inline>
                {sheet.mode === 'browser' ? null : (
                    <Callout
                        testID="kds-ticket-print-native-notice"
                        tone="info"
                        title={t('kitchen:transfer.print.nativeUnavailable')}
                    />
                )}
            </Stack>

            {/* Only the sheet in here: the print block unwinds every box down to it. */}
            <View testID="kds-ticket-print-sheets">
                <TicketPrintSheet order={order} />
            </View>
        </Stack>
    );
}

export interface TicketPrintScreenProps {
    /** The `order` query parameter. */
    readonly order?: string | undefined;
}

/** `/kds/ticket?order=…` — the board's own read, so the line's grant is enough. */
export function KdsTicketPrintScreen({ order }: TicketPrintScreenProps) {
    return (
        <Gate
            area="kds"
            requirement={{ anyOf: [ORDER_VIEW_PERMISSION, ORDER_PREPARE_PERMISSION] }}
            testID="kds-ticket-print"
        >
            <KdsTicketPrint order={order} />
        </Gate>
    );
}

function KdsTicketPrint({ order }: TicketPrintScreenProps) {
    const display = useKitchenDisplayQuery(true, false);
    const id = OrderId.safeParse(order ?? '');
    const found =
        id === null
            ? null
            : (display.data?.orders.find((candidate) => String(candidate.id) === String(id)) ??
              null);

    return (
        <TicketPrintPage
            order={found}
            pending={id !== null && display.isPending}
            error={display.error}
            retrying={display.isFetching}
            onRetry={() => {
                void display.refetch();
            }}
            fallback="/kds"
        />
    );
}

/** `/kitchen/orders/ticket?order=…` — the order book's read of the one order. */
export function KitchenTicketPrintScreen({ order }: TicketPrintScreenProps) {
    return (
        <Gate
            area="kitchen"
            requirement={{ allOf: [ORDER_VIEW_PERMISSION] }}
            testID="kitchen-ticket-print"
        >
            <KitchenTicketPrint order={order} />
        </Gate>
    );
}

function KitchenTicketPrint({ order }: TicketPrintScreenProps) {
    const id = OrderId.safeParse(order ?? '');
    const detail = useKitchenOrderQuery(id);

    return (
        <TicketPrintPage
            order={detail.data ?? null}
            pending={id !== null && detail.isPending}
            error={detail.error}
            retrying={detail.isFetching}
            onRetry={() => {
                void detail.refetch();
            }}
            fallback={id === null ? '/kitchen/orders' : `/kitchen/orders?view=${String(id)}`}
        />
    );
}
