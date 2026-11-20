import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { FileChartPieIcon, FileIcon, PresentationIcon } from "lucide-react";
import { motion } from "motion/react";

import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";

import NotionIcon from "@/components/shared/icons/files/notion";

const DEAL_TYPE_OPTIONS = [
  { value: "startup-fundraising", label: "Startup Fundraising" },
  { value: "fund-management", label: "Fundraising & Reporting" },
  { value: "mergers-acquisitions", label: "Mergers & Acquisitions" },
  { value: "financial-operations", label: "Financial Operations" },
  { value: "real-estate", label: "Real Estate" },
  { value: "project-management", label: "Project Management" },
];

const DEAL_SIZE_OPTIONS = [
  { value: "0-500k", label: "$0-500K" },
  { value: "500k-5m", label: "$500K-5M" },
  { value: "5m-10m", label: "$5M-10M" },
  { value: "10m-100m", label: "$10M-100M" },
  { value: "100m+", label: "$100M+" },
];

export default function Select() {
  const router = useRouter();
  const teamInfo = useTeam();
  const [selectedDoc, setSelectedDoc] = useState<string | null>(null);
  const [dealType, setDealType] = useState<string | null>(null);
  const [dealTypeOther, setDealTypeOther] = useState<string>("");
  const [showOtherInput, setShowOtherInput] = useState(false);
  const [dealSize, setDealSize] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Determine which survey step to show based on document type
  const needsDealTypeQuestion =
    selectedDoc === "notion" || selectedDoc === "document";
  const needsDealSizeQuestion =
    selectedDoc === "pitchdeck" ||
    selectedDoc === "sales-document" ||
    (needsDealTypeQuestion && dealType && dealType !== "project-management");

  const showDealTypeOptions = needsDealTypeQuestion && !dealType && !showOtherInput;
  const showDealSizeOptions =
    needsDealSizeQuestion &&
    (dealType || !needsDealTypeQuestion) &&
    !showOtherInput;

  const handleDocSelect = (docType: string) => {
    setSelectedDoc(docType);
    setDealType(null);
    setDealTypeOther("");
    setShowOtherInput(false);
    setDealSize(null);

    // Auto-set deal type for specific document types
    if (docType === "pitchdeck") {
      setDealType("startup-fundraising");
    } else if (docType === "sales-document") {
      setDealType("sales");
    }
  };

  const handleDealTypeSelect = (value: string) => {
    if (isSubmitting) return;
    setDealType(value);
    setShowOtherInput(false);
    if (value === "project-management") {
      setIsSubmitting(true);
      saveSurveyAndProceed(value, null, null);
    }
  };

  const handleOtherConfirm = () => {
    if (!dealTypeOther.trim()) return;
    setDealType("other");
    setShowOtherInput(false);
    // Show deal size question after confirming "Other"
  };

  const handleDealSizeSelect = (value: string) => {
    if (isSubmitting) return;
    setDealSize(value);
    setIsSubmitting(true);
    saveSurveyAndProceed(dealType, value, dealTypeOther || null);
  };

  const saveSurveyAndProceed = async (
    type: string | null,
    size: string | null,
    otherText: string | null,
  ) => {
    setIsSubmitting(true);

    try {
      if (teamInfo?.currentTeam?.id && type) {
        const res = await fetch(
          `/api/teams/${teamInfo.currentTeam.id}/survey`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              dealType: type,
              dealTypeOther: otherText,
              dealSize: size,
            }),
          },
        );

        if (!res.ok) {
          throw new Error(`Survey save failed: ${res.status}`);
        }
      }

      await router.push({
        pathname: "/welcome",
        query: { type: selectedDoc },
      });
    } catch (error) {
      console.error("Failed to save survey:", error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const getDealSizeQuestion = () => {
    if (
      selectedDoc === "pitchdeck" ||
      dealType === "startup-fundraising" ||
      dealType === "fund-management"
    ) {
      return "How much are you raising?";
    }
    if (
      dealType === "mergers-acquisitions" ||
      dealType === "real-estate" ||
      dealType === "financial-operations" ||
      dealType === "other"
    ) {
      return "What's the deal size?";
    }
    return "What's the typical deal size?";
  };

  return (
    <motion.div
      className="z-10 mx-5 flex flex-col items-center space-y-10 text-center sm:mx-auto"
      variants={{
        hidden: { opacity: 0, scale: 0.95 },
        show: {
          opacity: 1,
          scale: 1,
          transition: {
            staggerChildren: 0.2,
          },
        },
      }}
      initial="hidden"
      animate="show"
      exit="hidden"
      transition={{ duration: 0.3, type: "spring" }}
    >
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="flex flex-col items-center space-y-10 text-center"
      >
        <p className="text-2xl font-bold tracking-tighter text-foreground">
          Papermark
        </p>
        <h1 className="font-display max-w-md text-3xl font-semibold transition-colors sm:text-4xl">
          Which document do you want to share today?
        </h1>
      </motion.div>

      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="grid w-full grid-cols-1 divide-y divide-border rounded-md border border-border text-foreground md:grid-cols-4 md:divide-x"
      >
        <button
          onClick={() => handleDocSelect("pitchdeck")}
          className={`flex min-h-[100px] flex-col items-center justify-center space-y-5 overflow-hidden p-5 transition-colors md:min-h-[200px] md:p-10 ${
            selectedDoc === "pitchdeck"
              ? "bg-primary/5 ring-2 ring-inset ring-primary"
              : "hover:bg-gray-200 hover:dark:bg-gray-800"
          }`}
        >
          <PresentationIcon className="pointer-events-none h-auto w-12 sm:w-12" />
          <p>Pitchdeck</p>
        </button>

        <button
          onClick={() => handleDocSelect("sales-document")}
          className={`flex min-h-[100px] flex-col items-center justify-center space-y-5 overflow-hidden p-5 transition-colors md:min-h-[200px] md:p-10 ${
            selectedDoc === "sales-document"
              ? "bg-primary/5 ring-2 ring-inset ring-primary"
              : "hover:bg-gray-200 hover:dark:bg-gray-800"
          }`}
        >
          <FileChartPieIcon className="pointer-events-none h-auto w-12 sm:w-12" />
          <p>Sales document</p>
        </button>

        <button
          onClick={() => handleDocSelect("notion")}
          className={`flex min-h-[100px] flex-col items-center justify-center space-y-5 overflow-hidden p-5 transition-colors md:min-h-[200px] md:p-10 ${
            selectedDoc === "notion"
              ? "bg-primary/5 ring-2 ring-inset ring-primary"
              : "hover:bg-gray-200 hover:dark:bg-gray-800"
          }`}
        >
          <NotionIcon className="pointer-events-none h-auto w-12 sm:w-12" />
          <p>Notion Page</p>
        </button>

        <button
          onClick={() => handleDocSelect("document")}
          className={`flex min-h-[100px] flex-col items-center justify-center space-y-5 overflow-hidden p-5 transition-colors md:min-h-[200px] md:p-10 ${
            selectedDoc === "document"
              ? "bg-primary/5 ring-2 ring-inset ring-primary"
              : "hover:bg-gray-200 hover:dark:bg-gray-800"
          }`}
        >
          <FileIcon className="pointer-events-none h-auto w-12 sm:w-12" />
          <p>Another document</p>
        </button>
      </motion.div>

      {/* Inline Survey Questions */}
      {selectedDoc && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-xl space-y-4"
        >
          {/* Deal Type Question (for notion/document) */}
          {showDealTypeOptions && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                What do you use Papermark for?
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {DEAL_TYPE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleDealTypeSelect(option.value)}
                    disabled={isSubmitting}
                    className="rounded-full border border-border px-4 py-2 text-sm transition-all hover:border-primary hover:bg-primary/5"
                  >
                    {option.label}
                  </button>
                ))}
                <button
                  onClick={() => setShowOtherInput(true)}
                  disabled={isSubmitting}
                  className="rounded-full border border-border px-4 py-2 text-sm transition-all hover:border-primary hover:bg-primary/5"
                >
                  Other
                </button>
              </div>
            </div>
          )}

          {/* Other Input Field - inline */}
          {showOtherInput && !dealType && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                What do you use Papermark for?
              </p>
              <div className="flex items-center justify-center gap-2">
                <input
                  type="text"
                  value={dealTypeOther}
                  onChange={(e) => setDealTypeOther(e.target.value)}
                  placeholder="Please specify..."
                  className="max-w-xs rounded-full border border-border bg-background px-4 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && dealTypeOther.trim()) {
                      handleOtherConfirm();
                    }
                  }}
                />
                <button
                  onClick={handleOtherConfirm}
                  disabled={!dealTypeOther.trim() || isSubmitting}
                  className="rounded-full border border-primary bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-all hover:bg-primary/90 disabled:opacity-50"
                >
                  →
                </button>
              </div>
            </div>
          )}

          {/* Deal Size Question */}
          {showDealSizeOptions && !showDealTypeOptions && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-muted-foreground">
                {getDealSizeQuestion()}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {DEAL_SIZE_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => handleDealSizeSelect(option.value)}
                    disabled={isSubmitting}
                    className="rounded-full border border-border px-4 py-2 text-sm transition-all hover:border-primary hover:bg-primary/5"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Skip option */}
          <button
            onClick={() => saveSurveyAndProceed(dealType, null, dealTypeOther || null)}
            disabled={isSubmitting}
            aria-disabled={isSubmitting}
            className="text-xs text-muted-foreground underline-offset-4 hover:underline disabled:opacity-50 disabled:pointer-events-none"
          >
            Skip
          </button>
        </motion.div>
      )}
    </motion.div>
  );
}
