import {
  Dispatch,
  SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import { useTeam } from "@/context/team-context";
import { PlanEnum } from "@/ee/stripe/constants";
import { CircleHelpIcon } from "lucide-react";
import { toast } from "sonner";

import { usePlan } from "@/lib/swr/use-billing";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import { UpgradeButton } from "@/components/ui/upgrade-button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BadgeTooltip } from "@/components/ui/tooltip";

import {
  DEFAULT_RESOURCE_STATE,
  PRESET_DESCRIPTIONS,
  PRESET_OPTIONS,
  Preset,
  RESOURCE_OPTIONS,
  Resource,
  ResourceState,
  TOKEN_TYPE_OPTIONS,
  TokenSubjectType,
  buildScopesList,
  scopesToEditorState,
} from "./scopes";

interface TokenForEdit {
  id: string;
  name: string;
  scopes: string | null;
}

interface AddEditTokenModalProps {
  showModal: boolean;
  setShowModal: Dispatch<SetStateAction<boolean>>;
  token?: TokenForEdit;
  onTokenCreated?: (secret: string) => void;
  onSaved?: () => void;
}

function AddEditTokenModal({
  showModal,
  setShowModal,
  token,
  onTokenCreated,
  onSaved,
}: AddEditTokenModalProps) {
  const teamInfo = useTeam();
  const teamId = teamInfo?.currentTeam?.id;
  const isEdit = Boolean(token);
  const { isFree, isPro, isTrial } = usePlan();
  const showUpgrade = (isFree || isPro) && !isTrial;

  const initial = useMemo(
    () =>
      token
        ? scopesToEditorState(token.scopes)
        : {
            preset: "all_access" as Preset,
            resourceState: { ...DEFAULT_RESOURCE_STATE },
          },
    [token],
  );

  const [name, setName] = useState(token?.name ?? "");
  const [subjectType, setSubjectType] = useState<TokenSubjectType>("user");
  const [preset, setPreset] = useState<Preset>(initial.preset);
  const [resourceState, setResourceState] = useState<ResourceState>(
    initial.resourceState,
  );
  const [isLoading, setIsLoading] = useState(false);

  // Reset state when the modal opens or the target token changes so re-opens
  // don't leak input from a previous edit/create cycle.
  useEffect(() => {
    if (!showModal) return;
    setName(token?.name ?? "");
    setPreset(initial.preset);
    setResourceState(initial.resourceState);
    if (!isEdit) setSubjectType("user");
    setIsLoading(false);
  }, [showModal, token, initial, isEdit]);

  const scopesList = useMemo(
    () => buildScopesList(preset, resourceState),
    [preset, resourceState],
  );

  const submitDisabled =
    isLoading ||
    (!isEdit && !name.trim()) ||
    (isEdit && !name.trim()) ||
    (preset === "restricted" && scopesList.length === 0);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (showUpgrade) return;
    if (preset === "restricted" && scopesList.length === 0) {
      toast.error("Select at least one resource permission");
      return;
    }
    try {
      setIsLoading(true);

      if (isEdit && token) {
        const response = await fetch(`/api/teams/${teamId}/tokens`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            tokenId: token.id,
            name: name.trim(),
            scopes: scopesList,
          }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error);
        }
        toast.success("API key updated");
        setShowModal(false);
        onSaved?.();
      } else {
        const response = await fetch(`/api/teams/${teamId}/tokens`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            scopes: scopesList,
            subjectType,
          }),
        });
        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error);
        }
        const data = (await response.json()) as { token: string };
        toast.success("API key created");
        setShowModal(false);
        onSaved?.();
        onTokenCreated?.(data.token);
      }
    } catch (error) {
      console.error(error);
      toast.error((error as Error).message || "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const setResource = (resource: Resource, value: "none" | "read" | "write") => {
    setResourceState((prev) => ({ ...prev, [resource]: value }));
  };

  return (
    <Dialog open={showModal} onOpenChange={setShowModal}>
      <DialogContent className="bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit API key" : "Create new API key"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-2">
            <Label htmlFor="token-name">Name</Label>
            <Input
              id="token-name"
              autoFocus
              placeholder="My API key"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-white text-gray-900 dark:bg-white"
            />
          </div>

          {!isEdit ? (
            <div className="space-y-2">
              <Label>Type</Label>
              <div
                role="radiogroup"
                aria-label="Token subject type"
                className="grid grid-cols-2 gap-3"
              >
                {TOKEN_TYPE_OPTIONS.map((option) => {
                  const active = option.value === subjectType;
                  return (
                    <button
                      type="button"
                      key={option.value}
                      role="radio"
                      aria-checked={active}
                      onClick={() => setSubjectType(option.value)}
                      className={cn(
                        "group flex items-center justify-between rounded-md border px-3 py-2.5 text-left text-sm transition-colors",
                        active
                          ? "border-gray-900 text-gray-900 ring-1 ring-gray-900 dark:border-gray-100 dark:ring-gray-100"
                          : "border-gray-200 text-gray-700 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-4 w-4 items-center justify-center rounded-full border",
                            active
                              ? "border-gray-900 dark:border-gray-100"
                              : "border-gray-300 dark:border-gray-600",
                          )}
                        >
                          {active ? (
                            <span className="h-2 w-2 rounded-full bg-gray-900 dark:bg-gray-100" />
                          ) : null}
                        </span>
                        <span className="font-medium">{option.label}</span>
                      </span>
                      <BadgeTooltip
                        content={option.tooltip}
                        className="max-w-72 text-left leading-5 text-gray-600"
                      >
                        <CircleHelpIcon className="h-4 w-4 text-gray-400 group-hover:text-gray-600" />
                      </BadgeTooltip>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label>Permissions</Label>
            <div
              role="radiogroup"
              aria-label="Token permissions preset"
              className="grid grid-cols-3 overflow-hidden rounded-md border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
            >
              {PRESET_OPTIONS.map((option) => {
                const active = preset === option.value;
                return (
                  <button
                    type="button"
                    key={option.value}
                    role="radio"
                    aria-checked={active}
                    onClick={() => setPreset(option.value)}
                    className={cn(
                      "flex h-9 items-center justify-center text-sm transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400",
                      active
                        ? "bg-white font-medium text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 dark:bg-gray-900 dark:text-gray-100 dark:ring-gray-600"
                        : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700",
                    )}
                  >
                    {option.value === "all_access"
                      ? "All"
                      : option.value === "read_only"
                        ? "Read Only"
                        : "Restricted"}
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              This API key will have{" "}
              <span className="font-medium text-gray-700 dark:text-gray-200">
                {PRESET_DESCRIPTIONS[preset]}
              </span>
            </p>
          </div>

          {preset === "restricted" ? (
            <div className="space-y-3 border-t border-gray-100 pt-3 dark:border-gray-800">
              {RESOURCE_OPTIONS.map((option) => (
                <div
                  key={option.resource}
                  className="flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {option.label}
                    <BadgeTooltip
                      content={option.description}
                      className="max-w-72 text-left leading-5 text-gray-600"
                    >
                      <CircleHelpIcon className="h-3.5 w-3.5 text-gray-400" />
                    </BadgeTooltip>
                  </div>
                  <div className="flex items-center gap-4 text-sm">
                    <RadioPill
                      label="None"
                      checked={resourceState[option.resource] === "none"}
                      onClick={() => setResource(option.resource, "none")}
                    />
                    <RadioPill
                      label="Read"
                      checked={resourceState[option.resource] === "read"}
                      onClick={() => setResource(option.resource, "read")}
                    />
                    {option.actions.includes("write") ? (
                      <RadioPill
                        label="Write"
                        checked={resourceState[option.resource] === "write"}
                        onClick={() => setResource(option.resource, "write")}
                      />
                    ) : (
                      <span className="w-[56px]" aria-hidden />
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {showUpgrade ? (
            <UpgradeButton
              text="Business"
              customText="Upgrade to save API Key"
              clickedPlan={PlanEnum.Business}
              trigger="create_token"
              highlightItem={["api"]}
              className="w-full justify-center"
              key="create-token"
            />
          ) : (
            <Button
              type="submit"
              disabled={submitDisabled}
              loading={isLoading}
              className="w-full bg-gray-900 text-gray-50 hover:bg-gray-900/90"
            >
              {isEdit ? "Save changes" : "Create API key"}
            </Button>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RadioPill({
  label,
  checked,
  onClick,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      onClick={onClick}
      className="group flex items-center gap-1.5 text-sm text-gray-700 dark:text-gray-300"
    >
      <span
        className={cn(
          "flex h-4 w-4 items-center justify-center rounded-full border transition-colors",
          checked
            ? "border-gray-900 dark:border-gray-100"
            : "border-gray-300 group-hover:border-gray-500 dark:border-gray-600",
        )}
      >
        {checked ? (
          <span className="h-2 w-2 rounded-full bg-gray-900 dark:bg-gray-100" />
        ) : null}
      </span>
      {label}
    </button>
  );
}

export function useAddEditTokenModal({
  token,
  onTokenCreated,
  onSaved,
}: {
  token?: TokenForEdit;
  onTokenCreated?: (secret: string) => void;
  onSaved?: () => void;
} = {}) {
  const [showAddEditTokenModal, setShowAddEditTokenModal] = useState(false);

  const AddEditTokenModalCallback = useCallback(
    () => (
      <AddEditTokenModal
        showModal={showAddEditTokenModal}
        setShowModal={setShowAddEditTokenModal}
        token={token}
        onTokenCreated={onTokenCreated}
        onSaved={onSaved}
      />
    ),
    [showAddEditTokenModal, token, onTokenCreated, onSaved],
  );

  return useMemo(
    () => ({
      showAddEditTokenModal,
      setShowAddEditTokenModal,
      AddEditTokenModal: AddEditTokenModalCallback,
    }),
    [showAddEditTokenModal, AddEditTokenModalCallback],
  );
}
