import { z } from 'zod';

/** Mirrors the server password policy so users get instant feedback (the server still validates). */
export const passwordRule = z
  .string()
  .min(10, 'At least 10 characters')
  .max(128)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Use upper-case, lower-case letters and a digit');
