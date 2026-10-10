import { Heading, Stack, Text } from '@healthy360/design-system';
import { useTranslation } from 'react-i18next';
import { View } from 'react-native';

import { IMAGE_CREDITS } from '../../../media/image-manifest.generated.ts';
import { CreditLine } from '../../../media/photo-credit.tsx';

/**
 * Every photograph whose licence obliges a visible credit, in one reachable place.
 *
 * ## Why a screen and not just the repo's CREDITS.md
 *
 * CC BY and CC BY-SA ask for attribution "in any reasonable manner based on the medium". A file in
 * a source repository is not a medium the people using the application can reach, so for the
 * surfaces where a full credit cannot sit beside the image — a 20px catalogue thumbnail, a card in
 * a grid, a marketing tile — this page is where the obligation is actually met. Detail screens
 * carry their own credit inline as well; this is the destination for everything else, and the
 * complete list besides.
 *
 * ## Why only some images appear
 *
 * Public-domain and CC0 photographs are the majority of the set and oblige nothing, so they are
 * absent from {@link IMAGE_CREDITS} and therefore from this page. Their provenance is still
 * recorded — `assets/images/provenance.json` holds source, creator and licence for every file,
 * obliged or not, and `CREDITS.md` is generated from it — but listing several hundred credits that
 * no licence asks for would bury the ones that are actually required.
 *
 * The list is data from the generated manifest rather than copy, so a new image cannot be added
 * without its credit appearing here, and a credit cannot be written for an image that does not
 * exist.
 */
export function ImageCreditsScreen() {
    const { t } = useTranslation();
    const credits = Object.entries(IMAGE_CREDITS).sort(([a], [b]) => (a < b ? -1 : 1));

    return (
        <Stack space="xl" testID="image-credits-screen">
            <Stack space="sm">
                <Heading level={1} testID="image-credits-title">
                    {t('marketplace:imageCredits.title')}
                </Heading>
                <Text tone="secondary" className="max-w-[640px]">
                    {t('marketplace:imageCredits.intro')}
                </Text>
                <Text tone="secondary" className="max-w-[640px]">
                    {t('marketplace:imageCredits.synthetic')}
                </Text>
            </Stack>

            <Stack space="sm" testID="image-credits-list">
                {credits.length === 0 ? (
                    <Text tone="secondary" testID="image-credits-empty">
                        {t('marketplace:imageCredits.none')}
                    </Text>
                ) : (
                    credits.map(([key, credit]) => (
                        <View key={key} testID={`image-credits-${key.replace('/', '-')}`}>
                            <Text variant="label">{key}</Text>
                            <CreditLine credit={credit} />
                        </View>
                    ))
                )}
            </Stack>
        </Stack>
    );
}
