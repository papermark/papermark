import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const VISITOR_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "visited", label: "Visited" },
  { value: "invited", label: "Invited" },
  { value: "allowed", label: "On allow list" },
  { value: "assigned", label: "Assigned" },
  { value: "blocked", label: "Blocked" },
  { value: "none", label: "No activity" },
];

export function VisitorStatusFilter({
  value,
  onChange,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={className ?? "h-10 w-[160px]"}>
        <SelectValue placeholder="All statuses" />
      </SelectTrigger>
      <SelectContent>
        {VISITOR_STATUS_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
