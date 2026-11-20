import * as React from "react";

import { Link2Icon } from "lucide-react";

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

import LoadingSpinner from "./loading-spinner";

/**
 * Props for SingleSelect component
 */
interface SingleSelectProps<TMeta = any>
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * An array of option objects to be displayed in the single-select component.
   * Each option object has a label, value, and optional metadata.
   */
  options: SingleSelectOption<TMeta>[];
  searchPlaceholder?: string;
  inputClassName?: string;
  optionClassName?: string;
  popoverClassName?: string;

  /**
   * Callback function triggered when the selected value changes.
   * Receives the new selected value (or empty string if cleared).
   */
  onValueChange: (value: string) => void;

  /** The current selected value. */
  value: string;

  /**
   * Placeholder text to be displayed when no value is selected.
   * Optional, defaults to "Select option".
   */
  placeholder?: string;

  /**
   * Additional class names to apply custom styles to the single-select component.
   * Optional, can be used to add custom styles.
   */
  className?: string;

  loading?: boolean;
  triggerIcon?: React.ReactNode;

  /**
   * Custom render function for each option in the list.
   * If not provided, will use default rendering with label only.
   */
  renderOption?: (
    option: SingleSelectOption<TMeta>,
    isSelected: boolean,
  ) => React.ReactNode;

  /**
   * Custom render function for the trigger button content.
   * If not provided, will use default rendering with label only.
   */
  renderTrigger?: (
    option: SingleSelectOption<TMeta> | null,
  ) => React.ReactNode;

  /**
   * Text to show when no options match the search.
   */
  emptyText?: string;
}

export type SingleSelectOption<TMeta = any> = {
  label: string;
  value: string;
  searchableText?: string; // Additional text to search through
  meta?: TMeta;
};

export const SingleSelect = React.forwardRef<
  HTMLButtonElement,
  SingleSelectProps
>(
  (
    {
      options,
      onValueChange,
      className,
      value,
      searchPlaceholder = "Search...",
      inputClassName,
      optionClassName,
      popoverClassName,
      placeholder = "Select option",
      loading,
      triggerIcon,
      renderOption,
      renderTrigger,
      emptyText = "No results found.",
      ...props
    },
    ref,
  ) => {
    const [isPopoverOpen, setIsPopoverOpen] = React.useState(false);
    const [search, setSearch] = React.useState("");

    const handleInputKeyDown = (
      event: React.KeyboardEvent<HTMLInputElement>,
    ) => {
      if (event.key === "Enter") {
        setIsPopoverOpen(true);
      } else if (event.key === "Escape") {
        setIsPopoverOpen(false);
      }
    };

    const handleSelect = (selectedValue: string) => {
      onValueChange(selectedValue);
      setIsPopoverOpen(false);
      setSearch("");
    };

    const handleTogglePopover = () => {
      setIsPopoverOpen((prev) => !prev);
    };

    const selectedOption = options.find((opt) => opt.value === value);

    // Filter options based on search
    const filteredOptions = React.useMemo(() => {
      if (!search) return options;
      const searchLower = search.toLowerCase();
      return options.filter((option) => {
        const searchText = option.searchableText || option.label;
        return searchText.toLowerCase().includes(searchLower);
      });
    }, [options, search]);

    return (
      <Popover open={isPopoverOpen} onOpenChange={setIsPopoverOpen} modal>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            {...props}
            onClick={handleTogglePopover}
            className={cn(
              "flex h-auto w-full items-center justify-start gap-3 rounded-md border border-input bg-inherit px-3 py-2 hover:bg-inherit focus:border-muted-foreground focus:outline-none focus:ring-1 focus:ring-inset focus:ring-muted-foreground dark:border-gray-500 dark:bg-gray-800 focus:dark:bg-transparent [&_svg]:pointer-events-auto",
              className,
            )}
          >
            {triggerIcon || (
              <Link2Icon className="!size-4 shrink-0 text-muted-foreground" />
            )}
            {loading ? (
              <div className="flex w-full items-center justify-between">
                <LoadingSpinner className="size-4 shrink-0" />
              </div>
            ) : selectedOption ? (
              <div className="flex w-full items-center overflow-hidden">
                {renderTrigger ? (
                  renderTrigger(selectedOption)
                ) : (
                  <span className="truncate text-sm text-foreground">
                    {selectedOption.label}
                  </span>
                )}
              </div>
            ) : (
              <span className="text-sm font-normal text-muted-foreground">
                {placeholder}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className={cn("p-0", popoverClassName)}
          align="start"
          style={{ width: "var(--radix-popover-trigger-width)" }}
          onEscapeKeyDown={() => setIsPopoverOpen(false)}
        >
          <Command shouldFilter={false}>
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
            <CommandList className="scroll-mask-y scrollbar-hide">
              <CommandGroup>
                {loading ? (
                  <CommandItem className="justify-center">
                    <LoadingSpinner className="size-4 shrink-0" />
                  </CommandItem>
                ) : filteredOptions.length > 0 ? (
                  filteredOptions.map((option) => {
                    const isSelected = value === option.value;
                    return (
                      <CommandItem
                        key={option.value}
                        onSelect={() => handleSelect(option.value)}
                        className={cn(
                          "cursor-pointer gap-2 py-2.5",
                          optionClassName,
                        )}
                        value={option.value}
                      >
                        {renderOption ? (
                          renderOption(option, isSelected)
                        ) : (
                          <span className="text-sm">{option.label}</span>
                        )}
                      </CommandItem>
                    );
                  })
                ) : (
                  <CommandItem disabled className="justify-center">
                    <span className="text-sm text-muted-foreground">
                      {emptyText}
                    </span>
                  </CommandItem>
                )}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    );
  },
);

SingleSelect.displayName = "SingleSelect";

