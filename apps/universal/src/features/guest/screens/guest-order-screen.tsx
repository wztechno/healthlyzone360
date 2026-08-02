import { Badge, Callout, Card, Heading, Inline, Stack, Text } from '@healthy360/design-system';
import { useFormatter } from '@healthy360/i18n';
import { useTranslation } from 'react-i18next';

import {
    useGuestConversionPrefillQuery,
    useGuestOrderQuery,
    useGuestToken,
} from '../../../data/guest-hooks.ts';
import { formatAddress } from '../../commerce/address.ts';
import { formatMoney } from '../../marketplace/format.ts';
import { QueryStates } from '../../marketplace/query-states.tsx';
import { ConversionPrompt } from '../conversion-prompt.tsx';

/**
 * `/orders/{order}` — the guest order confirmation.
 *
 * ## The reference is the point of the page
 *
 * It is rendered first, largest, and as text rather than inside a sentence, because it is the one
 * thing a person has to keep: there is no account to find this order from later, and the URL is the
 * only bookmark they will have. The retention window is stated on the not-found path for the same
 * reason — an old reference stops working, and "we deleted it on schedule" is a better answer than
 * a blank page.
 *
 * ## The conversion prompt lives here and not in the checkout
 *
 * Offered before the order exists it becomes a condition of placing it. Offered after, it is what
 * it claims to be: an option, pre-filled from what we already know, with a visible way past it.
 * See `../conversion-prompt.tsx`.
 *
 * ## Public route, and that is deliberate
 *
 * The page sits in the marketplace group with no session behind it, because the person reading it
 * has no account by definition. What protects it is the reference itself, which the real generator
 * makes unguessable — the mock's sequential one is a fixture convenience and says so in `ids.ts`.
 */

const TEST_ID = 'guest-order';

export interface GuestOrderScreenProps {
    readonly reference: string | undefined;
}

export function GuestOrderScreen({ reference }: GuestOrderScreenProps) {
    const { t } = useTranslation();
    const formatter = useFormatter();

    const order = useGuestOrderQuery(reference ?? null);
    const token = useGuestToken();
    // Only offered to the person who still holds the session that placed it. Somebody opening a
    // shared link is reading a receipt, not being sold an account.
    const prefill = useGuestConversionPrefillQuery(token !== null);

    return (
        <Stack space="lg" testID={TEST_ID}>
            <QueryStates
                query={order}
                isEmpty={reference === undefined}
                emptyTitle={t('guest:order.notFoundTitle')}
                emptyBody={t('guest:order.notFoundBody')}
                skeletonCount={2}
                testID={`${TEST_ID}-states`}
            >
                {order.data === undefined ? null : (
                    <Stack space="lg">
                        <Stack space="xs">
                            <Heading level={1} testID={`${TEST_ID}-title`}>
                                {t('guest:order.title')}
                            </Heading>
                            <Text tone="secondary">{t('guest:order.subtitle')}</Text>
                        </Stack>

                        <Card padding="md" testID={`${TEST_ID}-reference-card`}>
                            <Stack space="sm">
                                <Text variant="bodyStrong">{t('guest:order.reference')}</Text>
                                <Heading level={2} testID={`${TEST_ID}-reference`}>
                                    {order.data.reference}
                                </Heading>
                                <Inline space="sm" align="center">
                                    <Badge
                                        testID={`${TEST_ID}-state`}
                                        tone="info"
                                        label={t(`guest:order.states.${order.data.state}`)}
                                    />
                                    <Text tone="secondary" testID={`${TEST_ID}-lines`}>
                                        {t('guest:order.lines', {
                                            count: order.data.lines.length,
                                        })}
                                    </Text>
                                </Inline>
                            </Stack>
                        </Card>

                        <Card padding="md" testID={`${TEST_ID}-detail`}>
                            <Stack space="sm">
                                <Text variant="bodyStrong">{t('guest:order.deliveringTo')}</Text>
                                <Text tone="secondary">{formatAddress(order.data.address)}</Text>

                                <Text variant="bodyStrong">{t('guest:order.slot')}</Text>
                                <Text tone="secondary">
                                    {`${formatter.formatDate(order.data.deliveryDate)} · ${t(
                                        `commerce:slots.${order.data.slotCode}`,
                                    )}`}
                                </Text>

                                <Text variant="bodyStrong">{t('guest:order.payment')}</Text>
                                <Text tone="secondary" testID={`${TEST_ID}-payment`}>
                                    {t('guest:review.cashOnDelivery')}
                                </Text>

                                <Text variant="bodyStrong">{t('guest:order.total')}</Text>
                                <Text testID={`${TEST_ID}-total`}>
                                    {formatMoney(formatter, order.data.total)}
                                </Text>
                            </Stack>
                        </Card>

                        {prefill.data === undefined ? (
                            <Callout
                                testID={`${TEST_ID}-no-conversion`}
                                role="note"
                                tone="info"
                                title={t('guest:order.subtitle')}
                            />
                        ) : (
                            <ConversionPrompt
                                testID={`${TEST_ID}-conversion`}
                                prefill={prefill.data}
                                onConverted={() => {
                                    // Nothing to navigate away to: the receipt is still the thing
                                    // the person came for, and the prompt reports its own success.
                                }}
                            />
                        )}
                    </Stack>
                )}
            </QueryStates>
        </Stack>
    );
}
