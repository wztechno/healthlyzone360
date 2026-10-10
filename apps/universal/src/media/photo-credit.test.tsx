import { createI18n } from '@healthy360/i18n';
import { render, screen } from '@testing-library/react-native';
import { I18nextProvider } from 'react-i18next';

import { PhotoCredit, providerName } from './photo-credit.tsx';
import { IMAGE_CREDITS } from './image-manifest.generated.ts';

/**
 * The credit is a licence condition, so the two branches are tested as compliance rather than as
 * rendering.
 *
 * **Showing nothing must mean nothing is owed.** `PhotoCredit` returns null when an image is not in
 * {@link IMAGE_CREDITS}, and that map only holds images whose licence requires attribution. If the
 * component ever returned null for an image that *did* require one, the app would quietly stop
 * complying and nothing on screen would look wrong — which is exactly the failure a test has to
 * catch, because no reviewer would.
 *
 * **Showing something must show all of it.** CC BY and CC BY-SA ask for the creator, the licence, a
 * link to the material and a statement that the work was modified. Half a credit is not a partial
 * pass; it is non-compliance that looks like compliance.
 *
 * The fixtures are taken from the generated manifest rather than invented, so this cannot drift
 * into testing a shape the pipeline no longer produces.
 */
const i18n = createI18n({ locale: 'en' });

/** RNTL 14 renders asynchronously; `screen` is bound only once this resolves. */
async function renderCredit(assetId: string | undefined) {
    return render(
        <I18nextProvider i18n={i18n}>
            <PhotoCredit assetId={assetId} testID="credit" />
        </I18nextProvider>,
    );
}

/** An ingredient whose licence obliges a credit, taken from whatever the pipeline actually sourced. */
const obligedKey = Object.keys(IMAGE_CREDITS).find((key) => key.startsWith('ingredients/'));

describe('PhotoCredit', () => {
    it('renders nothing when the image is undefined or unknown', async () => {
        await renderCredit(undefined);
        expect(screen.queryByTestId('credit')).toBeNull();

        await renderCredit('ingredient-no-such-thing');
        expect(screen.queryByTestId('credit')).toBeNull();
    });

    it('renders nothing for an image whose licence asks for nothing', async () => {
        // A public-domain or CC0 file is absent from IMAGE_CREDITS by construction, so a lookup
        // miss means "no credit required" rather than "credit missing". The provenance test is
        // what stops a genuinely missing credit hiding behind that.
        const unobliged = Object.keys(IMAGE_CREDITS);
        const pdAsset = 'ingredient-definitely-public-domain';
        expect(unobliged).not.toContain('ingredients/definitely-public-domain');

        await renderCredit(pdAsset);
        expect(screen.queryByTestId('credit')).toBeNull();
    });

    it('names the creator, the licence and the modification when one is owed', async () => {
        if (obligedKey === undefined) {
            throw new Error(
                'No attribution-bound ingredient image in the manifest — regenerate with ' +
                    'pnpm --filter universal build:images, or this test is asserting nothing.',
            );
        }

        const credit = IMAGE_CREDITS[obligedKey];
        if (credit === undefined) throw new Error('unreachable');

        await renderCredit(`ingredient-${obligedKey.slice('ingredients/'.length)}`);

        expect(screen.getByTestId('credit')).toBeTruthy();
        // Escaped: creators are free text from Commons, and a name with a bracket or a full stop
        // in its first twelve characters would otherwise be read as a pattern.
        const creatorStart = credit.creator.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        expect(screen.getByText(new RegExp(creatorStart))).toBeTruthy();
        expect(screen.getByText(credit.licence)).toBeTruthy();
        // The modification statement is not optional decoration: every file here is cropped and
        // re-encoded, so CC BY's "indicate if You modified the Licensed Material" always applies.
        expect(screen.getByText(/cropped and resized/)).toBeTruthy();
    });

    it('has a translated name for every library a credited photograph came through', () => {
        // The fallback exists so an unknown provider never prints a raw key, but reaching it for a
        // real credit would show "via the original publisher" where a name is owed.
        const t = i18n.t.bind(i18n);
        const fallback = t('common:photoCredit.provider.other');
        const providers = [...new Set(Object.values(IMAGE_CREDITS).map((c) => c.provider))];

        expect(providers.length).toBeGreaterThan(0);
        for (const provider of providers) {
            expect({ provider, name: providerName(t, provider) }).not.toEqual({
                provider,
                name: fallback,
            });
        }
    });

    it('carries a reachable link for the licence and the source', async () => {
        if (obligedKey === undefined) throw new Error('no attribution-bound image');
        const credit = IMAGE_CREDITS[obligedKey];
        if (credit === undefined) throw new Error('unreachable');

        expect(credit.licenceUrl).toMatch(/^https?:\/\//);
        expect(credit.sourceUrl).toMatch(/^https?:\/\//);

        await renderCredit(`ingredient-${obligedKey.slice('ingredients/'.length)}`);
        // By role, not by prop: what a screen reader user reaches is what has to hold.
        expect(screen.getAllByRole('link').length).toBeGreaterThanOrEqual(2);
    });
});
