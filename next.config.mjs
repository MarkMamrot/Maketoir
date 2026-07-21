const nextConfig = {
  productionBrowserSourceMaps: false,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  experimental: {
    serverComponentsExternalPackages: ['shopify-api-node', 'got', 'cacheable-request', 'keyv'],
  },
  webpack: (config) => {
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules[\\/]keyv[\\/]src[\\/]index\.js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
      (warning) => {
        const text = `${warning?.message || ''}\n${warning?.details || ''}`;
        return (
          text.includes('Critical dependency: the request of a dependency is an expression') &&
          text.includes('node_modules/keyv/src/index.js')
        );
      },
    ];
    return config;
  },
};
export default nextConfig;
