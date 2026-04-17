import * as React from "react";

import { type VariantProps, cva } from "class-variance-authority";
import { CheckIcon, PlusIcon, TagIcon, WandSparkles } from "lucide-react";

import { TagColorProps } from "@/lib/types";
import { cn } from "@/lib/utils";

import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

import TagBadge from "../links/link-sheet/tags/tag-badge";
import { Icon } from "../shared/icons";
import LoadingSpinner from "./loading-spinner";

/**
 * Variants for the multi-select component to handle different styles.
 * Uses class-variance-authority (cva) to define different styles based on "variant" prop.
 */
const multiSelectVariants = cva(
  "m-1 transition ease-in-out delay-150 hover:-translate-y-1 hover:scale-110 duration-300",
  {
    variants: {
      variant: {
        default:
          "border-foreground/10 text-foreground bg-card hover:bg-card/80",
        secondary:
          "border-foreground/10 bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        inverted: "inverted",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

/**
 * Props for MultiSelect component
 */
interface MultiSelectProps<
  TMeta = { color: string; description: string | null },
> extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof multiSelectVariants> {
  /**
   * An array of option objects to be displayed in the multi-select component.
   * Each option object has a label, value, and an optional icon.
   */
  options: ComboboxOption<TMeta>[];
  searchPlaceholder?: string;
  inputClassName?: string;
  createLabel?: (search: string) => React.ReactNode;
  onCreate?: (search: string) => Promise<boolean>;
  optionClassName?: string;

  /**
   * Callback function triggered when the selected values change.
   * Receives an array of the new selected values.
   */
  onValueChange: (value: string[]) => void;

  /** The default selected values when the component mounts. */
  defaultValue?: string[];

  /** update dynamic selected values when the value change. */
  value: string[];

  /**
   * Placeholder text to be displayed when no values are selected.
   * Optional, defaults to "Select options".
   */
  placeholder?: string;

  /**
   * Animation duration in seconds for the visual effects (e.g., bouncing badges).
   * Optional, defaults to 0 (no animation).
   */
  animation?: number;

  /**
   * Maximum number of items to display. Extra selected items will be summarized.
   * Optional, defaults to 3.
   */
  maxCount?: number;

  /**
   * The modality of the popover. When set to true, interaction with outside elements
   * will be disabled and only popover content will be visible to screen readers.
   * Optional, defaults to false.
   */
  modalPopover?: boolean;

  /**
   * If true, renders the multi-select component as a child of another component.
   * Optional, defaults to false.
   */
  asChild?: boolean;

  /**
   * Additional class names to apply custom styles to the multi-select component.
   * Optional, can be used to add custom styles.
   */
  className?: string;

  /**
   * Additional class names to apply to the popover content.
   * Optional, can be used to customize popover width and styles.
   */
  popoverClassName?: string;

  isPopoverOpen: boolean;
  setIsPopoverOpen: React.Dispatch<React.SetStateAction<boolean>>;
  loading?: boolean;
  triggerIcon?: React.ReactNode;
}

export type ComboboxOption<
  TMeta = { color: string; description: string | null },
> = {
  label: string | React.ReactNode;
  value: string;
  icon?: Icon | React.ReactNode;
  meta?: TMeta;
  separatorAfter?: boolean;
};

export const MultiSelect = React.forwardRef<
  HTMLButtonElement,
  MultiSelectProps
>(
  (
    {
      options,
      onValueChange,
      variant,
      defaultValue = [],
      placeholder = "Select options",
      animation = 0,
      maxCount = 3,
      modalPopover = false,
      asChild = false,
      className,
      popoverClassName,
      value,
      searchPlaceholder = "Search...",
      inputClassName,
      optionClassName,
      onCreate,
      createLabel,
      setIsPopoverOpen,
      isPopoverOpen,
      loading,
      triggerIcon,
      ...props
    },
    ref,
  ) => {
    // const [selectedValues, setSelectedValues] =
    //   React.useState<string[]>(defaultValue);
    const [isCreating, setIsCreating] = React.useState(false);
    const [isAnimating, setIsAnimating] = React.useState(false);
    const [search, setSearch] = React.useState("");

    const handleInputKeyDown = (
      event: React.KeyboardEvent<HTMLInputElement>,
    ) => {
      if (event.key === "Enter") {
        setIsPopoverOpen(true);
      } else if (event.key === "Backspace" && !event.currentTarget.value) {
        event.preventDefault();
        event.stopPropagation();
        const newSelectedValues = [...value];
        newSelectedValues.pop();
        // setSelectedValues(newSelectedValues);
        onValueChange(newSelectedValues);
      }
    };

    const toggleOption = (option: string) => {
      const newSelectedValues = value.includes(option)
        ? value.filter((value) => value !== option)
        : [...value, option];
      // setSelectedValues(newSelectedValues);
      onValueChange(newSelectedValues);
    };

    const handleClear = () => {
      // setSelectedValues([]);
      onValueChange([]);
    };

    const handleTogglePopover = () => {
      setIsPopoverOpen((prev) => !prev);
    };

    // const clearExtraOptions = () => {
    //   const newSelectedValues = value.slice(0, maxCount);
    //   // setSelectedValues(newSelectedValues);
    //   onValueChange(newSelectedValues);
    // };

    // const toggleAll = () => {
    //   if (value.length === options.length) {
    //     handleClear();
    //   } else {
    //     const allValues = options.map((option) => option.value);
    //     // setSelectedValues(allValues);
    //     onValueChange(allValues);
    //   }
    // };
    // flex w-full rounded-none rounded-l-md border border-input bg-white text-foreground placeholder-muted-foreground focus:border-muted-foreground focus:outline-none focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent sm:text-sm
    return (
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen} modal>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            {...props}
            onClick={handleTogglePopover}
            variant="outline"
            size="sm"
            className={cn(
              "flex w-full items-center justify-between gap-1.5 rounded-md border border-input bg-background px-2 py-0 font-normal shadow-sm hover:bg-background focus:border-muted-foreground focus:outline-none focus:ring-1 focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent sm:gap-2 sm:px-3 [&_svg]:pointer-events-auto",
              value.length === 0
                ? "h-9 max-h-9 min-h-9 sm:h-10 sm:max-h-10 sm:min-h-10"
                : "!h-auto min-h-9 py-1 sm:min-h-10 sm:py-1.5",
              className,
            )}
          >
            {triggerIcon || (
              <TagIcon className="!size-4 shrink-0 text-muted-foreground" />
            )}
            {loading ? (
              <div className="mx-auto flex w-full items-center justify-between">
                <LoadingSpinner className="size-4 shrink-0" />
              </div>
            ) : value.length > 0 ? (
              <div className="flex w-full items-center justify-between">
                <div className="flex flex-wrap items-center gap-2">
                  {value.slice(0, maxCount).map((value) => {
                    const option = options.find((o) => o.value === value);
                    return (
                      <TagBadge
                        key={value}
                        name={option?.label as string}
                        color={option?.meta?.color as TagColorProps}
                      />
                    );
                  })}
                  {value.length > maxCount && (
                    <span
                      className="my-auto block whitespace-nowrap rounded-md border px-2 py-0.5 text-sm text-foreground dark:border-gray-500"
                      style={{ animationDuration: `${animation}s` }}
                    >
                      +{value.length - maxCount} more
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="mx-auto flex w-full min-w-0 items-center justify-between">
                <span className="truncate py-0 text-sm font-normal leading-none text-muted-foreground">
                  {placeholder}
                </span>
              </div>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn(
            "w-auto p-0 sm:w-[600px] sm:max-w-[35rem]",
            popoverClassName,
          )}
          align="start"
          onEscapeKeyDown={() => setIsPopoverOpen(false)}
        >
          <Command>
            <CommandInput
              placeholder={searchPlaceholder}
              value={search}
              onValueChange={setSearch}
              noIcon
              wrapperClassName="px-0"
              className={cn(
                "grow border-0 py-3 outline-none placeholder:text-neutral-400 focus:ring-0 sm:text-sm",
                inputClassName,
              )}
              onKeyDown={handleInputKeyDown}
            />
            <ScrollArea>
              <CommandList>
                <CommandGroup>
                  {loading ? (
                    <CommandItem className="justify-center">
                      <LoadingSpinner className="size-4 shrink-0" />
                    </CommandItem>
                  ) : options.length > 0 ? (
                    options.map((option) => {
                      const isSelected = value.includes(option.value);
                      const IconComponent = option.icon;
                      return (
                        <CommandItem
                          key={option.value}
                          onSelect={() => toggleOption(option.value)}
                          className="cursor-pointer gap-2 py-2"
                          data-Value={option.value}
                        >
                          <div
                            className={cn(
                              "flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                              isSelected
                                ? "bg-primary text-primary-foreground"
                                : "opacity-50 [&_svg]:invisible",
                            )}
                          >
                            <CheckIcon className="h-4 w-4" />
                          </div>
                          {IconComponent && isReactNode(IconComponent) ? (
                            IconComponent
                          ) : typeof IconComponent === "function" ? (
                            <IconComponent className="h-5 w-4" />
                          ) : null}
                          <span>{option.label}</span>
                        </CommandItem>
                      );
                    })
                  ) : (
                    <CommandItem className="justify-center">
                      <span>No tags available</span>
                    </CommandItem>
                  )}
                </CommandGroup>
                {search.length > 0 && onCreate && (
                  <CommandGroup>
                    <CommandItem
                      className={cn(
                        "flex cursor-pointer items-center gap-2 whitespace-nowrap",
                        optionClassName,
                      )}
                      onSelect={async () => {
                        setIsCreating(true);
                        const success = await onCreate?.(search);
                        if (success) {
                          setSearch("");
                          setIsPopoverOpen(false);
                        }
                        setIsCreating(false);
                      }}
                    >
                      {isCreating ? (
                        <LoadingSpinner className="size-4 shrink-0" />
                      ) : (
                        <PlusIcon className="size-4 shrink-0" />
                      )}
                      <p className="grow truncate">
                        {createLabel?.(search) || `Create "${search}"`}
                      </p>
                    </CommandItem>
                  </CommandGroup>
                )}
              </CommandList>
            </ScrollArea>
          </Command>
        </PopoverContent>
        {animation > 0 && value.length > 0 && (
          <WandSparkles
            className={cn(
              "my-2 h-3 w-3 cursor-pointer bg-background text-foreground",
              isAnimating ? "" : "text-muted-foreground",
            )}
            onClick={() => setIsAnimating(!isAnimating)}
          />
        )}
      </Popover>
    );
  },
);

MultiSelect.displayName = "MultiSelect";

const isReactNode = (element: any): element is React.ReactNode =>
  React.isValidElement(element);
