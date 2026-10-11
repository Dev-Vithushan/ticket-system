import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);

export { z };

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

const toArray = (v: unknown) => (v === undefined || v === '' ? undefined : Array.isArray(v) ? v : String(v).split(','));
/** Query param accepting `a,b` or repeated `?x=a&x=b`. */
export const csvEnum = <T extends [string, ...string[]]>(values: T) =>
  z.preprocess(toArray, z.array(z.enum(values)).optional());
export const csvUuid = z.preprocess(toArray, z.array(z.string().uuid()).optional());

export const pagination = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};

export const boolQuery = z
  .enum(['true', 'false'])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === 'true'));

/** Trimmed non-empty string with HTML-angle-bracket control; React escapes output, but we still bound length. */
export const text = (max: number) => z.string().trim().min(1).max(max);
