import { createMDX } from 'fumadocs-mdx/next';

const withMDX = createMDX();

/** @type {import('next').NextConfig} */
const config = {
  reactStrictMode: true,
  // standalone output so this docs site can be built and deployed independently
  output: 'standalone',
};

export default withMDX(config);
