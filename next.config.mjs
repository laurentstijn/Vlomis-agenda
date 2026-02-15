/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },

  serverExternalPackages: ['puppeteer-core'],
  experimental: {
    serverComponentsExternalPackages: ['puppeteer-core'],
  },
}

export default nextConfig
