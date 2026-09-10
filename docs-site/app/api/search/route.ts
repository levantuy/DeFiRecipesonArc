import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// powers the built-in Fumadocs search UI (Orama, static index)
export const { GET } = createFromSource(source);
