import { Icon, useContentWidth } from '@healthy360/design-system';
import type { IconName, RecordDialogAction } from '@healthy360/design-system';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { DeskButton } from '../desk-kit/desk-button.tsx';
import { RECORD_POPUP_SPLIT_MIN, RECORD_SPLIT_MIN } from '../desk-layout.ts';
import { CompactRecordPopup } from './compact-record-popup.tsx';

/**
 * A kitchen-admin record, opened as a pop-up over the list it was picked from — the
 * `View as a pop-up` canvas (2026-11-07). The design system's `RecordDialog` plus the two things
 * only the kitchen admin knows:
 *
 * - **The trail.** `useKitchenTrailLeaf` still names the record as the shell's last crumb, and the
 *   list's crumb closes it, so the breadcrumb says what is open while the list is dimmed behind.
 * - **Where two columns fit.** Tiles split against the window's inner width, not the page's
 *   (`useRecordSplit`).
 *
 * A caller renders its list as always and this beside it while it holds a record.
 *
 * **The desk frame (2026-11-11).** The window is the Orders pop-up's (`CompactRecordPopup`): a slim
 * header with the kind and the ✕, the record's own canopy and tiles as the scrolling body, and every
 * action as a `DeskButton` pinned at the foot — the primary first and green, the rest outlined, a
 * destructive one at the far end. A button that is writing shows the desk's sweep. Each keeps the
 * id it had as a ⋯ entry (`{testID}-actions-menu-item-{key}` unless it names its own).
 */

export type RecordAction = RecordDialogAction;

/**
 * The old canopy button, as the ⋯ menu's first entry. Kept so a screen moves across without
 * restating its Edit: `pen` by default, `null` for one that is not an edit.
 */
export interface RecordPrimaryAction {
    readonly label: string;
    readonly onPress: () => void;
    readonly icon?: IconName | null | undefined;
    /** Overrides `{testID}-primary`. */
    readonly testID?: string | undefined;
    readonly loading?: boolean | undefined;
    readonly disabled?: boolean | undefined;
}

export function primaryMenuAction(
    primary: RecordPrimaryAction,
    testID: string,
): RecordDialogAction {
    return {
        key: 'primary',
        label: primary.label,
        icon: primary.icon === null ? undefined : (primary.icon ?? 'pen'),
        onSelect: primary.onPress,
        tone: 'brand',
        loading: primary.loading,
        disabled: primary.disabled,
        testID: primary.testID ?? `${testID}-primary`,
    };
}

const InRecordPopup = createContext(false);

/** One column or two for a record's body — against the pop-up's width when inside one. */
export function useRecordSplit(): boolean {
    const inPopup = useContext(InRecordPopup);
    return useContentWidth().atLeast(inPopup ? RECORD_POPUP_SPLIT_MIN : RECORD_SPLIT_MIN);
}

export interface RecordPopupProps {
    /** Translated record name. The window's accessible name and the trail's leaf. */
    readonly title: string;
    /** Translated kind, drawn as the window's upper label. */
    readonly kind: string;
    readonly onClose: () => void;
    readonly primaryAction?: RecordPrimaryAction | undefined;
    readonly actions?: readonly RecordAction[] | undefined;
    /** Before the kind label: the Back pill to the page that opened the record, when one did. */
    readonly leading?: ReactNode;
    readonly children: ReactNode;
    readonly testID: string;
}

const ICON_INK = {
    primary: 'text-content-on-brand',
    secondary: 'text-content-primary',
    dangerOutline: 'text-danger-strong',
} as const;

export function RecordPopup({
    title,
    kind,
    onClose,
    primaryAction,
    actions = [],
    leading,
    children,
    testID,
}: RecordPopupProps) {
    const all =
        primaryAction === undefined
            ? actions
            : [primaryMenuAction(primaryAction, testID), ...actions];
    const button = (action: RecordDialogAction, index: number) => {
        const variant =
            action.tone === 'danger'
                ? 'dangerOutline'
                : action.tone === 'brand' && index === 0
                  ? 'primary'
                  : 'secondary';
        return (
            <DeskButton
                key={action.key}
                testID={action.testID ?? `${testID}-actions-menu-item-${action.key}`}
                label={action.label}
                variant={variant}
                iconStart={
                    action.icon === undefined ? undefined : (
                        <Icon name={action.icon} size="sm" className={ICON_INK[variant]} />
                    )
                }
                loading={action.loading}
                disabled={action.disabled}
                onPress={action.onSelect}
            />
        );
    };
    // The record's primary leads the foot, wherever the caller listed it.
    const ahead = [
        ...all.filter((action) => action.tone === 'brand'),
        ...all.filter((action) => action.tone !== 'brand' && action.tone !== 'danger'),
    ];
    const danger = all.filter((action) => action.tone === 'danger');

    return (
        <CompactRecordPopup
            label={title}
            kind={kind}
            leading={leading}
            onClose={onClose}
            testID={testID}
            windowTestID={`${testID}-window`}
            kindTestID={`${testID}-eyebrow`}
            main={<InRecordPopup.Provider value>{children}</InRecordPopup.Provider>}
            {...(ahead.length === 0 ? {} : { footer: ahead.map(button) })}
            {...(danger.length === 0
                ? {}
                : { footerEnd: danger.map((action) => button(action, -1)) })}
        />
    );
}
