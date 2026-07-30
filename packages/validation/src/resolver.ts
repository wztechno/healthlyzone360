import { standardSchemaResolver } from '@hookform/resolvers/standard-schema';
import type { FieldValues } from 'react-hook-form';
import type { ZodType } from 'zod';

/**
 * Binds a Zod 4 schema to React Hook Form through the Standard Schema resolver.
 *
 * Zod 4 implements the Standard Schema interface, so `standardSchemaResolver` is the supported
 * path — `@hookform/resolvers/zod` still exists but couples itself to Zod's internals
 * (dependency-compatibility.md).
 *
 * The `TInput extends FieldValues` bound is what React Hook Form needs: a resolver must promise
 * that the values it validates are an object of form fields, which `ZodType`'s default `unknown`
 * input does not.
 */
export function toFormResolver<TInput extends FieldValues, TOutput>(
    schema: ZodType<TOutput, TInput>,
) {
    return standardSchemaResolver(schema);
}
