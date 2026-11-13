import type { DownloadedFile } from '@healthy360/api-client/contracts';
import { Platform } from 'react-native';

/**
 * Whether this build can hand a downloaded workbook to the person.
 *
 * Only the web can: it saves through an `<a download>`. Native has no file-save flow wired yet, so
 * a control that would download is left off rather than drawn and made to fail. A function rather
 * than a constant so a test (which runs as iOS) can mock it.
 */
export function canSaveFiles(): boolean {
    return Platform.OS === 'web' && typeof document !== 'undefined';
}

/** Saves the bytes under the server's file name, or `fallbackName` when the header was unreadable. */
export function saveDownload(file: DownloadedFile, fallbackName: string): void {
    const url = URL.createObjectURL(file.blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.filename ?? fallbackName;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    // Revoked on the next task: some browsers start the download only after `click` returns.
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}
