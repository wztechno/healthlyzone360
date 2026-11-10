import { RecordDialog, useContentWidth } from '@healthy360/design-system';
import type { IconName, RecordDialogAction } from '@healthy360/design-system';
import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

import { RECORD_POPUP_SPLIT_MIN, RECORD_SPLIT_MIN } from '../desk-layout.ts';
import { useKitchenTrailLeaf } from '../kitchen-ops-shell.tsx';

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
 * A caller renders its list as always and this beside it while it holds a record. Every action the
 * record has is an entry in `actions`, listed behind the window's ⋯.
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
    useKitchenTrailLeaf(title, onClose);

    const menu =
        primaryAction === undefined
            ? actions
            : [primaryMenuAction(primaryAction, testID), ...actions];

    return (
        <RecordDialog
            open
            onClose={onClose}
            kind={kind}
            label={title}
            actions={menu}
            leading={leading}
            testID={testID}
        >
            <InRecordPopup.Provider value>{children}</InRecordPopup.Provider>
        </RecordDialog>
    );
}
