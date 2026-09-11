import { z } from 'zod';

export const tutorialContentSchema = z.object({
  title: z.string().trim().max(100),
  body: z.string().trim().max(3000),
  published: z.boolean(),
}).strict().refine(value => !value.published || (!!value.title && !!value.body), {
  message: 'Published steps need a title and guidance.',
});
export const tutorialInputSchema = tutorialContentSchema.safeExtend({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER - 1),
});
export const tutorialIdSchema = z.string().regex(/^\d{17,20}$/);
