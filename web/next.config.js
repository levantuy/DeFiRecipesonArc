/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config, { webpack }) => {
    // 1. Keep your existing externals configuration
    config.externals.push(
      'pino-pretty',
      'lokijs',
      'encoding',
      /^@x402/
    );

    // 2. Ignore @react-native-async-storage to prevent "Module not found" warnings
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^@react-native-async-storage\/async-storage$/,
      })
    );

    // 3. Suppress "Critical dependency" warnings from viem / ox
    config.module.exprContextCritical = false;

    return config;
  },
};

module.exports = nextConfig;