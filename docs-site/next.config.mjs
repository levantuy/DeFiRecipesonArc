import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // 'standalone' is only for self-hosted Node/Docker deploys; Vercel does its own
  // output tracing and errors (missing .nft.json) if this is set, so leave it unset there.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
};

export default withMDX(config);
