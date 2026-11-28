import { createContext, useContext } from 'react';

import { useContentWidth } from '../hooks/use-content-width.tsx';

/**
 * Whether a record's body has room for two columns — its main column beside a 300px rail.
 *
 * On a page that is ~560 + 16 + 300 and slack for a scrollbar the shell cannot see; inside a record
 * pop-up it is measured against the window's own inner width, which is narrower for the same design.
 */
export const RECORD_SPLIT_MIN = 880;
export const RECORD_POPUP_SPLIT_MIN = 820;

/** Set by the record pop-up's window, so the parts inside it split against the window. */
export const InRecordPopup = createContext(false);

/** One column or two for a record's body — against the pop-up's width when inside one. */
export function useRecordSplit(): boolean {
    const inPopup = useContext(InRecordPopup);
    return useContentWidth().atLeast(inPopup ? RECORD_POPUP_SPLIT_MIN : RECORD_SPLIT_MIN);
}
