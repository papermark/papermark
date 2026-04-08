import { useRouter } from "next/router";

import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { E164Number } from "libphonenumber-js";
import { toast } from "sonner";
import { mutate } from "swr";

import { useAnalytics } from "@/lib/analytics";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { UpgradePlanModal } from "../billing/upgrade-plan-modal";
import { PhoneInput } from "../ui/phone-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

export function DataroomTrialModal({
  children,
  openModal = false,
  setOpenModal,
}: {
  children?: React.ReactNode;
  openModal?: boolean;
  setOpenModal?: React.Dispatch<React.SetStateAction<boolean>>;
}) {
  const router = useRouter();

  const [industry, setIndustry] = useState<string>("");
  const [companySize, setCompanySize] = useState<string>("");
  const [name, setName] = useState<string>("");
  const [companyName, setCompanyName] = useState<string>("");
  const [phoneNumber, setPhoneNumber] = useState<E164Number | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [open, setOpen] = useState<boolean>(openModal);

  const teamInfo = useTeam();
  const analytics = useAnalytics();

  // Helper function to convert industry to proper dataroom name
  const getDataroomName = (industryValue: string) => {
    const industryNames: Record<string, string> = {
      "finance-banking": "Finance and Banking Data Room",
      legal: "Legal Data Room",
      "real-estate": "Real Estate Data Room",
      technology: "Technology Data Room",
      pharmaceuticals: "Pharmaceuticals Data Room",
      energy: "Energy Data Room",
      manufacturing: "Manufacturing Data Room",
      healthcare: "Healthcare Data Room",
      consulting: "Consulting and Professional Services Data Room",
      government: "Government and Public Sector Data Room",
      entertainment: "Entertainment and Media Data Room",
      other: "Data Room",
    };

    return industryNames[industryValue] || "Data Room";
  };

  const handleSubmit = async (event: any) => {
    event.preventDefault();
    event.stopPropagation();

    if (!name || !companyName || !industry || !companySize || !phoneNumber) {
      toast.error("Please fill out all fields.");
      return;
    }

    setLoading(true);

    const dataroomName = getDataroomName(industry);

    try {
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
            industry,
            companySize,
            phoneNumber,
          }),
        },
      );

      if (!response.ok) {
        const { message } = await response.json();
        setLoading(false);
        toast.error(message);
        return;
      }

      analytics.capture("Dataroom Trial Created", {
        dataroomName: dataroomName,
        industry,
        companySize,
      });
      toast.success("Dataroom successfully created! 🎉");

      await Promise.all([
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms`),
        mutate(`/api/teams/${teamInfo?.currentTeam?.id}/datarooms?simple=true`),
      ]);
      router.push("/datarooms");
    } catch (error) {
      setLoading(false);
      toast.error("Error adding dataroom. Please try again.");
      return;
    } finally {
      setLoading(false);
      setOpen(false);
      if (openModal && setOpenModal) setOpenModal(false);
    }
  };

  const onOpenChange = (open: boolean) => {
    if (!open) {
      setOpen(false);
    } else {
      setOpen(true);
    }
    if (openModal && setOpenModal) setOpenModal(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="text-start">
          <DialogTitle>Dataroom Trial for 7 days</DialogTitle>
          <DialogDescription>No credit card required.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="name" className="opacity-80">
              Your Full Name
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
              Company Name
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
          <div className="space-y-1">
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
          </div>
          <div className="space-y-1">
            <Label className="opacity-80">Company Size</Label>
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
            <Label className="opacity-80">Phone Number</Label>
            <PhoneInput
              placeholder="+1 123 456 7890"
              onChange={(value) => setPhoneNumber(value)}
              defaultCountry="US"
            />
          </div>

          <DialogFooter>
            <div className="flex flex-col space-y-4">
              <Button
                type="submit"
                className="h-9 w-full"
                disabled={
                  !phoneNumber ||
                  !companySize ||
                  !industry ||
                  !name ||
                  !companyName
                }
                loading={loading}
              >
                Access your data room
              </Button>

              <div className="text-xs text-muted-foreground">
                After the trial, upgrade to{" "}
                <UpgradePlanModal clickedPlan={PlanEnum.Business}>
                  <button className="underline">Papermark Business</button>
                </UpgradePlanModal>{" "}
                to continue using Data Room plan features.
              </div>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
