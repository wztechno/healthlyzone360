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

export interface BreadcrumbsProps {
    readonly items: readonly BreadcrumbItem[];
    /** Landmark name. Defaults to the translated word for the trail. */
    readonly label?: string | undefined;
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
export function Breadcrumbs({ items, label, className, testID }: BreadcrumbsProps) {
    const { t } = useTranslation();
    const lastIndex = items.length - 1;

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
                                className="text-content-secondary"
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
                                    isCurrent
                                        ? 'font-semibold text-content-primary'
                                        : 'text-content-secondary',
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
                                    className="text-sm text-content-secondary underline text-start"
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
