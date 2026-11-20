import { NotionAPI } from "notion-client";

// Notion is decommissioning www.notion.so for the unofficial API in favor of
// app.notion.com. notion-client 7.10.0 still defaults to notion.so.
// Keep a User-Agent as well — Cloudflare has 403'd UA-less Node fetches.
// https://github.com/NotionX/react-notion-x/issues/710
const notion = new NotionAPI({
  apiBaseUrl: "https://app.notion.com/api/v3",
  ofetchOptions: {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    },
  },
});

export default notion;
