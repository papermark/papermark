/**
 * Build the Office Online embed URL for a workbook.
 *
 * `src` must be percent-encoded, or a signed URL's `&Signature=`/`&Key-Pair-Id=`
 * are parsed as parameters of `embed.aspx` itself and `src` is truncated at the
 * first `&`. Not `URLSearchParams`: it encodes spaces as `+`, which Microsoft
 * decodes back to a space and invalidates the signature.
 */
export function getOfficeViewerEmbedUrl(fileUrl: string): string {
  return `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(
    fileUrl,
  )}&wdPrint=0&action=embedview&wdAllowInteractivity=False`;
}
