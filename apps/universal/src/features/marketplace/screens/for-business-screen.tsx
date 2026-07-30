import {
    Button,
    Callout,
    Card,
    Chip,
    Heading,
    Icon,
    Inline,
    Stack,
    Text,
} from '@healthy360/design-system';
import type { IconName } from '@healthy360/design-system';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PrototypeDialog } from '../../../prototype/prototype-dialog.tsx';
import { PrototypeNotice } from '../../../prototype/prototype-notice.tsx';
import { CardGrid, CardGridItem, SectionHeader } from '../section-header.tsx';

/**
 * The four business programmes.
 *
 * Presentation only. Every one of them corresponds to a fixture in the business contract, but none
 * of that data is read here and none of it could be: the corporate catalogue requires an
 * organisation context, and this page is anonymous by definition.
 */
const PROGRAMMES: readonly { readonly key: string; readonly icon: IconName }[] = [
    { key: 'corporate', icon: 'organisation' },
    { key: 'clinic', icon: 'user' },
    { key: 'gym', icon: 'success' },
    { key: 'wholesale', icon: 'branch' },
];

/** What a business account brings, stated as capabilities rather than as a price sheet. */
const CAPABILITIES: readonly string[] = [
    'minimumOrder',
    'volumeTiers',
    'deliverySchedule',
    'leadTime',
    'recurringOrders',
    'eligibility',
];

/**
 * For business.
 *
 * ## There are no prices on this page. Not even a "from"
 *
 * The prompt requires that customer surfaces never expose private B2B pricing, and the reference
 * research found the same discipline in practice: business pricing reachable only through an
 * enquiry, with no public rate at all (doc 17, IA-06, SUB-13). A "from AED …" placeholder would be
 * weaker than it looks — it is still a public price signal for negotiated supply, it invites a
 * comparison the contract cannot honour, and it gives the B2B-price-privacy spec something to have
 * to reason about. Removing the number entirely removes the question.
 *
 * What replaces it is the thing a business actually needs to know before enquiring: what the
 * programmes are, what commercial terms exist as concepts (minimum order, volume tiers, lead time,
 * recurring supply), and how to start a conversation.
 *
 * ## The quotation control
 *
 * Submitting a quotation request needs an organisation context, which needs an account. Rather than
 * a control that pretends to submit, pressing it opens a dialog that says what a business account
 * is for and offers the two real routes there — sign in, or register. Honest, and not a dead end:
 * both buttons navigate to screens that exist.
 */
export function ForBusinessScreen() {
    const { t } = useTranslation();
    const router = useRouter();
    const [enquiryOpen, setEnquiryOpen] = useState(false);

    return (
        <Stack space="xl" testID="for-business-screen">
            <Stack space="sm">
                <Heading level={1} testID="for-business-title">
                    {t('marketplace:forBusiness.title')}
                </Heading>
                <Text tone="secondary" className="max-w-[640px] text-lg">
                    {t('marketplace:forBusiness.subtitle')}
                </Text>
                <Inline space="sm" wrap>
                    <Button
                        testID="for-business-request-quotation"
                        label={t('marketplace:forBusiness.requestQuotation')}
                        onPress={() => {
                            setEnquiryOpen(true);
                        }}
                    />
                </Inline>
            </Stack>

            <Stack space="sm" testID="for-business-programmes">
                <SectionHeader
                    title={t('marketplace:forBusiness.programmesTitle')}
                    description={t('marketplace:forBusiness.programmesBody')}
                />
                <CardGrid>
                    {PROGRAMMES.map((programme) => (
                        <CardGridItem key={programme.key}>
                            <Card
                                testID={`for-business-programme-${programme.key}`}
                                padding="md"
                                tone="raised"
                            >
                                <Stack space="xs">
                                    <Icon
                                        name={programme.icon}
                                        size="lg"
                                        className="text-content-on-brand-subtle"
                                    />
                                    <Text variant="bodyStrong">
                                        {t(
                                            `marketplace:forBusiness.programme.${programme.key}.title`,
                                        )}
                                    </Text>
                                    <Text tone="secondary" variant="caption">
                                        {t(
                                            `marketplace:forBusiness.programme.${programme.key}.body`,
                                        )}
                                    </Text>
                                </Stack>
                            </Card>
                        </CardGridItem>
                    ))}
                </CardGrid>
            </Stack>

            <Stack space="sm" testID="for-business-terms">
                <SectionHeader
                    title={t('marketplace:forBusiness.termsTitle')}
                    description={t('marketplace:forBusiness.termsBody')}
                />
                <Inline space="xs" wrap>
                    {CAPABILITIES.map((capability) => (
                        <Chip
                            key={capability}
                            testID={`for-business-capability-${capability}`}
                            tone="neutral"
                            label={t(`marketplace:forBusiness.capability.${capability}`)}
                        />
                    ))}
                </Inline>
            </Stack>

            <Callout
                testID="for-business-pricing"
                role="note"
                tone="info"
                title={t('marketplace:forBusiness.pricingTitle')}
                body={t('marketplace:forBusiness.pricingBody')}
            />

            <PrototypeNotice body={t('marketplace:forBusiness.prototypeNotice')} />

            <PrototypeDialog
                testID="for-business-enquiry"
                open={enquiryOpen}
                onClose={() => {
                    setEnquiryOpen(false);
                }}
                title={t('marketplace:forBusiness.enquiryTitle')}
                description={t('marketplace:forBusiness.enquiryBody')}
                contract="POST /api/v1/business/quotations"
                actions={
                    <>
                        <Button
                            testID="for-business-enquiry-register"
                            variant="secondary"
                            label={t('marketplace:nav.register')}
                            onPress={() => {
                                setEnquiryOpen(false);
                                router.push('/register');
                            }}
                        />
                        <Button
                            testID="for-business-enquiry-sign-in"
                            label={t('marketplace:nav.signIn')}
                            onPress={() => {
                                setEnquiryOpen(false);
                                router.push('/sign-in');
                            }}
                        />
                    </>
                }
            />
        </Stack>
    );
}
