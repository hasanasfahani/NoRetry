/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@prompt-optimizer/shared", "@prompt-optimizer/extension"],
  experimental: {
    externalDir: true
  },
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...(config.watchOptions || {}),
        poll: 1000,
        aggregateTimeout: 300,
        ignored: [
          "**/.git/**",
          "**/.next/**",
          "**/node_modules/**",
          "**/apps/extension/build/**",
          "**/apps/extension/.plasmo/**",
          "**/apps/extension/.cache/**"
        ]
      }
    }

    return config
  }
}

export default nextConfig
