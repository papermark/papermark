/**
 * Document content is stored in S3 as a private object key. Reads still support
 * `VERCEL_BLOB` for documents stored before the migration, and public assets
 * (brand logos, banners, link preview images) still use Vercel Blob directly.
 */
export const isS3Transport = () =>
  process.env.NEXT_PUBLIC_UPLOAD_TRANSPORT === "s3";

export const assertS3Transport = () => {
  if (!isS3Transport()) {
    throw new Error(
      'Unsupported upload transport: document uploads require NEXT_PUBLIC_UPLOAD_TRANSPORT="s3".',
    );
  }
};
