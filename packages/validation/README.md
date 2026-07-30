# @healthy360/validation

Zod 4 schemas for the Phase 1 authentication and context-selection forms, plus the glue that binds
them to React Hook Form. Schemas are produced by factories that take a translate function
(`makeLoginSchema(t)`, `makeRegisterSchema(t)`, `makeForgotPasswordSchema(t)`,
`makeResetPasswordSchema(t)`) so every validation message is an i18n key rather than an English
literal, and the same schema re-renders in Arabic without rebuilding. `toFormResolver(schema)` wraps
`standardSchemaResolver` from `@hookform/resolvers`, and `mapLaravelValidationErrors()` translates
the API's `{ error: { details: { field: [messages] } } }` envelope into React Hook Form field paths
so server-side rejections land on the same inputs as client-side ones — the client schema is a
convenience, never the authority. Password policy here is the client mirror of the backend rule
(minimum twelve characters); the server remains the enforcing side.
