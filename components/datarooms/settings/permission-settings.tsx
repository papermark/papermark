import { useState } from "react";

import { useTeam } from "@/context/team-context";
import { LinkIcon, UsersIcon } from "lucide-react";
import { toast } from "sonner";
import useSWR from "swr";

import { cn, fetcher } from "@/lib/utils";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

type DefaultPermissionStrategy =
  | "INHERIT_FROM_PARENT"
  | "ASK_EVERY_TIME"
  | "HIDDEN_BY_DEFAULT";

type RootItemAccess = "VIEW_ONLY" | "VIEW_AND_DOWNLOAD" | "HIDDEN";

type PermissionField =
  | "defaultPermissionStrategy"
  | "defaultGroupPermissionStrategy"
  | "defaultRootItemAccess"
  | "defaultGroupRootItemAccess";

interface DataroomPermissionData {
  id: string;
  name: string;
  pId: string;
  defaultPermissionStrategy: DefaultPermissionStrategy;
  defaultGroupPermissionStrategy: DefaultPermissionStrategy;
  defaultRootItemAccess: RootItemAccess;
  defaultGroupRootItemAccess: RootItemAccess;
}

interface PermissionSettingsProps {
  dataroomId: string;
}

type SettingOption = {
  value: string;
  label: string;
  description: string;
};

const STRATEGY_OPTIONS: SettingOption[] = [
  {
    value: "INHERIT_FROM_PARENT",
    label: "Inherit from parent folder",
    description:
      "New documents and folders inherit permissions from the folder they are placed in. Root-level items use the root-level access setting below.",
  },
  {
    value: "ASK_EVERY_TIME",
    label: "Ask every time",
    description:
      "Show a permissions dialog after each upload to configure access manually.",
  },
  {
    value: "HIDDEN_BY_DEFAULT",
    label: "Hidden by default",
    description:
      "New documents and folders are hidden. Grant access manually before they become visible.",
  },
];

const ROOT_ACCESS_OPTIONS: SettingOption[] = [
  {
    value: "VIEW_ONLY",
    label: "View only",
    description:
      "Root-level documents and folders become viewable (not downloadable) for every group.",
  },
  {
    value: "VIEW_AND_DOWNLOAD",
    label: "View and download",
    description:
      "Root-level documents and folders become viewable and downloadable for every group.",
  },
  {
    value: "HIDDEN",
    label: "Hidden",
    description:
      "Root-level documents and folders stay hidden until access is granted manually.",
  },
];

type Scope = {
  key: PermissionField;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const STRATEGY_SCOPES: Scope[] = [
  {
    key: "defaultGroupPermissionStrategy",
    label: "Groups",
    icon: UsersIcon,
  },
  {
    key: "defaultPermissionStrategy",
    label: "Links",
    icon: LinkIcon,
  },
];

const ROOT_ACCESS_SCOPES: Scope[] = [
  {
    key: "defaultGroupRootItemAccess",
    label: "Groups",
    icon: UsersIcon,
  },
  {
    key: "defaultRootItemAccess",
    label: "Links",
    icon: LinkIcon,
  },
];

export default function PermissionSettings({
  dataroomId,
}: PermissionSettingsProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;

  const { data: dataroomData, mutate: mutateDataroom } =
    useSWR<DataroomPermissionData>(
      teamId && dataroomId
        ? `/api/teams/${teamId}/datarooms/${dataroomId}`
        : null,
      fetcher,
    );

  const [updatingField, setUpdatingField] = useState<PermissionField | null>(
    null,
  );

  const handlePermissionChange = async (
    field: PermissionField,
    value: string,
  ) => {
    if (!dataroomId || !teamId || updatingField || !dataroomData) return;
    setUpdatingField(field);

    const optimisticData: DataroomPermissionData = {
      ...dataroomData,
      [field]: value,
    };

    const mutation = async () => {
      const res = await fetch(`/api/teams/${teamId}/datarooms/${dataroomId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });

      if (!res.ok) {
        throw new Error("Failed to update permission settings");
      }

      return res.json();
    };

    try {
      await toast.promise(
        mutateDataroom(mutation(), {
          optimisticData,
          rollbackOnError: true,
          populateCache: true,
          revalidate: false,
        }),
        {
          loading: "Updating permission settings...",
          success: "Permission settings updated",
          error: (err) => err.message,
        },
      );
    } catch (error) {
      console.error(error);
    } finally {
      setUpdatingField(null);
    }
  };

  const values: Record<PermissionField, string> = {
    defaultGroupPermissionStrategy:
      dataroomData?.defaultGroupPermissionStrategy ?? "INHERIT_FROM_PARENT",
    defaultPermissionStrategy:
      dataroomData?.defaultPermissionStrategy ?? "INHERIT_FROM_PARENT",
    defaultGroupRootItemAccess:
      dataroomData?.defaultGroupRootItemAccess ?? "VIEW_ONLY",
    defaultRootItemAccess: dataroomData?.defaultRootItemAccess ?? "VIEW_ONLY",
  };

  const disabled = updatingField !== null || !dataroomData;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Default File Permissions</CardTitle>
          <CardDescription>
            Configure how new documents and folders are exposed to groups and
            links. Each scope is set independently.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsMatrix
            options={STRATEGY_OPTIONS}
            scopes={STRATEGY_SCOPES}
            values={values}
            disabled={disabled}
            onChange={handlePermissionChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Root-Level Item Access</CardTitle>
          <CardDescription>
            Items created at the top level of the dataroom have no parent folder
            to inherit from. Choose what access groups and links get on new
            root-level documents and folders when the strategy is &quot;Inherit
            from parent folder&quot;.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SettingsMatrix
            options={ROOT_ACCESS_OPTIONS}
            scopes={ROOT_ACCESS_SCOPES}
            values={values}
            disabled={disabled}
            onChange={handlePermissionChange}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsMatrix({
  options,
  scopes,
  values,
  disabled,
  onChange,
}: {
  options: SettingOption[];
  scopes: Scope[];
  values: Record<PermissionField, string>;
  disabled: boolean;
  onChange: (field: PermissionField, value: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-x-8 gap-y-1">
      <div />
      <div className="flex items-center gap-1">
        {scopes.map((scope) => (
          <div
            key={scope.key}
            className="flex w-20 items-center justify-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            <scope.icon className="h-3 w-3" />
            {scope.label}
          </div>
        ))}
      </div>

      {options.map((option, index) => (
        <SettingRow
          key={option.value}
          option={option}
          scopes={scopes}
          values={values}
          disabled={disabled}
          isFirst={index === 0}
          onChange={onChange}
        />
      ))}
    </div>
  );
}

function SettingRow({
  option,
  scopes,
  values,
  disabled,
  isFirst,
  onChange,
}: {
  option: SettingOption;
  scopes: Scope[];
  values: Record<PermissionField, string>;
  disabled: boolean;
  isFirst: boolean;
  onChange: (field: PermissionField, value: string) => void;
}) {
  return (
    <>
      <div className={cn("py-3", !isFirst && "border-t border-border/60")}>
        <Label
          htmlFor={`group-${option.value}`}
          className="text-sm font-medium"
        >
          {option.label}
        </Label>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {option.description}
        </p>
      </div>
      <div
        className={cn(
          "flex items-center gap-1 py-3",
          !isFirst && "border-t border-border/60",
        )}
      >
        {scopes.map((scope) => (
          <div
            key={scope.key}
            className="flex w-20 items-center justify-center"
          >
            <RadioGroup
              value={values[scope.key]}
              onValueChange={(value) => onChange(scope.key, value)}
              disabled={disabled}
              aria-label={`${scope.label} default`}
            >
              <RadioGroupItem
                value={option.value}
                id={`${scope.key}-${option.value}`}
                aria-label={`${option.label} for ${scope.label.toLowerCase()}`}
              />
            </RadioGroup>
          </div>
        ))}
      </div>
    </>
  );
}
