import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    experimental: {
        serverActions: {
            bodySizeLimit: '100mb',
        }
    },
    typescript: {
        ignoreBuildErrors: true,
    },
    images: {
        localPatterns: [
            {
                pathname: '/api/blob-proxy',
                search: '?**',
            },
            {
                pathname: '/api/**',
                search: '?**',
            },
        ],
        remotePatterns: [
            { protocol: 'https', hostname: 'covers.openlibrary.org' },
            { protocol: 'https', hostname: '**.blob.vercel-storage.com' },
            { protocol: 'https', hostname: '**.vercel-storage.com' },
        ],
    },
};

export default nextConfig;
