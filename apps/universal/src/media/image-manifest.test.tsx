import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { IMAGE_ASSET_COUNT, IMAGE_ASSETS } from './image-manifest.generated.ts';
import { resolveEntityImage, resolveMarketingImage } from './entity-image.tsx';

/**
 * The manifest is generated from what is on disk (`scripts/build-image-manifest.mjs`). This test is
 * the drift guard: it re-derives the keys from `assets/images/` and fails if the committed manifest
 * disagrees — the same contract the design-tokens drift test enforces — plus a few resolver mappings
 * so a renamed family or a broken meal→dish table is caught here rather than as a blank card.
 */
const imagesRoot = join(__dirname, '..', '..', 'assets', 'images');

function keysOnDisk(): string[] {
    const keys: string[] = [];
    for (const family of readdirSync(imagesRoot)) {
        const familyDir = join(imagesRoot, family);
        if (!statSync(familyDir).isDirectory()) continue;
        for (const file of readdirSync(familyDir)) {
            if (file.endsWith('.webp')) keys.push(`${family}/${file.replace(/\.webp$/, '')}`);
        }
    }
    return keys.sort();
}

describe('bundled image manifest', () => {
    it('matches the WebP assets on disk (regenerate with pnpm --filter universal build:images)', () => {
        const disk = keysOnDisk();
        expect(Object.keys(IMAGE_ASSETS).sort()).toEqual(disk);
        expect(IMAGE_ASSET_COUNT).toBe(disk.length);
    });

    it('resolves every asset to a truthy bundled reference', () => {
        for (const value of Object.values(IMAGE_ASSETS)) {
            expect(value).toBeTruthy();
        }
    });
});

describe('resolveEntityImage', () => {
    it('maps a marketplace meal to its dish photo (40 meals share 20 dishes)', () => {
        expect(resolveEntityImage('meal-verdant-herb-garden-bowl', 'card')).toBeTruthy();
        expect(resolveEntityImage('meal-riverstone-training-freekeh', 'detail')).toBeTruthy();
        // Both of the above are built from the same recipe, so they resolve to the same dish photo.
        expect(resolveEntityImage('meal-verdant-herb-garden-bowl', 'card')).toBe(
            resolveEntityImage('meal-riverstone-training-freekeh', 'card'),
        );
    });

    it('maps recipes, kitchens, plans, dietitians and diet hubs', () => {
        expect(resolveEntityImage('recipe-herbed-chicken-freekeh', 'detail')).toBeTruthy();
        expect(resolveEntityImage('kitchen-verdant-kitchen', 'card')).toBeTruthy();
        expect(resolveEntityImage('plan-balanced-week', 'card')).toBeTruthy();
        expect(resolveEntityImage('dietitian-layla-haddad', 'card')).toBeTruthy();
        expect(resolveEntityImage('diet-high-protein', 'detail')).toBeTruthy();
    });

    it('falls back to null for unknown ids and undefined', () => {
        expect(resolveEntityImage('meal-does-not-exist', 'card')).toBeNull();
        expect(resolveEntityImage('gibberish', 'card')).toBeNull();
        expect(resolveEntityImage(undefined, 'card')).toBeNull();
    });
});

describe('resolveMarketingImage', () => {
    it('resolves marketing slots by manifest key and null otherwise', () => {
        expect(resolveMarketingImage('landing/hero.hero')).toBeTruthy();
        expect(resolveMarketingImage('nope/missing.tile')).toBeNull();
    });
});
