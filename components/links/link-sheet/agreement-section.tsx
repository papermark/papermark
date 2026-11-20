import { useEffect, useMemo, useState } from "react";

import { Agreement } from "@prisma/client";
import { PlusIcon } from "lucide-react";
import { motion } from "motion/react";

import { FADE_IN_ANIMATION_SETTINGS } from "@/lib/constants";
import { useAgreements } from "@/lib/swr/use-agreements";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

import { DEFAULT_LINK_TYPE } from ".";
import AgreementSheet from "./agreement-panel";
import LinkItem from "./link-item";
import { LinkUpgradeOptions } from "./link-options";

const isSigningAgreement = (
  agreement: Pick<Agreement, "contentType" | "signingProvider">,
) =>
  agreement.contentType === "SIGNING" ||
  agreement.signingProvider === "DOCUMENSO";

type AgreementWithSignedResponseCount = Agreement & {
  _count?: {
    responses?: number;
  };
};

const agreementHasSignatures = (agreement: AgreementWithSignedResponseCount) =>
  (agreement._count?.responses ?? 0) > 0;

export default function AgreementSection({
  data,
  setData,
  isAllowed,
  handleUpgradeStateChange,
}: {
  data: DEFAULT_LINK_TYPE;
  setData: React.Dispatch<React.SetStateAction<DEFAULT_LINK_TYPE>>;
  isAllowed: boolean;
  handleUpgradeStateChange: ({
    state,
    trigger,
    plan,
    highlightItem,
  }: LinkUpgradeOptions) => void;
}) {
  const { agreements } = useAgreements();
  const { enableAgreement, agreementId, emailProtected } = data;
  const [enabled, setEnabled] = useState<boolean>(false);
  const [isAgreementSheetVisible, setIsAgreementSheetVisible] =
    useState<boolean>(false);
  const [editAgreement, setEditAgreement] = useState<Agreement | null>(null);
  const [startSigningAuthoring, setStartSigningAuthoring] = useState(false);
  const [isAgreementSelectOpen, setIsAgreementSelectOpen] = useState(false);

  const filteredAgreements = useMemo(
    () =>
      agreements.filter(
        (agreement: Agreement) =>
          !agreement.deletedAt || agreement.id === agreementId,
      ),
    [agreements, agreementId],
  );

  useEffect(() => {
    setEnabled(enableAgreement!);
  }, [enableAgreement]);

  const handleAgreement = async () => {
    const updatedAgreement = !enabled;

    setData({
      ...data,
      enableAgreement: updatedAgreement,
      emailProtected: updatedAgreement ? true : emailProtected,
    });
    setEnabled(updatedAgreement);
  };

  const handleAgreementChange = (value: string) => {
    setData({ ...data, agreementId: value });
  };

  const handleAgreementSaved = (agreement: Agreement) => {
    setData((prev) => ({ ...prev, agreementId: agreement.id }));
  };

  const handleAddAgreement = () => {
    setEditAgreement(null);
    setStartSigningAuthoring(false);
    setIsAgreementSheetVisible(true);
  };

  const handleEditSigningAgreement = (agreement: Agreement) => {
    if (!isSigningAgreement(agreement)) {
      return;
    }

    setEditAgreement(agreement);
    setStartSigningAuthoring(true);
    setIsAgreementSelectOpen(false);
    setIsAgreementSheetVisible(true);
  };

  const handleAgreementSheetClose = () => {
    setEditAgreement(null);
    setStartSigningAuthoring(false);
  };

  return (
    <div className="pb-5">
      <LinkItem
        title="NDA agreement"
        link="https://www.papermark.com/help/article/require-nda-to-view"
        tooltipContent="Users must acknowledge an agreement to access the content."
        enabled={enabled}
        action={handleAgreement}
        isAllowed={isAllowed}
        requiredPlan="datarooms"
        upgradeAction={() =>
          handleUpgradeStateChange({
            state: true,
            trigger: "link_sheet_agreement_section",
            plan: "Data Rooms",
            highlightItem: ["nda"],
          })
        }
      />

      {enabled && (
        <motion.div
          className="relative mt-4 space-y-3"
          {...FADE_IN_ANIMATION_SETTINGS}
        >
          <div className="flex w-full flex-col items-start gap-3 overflow-x-visible pb-4 pt-0">
            <div className="flex w-full flex-wrap items-center gap-2">
              <Select
                open={isAgreementSelectOpen}
                onOpenChange={setIsAgreementSelectOpen}
                value={agreementId ?? ""}
                onValueChange={handleAgreementChange}
              >
                <SelectTrigger className="focus:ring-offset-3 flex min-w-[220px] flex-1 rounded-md border-0 bg-background py-1.5 text-foreground shadow-sm ring-1 ring-inset ring-input placeholder:text-muted-foreground focus:ring-2 focus:ring-gray-400 sm:text-sm sm:leading-6">
                  <SelectValue placeholder="Select an agreement" />
                </SelectTrigger>
                <SelectContent>
                  {filteredAgreements && filteredAgreements.length > 0 ? (
                    filteredAgreements.map((agreement) => {
                      const canEditFields = isSigningAgreement(agreement);
                      const hasSignatures = agreementHasSignatures(agreement);
                      const isSelected = agreement.id === agreementId;
                      const disabledEditReason =
                        "Signing fields cannot be edited after signatures have been collected";
                      const editVisibilityClass = isSelected
                        ? hasSignatures
                          ? "opacity-50"
                          : "opacity-100"
                        : hasSignatures
                          ? "opacity-0 group-focus/agreement:opacity-50 group-hover/agreement:opacity-50"
                          : "opacity-0 group-focus/agreement:opacity-100 group-hover/agreement:opacity-100";

                      return (
                        <SelectItem
                          key={agreement.id}
                          value={agreement.id}
                          className="group/agreement pr-16"
                          trailingContent={
                            canEditFields ? (
                              <TooltipProvider delayDuration={0}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span
                                      role="button"
                                      tabIndex={hasSignatures ? -1 : 0}
                                      aria-disabled={hasSignatures}
                                      aria-label={`Edit signing fields for ${agreement.name}`}
                                      className={`absolute right-7 top-1/2 z-10 flex h-6 -translate-y-1/2 items-center rounded-md border border-border bg-background px-2 text-xs font-medium text-muted-foreground shadow-sm transition-opacity ${
                                        hasSignatures
                                          ? "cursor-not-allowed"
                                          : "cursor-pointer hover:border-foreground/20 hover:text-foreground"
                                      } ${editVisibilityClass}`}
                                      onPointerDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();

                                        if (hasSignatures) {
                                          return;
                                        }

                                        handleEditSigningAgreement(agreement);
                                      }}
                                      onKeyDown={(event) => {
                                        if (
                                          event.key !== "Enter" &&
                                          event.key !== " "
                                        ) {
                                          return;
                                        }

                                        event.preventDefault();
                                        event.stopPropagation();

                                        if (hasSignatures) {
                                          return;
                                        }

                                        handleEditSigningAgreement(agreement);
                                      }}
                                    >
                                      Edit
                                    </span>
                                  </TooltipTrigger>
                                  {hasSignatures ? (
                                    <TooltipPortal>
                                      <TooltipContent
                                        side="left"
                                        sideOffset={8}
                                        className="max-w-64 text-center text-xs"
                                      >
                                        {disabledEditReason}
                                      </TooltipContent>
                                    </TooltipPortal>
                                  ) : null}
                                </Tooltip>
                              </TooltipProvider>
                            ) : null
                          }
                        >
                          {agreement.name}
                        </SelectItem>
                      );
                    })
                  ) : (
                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                      No agreements yet
                    </div>
                  )}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-9 shrink-0"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleAddAgreement();
                }}
              >
                <PlusIcon className="mr-2 h-4 w-4" />
                Add agreement
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      <AgreementSheet
        editAgreement={editAgreement}
        isOpen={isAgreementSheetVisible}
        setIsOpen={setIsAgreementSheetVisible}
        startSigningAuthoring={startSigningAuthoring}
        onClose={handleAgreementSheetClose}
        onSaved={handleAgreementSaved}
      />
    </div>
  );
}
