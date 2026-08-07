import { useTranslation } from 'react-i18next';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';

export interface BreadcrumbItem {
    readonly key: string;
    readonly label: string;
    /** Omit on the last item: an ancestor without a destination is the current page. */
    readonly onPress?: (() => void) | undefined;
    readonly testID?: string | undefined;
}

export const BREADCRUMB_TONES = ['default', 'canopy'] as const;
export type BreadcrumbTone = (typeof BREADCRUMB_TONES)[number];

export interface BreadcrumbsProps {
    readonly items: readonly BreadcrumbItem[];
    /** Landmark name. Defaults to the translated word for the trail. */
    readonly label?: string | undefined;
    /**
     * `canopy` for a trail sitting inside the hero band. It is a prop rather than a `className`
     * because the colours live on the *items*, and React Native text does not inherit colour
     * through a View — a class on the container would recolour nothing at all. Left as
     * `content-secondary`, the trail is 2.16:1 on the canopy.
     */
    readonly tone?: BreadcrumbTone | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Breadcrumb trail.
 *
 * It is a `navigation` landmark with its own name, because a page that carries both a primary
 * navigation and a breadcrumb trail otherwise presents a screen reader user with two identically
 * announced landmarks.
 *
 * The last crumb is *not* a link — it is the page you are already on — and carries
 * `aria-current="page"`. The separators are direction-aware chevrons that resolve their glyph from
 * the active locale, so the trail points the right way in Arabic without a transform.
 */
export function Breadcrumbs({
    items,
    label,
    tone = 'default',
    className,
    testID,
}: BreadcrumbsProps) {
    const { t } = useTranslation();
    const lastIndex = items.length - 1;
    const onCanopy = tone === 'canopy';
    // 75 and 90 rather than the §1.3 floor of 62: a trail is small text and the current crumb is
    // the one word in it that says where you are.
    const mutedClass = onCanopy ? 'text-content-on-canopy-muted/75' : 'text-content-secondary';
    const currentClass = onCanopy
        ? 'font-semibold text-content-on-canopy-muted/90'
        : 'font-semibold text-content-primary';

    return (
        <View
            testID={testID}
            role="navigation"
            aria-label={label ?? t('designSystem:breadcrumbs.label')}
            accessibilityLabel={label ?? t('designSystem:breadcrumbs.label')}
            className={cx('flex-row flex-wrap items-center gap-1', className)}
        >
            {items.map((item, index) => {
                const isCurrent = index === lastIndex;
                return (
                    <View key={item.key} className="flex-row items-center gap-1">
                        {index === 0 ? null : (
                            <Icon
                                name="chevronEnd"
                                size="sm"
                                className={mutedClass}
                                testID={
                                    testID === undefined
                                        ? undefined
                                        : `${testID}-separator-${String(index)}`
                                }
                            />
                        )}

                        {isCurrent || item.onPress === undefined ? (
                            <RNText
                                testID={item.testID}
                                aria-current={isCurrent ? 'page' : undefined}
                                numberOfLines={1}
                                className={cx(
                                    'text-sm text-start',
                                    isCurrent ? currentClass : mutedClass,
                                )}
                            >
                                {item.label}
                            </RNText>
                        ) : (
                            <Pressable
                                testID={item.testID}
                                role="link"
                                accessibilityRole="link"
                                accessibilityLabel={item.label}
                                focusable
                                onPress={item.onPress}
                                className="min-h-touch justify-center px-1"
                            >
                                <RNText
                                    numberOfLines={1}
                                    className={cx('text-sm underline text-start', mutedClass)}
                                >
                                    {item.label}
                                </RNText>
                            </Pressable>
                        )}
                    </View>
                );
            })}
        </View>
    );
}
