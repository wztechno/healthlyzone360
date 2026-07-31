import { Avatar, ImagePlaceholder } from '@healthy360/design-system';
import type { AvatarSize } from '@healthy360/design-system';
import { Image, View } from 'react-native';
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

export type EntityImageAspect = 'square' | 'wide' | 'tall';
export type EntityImageVariant = 'card' | 'detail';

const ASPECT_CLASS: Readonly<Record<EntityImageAspect, string>> = {
    square: 'aspect-square',
    wide: 'aspect-video',
    tall: 'aspect-[3/4]',
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
    className,
    testID,
}: EntityImageProps) {
    const resolved = source !== undefined ? source : resolveEntityImage(assetId, variant);

    if (resolved === null || resolved === undefined) {
        return (
            <ImagePlaceholder
                testID={testID}
                seed={seed}
                label={label}
                aspect={aspect}
                className={className}
            />
        );
    }

    return (
        <View
            testID={testID}
            aria-hidden={decorative}
            accessibilityElementsHidden={decorative}
            importantForAccessibility={decorative ? 'no-hide-descendants' : undefined}
            className={cx('w-full overflow-hidden rounded-lg', ASPECT_CLASS[aspect], className)}
        >
            <Image
                accessibilityLabel={decorative ? undefined : label}
                alt={decorative ? '' : label}
                source={resolved}
                resizeMode="cover"
                style={{ width: '100%', height: '100%' }}
            />
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
