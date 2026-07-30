export {
    EMAIL_MAX_LENGTH,
    NAME_MAX_LENGTH,
    NAME_MIN_LENGTH,
    PASSWORD_MIN_LENGTH,
    VALIDATION_KEYS,
    identityTranslate,
} from './messages.ts';
export type { Translate, ValidationKey } from './messages.ts';

export {
    contextSelectionSchema,
    makeForgotPasswordSchema,
    makeLoginSchema,
    makeRegisterSchema,
    makeResetPasswordSchema,
} from './schemas.ts';
export type {
    ContextSelectionInput,
    ContextSelectionValues,
    ForgotPasswordValues,
    LoginInput,
    LoginValues,
    RegisterInput,
    RegisterValues,
    ResetPasswordValues,
} from './schemas.ts';

export { toFormResolver } from './resolver.ts';

export {
    extractValidationDetails,
    isErrorEnvelope,
    mapLaravelValidationErrors,
} from './laravel-errors.ts';
export type {
    ErrorEnvelope,
    MapLaravelErrorsOptions,
    MapLaravelErrorsResult,
    SetFieldError,
} from './laravel-errors.ts';
