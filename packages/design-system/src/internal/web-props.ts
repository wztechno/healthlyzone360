import { Platform } from 'react-native';

/**
 * Web-only DOM props that React Native does not type.
 *
 * `onKeyDown` is on react-native-web's forwarded-prop list, so it reaches the underlying DOM node
 * unchanged — but React Native's own `PressableProps` has no key events to declare, because there
 * is no keyboard on a phone. Rather than sprinkle casts through the components, the one cast lives
 * here, next to the reason for it, and the exported helper is a no-op on native so a component can
 * spread it unconditionally.
 */
export interface WebKeyEvent {
    readonly key: string;
    readonly preventDefault: () => void;
}

export const KEYS = {
    arrowLeft: 'ArrowLeft',
    arrowRight: 'ArrowRight',
    arrowUp: 'ArrowUp',
    arrowDown: 'ArrowDown',
    home: 'Home',
    end: 'End',
    escape: 'Escape',
    enter: 'Enter',
    space: ' ',
} as const;

export interface WebKeyboardProps {
    readonly onKeyDown?: ((event: WebKeyEvent) => void) | undefined;
}

/**
 * Spreadable key handler: real on the web, empty everywhere else.
 *
 * The return type is deliberately its own interface rather than `PressableProps` or
 * `TextInputProps` — a React Native props type would drag in every *other* handler's signature and
 * clash with whichever element the result is spread onto. JSX spread performs no excess-property
 * check, so an unknown-to-React-Native prop passes through to the DOM exactly as intended.
 */
export function keyDownProps(handler: (event: WebKeyEvent) => void): WebKeyboardProps {
    if (Platform.OS !== 'web') return {};
    return { onKeyDown: handler };
}

/**
 * ARIA roles React Native does not model, applied on the web only.
 *
 * `Role` in React Native's types is the subset of ARIA its native accessibility bridges implement.
 * `listbox`, `menuitemcheckbox` and `table` roles beyond that subset are real and necessary on the
 * web — a result list that does not announce as a listbox is a list of buttons to a screen reader
 * user — but they are not values `role` will accept.
 *
 * So the same shape as {@link keyDownProps}: a spreadable object, real on the web and empty
 * everywhere else. The return type is deliberately `object` rather than `{ role: string }`, because
 * a declared `role` would be checked against React Native's union and rejected for exactly the
 * values this helper exists to pass. Native keeps its own `accessibilityRole`, which every call
 * site sets alongside this.
 */
export function webRole(role: string): object {
    if (Platform.OS !== 'web') return {};
    return { role };
}
