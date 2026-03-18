import { NextApiRequest, NextApiResponse } from "next";

import * as mupdf from "mupdf";

export default async (req: NextApiRequest, res: NextApiResponse) => {
  // check if post method
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  // Extract the API Key from the Authorization header
  const authHeader = req.headers.authorization;
  const token = authHeader?.split(" ")[1]; // Assuming the format is "Bearer [token]"

  // Check if the API Key matches
  if (token !== process.env.INTERNAL_API_KEY) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  try {
    const { url } = req.body as { url: string };
    // Fetch the PDF data with a 90s timeout to avoid indefinite hangs on slow storage
    const response = await fetch(url, {
      signal: AbortSignal.timeout(90_000),
    });

    if (!response.ok) {
      console.error(
        `Failed to fetch PDF: HTTP ${response.status} ${response.statusText}`,
      );
      res.status(502).json({ error: "Failed to fetch PDF from storage" });
      return;
    }

    const pdfData = await response.arrayBuffer();
    var doc = new mupdf.PDFDocument(pdfData);

    var n = doc.countPages();

    res.status(200).json({ numPages: n });
  } catch (error) {
    console.error("Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
