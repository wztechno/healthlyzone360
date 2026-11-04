import { useRouter } from 'expo-router';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Image, Text as RNText, View } from 'react-native';
import type { ImageRequireSource } from 'react-native';

import { ExtraCard, ExtraPage } from '../../account/account-extra.tsx';
import { IMAGE_ASSETS, IMAGE_CREDITS } from '../../../media/image-manifest.generated.ts';
import { CreditLine } from '../../../media/photo-credit.tsx';

/**
 * Every photograph whose licence obliges a visible credit, in one reachable place — drawn as the
 * Explorations board: the back pill and image tile over two short cards saying what the photography
 * is, then one card listing every credit with the photograph it belongs to.
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
    const router = useRouter();
    const credits = Object.entries(IMAGE_CREDITS).sort(([a], [b]) => (a < b ? -1 : 1));
    const thumbs = useMemo(() => thumbnailsByCredit(), []);

    return (
        <ExtraPage
            testID="image-credits-screen"
            backTestID="image-credits-back"
            backLabel={t('auth:frame.backToShop')}
            onBack={() => {
                router.push('/discover');
            }}
            icon="layers"
            title={t('marketplace:imageCredits.title')}
            titleTestID="image-credits-title"
        >
            <View className="mt-[18px] flex-col gap-4 md:flex-row">
                <IntroCard
                    title={t('marketplace:imageCredits.openTitle')}
                    body={t('marketplace:imageCredits.intro')}
                />
                <IntroCard
                    title={t('marketplace:imageCredits.stockTitle')}
                    body={t('marketplace:imageCredits.synthetic')}
                />
            </View>

            <ExtraCard>
                <View className="flex-row items-center justify-between gap-3">
                    <RNText
                        accessibilityRole="header"
                        aria-level={2}
                        className="text-lg font-bold text-content-primary text-start"
                    >
                        {t('marketplace:imageCredits.listTitle')}
                    </RNText>
                    <View className="h-7 flex-row items-center rounded-full bg-surface-brand-subtle px-2.5">
                        <RNText className="text-xs font-semibold text-content-on-brand-subtle">
                            {t('marketplace:imageCredits.count', { count: credits.length })}
                        </RNText>
                    </View>
                </View>

                <View testID="image-credits-list" className="mt-2 flex-col">
                    {credits.length === 0 ? (
                        <RNText
                            testID="image-credits-empty"
                            className="py-4 text-sm font-medium text-content-secondary text-start"
                        >
                            {t('marketplace:imageCredits.none')}
                        </RNText>
                    ) : (
                        credits.map(([key, credit], index) => {
                            const thumb = thumbs.get(key);
                            return (
                                <View
                                    key={key}
                                    testID={`image-credits-${key.replace('/', '-')}`}
                                    className={
                                        index === 0
                                            ? 'flex-row items-center gap-3.5 py-2.5'
                                            : 'flex-row items-center gap-3.5 border-t border-stroke-subtle py-2.5'
                                    }
                                >
                                    {thumb === undefined ? (
                                        <View
                                            aria-hidden
                                            className="h-14 w-14 shrink-0 rounded-[14px] bg-surface-sunken"
                                        />
                                    ) : (
                                        <Image
                                            source={thumb}
                                            alt=""
                                            aria-hidden
                                            resizeMode="cover"
                                            style={{ width: 56, height: 56, borderRadius: 14 }}
                                        />
                                    )}
                                    <View className="min-w-0 flex-1 flex-col gap-0.5">
                                        <RNText className="text-sm font-semibold text-content-primary text-start">
                                            {key}
                                        </RNText>
                                        <CreditLine credit={credit} />
                                    </View>
                                </View>
                            );
                        })
                    )}
                </View>
            </ExtraCard>
        </ExtraPage>
    );
}

function IntroCard({ title, body }: { readonly title: string; readonly body: string }) {
    return (
        <View className="min-w-0 flex-1 rounded-[20px] border border-stroke-subtle bg-surface-raised px-5 py-[18px]">
            <RNText className="mb-1 text-sm font-bold text-content-primary text-start">
                {title}
            </RNText>
            <RNText className="text-sm font-medium leading-6 text-content-secondary text-start">
                {body}
            </RNText>
        </View>
    );
}

/**
 * The photograph each credit is for. A credit is keyed `<family>/<base>`; the files are that key
 * plus a crop (`.card`, `.detail`, `.tile`, `.hero`). The smallest crop there is stands in for it.
 */
function thumbnailsByCredit(): ReadonlyMap<string, ImageRequireSource> {
    const order = ['card', 'tile', 'portrait', 'detail', 'hero'];
    const best = new Map<string, { readonly rank: number; readonly source: ImageRequireSource }>();
    for (const [file, source] of Object.entries(IMAGE_ASSETS)) {
        const dot = file.lastIndexOf('.');
        if (dot === -1) continue;
        const key = file.slice(0, dot);
        const found = order.indexOf(file.slice(dot + 1));
        const rank = found === -1 ? order.length : found;
        const current = best.get(key);
        if (current === undefined || rank < current.rank) best.set(key, { rank, source });
    }
    return new Map([...best].map(([key, value]) => [key, value.source]));
}
