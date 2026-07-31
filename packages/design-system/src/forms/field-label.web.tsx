import { fieldLabelClassName } from './field-label-shared.ts';
import type { FieldLabelProps } from './field-label-shared.ts';

export type { FieldLabelProps } from './field-label-shared.ts';

/**
 * Field label — web.
 *
 * A real `<label for="…">`, written as a DOM element for the same reason `date-field.web.tsx`
 * writes a real `<input type="date">`: react-native-web's `Text` can carry an id but can never be a
 * `<label>`, and only a `<label>` gives the browser the click-to-focus behaviour and gives axe an
 * association it resolves without asking whether the label is on screen at this scroll position.
 *
 * The id stays as well, so the `aria-labelledby` both platforms set keeps resolving.
 */
export function FieldLabel({
    id,
    htmlFor,
    text,
    requiredMark,
    disabled = false,
    testID,
}: FieldLabelProps) {
    return (
        <label
            id={id}
            htmlFor={htmlFor}
            data-testid={testID}
            className={fieldLabelClassName(disabled)}
        >
            {text}
            {requiredMark === undefined ? null : (
                <span className="text-danger-strong">{` ${requiredMark}`}</span>
            )}
        </label>
    );
}
