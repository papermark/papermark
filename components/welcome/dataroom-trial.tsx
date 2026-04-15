import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { E164Number } from "libphonenumber-js";
import { motion } from "motion/react";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";
import { STAGGER_CHILD_VARIANTS } from "@/lib/constants";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PhoneInput } from "@/components/ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { UpgradePlanModal } from "../billing/upgrade-plan-modal";
import { Input } from "../ui/input";

export default function DataroomTrial() {
  const teamInfo = useTeam();
  const analytics = useAnalytics();
  const router = useRouter();

  const [useCase, setUseCase] = useState<string>("");
  const [customUseCase, setCustomUseCase] = useState<string>("");
  const [dealSize, setDealSize] = useState<string>("");
  const [companySize, setCompanySize] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [tools, setTools] = useState<string>("");

  const [loading, setLoading] = useState<boolean>(false);

  // Map use case to deal type for survey
  const useCaseToDealType: Record<string, string> = {
    "mergers-and-acquisitions": "mergers-acquisitions",
    "startup-fundraising": "startup-fundraising",
    "fund-management": "fund-management",
    sales: "sales",
    "project-management": "project-management",
    operations: "financial-operations",
    "real-estate": "real-estate",
  };

  // Check if use case needs deal size question
  const needsDealSize =
    !!useCase && useCase !== "project-management";

  // Helper function to convert use case to proper dataroom name
  const getDataroomName = (useCaseValue: string, customValue: string = "") => {
    if (useCaseValue === "other" && customValue) {
      return `${customValue} Data Room`;
    }

    const useCaseNames: Record<string, string> = {
      "mergers-and-acquisitions": "Mergers & Acquisitions Data Room",
      "startup-fundraising": "Startup Fundraising Data Room",
      "fund-management": "Fundraising & Reporting Data Room",
      sales: "Sales Data Room",
      "project-management": "Project Management Data Room",
      operations: "Financial Operations Data Room",
      "real-estate": "Real Estate Data Room",
    };

    return useCaseNames[useCaseValue] || "Data Room";
  };

  const handleSubmit = async (event: any) => {
    event.preventDefault();
    event.stopPropagation();

    if (!name || !companyName || !useCase || !companySize || !tools) {
      toast.error("Please fill out all fields.");
      return;
    }

    // Check if deal size is required but not filled
    if (needsDealSize && !dealSize) {
      toast.error("Please select a deal size.");
      return;
    }

    setLoading(true);

    const dataroomName = getDataroomName(useCase, customUseCase.trim());

    try {
      // Save survey data to team
      const dealType = useCase === "other" ? "other" : useCaseToDealType[useCase];
      if (dealType) {
        await fetch(`/api/teams/${teamInfo?.currentTeam?.id}/survey`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            dealType,
            dealTypeOther: useCase === "other" ? customUseCase.trim() : null,
            dealSize: dealSize || null,
          }),
        });
      }

      const response = await fetch(
        `/api/teams/${teamInfo?.currentTeam?.id}/datarooms/trial`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: dataroomName,
            fullName: name,
            companyName,
            useCase: useCase === "other" ? customUseCase.trim() : useCase,
            companySize,
            tools,
          }),
        },
      );

      if (!response.ok) {
        const { message } = await response.json();
        setLoading(false);
        toast.error(message);
        return;
      }

      const { id: dataroomId } = await response.json(); // Assuming the API returns the created dataroom's ID

      if (!dataroomId) {
        throw new Error("No dataroom ID returned from the server");
      }

      analytics.capture("Dataroom Trial Created", {
        dataroomName: dataroomName,
        useCase: useCase === "other" ? customUseCase.trim() : useCase,
        companySize,
        dealSize,
        dataroomId,
      });
      toast.success("Free trial started! 🎉");

      await Promise.all([
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms`),
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms?simple=true`),
      ]);

      // Navigate to dataroom choice page (scratch vs templates)
      router.push(`/welcome?type=dataroom-choice&dataroomId=${dataroomId}`);
    } catch (error) {
      toast.error("Error adding dataroom. Please try again.");
      console.error("Error creating dataroom:", error);
    } finally {
      setLoading(false);
    }
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
        <h1 className="font-display max-w-lg text-3xl font-semibold transition-colors sm:text-4xl">
          Start a 7-day free trial!
        </h1>
        {/* <p className="mt-2 text-lg text-muted-foreground">
          Data Room Plan Trial
        </p> */}
      </motion.div>
      <motion.div
        variants={STAGGER_CHILD_VARIANTS}
        className="mx-auto mt-24 w-full max-w-md text-left"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name" className="opacity-80">
              Your Full Name*
            </Label>
            <Input
              id="name"
              type="text"
              autoComplete="off"
              data-1p-ignore
              placeholder="John Doe"
              className="mb-4 mt-1 w-full"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="company-name" className="opacity-80">
              Company Name*
            </Label>
            <Input
              id="company-name"
              type="text"
              autoComplete="off"
              data-1p-ignore
              placeholder="ACME Inc."
              className="mb-4 mt-1 w-full"
              onChange={(e) => setCompanyName(e.target.value)}
            />
          </div>
          {/* <div className="space-y-1">
            <Label className="opacity-80">Industry</Label>
            <Select onValueChange={(value) => setIndustry(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select an industry" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="finance-banking">
                  Finance and Banking
                </SelectItem>
                <SelectItem value="legal">Legal</SelectItem>
                <SelectItem value="real-estate">Real Estate</SelectItem>
                <SelectItem value="technology">Technology</SelectItem>
                <SelectItem value="pharmaceuticals">Pharmaceuticals</SelectItem>
                <SelectItem value="energy">Energy</SelectItem>
                <SelectItem value="manufacturing">Manufacturing</SelectItem>
                <SelectItem value="healthcare">Healthcare</SelectItem>
                <SelectItem value="consulting">
                  Consulting and Professional Services
                </SelectItem>
                <SelectItem value="government">
                  Government and Public Sector
                </SelectItem>
                <SelectItem value="entertainment">
                  Entertainment and Media
                </SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div> */}
          <div className="space-y-1">
            <Label className="opacity-80">Company Size*</Label>
            <Select onValueChange={(value) => setCompanySize(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select a company size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">1 employee</SelectItem>
                <SelectItem value="2-10">2-10 employees</SelectItem>
                <SelectItem value="11-50">11-50 employees</SelectItem>
                <SelectItem value="51-200">51-200 employees</SelectItem>
                <SelectItem value="201-500">201-500 employees</SelectItem>
                <SelectItem value="501-1000">501-1,000 employees</SelectItem>
                <SelectItem value="1001-5000">1,001-5,000 employees</SelectItem>
                <SelectItem value="5001-10000">
                  5,001-10,000 employees
                </SelectItem>
                <SelectItem value="10001+">10,001+ employees</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="opacity-80">Use Case*</Label>
            <Select
              onValueChange={(value) => {
                setUseCase(value);
                if (value !== "other") {
                  setCustomUseCase("");
                }
                // Reset deal size when use case changes
                setDealSize("");
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select your use case" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="mergers-and-acquisitions">
                  Mergers & Acquisitions
                </SelectItem>
                <SelectItem value="startup-fundraising">
                  Startup Fundraising
                </SelectItem>
                <SelectItem value="fund-management">
                  Fundraising & Reporting
                </SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="project-management">
                  Project Management
                </SelectItem>
                <SelectItem value="operations">Financial Operations</SelectItem>
                <SelectItem value="real-estate">Real Estate</SelectItem>

                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
            {useCase === "other" && (
              <input
                type="text"
                className="mt-2 w-full rounded border border-gray-300 px-3 py-2 text-sm"
                placeholder="Please specify your use case"
                value={customUseCase}
                onChange={(e) => setCustomUseCase(e.target.value)}
              />
            )}
          </div>

          {/* Deal Size - shown after use case is selected (except project-management and operations) */}
          {needsDealSize && (
            <div className="space-y-1">
              <Label className="opacity-80">
                {useCase === "startup-fundraising" || useCase === "fund-management"
                  ? "How much are you raising?*"
                  : "What's the deal size?*"}
              </Label>
              <Select onValueChange={(value) => setDealSize(value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select deal size" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0-500k">$0 - $500K</SelectItem>
                  <SelectItem value="500k-5m">$500K - $5M</SelectItem>
                  <SelectItem value="5m-10m">$5M - $10M</SelectItem>
                  <SelectItem value="10m-100m">$10M - $100M</SelectItem>
                  <SelectItem value="100m+">$100M+</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="tools" className="opacity-80">
              Tools*
            </Label>
            <Input
              id="tools"
              type="text"
              autoComplete="off"
              data-1p-ignore
              placeholder="Current software you are using for data rooms"
              className="mb-4 mt-1 w-full"
              onChange={(e) => setTools(e.target.value)}
            />
          </div>
          {/* <div className="space-y-1">
            <Label className="opacity-80">Phone Number</Label>
            <PhoneInput
              placeholder="+1 123 456 7890"
              onChange={(value) => setPhoneNumber(value)}
              defaultCountry="US"
            />
          </div> */}

          <div className="space-y-4 text-center">
            <Button
              type="submit"
              className="h-9 w-full"
              disabled={
                !tools ||
                !companySize ||
                !useCase ||
                !name ||
                !companyName ||
                (useCase === "other" && !customUseCase.trim()) ||
                (needsDealSize && !dealSize)
              }
              loading={loading}
            >
              Access your data room
            </Button>

            <div className="text-xs text-muted-foreground">
              {/* Data rooms are available on our{" "}
              <UpgradePlanModal clickedPlan={PlanEnum.Business}>
                <button className="underline">Business</button>
              </UpgradePlanModal>{" "}
              plan. <br /> */}
              No credit card is required. After the trial, upgrade to{" "}
              <UpgradePlanModal
                clickedPlan={PlanEnum.Business}
                highlightItem={["datarooms"]}
                trigger="dataroom_trial_form"
              >
                <button className="underline">Papermark Data Rooms</button>
              </UpgradePlanModal>{" "}
              to continue using Data Room plan features.
            </div>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
}
