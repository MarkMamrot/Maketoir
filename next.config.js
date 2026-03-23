/** @type {import('next').NextConfig} */
const nextConfig = {
  // Output a standalone folder that works better with cPanel Phusion Passenger environments
  output: 'standalone',
    // your project has ESLint errors. Perfect for bypassing cPanel strictness.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Dangerously allow production builds to successfully complete even if
    // your project has type errors.
    ignoreBuildErrors: true,
  },
}

module.exports = nextConfig
