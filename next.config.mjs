const portArgumentIndex = process.argv.findIndex(argument => argument === '-p' || argument === '--port');
const inlinePort = process.argv.find(argument => argument.startsWith('--port='));
const developmentPort = inlinePort?.slice('--port='.length)
  || (portArgumentIndex >= 0 ? process.argv[portArgumentIndex + 1] : undefined)
  || process.env.PORT
  || '3000';

const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR
    || (process.env.NODE_ENV === 'development' ? `.next-dev-${developmentPort}` : '.next'),
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
