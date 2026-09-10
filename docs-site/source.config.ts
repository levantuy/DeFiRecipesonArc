import { defineDocs, defineConfig } from 'fumadocs-mdx/config';

export const docs = defineDocs({
  dir: 'content/docs',
});

export default defineConfig({
  mdxOptions: {
    rehypeCodeOptions: {
      themes: {
        light: 'github-light',
        dark: 'github-dark',
      },
      // syntax highlighting for Solidity and dotenv blocks used across the docs;
      // "text"/"plaintext" fences are handled by Shiki's built-in fallback and need no entry here
      langs: ['solidity', 'dotenv', 'bash', 'json', 'typescript', 'tsx'],
    },
  },
});
