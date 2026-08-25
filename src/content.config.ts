import { defineCollection } from 'astro:content'
import { glob } from 'astro/loaders'
import { z } from 'astro/zod'

const optionalDate = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.coerce.date().optional(),
)

const optionalString = z.preprocess(
  (value) => (value === null || value === '' ? undefined : value),
  z.string().trim().min(1).optional(),
)

const posts = defineCollection({
  loader: glob({
    base: './source/_posts',
    pattern: '**/*.md',
    // Keep the file name as the stable content ID. Existing public URLs use it.
    generateId: ({ entry }) => entry.replace(/\\/g, '/').replace(/\.md$/i, ''),
  }),
  schema: z.object({
    title: z.string().trim().min(1),
    date: z.coerce.date(),
    updated: optionalDate,
    description: optionalString,
    draft: z.boolean().optional(),
    sticky: z.union([z.boolean(), z.number().finite()]).optional(),
    categories: z.union([z.string(), z.array(z.string())]).optional(),
    tags: z.array(z.string()).optional(),
    cover: optionalString,
    image: optionalString,
  }),
})

export const collections = { posts }
