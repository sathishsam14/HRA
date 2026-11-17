/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
  images: {
    unoptimized: true,
  },
};

module.exports = nextConfig;
