import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      /**
       * The framework caps request bodies at 1MB by default and answers anything
       * over it with a plain-text 413 before our code runs at all. An order
       * carries a converted pattern and usually the original photo, which goes
       * past 1MB as soon as the picture is any good — so ordering failed for
       * exactly the people who uploaded a real photograph, and what they saw was
       * a JSON parse error rather than an explanation.
       *
       * Set above the 20MB the order route enforces for itself, so a request
       * that really is too big reaches that check and the customer gets a
       * sentence they can act on instead of the framework's bare 413.
       */
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
