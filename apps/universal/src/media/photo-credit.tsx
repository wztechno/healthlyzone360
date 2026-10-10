import { Text } from '@healthy360/design-system';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Linking, Text as RNText, View } from 'react-native';

import { creditKeyFor } from './entity-image.tsx';
import { IMAGE_CREDITS } from './image-manifest.generated.ts';
import type { ImageCredit } from './image-manifest.generated.ts';

/**
 * The credit a photograph's licence obliges us to show, or nothing.
 *
 * ## Why this is a component and not a string
 *
 * CC BY and CC BY-SA do not ask for a courtesy mention; they set conditions. Each requires the
 * creator's name, the licence, a link to the licensed material, and — because every file here is
 * cropped to a fixed frame and re-encoded — a statement that the work was modified. Rendering only
 * "Photo: Jane Doe" would satisfy none of them. All four parts travel together here so a call site
 * cannot show half a credit and believe it has complied.
 *
 * The library the photograph came through is named from the image's own provenance, never assumed.
 * Photographs now arrive from Wikimedia Commons and, through Openverse, from Flickr, rawpixel and
 * others; a credit reading "via Wikimedia Commons" under a Flickr photograph would misattribute it.
 *
 * Public-domain and CC0 images oblige nothing, and they are simply absent from
 * {@link IMAGE_CREDITS}. A lookup miss therefore means "no credit required", not "credit missing" —
 * which is why this returns null rather than a placeholder. What stops a *genuinely* missing credit
 * from hiding behind that null is `image-provenance.test.ts`, which asserts every attribution-bound
 * entry has a creator and a licence URL before it can reach the manifest at all.
 *
 * ## Where it goes, and where it does not
 *
 * On the surfaces that show a record's own photograph large enough to read a caption under: the
 * ingredient and recipe detail panes, the meal detail screen. Not on a 20px catalogue thumbnail,
 * where there is no room and the credit would outweigh the image several times over; the licences
 * ask for attribution reasonable to the medium, and for those the medium is the detail view of the
 * same asset plus the credits screen that lists every file.
 */
export interface PhotoCreditProps {
    /** The same `assetId` the image beside it was given, e.g. `ingredient-black-pepper`. */
    readonly assetId?: string | undefined;
    readonly testID?: string | undefined;
}

export function PhotoCredit({ assetId, testID }: PhotoCreditProps) {
    const key = creditKeyFor(assetId);
    const credit = key === null ? undefined : IMAGE_CREDITS[key];

    if (credit === undefined) return null;

    return (
        <View testID={testID}>
            <CreditLine credit={credit} />
        </View>
    );
}

/**
 * The name of the library a photograph was published through, translated.
 *
 * A closed map of literal keys rather than a key built from the provider string, so a provider the
 * catalogues do not know falls back to a neutral word instead of printing a raw key on screen.
 */
export function providerName(t: TFunction, provider: string): string {
    switch (provider) {
        case 'wikimedia':
            return t('common:photoCredit.provider.wikimedia');
        case 'flickr':
            return t('common:photoCredit.provider.flickr');
        case 'rawpixel':
            return t('common:photoCredit.provider.rawpixel');
        case 'stocksnap':
            return t('common:photoCredit.provider.stocksnap');
        case 'nappy':
            return t('common:photoCredit.provider.nappy');
        case 'unsplash':
            return t('common:photoCredit.provider.unsplash');
        default:
            return t('common:photoCredit.provider.other');
    }
}

/**
 * One complete credit: creator, licence (linked to its deed), the source (linked to the
 * photograph's own page) and the modification note. Shared by the inline credit and the credits
 * screen, so the two can never disagree about what a credit contains.
 */
export function CreditLine({ credit }: { readonly credit: ImageCredit }) {
    const { t } = useTranslation();

    return (
        <Text variant="caption" tone="secondary">
            {t('common:photoCredit.byline', { creator: credit.creator })}
            {' · '}
            <RNText
                accessibilityRole="link"
                onPress={() => void Linking.openURL(credit.licenceUrl)}
                className="underline"
            >
                {credit.licence}
            </RNText>
            {' · '}
            {t('common:photoCredit.via')}{' '}
            <RNText
                accessibilityRole="link"
                onPress={() => void Linking.openURL(credit.sourceUrl)}
                className="underline"
            >
                {providerName(t, credit.provider)}
            </RNText>
            {' · '}
            {t('common:photoCredit.modified')}
        </Text>
    );
}
