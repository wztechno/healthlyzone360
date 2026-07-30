import { useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';

import { Icon } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { Collapse } from '../motion/collapse.tsx';

export interface AccordionItem {
    readonly key: string;
    readonly title: string;
    readonly children: ReactNode;
    readonly disabled?: boolean | undefined;
    readonly testID?: string | undefined;
}

export interface AccordionProps {
    readonly items: readonly AccordionItem[];
    /** Controlled: supply this together with `onChange`. */
    readonly expandedKeys?: readonly string[] | undefined;
    /** Uncontrolled starting state. Ignored when `expandedKeys` is supplied. */
    readonly defaultExpandedKeys?: readonly string[] | undefined;
    readonly onChange?: ((keys: readonly string[]) => void) | undefined;
    /** Allow several panels open at once. Off by default. */
    readonly multiple?: boolean | undefined;
    readonly className?: string | undefined;
    readonly testID?: string | undefined;
}

/**
 * Accordion.
 *
 * Each header is a real button carrying `aria-expanded` and `aria-controls`, and each panel is a
 * `region` named by its header — which is what lets a screen reader user jump between panels
 * instead of reading the whole page. The panel element is always present so the `aria-controls`
 * reference always resolves, while its *contents* are unmounted once collapsed, so a closed panel
 * never leaves focusable controls in the tab order.
 *
 * The open and close motion is {@link Collapse}, which animates height: the reason to animate here
 * is that content below the panel jumps otherwise and the reader loses their place.
 */
export function Accordion({
    items,
    expandedKeys,
    defaultExpandedKeys,
    onChange,
    multiple = false,
    className,
    testID,
}: AccordionProps) {
    const generated = useId();
    const base = testID ?? `accordion-${generated.replace(/:/g, '')}`;
    const [internal, setInternal] = useState<readonly string[]>(defaultExpandedKeys ?? []);
    const open = expandedKeys ?? internal;

    const toggle = (key: string) => {
        const isOpen = open.includes(key);
        const next = isOpen
            ? open.filter((candidate) => candidate !== key)
            : multiple
              ? [...open, key]
              : [key];
        if (expandedKeys === undefined) setInternal(next);
        onChange?.(next);
    };

    return (
        <View
            testID={testID}
            className={cx(
                'flex-col overflow-hidden rounded-lg border border-stroke-subtle',
                className,
            )}
        >
            {items.map((item, index) => {
                const isOpen = open.includes(item.key);
                const headerId = `${base}-${item.key}-header`;
                const panelId = `${base}-${item.key}-panel`;
                const disabled = item.disabled === true;

                return (
                    <View
                        key={item.key}
                        className={cx(
                            'flex-col',
                            index === 0 ? null : 'border-t border-stroke-subtle',
                        )}
                    >
                        <Pressable
                            testID={item.testID ?? `${base}-${item.key}-header`}
                            nativeID={headerId}
                            role="button"
                            accessibilityRole="button"
                            accessibilityLabel={item.title}
                            aria-expanded={isOpen}
                            aria-controls={panelId}
                            accessibilityState={{ expanded: isOpen, disabled }}
                            aria-disabled={disabled}
                            disabled={disabled}
                            focusable={!disabled}
                            onPress={() => {
                                toggle(item.key);
                            }}
                            className={cx(
                                'min-h-touch flex-row items-center gap-2 px-4 py-3',
                                disabled ? 'opacity-50' : null,
                            )}
                        >
                            <RNText
                                numberOfLines={2}
                                className="flex-1 text-sm font-medium text-content-primary text-start"
                            >
                                {item.title}
                            </RNText>
                            <Icon
                                name={isOpen ? 'chevronUp' : 'chevronDown'}
                                size="sm"
                                className="text-content-secondary"
                            />
                        </Pressable>

                        <Collapse
                            testID={`${base}-${item.key}-panel`}
                            nativeID={panelId}
                            role="region"
                            aria-labelledby={headerId}
                            open={isOpen}
                        >
                            <View className="px-4 pb-4">{item.children}</View>
                        </Collapse>
                    </View>
                );
            })}
        </View>
    );
}
