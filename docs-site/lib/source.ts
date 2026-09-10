import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';

// central page-tree loader consumed by the docs layout, page renderer and search API
export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});
