/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  pageExtensions: ["js", "jsx", "ts", "tsx", "mdx"],
  transpilePackages: ["@boxyhq/saml-jackson", "@libpdf/core"],
  images: {
    minimumCacheTTL: 2592000, // 30 days
    remotePatterns: prepareRemotePatterns(),
  },
  skipTrailingSlashRedirect: true,
  assetPrefix:
    process.env.NODE_ENV === "production" &&
    process.env.VERCEL_ENV === "production"
      ? process.env.NEXT_PUBLIC_BASE_URL
      : undefined,
  async rewrites() {
    const afterFiles = [
      // node-oidc-provider lives under /oauth/* externally, but is mounted
      // internally at pages/api/oauth/[...slug].ts. Use `afterFiles` so
      // filesystem pages (e.g. /oauth/interaction/[uid].tsx, our consent UI)
      // match first and only unmapped OAuth paths fall through to the
      // provider.
      { source: "/oauth/:path*", destination: "/api/oauth/:path*" },
      // Discovery is spec-pinned to /.well-known/openid-configuration at the
      // service root.
      {
        source: "/.well-known/openid-configuration",
        destination: "/api/oauth/.well-known/openid-configuration",
      },
      // RFC 9728 protected-resource metadata for the MCP endpoint. MCP
      // clients fetch this after receiving a 401 + WWW-Authenticate from
      // /api/mcp to discover our OAuth issuer.
      {
        source: "/.well-known/oauth-protected-resource",
        destination: "/api/well-known/oauth-protected-resource",
      },
      // ChatGPT app submission domain ownership challenge.
      {
        source: "/.well-known/openai-apps-challenge",
        destination: "/api/well-known/openai-apps-challenge",
      },
    ];
    const beforeFiles = [];
    const apiHost = process.env.NEXT_PUBLIC_API_BASE_HOST;
    if (apiHost) {
      beforeFiles.push(
        // The only allowed surface on the api subdomain is the public v1 API.
        {
          source: "/v1/:path*",
          destination: "/api/v1/:path*",
          has: [{ type: "host", value: apiHost }],
        },
        // Block direct hits to /oauth/* and /.well-known/* on the api host.
        // These paths bypass middleware (excluded in the matcher) so we
        // rewrite them to /404 here.
        //
        // Note: we deliberately do NOT block /api/* on the api host. Vercel
        // re-evaluates beforeFiles rules against the rewritten path, so a
        // generic /api/:path* → /404 rule cascades and catches /api/v1/*
        // (the target of the /v1 rewrite above), breaking the v1 surface
        // we're trying to expose. The internal /api/* routes are already
        // auth-gated by NextAuth or bearer-token middleware, so reachability
        // on api.papermark.com adds no net exposure beyond app.papermark.com.
        {
          source: "/oauth/:path*",
          destination: "/404",
          has: [{ type: "host", value: apiHost }],
        },
        {
          source: "/.well-known/:path*",
          destination: "/404",
          has: [{ type: "host", value: apiHost }],
        },
        // Public static files served from /public also bypass middleware
        // (excluded in the matcher). Block them on the api host so the
        // surface is genuinely just /v1/* — no marketing-site favicon /
        // sitemap leaking through.
        {
          source: "/favicon.ico",
          destination: "/404",
          has: [{ type: "host", value: apiHost }],
        },
        {
          source: "/sitemap.xml",
          destination: "/404",
          has: [{ type: "host", value: apiHost }],
        },
        {
          source: "/robots.txt",
          destination: "/404",
          has: [{ type: "host", value: apiHost }],
        },
      );
    }
    // mcp.papermark.com — Linear-style short MCP entry point. Clients paste
    // `https://mcp.papermark.com/mcp` in their configs; this host rewrites
    // it to the underlying /api/mcp handler. /.well-known and /oauth paths
    // pass through to their app-domain handlers so OAuth discovery +
    // flow work identically from either host.
    const mcpHost = process.env.NEXT_PUBLIC_MCP_BASE_HOST;
    if (mcpHost) {
      beforeFiles.push(
        // /mcp → actual Streamable HTTP adapter
        {
          source: "/mcp",
          destination: "/api/mcp",
          has: [{ type: "host", value: mcpHost }],
        },
        // Protected-resource discovery (RFC 9728)
        {
          source: "/.well-known/oauth-protected-resource",
          destination: "/api/well-known/oauth-protected-resource",
          has: [{ type: "host", value: mcpHost }],
        },
        // ChatGPT app submission domain ownership challenge.
        {
          source: "/.well-known/openai-apps-challenge",
          destination: "/api/well-known/openai-apps-challenge",
          has: [{ type: "host", value: mcpHost }],
        },
        // Custom OIDC discovery doc: issuer stays on app domain but
        // authorization_endpoint points at the interstitial below.
        {
          source: "/.well-known/openid-configuration",
          destination: "/api/mcp-oauth/openid-configuration",
          has: [{ type: "host", value: mcpHost }],
        },
        // DCR-approval interstitial (Linear-style card). More specific
        // than the /oauth/:path* catch-all below, so it wins.
        {
          source: "/oauth/authorize",
          destination: "/mcp-oauth/authorize",
          has: [{ type: "host", value: mcpHost }],
        },
        // Everything else under /oauth/* (reg, token, device, revocation,
        // introspection, jwks, etc.) passes through to app's oidc-provider
        // catch-all unchanged.
        {
          source: "/oauth/:path*",
          destination: "/api/oauth/:path*",
          has: [{ type: "host", value: mcpHost }],
        },
      );
    }
    return { beforeFiles, afterFiles, fallback: [] };
  },
  async redirects() {
    const redirects = [
      {
        source: "/",
        destination: "/dashboard",
        permanent: false,
        has: [
          {
            type: "host",
            value: process.env.NEXT_PUBLIC_APP_BASE_HOST,
          },
        ],
      },
      {
        source: "/settings",
        destination: "/settings/general",
        permanent: false,
      },
      {
        // The plan picker moved to /settings/billing/upgrade (App Router).
        // Keep the old path working for bookmarks and previously sent emails.
        source: "/settings/upgrade",
        destination: "/settings/billing/upgrade",
        permanent: false,
      },
      {
        source: "/:path*",
        destination: "https://presentation.atelierbatalla.com/:path*",
        permanent: true,
        has: [{ type: "host", value: "pitchdeck.jonpagels.com" }],
      },
    ];
    // mcp.papermark.com/ → docs. 302 (not 301) so we can repoint later
    // when docs move. The /mcp endpoint and /.well-known/* + /oauth/*
    // paths are rewritten above and take precedence, so this only
    // catches the subdomain's bare root + any other unknown path.
    const mcpHost = process.env.NEXT_PUBLIC_MCP_BASE_HOST;
    const mcpDocsUrl =
      process.env.NEXT_PUBLIC_MCP_DOCS_URL ??
      "https://www.papermark.com/docs/mcp";
    if (mcpHost) {
      redirects.push({
        source: "/",
        destination: mcpDocsUrl,
        permanent: false,
        has: [{ type: "host", value: mcpHost }],
      });
    }
    return redirects;
  },
  async headers() {
    const isDev = process.env.NODE_ENV === "development";

    return [
      {
        // Default headers for all routes
        source: "/:path*",
        headers: [
          {
            key: "Referrer-Policy",
            value: "no-referrer-when-downgrade",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "X-Frame-Options",
            value: "SAMEORIGIN",
          },
          {
            key: "Report-To",
            value: JSON.stringify({
              group: "csp-endpoint",
              max_age: 10886400,
              endpoints: [{ url: "/api/csp-report" }],
            }),
          },
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              `default-src 'self' https: ${isDev ? "http:" : ""}; ` +
              `script-src 'self' 'unsafe-inline' 'unsafe-eval' https: ${isDev ? "http:" : ""}; ` +
              `style-src 'self' 'unsafe-inline' https: ${isDev ? "http:" : ""}; ` +
              `img-src 'self' data: blob: https: ${isDev ? "http:" : ""}; ` +
              `font-src 'self' data: https: ${isDev ? "http:" : ""}; ` +
              `frame-ancestors 'none'; ` +
              `connect-src 'self' https: ${isDev ? "http: ws: wss:" : ""}; ` + // Add WebSocket for hot reload
              `${isDev ? "" : "upgrade-insecure-requests;"} ` +
              "report-to csp-endpoint;",
          },
        ],
      },
      {
        source: "/view/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
      {
        source: "/login",
        has: [
          {
            type: "query",
            key: "next",
          },
        ],
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex, nofollow",
          },
        ],
      },
      {
        // Embed routes - allow iframe embedding
        source: "/view/:path*/embed",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self' https: ${isDev ? "http:" : ""}; ` +
              `script-src 'self' 'unsafe-inline' 'unsafe-eval' https: ${isDev ? "http:" : ""}; ` +
              `style-src 'self' 'unsafe-inline' https: ${isDev ? "http:" : ""}; ` +
              `img-src 'self' data: blob: https: ${isDev ? "http:" : ""}; ` +
              `font-src 'self' data: https: ${isDev ? "http:" : ""}; ` +
              "frame-ancestors *; " + // This allows iframe embedding
              `connect-src 'self' https: ${isDev ? "http: ws: wss:" : ""}; ` + // Add WebSocket for hot reload
              `${isDev ? "" : "upgrade-insecure-requests;"}`,
          },
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
      {
        source: "/services/:path*",
        has: [
          {
            type: "host",
            value: process.env.NEXT_PUBLIC_WEBHOOK_BASE_HOST,
          },
        ],
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
      {
        source: "/api/webhooks/services/:path*",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
      {
        source: "/unsubscribe",
        headers: [
          {
            key: "X-Robots-Tag",
            value: "noindex",
          },
        ],
      },
    ];
  },
  experimental: {
    // Rewrite barrel imports (e.g. `import { Icon } from "lucide-react"`) to
    // direct submodule imports at build time. Cuts dev boot, cold starts and
    // HMR for these large re-export packages without losing ergonomic imports.
    optimizePackageImports: [
      "lucide-react",
      "@tremor/react",
      "date-fns",
      "lodash",
    ],
    outputFileTracingIncludes: {
      "/api/mupdf/*": ["./node_modules/mupdf/dist/*.wasm"],
      // Jackson SAML routes need jose + openid-client for crypto
      "/api/auth/saml/token": [
        "./node_modules/jose/**/*",
        "./node_modules/openid-client/**/*",
      ],
      "/api/auth/saml/userinfo": [
        "./node_modules/jose/**/*",
        "./node_modules/openid-client/**/*",
      ],
    },
    missingSuspenseWithCSRBailout: false,
    // oidc-provider uses Koa which has dynamic requires that webpack can't
    // statically analyze. Keep them out of the bundle; they'll be loaded at
    // runtime from node_modules.
    // jsonpath (a dub dependency) reads its grammar file from disk at module
    // load, which breaks when webpack bundles it into app-router routes.
    serverComponentsExternalPackages: ["oidc-provider", "koa", "jsonpath"],
  },
  webpack: (config, { isServer }) => {
    // oidc-provider depends on Koa which uses dynamic requires webpack can't
    // statically analyze. Mark it external on the server so Node's require()
    // resolves it from node_modules at runtime.
    if (isServer) {
      const externals = Array.isArray(config.externals)
        ? config.externals
        : [config.externals].filter(Boolean);
      externals.push("oidc-provider", "koa");
      config.externals = externals;
    }

    // Stub out @google-cloud/kms - it's an optional dependency of @libpdf/core
    // that we don't use (only needed for KMS-based PDF encryption)
    config.resolve.alias = {
      ...config.resolve.alias,
      "@google-cloud/kms": false,
      "@google-cloud/secret-manager": false,
      // Jackson pulls TypeORM/Mongo optional drivers we don't use (Postgres-only setup).
      // Aliasing prevents module resolution errors in dev/build.
      mongodb: false,
      mysql: false,
      "react-native-sqlite-storage": false,
      aws4: false,
      "@sap/hana-client": false,
      "@sap/hana-client/extension/Stream": false,
      "hdb-pool": false,
    };

    // Suppress critical dependency warnings from Jackson's dynamic requires
    config.module = {
      ...config.module,
      exprContextCritical: false,
    };

    return config;
  },
};

function prepareRemotePatterns() {
  let patterns = [
    // static images and videos
    { protocol: "https", hostname: "assets.papermark.io" },
    { protocol: "https", hostname: "cdn.papermarkassets.com" },
    { protocol: "https", hostname: "d2kgph70pw5d9n.cloudfront.net" },
    // twitter img
    { protocol: "https", hostname: "pbs.twimg.com" },
    // linkedin img
    { protocol: "https", hostname: "media.licdn.com" },
    // google img
    { protocol: "https", hostname: "lh3.googleusercontent.com" },
    // papermark img
    { protocol: "https", hostname: "www.papermark.io" },
    { protocol: "https", hostname: "app.papermark.io" },
    { protocol: "https", hostname: "www.papermark.com" },
    { protocol: "https", hostname: "app.papermark.com" },
    // useragent img
    { protocol: "https", hostname: "faisalman.github.io" },
    // special document pages
    { protocol: "https", hostname: "d36r2enbzam0iu.cloudfront.net" },
    // us special storage
    { protocol: "https", hostname: "d35vw2hoyyl88.cloudfront.net" },
  ];

  // Default region patterns
  if (process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST) {
    patterns.push({
      protocol: "https",
      hostname: process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST,
    });
  }

  if (process.env.NEXT_PRIVATE_ADVANCED_UPLOAD_DISTRIBUTION_HOST) {
    patterns.push({
      protocol: "https",
      hostname: process.env.NEXT_PRIVATE_ADVANCED_UPLOAD_DISTRIBUTION_HOST,
    });
  }

  // US region patterns
  if (process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST_US) {
    patterns.push({
      protocol: "https",
      hostname: process.env.NEXT_PRIVATE_UPLOAD_DISTRIBUTION_HOST_US,
    });
  }

  if (process.env.NEXT_PRIVATE_ADVANCED_UPLOAD_DISTRIBUTION_HOST_US) {
    patterns.push({
      protocol: "https",
      hostname: process.env.NEXT_PRIVATE_ADVANCED_UPLOAD_DISTRIBUTION_HOST_US,
    });
  }

  if (process.env.VERCEL_ENV === "production") {
    patterns.push({
      // production vercel blob
      protocol: "https",
      hostname: "yoywvlh29jppecbh.public.blob.vercel-storage.com",
    });
  }

  if (
    process.env.VERCEL_ENV === "preview" ||
    process.env.NODE_ENV === "development"
  ) {
    patterns.push({
      // staging vercel blob
      protocol: "https",
      hostname: "36so9a8uzykxknsu.public.blob.vercel-storage.com",
    });
  }

  return patterns;
}

export default nextConfig;
