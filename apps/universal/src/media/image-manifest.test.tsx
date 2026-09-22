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
        // The three original API demo meals reuse photographs from the customer prototype too.
        // Keeping these here means API mode cannot silently regress to patterned placeholders.
        expect(resolveEntityImage('meal-grilled-chicken-freekeh', 'card')).toBeTruthy();
        expect(resolveEntityImage('meal-mezze-plate', 'card')).toBeTruthy();
        expect(resolveEntityImage('meal-red-lentil-soup', 'card')).toBeTruthy();
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

    it('sends an ingredient to its one square file, whatever variant is asked for', () => {
        // `thumb` is a single file per ingredient, so the variant is ignored — the same
        // contract `dietitian` and `diet` have. A 20px row and an 80px detail pane both
        // want the square, not a 16:9 crop of it.
        expect(resolveEntityImage('ingredient-black-pepper', 'card')).toBe(
            resolveEntityImage('ingredient-black-pepper', 'detail'),
        );
    });

    it('keeps hyphenated slugs whole', () => {
        // The resolver splits on the FIRST dash only. If it ever split on the last, every
        // multi-word slug would address a family that does not exist and quietly fall back
        // to the generated pattern — a miss that looks like a design choice.
        expect(resolveEntityImage('ingredient-apple-cider-vinegar', 'card')).toBe(
            IMAGE_ASSETS['ingredients/apple-cider-vinegar.thumb'] ?? null,
        );
    });

    it('sends a catalogue item with no prototype recipe to its own photograph', () => {
        // The prototype's forty meals alias onto twenty dish photos because they are
        // portions of the same dish. Everything else owns its picture.
        expect(resolveEntityImage('meal-chicken-crispy', 'card')).toBe(
            IMAGE_ASSETS['meals/chicken-crispy.card'] ?? null,
        );
        expect(resolveEntityImage('meal-verdant-herb-garden-bowl', 'card')).toBe(
            IMAGE_ASSETS['dishes/herbed-chicken-freekeh.card'] ?? null,
        );
    });

    it('resolves an imported catalogue item, which arrives as `product-`', () => {
        // The importer writes every row as CatalogueItemType::Product and the marketplace
        // presenter derives the id from that, so a HealthZone360 dish is `product-<slug>`.
        // The v6 stand-in table this replaced was keyed on `meal-` and therefore never fired;
        // if this assertion ever goes back to null, thirty-eight dishes have silently lost
        // their photographs again.
        expect(resolveEntityImage('product-chicken-crispy', 'card')).toBe(
            IMAGE_ASSETS['meals/chicken-crispy.card'] ?? null,
        );
        expect(resolveEntityImage('product-chicken-crispy', 'card')).toBe(
            resolveEntityImage('meal-chicken-crispy', 'card'),
        );
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
