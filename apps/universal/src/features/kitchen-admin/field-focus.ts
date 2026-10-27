import { spotlightElement } from '@healthy360/design-system';
import { Platform } from 'react-native';

/**
 * Takes the reader to a field by the id its `FormField` gave the control — what an issue tray
 * card's Fix does when pressed — and spotlights it, so the eye lands on the right one of a dozen.
 *
 * By id rather than by ref because the fields that need it are drawn by five different components
 * (`TextInputField`, `QuantityInput`, `Select`, `BilingualField`'s halves) and threading a ref
 * through each would be five new props for one behaviour. Every one of them already renders its
 * control with `nativeID`, which React Native Web writes out as the element's `id`.
 *
 * Deferred a frame, because the chip that calls it may also have switched the tab the field is on:
 * the field does not exist until that render lands. On native there is no document to search, so
 * the chip's other half — opening the right tab — is the whole of what it does there.
 */
export function focusField(id: string): void {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    requestAnimationFrame(() => {
        const element = document.getElementById(id);
        if (element === null) return;
        // Optional: jsdom implements neither, and a missing scroll is no reason to skip the focus.
        element.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        element.focus?.({ preventScroll: true });
        spotlightElement(id);
    });
}

/**
 * Takes the reader to a whole section — a `FormSection` given a `nativeID` — and spotlights it,
 * without focusing anything: what a card's Fix does when the problem is the section ("Not costed",
 * "Allergens not recorded") rather than one field in it. Deferred a frame, as `focusField` is, for
 * the tab switch that may come with it.
 */
export function focusSection(id: string): void {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    requestAnimationFrame(() => {
        const element = document.getElementById(id);
        if (element === null) return;
        element.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
        spotlightElement(id);
    });
}
