import Link from "next/link";
import { useRouter } from "next/router";

import { ArrowLeft, Download, FileText, Loader2 } from "lucide-react";

import { useInvoices } from "@/lib/swr/use-invoices";

import AppLayout from "@/components/layouts/app";
import { SettingsHeader } from "@/components/settings/settings-header";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export default function Invoices() {
  const router = useRouter();
  const { invoices, loading, error } = useInvoices();

  const formatCurrency = (amount: number, currency: string) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount / 100);
  };

  const formatDate = (timestamp: number) => {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const handleDownload = (invoicePdf: string | null) => {
    if (invoicePdf) {
      window.open(invoicePdf, "_blank");
    }
  };

  const handleViewInvoice = (hostedInvoiceUrl: string | null) => {
    if (hostedInvoiceUrl) {
      window.open(hostedInvoiceUrl, "_blank");
    }
  };

  return (
    <AppLayout>
      <main className="relative mx-2 mb-10 mt-4 space-y-8 overflow-hidden px-1 sm:mx-3 md:mx-5 md:mt-5 lg:mx-7 lg:mt-8 xl:mx-10">
        <SettingsHeader />

        <div className="space-y-4">
          <div className="space-y-2">
            <Link
              href="/settings/billing"
              className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to subscription
            </Link>
            <div className="space-y-1">
              <h3 className="text-2xl font-semibold tracking-tight text-foreground">
                Invoices
              </h3>
              <p className="text-sm text-muted-foreground">
                A history of all your invoices
              </p>
            </div>
          </div>

          <div className="rounded-lg border bg-white">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="flex flex-col items-center justify-center gap-2 py-12">
                <p className="text-sm text-muted-foreground">
                  Failed to load invoices
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => router.reload()}
                >
                  Retry
                </Button>
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-4 py-12">
                <div className="rounded-full border border-white bg-gradient-to-t from-gray-100 p-3">
                  <FileText className="size-6" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium">No invoices yet</p>
                  <p className="text-sm text-muted-foreground">
                    Your invoices will appear here once you have a subscription
                  </p>
                </div>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Total</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map((invoice) => (
                    <TableRow key={invoice.id}>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="font-medium">
                            Papermark Subscription
                          </span>
                          {invoice.number && (
                            <span className="text-xs text-muted-foreground">
                              {invoice.number}
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{formatDate(invoice.created)}</TableCell>
                      <TableCell>
                        {formatCurrency(invoice.amount, invoice.currency)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleViewInvoice(invoice.hostedInvoiceUrl)
                            }
                            disabled={!invoice.hostedInvoiceUrl}
                          >
                            View invoice
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDownload(invoice.invoicePdf)}
                            disabled={!invoice.invoicePdf}
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </main>
    </AppLayout>
  );
}
