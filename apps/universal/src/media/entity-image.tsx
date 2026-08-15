import { Avatar, ImagePlaceholder } from '@healthy360/design-system';
import type { AvatarSize } from '@healthy360/design-system';
import type { ReactNode } from 'react';
import { Image, Text as RNText, View } from 'react-native';
import type { ImageRequireSource } from 'react-native';

import { IMAGE_ASSETS } from './image-manifest.generated.ts';

/**
 * Real photography for the fixture-backed image slots, with the generated pattern placeholder as the
 * fallback for anything unmapped.
 *
 * The prototype's photographs are bundled, same-origin WebP (the `no-external-requests` e2e gate
 * forbids any other kind), keyed by the fixture `imagePlaceholderId`. This module turns that id into
 * a manifest key and renders a real `<Image>` when one exists — otherwise it delegates to the design
 * system's {@link ImagePlaceholder}/{@link Avatar}, so an unmapped meal, a synthetic showcase seed,
 * or a future fixture still renders something rather than a blank box, and every existing testID is
 * preserved because the wrapper carries it in both branches.
 *
 * The photos are illustrative licensed stock, not photographs of real Healthy360 products; the
 * fixtures they decorate remain labelled synthetic on screen. Attribution is in
 * `assets/images/CREDITS.md`.
 */

const cx = (...parts: Array<string | undefined | false>): string => parts.filter(Boolean).join(' ');

/**
 * Note that `aspect` and `variant` are different questions and neither implies the other. `variant`
 * picks which *file* to load (`card` ≈640w, `detail` ≈1280w); `aspect` picks the shape of the frame
 * it is drawn in. A card at `variant="card"` usually wants `aspect="card"`, but a 4:3 crop of the
 * detail-resolution file is a perfectly sensible thing to ask for.
 */
export type EntityImageAspect = 'square' | 'wide' | 'tall' | 'card';
export type EntityImageVariant = 'card' | 'detail';

const ASPECT_CLASS: Readonly<Record<EntityImageAspect, string>> = {
    square: 'aspect-square',
    wide: 'aspect-video',
    tall: 'aspect-[3/4]',
    // 4:3 for a grid card — a taller crop so the dish fills the frame. `wide` stays 16:9 for the
    // detail page, which is why this is a new aspect rather than a redefinition of that one.
    card: 'aspect-[4/3]',
};

const AVATAR_SIZE_CLASS: Readonly<Record<AvatarSize, string>> = {
    sm: 'h-8 w-8',
    md: 'h-10 w-10',
    lg: 'h-12 w-12',
    xl: 'h-16 w-16',
};

/**
 * Which dish photograph a marketplace meal or recipe shows.
 *
 * Forty meals are built from twenty recipes, so the twenty dish photographs are reused across them —
 * a meal and its larger-portion sibling are literally the same dish. This table mirrors the
 * meal→recipe relationship in the prototype fixtures; it is duplicated here rather than imported
 * because app code may not import the mock world (an eslint-enforced invariant), and the mapping is a
 * stable fact of the fixture set. Keys are the meal `imagePlaceholderId` minus its `meal-` prefix;
 * values are the dish photo base name (the recipe key).
 */
const DISH_FOR_MEAL: Readonly<Record<string, string>> = {
    // The API demonstration menu is separate from the 40-meal prototype world
    // below.  These use the same locally bundled, credited Unsplash assets at
    // the card/detail dimensions, so API mode remains fully offline.
    'grilled-chicken-freekeh': 'herbed-chicken-freekeh',
    'mezze-plate': 'charred-aubergine-chickpea',
    'red-lentil-soup': 'spiced-lentil-pumpkin-stew',
    'verdant-herb-garden-bowl': 'herbed-chicken-freekeh',
    'riverstone-training-freekeh': 'herbed-chicken-freekeh',
    'saffron-tahini-salmon-tray': 'lemon-tahini-salmon',
    'verdant-lemon-salmon-plate': 'lemon-tahini-salmon',
    'verdant-pumpkin-lentil-pot': 'spiced-lentil-pumpkin-stew',
    'daily-pot-house-lentil-stew': 'spiced-lentil-pumpkin-stew',
    'daily-pot-halloumi-plate': 'grilled-halloumi-rocket',
    'verdant-halloumi-garden-plate': 'grilled-halloumi-rocket',
    'daily-pot-braised-lamb': 'slow-braised-lamb-bulgur',
    'riverstone-lamb-recovery-plate': 'slow-braised-lamb-bulgur',
    'verdant-aubergine-chickpea-bowl': 'charred-aubergine-chickpea',
    'saffron-aubergine-mezze': 'charred-aubergine-chickpea',
    'verdant-morning-oats': 'morning-oats-dates-almonds',
    'daily-pot-counter-oats': 'morning-oats-dates-almonds',
    'daily-pot-garden-omelette': 'garden-omelette-spinach',
    'verdant-spinach-omelette-box': 'garden-omelette-spinach',
    'saffron-harbour-prawn-bowl': 'harbour-prawn-quinoa',
    'riverstone-prawn-protein-bowl': 'harbour-prawn-quinoa',
    'verdant-tempeh-stir-fry': 'tempeh-broccoli-stir-fry',
    'riverstone-tempeh-power-bowl': 'tempeh-broccoli-stir-fry',
    'daily-pot-labneh-breakfast': 'sunrise-labneh-sourdough',
    'verdant-sunrise-labneh-box': 'sunrise-labneh-sourdough',
    'verdant-cauliflower-wrap': 'roasted-cauliflower-wrap',
    'daily-pot-cauliflower-roll': 'roasted-cauliflower-wrap',
    'saffron-citrus-sea-bass': 'citrus-sea-bass-green-beans',
    'riverstone-sea-bass-lean-plate': 'citrus-sea-bass-green-beans',
    'riverstone-turkey-hash': 'turkey-sweet-potato-hash',
    'daily-pot-weeknight-hash': 'turkey-sweet-potato-hash',
    'daily-pot-courgette-pasta': 'courgette-walnut-pasta',
    'saffron-walnut-pasta-plate': 'courgette-walnut-pasta',
    'daily-pot-bean-chilli': 'red-bean-pepper-chilli',
    'riverstone-chilli-batch-bowl': 'red-bean-pepper-chilli',
    'riverstone-mint-chicken-skewers': 'mint-yoghurt-chicken-skewers',
    'daily-pot-grill-skewers': 'mint-yoghurt-chicken-skewers',
    'verdant-pistachio-yoghurt-pot': 'pistachio-pomegranate-bowl',
    'saffron-pomegranate-pot': 'pistachio-pomegranate-bowl',
    'riverstone-smoky-tofu-bowl': 'smoky-tofu-kale-bowl',
    'verdant-tofu-kale-box': 'smoky-tofu-kale-bowl',
    'saffron-calamari-salad': 'calamari-rocket-salad',
    'daily-pot-calamari-plate': 'calamari-rocket-salad',
};

/** Turns a fixture `imagePlaceholderId` into a manifest key, or null when there is no photo family. */
function manifestKey(placeholderId: string, variant: EntityImageVariant): string | null {
    const dash = placeholderId.indexOf('-');
    if (dash === -1) return null;
    const kind = placeholderId.slice(0, dash);
    const rest = placeholderId.slice(dash + 1);

    switch (kind) {
        case 'meal': {
            const dish = DISH_FOR_MEAL[rest];
            return dish ? `dishes/${dish}.${variant}` : null;
        }
        case 'recipe':
            return `dishes/${rest}.${variant}`;
        case 'kitchen':
            return `kitchens/${rest}.${variant}`;
        case 'plan':
            return `plans/${rest}.${variant}`;
        case 'dietitian':
            return `dietitians/${rest}.portrait`;
        case 'diet':
            return `diets/${rest}.hero`;
        default:
            return null;
    }
}

/** The bundled photo for a fixture `imagePlaceholderId`, or null to fall back to the placeholder. */
export function resolveEntityImage(
    placeholderId: string | undefined,
    variant: EntityImageVariant,
): ImageRequireSource | null {
    if (placeholderId === undefined) return null;
    const key = manifestKey(placeholderId, variant);
    return key === null ? null : (IMAGE_ASSETS[key] ?? null);
}

/** The bundled photo for a marketing slot, addressed by manifest key directly (e.g. `landing/hero.hero`). */
export function resolveMarketingImage(key: string): ImageRequireSource | null {
    return IMAGE_ASSETS[key] ?? null;
}

export interface EntityImageProps {
    /** The fixture `imagePlaceholderId`. When it maps to a bundled photo, that photo is shown. */
    readonly assetId?: string | undefined;
    /** A resolved asset (e.g. from {@link resolveMarketingImage}); takes precedence over `assetId`. */
    readonly source?: ImageRequireSource | null | undefined;
    /** Which sized variant to prefer for entities that ship both (`card` ~640w, `detail` ~1280w). */
    readonly variant?: EntityImageVariant | undefined;
    /** Fallback pattern seed and accessible label, forwarded to the placeholder when unmapped. */
    readonly seed: string;
    readonly label: string;
    readonly aspect?: EntityImageAspect | undefined;
    /**
     * Decorative photography sits beside a heading that already carries the meaning, so it is hidden
     * from assistive technology (WCAG H67) rather than announced twice. Used by the marketing slots.
     */
    readonly decorative?: boolean | undefined;
    /**
     * Drops the image's own 12px radius, for media sitting flush inside a clipped card. Without it
     * a 12px image floats inside a 16px card and the corners visibly disagree.
     *
     * A prop rather than a `className="rounded-none"` override, because the local {@link cx} is a
     * plain join: the last class in the string does not win, the more specific CSS rule does, and
     * between two same-specificity utilities that is stylesheet order rather than call-site order.
     */
    readonly flush?: boolean | undefined;
    /** Top-leading overlay — a kitchen name, a verified mark. Rendered over either branch. */
    readonly overlayStart?: ReactNode | undefined;
    /** Bottom-trailing overlay — a price tag, a duration. */
    readonly overlayEnd?: ReactNode | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * An entity photograph — a real bundled image when one exists, the generated pattern otherwise.
 *
 * The wrapper carries the `testID` in both branches so callers keep their `${id}-image` handle, and
 * the accessible name is on the image itself so a screen reader announces the meal/kitchen/plan
 * rather than "image" (unless `decorative`, where the image is hidden from assistive technology).
 */
export function EntityImage({
    assetId,
    source,
    variant = 'card',
    seed,
    label,
    aspect = 'wide',
    decorative = false,
    flush = false,
    overlayStart,
    overlayEnd,
    className,
    testID,
}: EntityImageProps) {
    const resolved = source !== undefined ? source : resolveEntityImage(assetId, variant);
    const hasOverlay = overlayStart !== undefined || overlayEnd !== undefined;

    // Overlays are positioned against a wrapper that both branches share, so a chip does not
    // vanish the moment a fixture has no photograph and falls back to the generated pattern.
    // Without overlays there is no wrapper at all — an extra View per image, on a grid of forty,
    // for nothing.
    const withOverlays = (media: ReactNode) =>
        hasOverlay ? (
            <View className="relative w-full">
                {media}
                {overlayStart === undefined ? null : (
                    <View className="absolute start-2 top-2 flex-row">{overlayStart}</View>
                )}
                {overlayEnd === undefined ? null : (
                    <View className="absolute bottom-2 end-2 flex-row">{overlayEnd}</View>
                )}
            </View>
        ) : (
            media
        );

    if (resolved === null || resolved === undefined) {
        return withOverlays(
            <ImagePlaceholder
                testID={testID}
                seed={seed}
                label={label}
                aspect={aspect}
                flush={flush}
                className={className}
            />,
        );
    }

    return withOverlays(
        <View
            testID={testID}
            aria-hidden={decorative}
            accessibilityElementsHidden={decorative}
            importantForAccessibility={decorative ? 'no-hide-descendants' : undefined}
            className={cx(
                'w-full overflow-hidden',
                !flush && 'rounded-lg',
                ASPECT_CLASS[aspect],
                className,
            )}
        >
            <Image
                accessibilityLabel={decorative ? undefined : label}
                alt={decorative ? '' : label}
                source={resolved}
                resizeMode="cover"
                style={{ width: '100%', height: '100%' }}
            />
        </View>,
    );
}

export interface MediaChipProps {
    readonly label: string;
    readonly testID?: string | undefined;
}

/**
 * A label that sits on top of photography — a kitchen name, a verified mark.
 *
 * The fill is the canopy at 80% rather than a neutral scrim, and it is deliberately near-opaque:
 * a chip over an unknown photograph cannot rely on the image behind it for contrast, and the worst
 * case here (the chip over a pure-white photo) still puts white text at 6.9:1. A lighter wash would
 * be legible over the dish photographs currently in the manifest and illegible over the next batch.
 *
 *
 * RNText throughout, never the design system's `Text`.
 *
 * `Text` emits its own variant and tone classes ahead of a caller's `className`, and which colour
 * actually wins is decided by stylesheet order rather than by the order they appear in the
 * attribute. This chip shipped as `text-content-primary` on the canopy — 2.13:1, which the axe
 * suite caught — despite asking for `text-content-on-canopy` right there in its className.
 * Anything that states its own colour on a dark surface says so with a plain RNText.
 */
export function MediaChip({ label, testID }: MediaChipProps) {
    return (
        <View testID={testID} className="rounded-full bg-surface-canopy/80 px-3 py-1">
            <RNText className="text-xs font-bold text-content-on-canopy">{label}</RNText>
        </View>
    );
}

export interface EntityAvatarProps {
    /** The fixture `imagePlaceholderId`. When it maps to a portrait, that portrait is shown. */
    readonly assetId?: string | undefined;
    /** Announced as the accessible name and shown as initials in the fallback. */
    readonly name: string;
    /** Keeps the fallback colour stable across renames (an id rather than the display name). */
    readonly seed?: string | undefined;
    readonly size?: AvatarSize | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * A person's portrait — a real bundled photo when one exists, the generated initials avatar
 * otherwise. Mirrors {@link Avatar}'s testID/size contract so the dietitian card and profile slots
 * are unchanged apart from gaining a photograph.
 */
export function EntityAvatar({
    assetId,
    name,
    seed,
    size = 'md',
    className,
    testID,
}: EntityAvatarProps) {
    const source = resolveEntityImage(assetId, 'card');

    if (source === null) {
        return <Avatar name={name} seed={seed} size={size} className={className} testID={testID} />;
    }

    return (
        <View
            testID={testID}
            className={cx('overflow-hidden rounded-full', AVATAR_SIZE_CLASS[size], className)}
        >
            <Image
                accessibilityLabel={name}
                alt={name}
                source={source}
                resizeMode="cover"
                style={{ width: '100%', height: '100%' }}
            />
        </View>
    );
}
