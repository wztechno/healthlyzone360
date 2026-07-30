/**
 * Nominal ("branded") types.
 *
 * `Brand<string, 'UserId'>` is assignable to `string` but a plain `string` is not assignable to it,
 * which stops organisation identifiers being passed where branch identifiers are expected.
 */

declare const brandSymbol: unique symbol;

export type Brand<TBase, TBrand extends string> = TBase & {
    readonly [brandSymbol]: TBrand;
};

/** Strips the brand back off, mostly useful when handing values to untyped transports. */
export type Unbrand<T> = T extends Brand<infer TBase, string> ? TBase : T;
