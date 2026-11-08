import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
    Modal,
    Pressable,
    Text as RNText,
    ScrollView,
    View,
    useWindowDimensions,
} from 'react-native';

import { IconButton } from '../actions/button.tsx';
import { ContentWidthProvider } from '../hooks/use-content-width.tsx';
import { Icon } from '../icons/icon.tsx';
import type { IconName } from '../icons/icon.tsx';
import { FadeIn } from '../motion/fade-in.tsx';
import { Menu } from './menu.tsx';
import type { MenuItem, MenuSection } from './menu.tsx';

/**
 * RecordDialog — one record, opened over the list it was picked from (the `View as a pop-up`
 * canvas, 2026-11-07).
 *
 * ```
 * ┌──────────────────────────────────────────── 880, max viewport − 64 ┐
 * │ INGREDIENT                                              [⋯] [✕]    │  sticky
 * │ ┌ canopy ───────────────────────────────────────────────────────┐  │
 * │ └───────────────────────────────────────────────────────────────┘  │
 * │ ┌ tile ─────────────────────┐ ┌ tile ─────────────┐                │  scrolls
 * └────────────────────────────────────────────────────────────────────┘
 * ```
 *
 * Most records are too short to fill a page, so the list stays where it was — dimmed, behind —
 * and the record sits in a window over it. Its page, sort and filters were never left.
 *
 * ## Every action is behind ⋯
 *
 * The window draws no button of its own but Close. What the record lets a reader do is `actions`,
 * listed in the ⋯ menu in order: the record's primary first, in brand ink, then the rest. An
 * action that opens a dialog of its own opens it on top — react-native-web stacks its modals and
 * the newest is the active one, so its focus trap and Escape are the ones that answer.
 *
 * ## Its body is a content column
 *
 * What is drawn inside reads `useContentWidth()` to decide one column or two. Inside the window
 * that is the window's own inner width, not the page's, so a record laid out for the shell's
 * 1100px column does not split into a window that is 848 inside.
 *
 * Close is ✕, a backdrop press and Escape (`Modal`'s `onRequestClose`). The backdrop is a sibling
 * under the panel, never its parent, for the reason `RecordWindow` states.
 */

export interface RecordDialogAction {
    readonly key: string;
    /** Translated. */
    readonly label: string;
    readonly icon?: IconName | undefined;
    readonly onSelect: () => void;
    /** `brand` for the record's primary — listed first. `danger` for a destructive one. */
    readonly tone?: 'default' | 'brand' | 'danger' | undefined;
    readonly disabled?: boolean | undefined;
    /** An action already writing. It cannot be chosen again until it settles. */
    readonly loading?: boolean | undefined;
    /** Starts a new group under a hairline — Edit order apart from the order's next steps. */
    readonly separated?: boolean | undefined;
    /** Overrides `{testID}-actions-menu-item-{key}`. */
    readonly testID?: string | undefined;
}

export interface RecordDialogProps {
    readonly open: boolean;
    readonly onClose: () => void;
    /** Translated kind — "Ingredient", "Order". The small upper label at the bar's start. */
    readonly kind: string;
    /** The record's name — the window's accessible name. */
    readonly label: string;
    readonly actions?: readonly RecordDialogAction[] | undefined;
    readonly children: ReactNode;
    readonly testID: string;
}

/** The design's window. Narrower viewports get the viewport less the gutters. */
export const RECORD_DIALOG_WIDTH = 880;
const GUTTER = 32;
/** A phone keeps 16 of its few hundred pixels a side, not 32. */
const PHONE_GUTTER = 16;
const PHONE_MAX = 640;
/** The body's inline padding — `px-base`. What `useContentWidth` subtracts inside the window. */
const BODY_PADDING = 16;

export function actionSections(actions: readonly RecordDialogAction[]): MenuSection[] {
    const sections: MenuItem[][] = [];
    for (const action of actions) {
        const item: MenuItem = {
            key: action.key,
            label: action.label,
            icon: action.icon,
            onSelect: action.onSelect,
            tone: action.tone === 'danger' ? 'danger' : 'default',
            primary: action.tone === 'brand',
            disabled: action.disabled === true || action.loading === true,
            testID: action.testID,
        };
        const last = sections.at(-1);
        if (last === undefined || action.separated === true) sections.push([item]);
        else last.push(item);
    }
    return sections.map((items) => ({ items }));
}

export function RecordDialog({
    open,
    onClose,
    kind,
    label,
    actions = [],
    children,
    testID,
}: RecordDialogProps) {
    const { t } = useTranslation();
    const viewport = useWindowDimensions();
    const gutter = viewport.width < PHONE_MAX ? PHONE_GUTTER : GUTTER;
    const width = Math.max(0, Math.min(RECORD_DIALOG_WIDTH, viewport.width - gutter * 2));
    const maxHeight = Math.max(0, viewport.height - gutter * 2);
    const actionsLabel = t('common:action.actions');

    return (
        <Modal
            visible={open}
            transparent
            // 'none' for the reason `Dialog` states: react-native-web's animated modals never fire
            // `animationend`, which leaves the dialog role and focus trap inactive.
            animationType="none"
            onRequestClose={onClose}
            {...({ 'aria-label': label } as object)}
        >
            <View className="flex-1 items-center justify-center" style={{ padding: gutter }}>
                <Pressable
                    testID={`${testID}-backdrop`}
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    aria-hidden
                    focusable={false}
                    onPress={onClose}
                    className="absolute inset-0 bg-overlay"
                />
                <FadeIn>
                    {/* Sized on a plain view: a class cap on the animated wrapper does not hold. */}
                    <View style={{ width, maxHeight }}>
                        <View
                            testID={`${testID}-window`}
                            role="dialog"
                            aria-modal
                            // The canopy draws the name; the window carries it for a screen reader.
                            aria-label={label}
                            className="min-h-0 shrink flex-col overflow-hidden rounded-2xl border border-stroke bg-surface-base shadow-elevation-4"
                        >
                            <View className="z-auto flex-row items-center gap-2 pe-3 ps-base pb-2 pt-3">
                                <RNText
                                    testID={`${testID}-eyebrow`}
                                    className="min-w-0 shrink text-role-label font-bold uppercase tracking-wider text-content-secondary text-start"
                                    numberOfLines={1}
                                >
                                    {kind}
                                </RNText>
                                <View className="flex-1" />
                                {actions.length === 0 ? null : (
                                    <Menu
                                        testID={`${testID}-actions-menu`}
                                        label={actionsLabel}
                                        align="end"
                                        sections={actionSections(actions)}
                                        trigger={({ triggerProps, toggle }) => (
                                            <IconButton
                                                {...triggerProps}
                                                testID={`${testID}-actions`}
                                                variant="ghost"
                                                size="sm"
                                                label={actionsLabel}
                                                icon={<Icon name="more" size="sm" />}
                                                onPress={toggle}
                                            />
                                        )}
                                    />
                                )}
                                <IconButton
                                    testID={`${testID}-close`}
                                    variant="ghost"
                                    size="sm"
                                    label={t('common:action.close')}
                                    icon={<Icon name="close" size="sm" />}
                                    onPress={onClose}
                                />
                            </View>
                            <ScrollView
                                testID={`${testID}-scroll`}
                                className="min-h-0 shrink"
                                contentContainerClassName="px-base pb-base pt-1"
                            >
                                <ContentWidthProvider
                                    value={{
                                        chrome: Math.max(0, viewport.width - width),
                                        padding: BODY_PADDING,
                                    }}
                                >
                                    {children}
                                </ContentWidthProvider>
                            </ScrollView>
                        </View>
                    </View>
                </FadeIn>
            </View>
        </Modal>
    );
}
