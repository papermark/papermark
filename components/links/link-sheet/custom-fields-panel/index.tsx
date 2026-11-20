import { useCallback } from "react";

import { CustomField, CustomFieldType } from "@prisma/client";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import useLimits from "@/lib/swr/use-limits";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

import AccessScreenPreview from "../access-screen-preview";
import CustomFieldComponent from "./custom-field";

export type CustomFieldData = Omit<
  CustomField,
  "id" | "createdAt" | "updatedAt" | "linkId"
> & {
  type: Omit<CustomFieldType, "CHECKBOX" | "SELECT" | "MULTI_SELECT">;
};

export default function CustomFieldsPanel({
  fields,
  onChange,
  isConfigOpen,
  setIsConfigOpen,
  requireEmail,
  requirePassword,
  requireAgreement,
  welcomeMessage,
}: {
  fields: CustomFieldData[];
  onChange: (fields: CustomFieldData[]) => void;
  isConfigOpen: boolean;
  setIsConfigOpen: (open: boolean) => void;
  requireEmail?: boolean;
  requirePassword?: boolean;
  requireAgreement?: boolean;
  welcomeMessage?: string | null;
}) {
  const { limits } = useLimits();

  const fieldLimit = limits?.linkCustomFields ?? 0;

  const addField = useCallback(() => {
    if (fields.length >= fieldLimit) {
      toast.error(
        `You can only add up to ${fieldLimit} custom field${fieldLimit === 1 ? "" : "s"} on your current plan`,
      );
      return;
    }

    const newField: CustomFieldData = {
      type: "SHORT_TEXT",
      identifier: "",
      label: "",
      placeholder: "",
      required: false,
      disabled: false,
      orderIndex: fields.length,
    };
    onChange([...fields, newField]);
  }, [fields, fieldLimit, onChange]);

  const updateField = useCallback(
    (index: number, updatedField: CustomFieldData) => {
      const newFields = [...fields];
      newFields[index] = updatedField;
      onChange(newFields);
    },
    [fields, onChange],
  );

  const removeField = useCallback(
    (index: number) => {
      const newFields = fields.filter((_, i) => i !== index);
      // Update orderIndex for remaining fields
      newFields.forEach((field, i) => {
        field.orderIndex = i;
      });
      onChange(newFields);
    },
    [fields, onChange],
  );

  const moveField = useCallback(
    (index: number, direction: "up" | "down") => {
      if (
        (direction === "up" && index === 0) ||
        (direction === "down" && index === fields.length - 1)
      )
        return;

      const newFields = [...fields];
      const newIndex = direction === "up" ? index - 1 : index + 1;
      [newFields[index], newFields[newIndex]] = [
        newFields[newIndex],
        newFields[index],
      ];

      // Update orderIndex for all fields
      newFields.forEach((field, i) => {
        field.orderIndex = i;
      });

      onChange(newFields);
    },
    [fields, onChange],
  );

  return (
    <Sheet open={isConfigOpen} onOpenChange={setIsConfigOpen}>
      <SheetContent className="flex h-full flex-col sm:max-w-6xl">
        <SheetHeader>
          <SheetTitle>Configure Custom Form Fields</SheetTitle>
          <SheetDescription>
            Configure the custom fields that will be shown to viewers.
            {fieldLimit > 0 && (
              <span className="mt-1 block text-sm text-muted-foreground">
                You can add up to {fieldLimit} custom field
                {fieldLimit === 1 ? "" : "s"} on your current plan.
              </span>
            )}
          </SheetDescription>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-6 lg:flex-row lg:gap-8">
          {/* Config column */}
          <div className="flex min-h-0 flex-1 flex-col gap-4 lg:w-[360px] lg:flex-none">
            <div className="flex items-center justify-between">
              <div className="text-sm text-muted-foreground">
                {fields.length} of {fieldLimit} custom field
                {fields.length === 1 ? "" : "s"}
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={addField}
                className="flex items-center gap-2"
                disabled={fields.length >= fieldLimit}
              >
                <Plus className="h-4 w-4" />
                Add Field
              </Button>
            </div>

            <Separator />

            <ScrollArea className="min-h-0 flex-1 lg:pr-4">
              <div className="space-y-4">
                {fields.map((field, index) => (
                  <CustomFieldComponent
                    key={index}
                    field={field}
                    onUpdate={(updatedField) =>
                      updateField(index, updatedField)
                    }
                    onDelete={() => removeField(index)}
                    onMoveUp={() => moveField(index, "up")}
                    onMoveDown={() => moveField(index, "down")}
                    isFirst={index === 0}
                    isLast={index === fields.length - 1}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>

          {/* Separator */}
          <div className="hidden lg:block lg:w-px lg:self-stretch lg:bg-border" />

          {/* Preview column */}
          <div className="min-h-0 flex-1 overflow-y-auto lg:pl-2">
            <AccessScreenPreview
              fields={fields}
              requireEmail={requireEmail}
              requirePassword={requirePassword}
              requireAgreement={requireAgreement}
              welcomeMessage={welcomeMessage}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
