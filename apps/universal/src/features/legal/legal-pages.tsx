import { Heading, Stack, Text } from '@healthy360/design-system';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';

/**
 * Terms, privacy and refund policy: the place for them, empty until the owner supplies the text.
 *
 * To publish one, add the two strings to `marketplace.legal` in every catalogue and a row here; the
 * footer link and `/legal/<slug>` follow from the row. Nothing links to a page that is not listed,
 * and a typed address that is not listed goes to the shop.
 */
export interface LegalPage {
    readonly slug: string;
    readonly titleKey: string;
    readonly bodyKey: string;
}

export const LEGAL_PAGES: readonly LegalPage[] = [];

export function LegalScreen({
    slug,
    pages = LEGAL_PAGES,
}: {
    readonly slug: string | undefined;
    readonly pages?: readonly LegalPage[];
}) {
    const { t } = useTranslation();
    const page = pages.find((candidate) => candidate.slug === slug);

    if (page === undefined) return <Redirect href="/discover" />;

    return (
        <Stack space="sm" testID="legal-screen">
            <Heading level={1} testID="legal-title">
                {t(page.titleKey)}
            </Heading>
            <Text className="max-w-[640px]">{t(page.bodyKey)}</Text>
        </Stack>
    );
}
