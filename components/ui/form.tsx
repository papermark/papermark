import {
  InputHTMLAttributes,
  ReactNode,
  useEffect,
  useMemo,
  useState,
} from "react";

import { toast } from "sonner";

import { cn } from "@/lib/utils";
import { validateEmail } from "@/lib/utils/validate-email";

import PlanBadge from "../billing/plan-badge";
import { Button } from "./button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./card";
import { Input } from "./input";
import { Label } from "./label";
import { Switch } from "./switch";

export function Form({
  title,
  description,
  inputAttrs,
  helpText,
  buttonText = "Save Changes",
  disabledTooltip,
  handleSubmit,
  validate,
  defaultValue,
  plan,
}: {
  title: string;
  description: string;
  inputAttrs: InputHTMLAttributes<HTMLInputElement>;
  helpText?: string | ReactNode;
  buttonText?: string;
  disabledTooltip?: string | ReactNode;
  handleSubmit: (data: any) => Promise<any>;
  validate?: (data: string) => boolean;
  defaultValue?: string;
  plan?: string;
}) {
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (typeof defaultValue === "string") setValue(defaultValue);
  }, [defaultValue]);

  const saveDisabled = useMemo(() => {
    if (saving) return true;
    if (inputAttrs.type === "checkbox") {
      const currentValue = value === "true";
      const defaultVal = defaultValue === "true";
      return currentValue === defaultVal;
    }
    return !value || value === defaultValue;
  }, [saving, value, defaultValue, inputAttrs.type]);

  const renderInput = () => {
    if (inputAttrs.type === "checkbox") {
      return (
        <div className="flex items-center space-x-2">
          <Switch
            checked={value === "true"}
            onCheckedChange={(checked) => setValue(String(checked))}
            disabled={!!disabledTooltip}
            id={inputAttrs.name}
          />
          <Label
            htmlFor={inputAttrs.name}
            className="text-sm text-muted-foreground"
          >
            {inputAttrs.placeholder}
          </Label>
        </div>
      );
    }

    return (
      <Input
        {...inputAttrs}
        value={value}
        type={inputAttrs.type || "text"}
        required
        disabled={!!disabledTooltip}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => setValue(e.target.value.trim())}
        onKeyDown={(e) =>
          inputAttrs.type === "email" && e.key === " " && e.preventDefault()
        }
        className={cn(
          "w-full max-w-md focus:border-gray-500 focus:outline-none focus:ring-gray-500",
          {
            "cursor-not-allowed bg-gray-100 text-gray-400": disabledTooltip,
          },
        )}
        data-1p-ignore
      />
    );
  };

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setSaving(true);
        if (!validate || validate(value?.toString() || "")) {
          await handleSubmit({
            [inputAttrs.name as string]: value?.toString(),
          });
        } else {
          toast.error("Please enter a valid value");
        }
        setSaving(false);
      }}
      className="rounded-lg"
    >
      <Card className="bg-transparent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {title} {plan && <PlanBadge plan={plan} />}
          </CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          {typeof defaultValue === "string" ? (
            renderInput()
          ) : (
            <div className="h-[2.35rem] w-full max-w-md animate-pulse rounded-md bg-gray-200" />
          )}
        </CardContent>
        <CardFooter className="flex items-center justify-between rounded-b-lg border-t bg-muted px-6 py-3">
          {typeof helpText === "string" ? (
            <p
              className="text-sm text-muted-foreground transition-colors"
              dangerouslySetInnerHTML={{ __html: helpText || "" }}
            />
          ) : (
            helpText
          )}
          <div className="shrink-0">
            <Button loading={saving} disabled={saveDisabled}>
              {buttonText}
            </Button>
          </div>
        </CardFooter>
      </Card>
    </form>
  );
}
