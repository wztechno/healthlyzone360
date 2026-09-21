import { useEffect, useMemo, useRef, useState } from 'react';
import {
    Modal,
    Platform,
    Pressable,
    Text as RNText,
    ScrollView,
    TextInput,
    View,
} from 'react-native';

import { neutral } from '@healthy360/design-tokens';

import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { cx } from '../internal/class-names.ts';
import { FadeIn } from '../motion/fade-in.tsx';

/**
 * CommandPalette — "type to go somewhere", opened from a search box or a shortcut.
 *
 * ```
 * ┌──────────────────────────────────────────────┐
 * │ ⌕  Type to search pages…                     │
 * ├──────────────────────────────────────────────┤
 * │ CATALOGUE                                    │
 * │ ▌ ⌂ Ingredients                    ← active  │
 * │   ▢ Recipes                                  │
 * │ OPERATIONS                                   │
 * │   ▢ Orders                                   │
 * ├──────────────────────────────────────────────┤
 * │ ↑↓ to move   ↵ to open   esc to close        │
 * └──────────────────────────────────────────────┘
 * ```
 *
 * A window, not a dropdown: it sits in the upper third of the screen over a dimmed page, because
 * a reader who pressed Ctrl K has left the page they were on and is looking for another one. Built
 * on React Native's `Modal`, like `Dialog`, which is what gives it a portal and a focus trap on the
 * web for free.
 *
 * ## Matching
 *
 * Every word typed must appear in the item's label, its group or its keywords, case- and
 * accent-insensitively; an item whose label *starts* with the query ranks first. That is enough
 * for a list of pages — the reader knows the word they are after — and it behaves the same in
 * Arabic, where there is no case to fold.
 *
 * ## Keys
 *
 * The field keeps focus the whole time. ↑ and ↓ move the highlight and wrap at the ends, Enter
 * opens the highlighted item, Escape closes. The highlight resets to the first result whenever the
 * query changes, so typing and then pressing Enter always opens the best match.
 *
 * The component is presentational: the caller owns `open`, and the caller owns the shortcut that
 * sets it (see `useCommandShortcut`), because which key opens which palette is the area's business.
 */

export interface CommandPaletteItem {
    readonly key: string;
    readonly label: string;
    readonly icon?: IconName | undefined;
    /** The heading the item is listed under. Items with none are listed first, unheaded. */
    readonly group?: string | undefined;
    /** Other words the item answers to, which are matched but not shown. */
    readonly keywords?: readonly string[] | undefined;
    /** A figure beside the label — a queue count. */
    readonly count?: number | undefined;
    readonly onSelect: () => void;
    readonly testID?: string | undefined;
}

export interface CommandPaletteProps {
    readonly open: boolean;
    readonly onClose: () => void;
    readonly items: readonly CommandPaletteItem[];
    /** The window's accessible name. */
    readonly label: string;
    readonly placeholder: string;
    /** Shown when nothing matches; `{query}` is not interpolated here — pass the finished line. */
    readonly emptyText: (query: string) => string;
    /** The footer's three key hints, translated: move, open, close. */
    readonly hints: { readonly move: string; readonly open: string; readonly close: string };
    /** Heading for items with no `group`. */
    readonly ungroupedLabel?: string | undefined;
    readonly testID?: string | undefined;
}

function fold(text: string): string {
    return text
        .normalize('NFD')
        .replace(/\p{Diacritic}/gu, '')
        .toLocaleLowerCase();
}

/** The items that match every word of the query, best first, in the caller's order otherwise. */
export function filterCommandItems(
    items: readonly CommandPaletteItem[],
    query: string,
): readonly CommandPaletteItem[] {
    const words = fold(query)
        .split(/\s+/)
        .filter((word) => word !== '');
    if (words.length === 0) return items;
    const scored = items
        .map((item, index) => {
            const label = fold(item.label);
            const haystack = [
                label,
                fold(item.group ?? ''),
                ...(item.keywords ?? []).map(fold),
            ].join(' ');
            if (!words.every((word) => haystack.includes(word))) return null;
            const rank = label.startsWith(words.join(' ')) ? 0 : label.includes(words[0]!) ? 1 : 2;
            return { item, index, rank };
        })
        .filter(
            (entry): entry is { item: CommandPaletteItem; index: number; rank: number } =>
                entry !== null,
        );
    scored.sort((a, b) => a.rank - b.rank || a.index - b.index);
    return scored.map((entry) => entry.item);
}

interface KeyEvent {
    readonly nativeEvent: { readonly key: string };
    readonly preventDefault?: () => void;
}

export function CommandPalette({
    open,
    onClose,
    items,
    label,
    placeholder,
    emptyText,
    hints,
    ungroupedLabel,
    testID = 'command-palette',
}: CommandPaletteProps) {
    const [query, setQuery] = useState('');
    const [active, setActive] = useState(0);
    const rowRefs = useRef(new Map<string, unknown>());

    // A fresh palette every time it opens: yesterday's query is not what anybody is looking for.
    useEffect(() => {
        if (open) {
            setQuery('');
            setActive(0);
        }
    }, [open]);

    const results = useMemo(() => filterCommandItems(items, query), [items, query]);

    useEffect(() => {
        setActive(0);
    }, [query]);

    const choose = (item: CommandPaletteItem | undefined) => {
        if (item === undefined) return;
        onClose();
        item.onSelect();
    };

    // Results in their groups, ungrouped first, each group in the order its first item arrived.
    const sections = useMemo(() => {
        const order: (string | undefined)[] = [];
        const byGroup = new Map<string | undefined, CommandPaletteItem[]>();
        for (const item of results) {
            if (!byGroup.has(item.group)) {
                byGroup.set(item.group, []);
                order.push(item.group);
            }
            byGroup.get(item.group)!.push(item);
        }
        // Browsing, the ungrouped pages lead. Searching, the group of the best match leads, so the
        // first row on screen is the one Enter opens.
        // (By hand, not `sort`: `Array.prototype.sort` moves `undefined` to the end without ever
        // asking the comparator, which is exactly the entry this wants first.)
        const leading =
            query.trim() === '' && order.includes(undefined)
                ? [undefined, ...order.filter((group) => group !== undefined)]
                : order;
        return leading.map((group) => ({ group, items: byGroup.get(group)! }));
    }, [results, query]);

    // The flat order the arrows walk, which is the grouped order on screen.
    const flat = sections.flatMap((section) => section.items);

    // Keep the highlighted row in view as the arrows walk past the scroll port's edge.
    const activeKey = flat[active]?.key;
    useEffect(() => {
        if (Platform.OS !== 'web' || activeKey === undefined) return;
        const node = rowRefs.current.get(activeKey) as {
            scrollIntoView?: (options: { block: string }) => void;
        } | null;
        node?.scrollIntoView?.({ block: 'nearest' });
    }, [activeKey]);

    const onKeyPress = (event: KeyEvent) => {
        const key = event.nativeEvent.key;
        if (flat.length === 0) return;
        if (key === 'ArrowDown') {
            event.preventDefault?.();
            setActive((current) => (current + 1) % flat.length);
        } else if (key === 'ArrowUp') {
            event.preventDefault?.();
            setActive((current) => (current - 1 + flat.length) % flat.length);
        } else if (key === 'Escape') {
            onClose();
        }
    };

    return (
        <Modal visible={open} transparent animationType="none" onRequestClose={onClose}>
            <View className="flex-1 items-center px-4 pt-[12vh]">
                <Pressable
                    testID={`${testID}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="absolute inset-0 bg-overlay"
                />
                {/* The bound is on a plain View: `FadeIn` is an Animated.View, which drops
                    `className` on the web. See the same note in `dialog.tsx`. */}
                <View className="w-full max-w-[640px]">
                    <FadeIn duration="fast">
                        <View
                            testID={testID}
                            role="dialog"
                            aria-modal
                            aria-label={label}
                            accessibilityLabel={label}
                            className="max-h-[70vh] w-full flex-col overflow-hidden rounded-xl bg-surface-raised shadow-elevation-4"
                        >
                            <View className="flex-row items-center gap-3 border-b border-stroke-subtle px-5 py-4">
                                <Icon name="searchLens" className="text-content-secondary" />
                                <TextInput
                                    testID={`${testID}-input`}
                                    value={query}
                                    onChangeText={setQuery}
                                    placeholder={placeholder}
                                    accessibilityLabel={label}
                                    aria-label={label}
                                    autoFocus
                                    autoCorrect={false}
                                    autoCapitalize="none"
                                    returnKeyType="go"
                                    onKeyPress={onKeyPress}
                                    onSubmitEditing={() => {
                                        choose(flat[active]);
                                    }}
                                    className="min-w-0 flex-1 text-base text-content-primary text-start web:outline-none"
                                    // neutral.600, as `TextInputField` uses: placeholder text is
                                    // still text to WCAG.
                                    placeholderTextColor={neutral[600]}
                                />
                            </View>

                            <ScrollView
                                testID={`${testID}-results`}
                                className="min-h-0 shrink"
                                contentContainerClassName="flex-col px-2 py-2"
                                keyboardShouldPersistTaps="handled"
                            >
                                {flat.length === 0 ? (
                                    <RNText
                                        testID={`${testID}-empty`}
                                        className="px-3 py-6 text-center text-sm text-content-secondary"
                                    >
                                        {emptyText(query)}
                                    </RNText>
                                ) : (
                                    sections.map((section) => (
                                        <View key={section.group ?? '—'} className="flex-col">
                                            {section.group === undefined &&
                                            ungroupedLabel === undefined ? null : (
                                                <RNText
                                                    accessibilityRole="header"
                                                    className="px-3 pb-1 pt-3 text-xs font-semibold uppercase tracking-wider text-content-secondary text-start"
                                                >
                                                    {section.group ?? ungroupedLabel}
                                                </RNText>
                                            )}
                                            {section.items.map((item) => {
                                                const highlighted = flat[active]?.key === item.key;
                                                return (
                                                    <Pressable
                                                        key={item.key}
                                                        ref={(node) => {
                                                            if (node === null)
                                                                rowRefs.current.delete(item.key);
                                                            else
                                                                rowRefs.current.set(item.key, node);
                                                        }}
                                                        testID={
                                                            item.testID ??
                                                            `${testID}-item-${item.key}`
                                                        }
                                                        role="option"
                                                        accessibilityRole="button"
                                                        accessibilityLabel={item.label}
                                                        aria-selected={highlighted}
                                                        accessibilityState={{
                                                            selected: highlighted,
                                                        }}
                                                        onHoverIn={() => {
                                                            setActive(flat.indexOf(item));
                                                        }}
                                                        onPress={() => {
                                                            choose(item);
                                                        }}
                                                        className={cx(
                                                            'flex-row items-center gap-3 rounded-lg px-3 py-2.5',
                                                            highlighted
                                                                ? 'bg-surface-brand-subtle'
                                                                : 'bg-transparent',
                                                        )}
                                                    >
                                                        <Icon
                                                            name={item.icon ?? 'dot'}
                                                            className={
                                                                highlighted
                                                                    ? 'text-content-on-brand-subtle'
                                                                    : 'text-content-secondary'
                                                            }
                                                        />
                                                        <RNText
                                                            numberOfLines={1}
                                                            className={cx(
                                                                'min-w-0 flex-1 text-sm text-start',
                                                                highlighted
                                                                    ? 'font-medium text-content-on-brand-subtle'
                                                                    : 'text-content-primary',
                                                            )}
                                                        >
                                                            {item.label}
                                                        </RNText>
                                                        {item.count === undefined ||
                                                        item.count === 0 ? null : (
                                                            <RNText className="rounded-full bg-warning-subtle px-2 py-0.5 text-xs font-semibold text-warning-on-subtle">
                                                                {String(item.count)}
                                                            </RNText>
                                                        )}
                                                    </Pressable>
                                                );
                                            })}
                                        </View>
                                    ))
                                )}
                            </ScrollView>

                            <View
                                testID={`${testID}-hints`}
                                className="flex-row items-center gap-4 border-t border-stroke-subtle px-5 py-2.5"
                            >
                                <Hint keys="↑ ↓" text={hints.move} />
                                <Hint keys="↵" text={hints.open} />
                                <Hint keys="esc" text={hints.close} />
                            </View>
                        </View>
                    </FadeIn>
                </View>
            </View>
        </Modal>
    );
}

function Hint({ keys, text }: { readonly keys: string; readonly text: string }) {
    return (
        <View className="flex-row items-center gap-1.5">
            <RNText className="rounded border border-stroke-subtle bg-surface-sunken px-1.5 py-0.5 text-xs text-content-secondary">
                {keys}
            </RNText>
            <RNText className="text-xs text-content-secondary">{text}</RNText>
        </View>
    );
}

/**
 * Ctrl K — or ⌘K on a Mac — anywhere on the page, on the web. Native has no keyboard to listen to,
 * and the listener is removed with the component that registered it.
 */
export function useCommandShortcut(onTrigger: () => void, key = 'k'): void {
    const latest = useRef(onTrigger);
    latest.current = onTrigger;
    useEffect(() => {
        if (Platform.OS !== 'web' || typeof document === 'undefined') return;
        const onKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === key) {
                event.preventDefault();
                latest.current();
            }
        };
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [key]);
}

/** "⌘ K" on Apple platforms, "Ctrl K" everywhere else — what the shortcut chip says. */
export function commandShortcutLabel(key = 'K'): string {
    const apple =
        Platform.OS === 'ios' ||
        (typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? ''));
    return apple ? `⌘ ${key}` : `Ctrl ${key}`;
}
